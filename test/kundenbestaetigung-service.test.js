'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createKundenbestaetigungService}=require('../lib/kundenbestaetigung-service');

function mockFall({angezahlt=false,partner=false,zahlungsinfoStatus=null,manuellGesendetAm=null,
  laufenderManuellerVersand=false,bestaetigungStatus=null,kundeEmail='kunde@example.test',
  gesamtpreis=100,offeneEinteilungen=0}={}){
  const mails=[],updates=[];let available=true;
  const data={email:kundeEmail,partnerhausKontaktEmail:'partner@example.test',
    partnerhausKontaktName:'Jugendherberge',name:'Max Muster',vorname:'Max',
    angebot:'Kistenklettern',datum:'2026-11-08',uhrzeit:'12:00',buchungsnummer:'MUSTER-MAX-081126',
    buchungsmodus:'gruppe',gesamtpreis,anzahlung:25,restbetrag:75,
    zahlungen:angezahlt?[{betragCent:2500,methode:'ueberweisung'}]:[],
    ...(partner?{partnerhausAbwicklung:true}:{}),
    ...(zahlungsinfoStatus?{zahlungsinfoVersand:{status:zahlungsinfoStatus}}:{})};
  const pool={
    async query(sql,params=[]){
      if(sql.includes('SELECT data FROM brilon_rechnungsdaten'))
        return {rows:[{data:{bankname:'Testbank',iban:'DE00123456780000000000'}}],rowCount:1};
      if(sql.includes("SELECT data #>> '{bestaetigungsEmail,status}'"))
        return {rows:[{status:bestaetigungStatus}],rowCount:1};
      if(sql.includes('SELECT zahlungsinfo_gesendet_am')){
        return {rows:[{zahlungsinfo_gesendet_am:manuellGesendetAm,
          status:laufenderManuellerVersand?'unklar':zahlungsinfoStatus}],rowCount:1};
      }
      if(sql.includes('UPDATE brilon_kundenbestaetigungen')){
        updates.push({kind:'queue',params,sql});return {rows:[],rowCount:1};
      }
      if(sql.includes('UPDATE brilon_buchungen')&&sql.includes('partnerhausWeiterleitung')){
        updates.push({kind:'partner',params,sql});
        if(sql.includes('RETURNING data,status'))
          return {rows:[{data,status:'offen'}],rowCount:1};
        return {rows:[{id:'booking-1'}],rowCount:1};
      }
      if(sql.includes('UPDATE brilon_buchungen')){
        updates.push({kind:'booking',params,sql});
        if(sql.includes("NOT IN ('wird_versendet'")&&
          ['angenommen','ungeklaert','wird_versendet'].includes(bestaetigungStatus))
          return {rows:[],rowCount:0};
        if(sql.includes('zahlungsinfo_gesendet_am IS NULL')&&laufenderManuellerVersand)
          return {rows:[],rowCount:0};
        if(sql.includes('zahlungsinfo_gesendet_am IS NULL')&&manuellGesendetAm)
          return {rows:[],rowCount:0};
        return {rows:sql.includes('RETURNING')?[{id:'booking-1',
          zahlungsinfo_gesendet_am:'2026-11-20T18:00:00Z'}]:[],rowCount:1};
      }
      throw new Error('Unerwartetes SQL: '+sql);
    },
    async connect(){
      return {async query(sql,params=[]){
        if(/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql))return {rows:[],rowCount:0};
        if(sql.includes('SELECT q.buchung_id,b.data,b.status AS buchungsstatus')){
          if(!available)return {rows:[],rowCount:0};
          available=false;
          return {rows:[{buchung_id:'booking-1',data,buchungsstatus:'offen',zahlungsinfo_gesendet_am:manuellGesendetAm}],rowCount:1};
        }
        if(sql.includes("COUNT(*) FILTER (WHERE status='eingeteilt')"))
          return {rows:[{offen:offeneEinteilungen,bestaetigt:1}],rowCount:1};
        if(sql.includes('UPDATE brilon_kundenbestaetigungen'))
          return {rows:[],rowCount:1};
        throw new Error('Unerwartetes Transaktions-SQL: '+sql);
      },release(){}};
    }
  };
  const service=createKundenbestaetigungService({pool,brevoMail:async(...args)=>mails.push(args)});
  return {service,mails,updates};
}

test('Ohne Anzahlung nur vorläufige Zahlungsaufforderung, niemals verbindliche Zusage',async()=>{
  const x=mockFall();
  await x.service.processQueue();
  assert.equal(x.mails.length,1);
  assert.match(x.mails[0][1],/Zahlungsinformationen/);
  assert.match(x.mails[0][2],/UNVERBINDLICH/);
  assert.match(x.mails[0][2],/Anzahlung \(25 %\), jetzt fällig: 25,00 €/);
  assert.match(x.mails[0][2],/IBAN: DE00123456780000000000/);
  assert.ok(x.updates.some(v=>v.sql.includes('zahlungsinfo_gesendet_am=NOW()')));
  assert.ok(!x.updates.some(v=>v.sql.includes("status='bestaetigt'")));
});

test('Mit erfasster Anzahlung und Trainerfreigabe verbindliche Buchungsbestätigung',async()=>{
  const x=mockFall({angezahlt:true});
  await x.service.processQueue();
  assert.equal(x.mails.length,1);
  assert.match(x.mails[0][1],/Verbindliche Buchungsbestätigung/);
  assert.match(x.mails[0][2],/verbindlich/);
  assert.ok(x.updates.some(v=>v.sql.includes("status='bestaetigt'")));
});

