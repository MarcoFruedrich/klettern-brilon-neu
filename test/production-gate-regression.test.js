'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {zahlungsstand}=require('../lib/buchungslogik');
const {createPdf,formatDate}=require('../lib/rechnung');
const {createKundenrechnungsversand}=require('../lib/kundenrechnungsversand');
const {sonderangebotVorschlaege}=require('../lib/sonderangebot-vorschlaege');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const spontan=fs.readFileSync(path.join(__dirname,'..','lib','spontangruppen-api.js'),'utf8');

function invoiceFixture(partner=false){
  const mails=[],queries=[];let gespeicherteRechnung=null,mailStatus='ausstehend';
  const settings={firma:'Klettern Test',name:'Beispielfirma',strasse:'Testweg 7',
    plz:'59602',ort:'Rüthen',email:'firma@example.test',telefon:'012345678',
    steuerhinweis:'Besteuerung nach geltender Gesetzeslage'};
  const booking={name:'Max Muster',email:'kunde@example.test',angebot:'Klettern',datum:'2026-12-03',
    uhrzeit:'10:00',teilnehmer:6,dauer:180,buchungsnummer:'KA-TEST-001',veranstaltungsort:'Brilon',
    gesamtpreis:100,zahlungen:[{betragCent:10000,methode:'ueberweisung',eingangsdatum:'2026-11-19'}],
    ...(partner?{partnerhausAbwicklung:true}:{})};
  const client={async query(sql,params=[]){
    queries.push({sql,params});
    if(/^\s*(BEGIN|COMMIT|ROLLBACK)\b/.test(sql))return {rows:[],rowCount:0};
    if(sql.includes('SELECT id,data,status FROM brilon_buchungen'))
      return {rows:[{id:'550e8400-e29b-41d4-a716-446655440000',data:booking,status:'bestaetigt'}],rowCount:1};
    if(sql.includes('SELECT id,rechnungsnummer,email_status FROM brilon_rechnungen'))
      return {rows:[],rowCount:0};
    if(sql.includes('SELECT data,naechste_nummer FROM brilon_rechnungsdaten'))
      return {rows:[{data:settings,naechste_nummer:1}],rowCount:1};
    if(sql.includes('INSERT INTO brilon_rechnungen')){
      gespeicherteRechnung={
        id:params[0],buchung_id:params[1],rechnungsnummer:params[2],
        data:JSON.parse(params[3]),pdf:params[4]
      };
      return {rows:[],rowCount:1};
    }
    if(sql.startsWith('UPDATE ')||sql.startsWith('INSERT INTO '))
      return {rows:[],rowCount:1};
    throw new Error('Unexpected SQL '+sql);
  },release(){}};
  const pool={connect:async()=>client,async query(sql,params=[]){
    queries.push({sql,params});
    if(sql.includes("SET email_status='unklar'")&&sql.includes('RETURNING id,buchung_id')){
      if(!gespeicherteRechnung||mailStatus!=='ausstehend')return {rows:[],rowCount:0};
      mailStatus='unklar';return {rows:[gespeicherteRechnung],rowCount:1};
    }
    if(sql.includes("SELECT data->>'email' AS email"))
      return {rows:[{email:booking.email,partnerhaus:booking.partnerhausAbwicklung===true}],rowCount:1};
    if(sql.includes("SET email_status='angenommen'"))mailStatus='angenommen';
    if(sql.includes('SELECT rechnungsnummer,email_status FROM brilon_rechnungen'))
      return {rows:[{rechnungsnummer:gespeicherteRechnung?.rechnungsnummer,email_status:mailStatus}],rowCount:1};
    return {rows:[],rowCount:1};
  }};
  const start=server.indexOf('async function rechnungSichernUndVersenden(');
  const end=server.indexOf('function gueltigesDatum(',start);
  assert.ok(start>0&&end>start);
  const kundenrechnungVersenden=createKundenrechnungsversand({
    pool,brevoMail:async(...args)=>mails.push(args)
  });
  const func=new Function('pool','kundenrechnungVersenden','crypto','safeText','zahlungsstand',
    'erstelleRechnungsPdf','rechnungsDatumFormatieren','heuteInBerlin','rechnungsdatenVollstaendig',
    server.slice(start,end)+'\nreturn rechnungSichernUndVersenden;')(
    pool,kundenrechnungVersenden,crypto,
    (value,n=200)=>typeof value==='string'?value.trim().slice(0,n):'',zahlungsstand,
    createPdf,formatDate,()=> '2026-11-19',
    data=>Boolean(data.firma&&data.name&&data.strasse&&data.plz&&data.ort&&data.email&&data.telefon&&data.steuerhinweis));
  return {func,mails,queries,booking};
}