test('Nach letzter Mitarbeiterzusage wird der Netzwerkpartner informiert, nicht der Gast',async()=>{
  const x=mockFall({partner:true,kundeEmail:'',gesamtpreis:null});
  await x.service.processQueue();
  assert.equal(x.mails.length,1);
  assert.equal(x.mails[0][0],'partner@example.test');
  assert.match(x.mails[0][1],/Alle Mitarbeiter haben zugesagt/);
  assert.match(x.mails[0][2],/Zahlungsinformationen und Ihre Buchungsbedingungen/);
  assert.doesNotMatch(x.mails[0][2],/IBAN:|Anzahlung \(25 %\)/);
  assert.ok(x.updates.some(v=>v.kind==='partner'));
  assert.ok(!x.updates.some(v=>v.kind==='booking'));
  assert.ok(x.updates.some(v=>v.kind==='queue'&&v.params[1]==='gesendet'));
});

test('Solange eine zugewiesene Person nicht zugestimmt hat, wird niemand informiert',async()=>{
  const direkt=mockFall({offeneEinteilungen:1});
  await direkt.service.processQueue();
  assert.equal(direkt.mails.length,0);
  const partner=mockFall({partner:true,offeneEinteilungen:1});
  await partner.service.processQueue();
  assert.equal(partner.mails.length,0);
});

test('Bei Partnerabrechnung werden auch ohne Kundenadresse und Preis niemals eigene Zahlungsdetails verschickt',async()=>{
  const x=mockFall({partner:true,kundeEmail:null,gesamtpreis:null});
  await x.service.processQueue();
  assert.equal(x.mails.length,1);
  assert.ok(x.mails[0][0]==='partner@example.test');
  assert.ok(!x.updates.some(x=>x.sql.includes('zahlungsinfo_gesendet_am=NOW()')));
});

test('Nach manueller Versandreservierung löst die automatische Warteschlange keine zweite E-Mail aus',async()=>{
  const x=mockFall({zahlungsinfoStatus:'unklar'});
  await x.service.processQueue();
  assert.equal(x.mails.length,0);
  assert.ok(x.updates.some(update=>update.kind==='queue'&&update.sql.includes("status='abgebrochen'")));
});

test('Zeitgleich gestarteter manueller Versand blockiert den automatischen Sendeversuch atomar',async()=>{
  const x=mockFall({laufenderManuellerVersand:true});
  await x.service.processQueue();
  assert.equal(x.mails.length,0);
  assert.ok(x.updates.some(update=>update.kind==='booking'&&update.sql.includes('zahlungsinfo_gesendet_am IS NULL')));
});

test('Früher versandte Zahlungsinformationen bleiben auch nach Queue-Neustart gesperrt',async()=>{
  const x=mockFall({manuellGesendetAm:'2026-11-20T10:00:00Z'});
  await x.service.processQueue();
  assert.equal(x.mails.length,0);
});

test('Automatische Bestätigung verwendet dieselbe Reservierung wie die Verwaltung',async()=>{
  const x=mockFall({angezahlt:true});await x.service.processQueue();
  assert.equal(x.mails.length,1);
  assert.ok(x.updates.some(row=>row.sql.includes("NOT IN ('wird_versendet'")));
  assert.ok(x.updates.some(row=>row.sql.includes("'{bestaetigungsEmail,versuch}'=$3")));
});
test('Manuell angenommene Bestätigung wird automatisch nicht erneut gesendet',async()=>{
  const x=mockFall({angezahlt:true,bestaetigungStatus:'angenommen'});
  await x.service.processQueue();
  assert.equal(x.mails.length,0);
  assert.ok(x.updates.some(row=>row.kind==='queue'&&row.sql.includes("status='gesendet'")));
});
test('Unklarer Status verhindert automatische Bestätigung des Termins',async()=>{
  const x=mockFall({angezahlt:true,bestaetigungStatus:'ungeklaert'});
  await x.service.processQueue();
  assert.equal(x.mails.length,0);
  assert.ok(!x.updates.some(row=>row.kind==='booking'&&row.sql.includes("status='bestaetigt'")));
  assert.ok(x.updates.some(row=>row.kind==='queue'&&row.sql.includes("status='abgebrochen'")));
});

test('Bei allen zugewiesenen Mitarbeiterzusagen wird ohne Sonderfreigabe ein Versand geplant',async()=>{
  const queries=[];
  const pool={async query(sql,params=[]){
    queries.push({sql,params});
    if(sql.includes('SELECT b.id FROM brilon_buchungen b'))return {rowCount:1,rows:[{id:'booking-1'}]};
    if(sql.includes('SELECT verzoegerung_minuten AS'))return {rowCount:1,rows:[{
      verzoegerungMinuten:120,ruhebeginn:'18:00',ruheende:'09:00'
    }]};
    if(sql.includes('INSERT INTO brilon_kundenbestaetigungen'))
      return {rowCount:1,rows:[{faellig_ab:new Date('2026-11-21T08:00:00Z')}]};
    throw Error('Unerwartetes SQL: '+sql);
  }};
  const service=createKundenbestaetigungService({pool,brevoMail:async()=>{}});
  const result=await service.schedule('booking-1','staff-last');
  assert.equal(result.geplant,true);
  const check=queries[0].sql;
  assert.match(check,/e.status='bestaetigt'/);
  assert.match(check,/NOT EXISTS\(SELECT 1 FROM brilon_einsaetze e\s+WHERE e.buchung_id=b.id AND e.status='eingeteilt'\)/);
  assert.doesNotMatch(check,/c.vertrauensperson/);
  assert.ok(queries.some(x=>x.sql.includes('INSERT INTO brilon_kundenbestaetigungen')));
});