test('Vollständig bezahlte Direktbuchung erzeugt eine PDF-Rechnung und versendet sie ohne Scope-Fehler',async()=>{
  const x=invoiceFixture();
  const res=await x.func('550e8400-e29b-41d4-a716-446655440000');
  assert.equal(res.status,'angenommen');
  assert.equal(x.mails.length,1);
  assert.match(x.mails[0][2],/Rechnung KA-2026-0001/);
  assert.equal(x.mails[0][3].attachments.length,1);
  assert.ok(Buffer.from(x.mails[0][3].attachments[0].content,'base64').toString('latin1').startsWith('%PDF'));
  assert.ok(x.queries.some(q=>q.sql.includes('INSERT INTO brilon_rechnungen')));
});

test('Partnerhaus-Gäste erhalten weder eigene Rechnung noch eigene Zahlungsaufforderung',async()=>{
  const x=invoiceFixture(true);
  const res=await x.func('550e8400-e29b-41d4-a716-446655440000');
  assert.equal(res.status,'partnerhaus_abrechnung');
  assert.equal(x.mails.length,0);
  assert.ok(!x.queries.some(q=>q.sql.includes('INSERT INTO brilon_rechnungen')));
  assert.match(server,/Diese Buchung wird direkt vom Partnerhaus abgerechnet/);
  assert.match(server,/Eigene Zahlungsaufforderungen sind gesperrt/);
});

test('Partnerrechnungen und zugehörige Anwesenheitsdaten werden nicht durch automatischen Sitzungs-DELETE gelöscht',()=>{
  assert.doesNotMatch(spontan,/await pool.query\(["']DELETE FROM brilon_spontan_sessions/);
  assert.match(spontan,/Finanzrelevante Sessions NICHT automatisch löschen/);
});

test('Automatische Folgeangebote erscheinen erst nach verbindlich bestätigter Hauptbuchung',async()=>{
  let available=true;
  const mail=[];
  const booking={id:'booking-abc',status:'offen',data:{angebot:'Klettern',datum:'2026-12-03',
    uhrzeit:'12:00',dauer:180,teilnehmer:6,veranstaltungsort:'Brilon',programmId:'4'}};
  const client={async query(sql,params=[]){
    if(/^\s*(BEGIN|COMMIT|ROLLBACK)\b/.test(sql))return {rowCount:0,rows:[]};
    if(sql.includes('FROM brilon_buchungen WHERE id=$1 FOR UPDATE'))
      return {rowCount:1,rows:[booking]};
    if(sql.includes('FROM brilon_angebote WHERE'))
      return {rowCount:1,rows:[{id:4,name:'Klettern',veranstaltungsort:'Brilon',
        veranstaltungsorte:['Brilon'],kapazitaet:15,verfuegbare_termine:[],
        preise:{'1-10':165},gruppenstufen:[{min:1,max:10,dauer:180,preis:165}]}]};
    if(sql.includes('FROM brilon_einsaetze e JOIN brilon_pruef_mitarbeitende'))
      return {rowCount:1,rows:[{mitarbeiter_id:'staff-1',name:'Trainerin',
        anschluss_option:'danach'}]};
    if(sql.includes('FROM brilon_aktionen WHERE'))
      return {rowCount:0,rows:[]};
    if(sql.includes('FROM brilon_buchungen')||sql.includes('FROM brilon_kalender')||
      sql.includes('FROM brilon_einsaetze e'))
      return {rowCount:0,rows:[]};
    if(sql.includes('INSERT INTO brilon_aktionen')){
      mail.push(JSON.parse(params[1]));return {rowCount:1,rows:[]};
    }
    throw new Error('Unexpected addon SQL '+sql);
  },release(){}};
  const pool={connect:async()=>client};
  const pending=await sonderangebotVorschlaege(pool,booking.id);
  assert.equal(pending.ok,false);
  assert.equal(mail.length,0);
  booking.status='bestaetigt';
  const confirmed=await sonderangebotVorschlaege(pool,booking.id);
  assert.equal(confirmed.ok,true);
  assert.equal(confirmed.anzahl,1);
  assert.equal(mail.length,1);
  assert.equal(mail[0].quelle_buchung_id,booking.id);
  assert.equal(mail[0].veranstaltungsort,'Brilon');
  assert.equal(mail[0].preis,'165.00');
  assert.equal(mail[0].status,'veroeffentlicht');
});

test('Zeitfenster- und Kapazitätsprüfung ist standortbezogen statt ganztags',()=>{
  assert.match(server,/einzelplatz\?\{angebot,uhrzeit:data\.uhrzeit\}:null,bookingSite/);
  assert.match(server,/Gruppenangebote können zeitlich nacheinander ohne Tageslimit gebucht werden/);
  assert.match(server,/uhrzeit < \$4::time AND endzeit > \$3::time/);
  assert.match(server,/SELECT uhrzeit::text AS uhrzeit,endzeit::text AS endzeit/);
});
