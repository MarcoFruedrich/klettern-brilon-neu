'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPruefungApi}=require('../lib/stationspruefung-api');

function scenario({anzahlung=false,partner=false,mailerStatus='angenommen'}={}){
  const statements=[],emails=[];
  const data={
    name:'Max',email:'kunde@example.test',angebot:'Klettergeburtstag',
    datum:'2026-12-05',uhrzeit:'14:00',buchungsnummer:'CI-TRE-001',
    buchungsmodus:'gruppe',gesamtpreis:partner?null:200,
    zahlungen:anzahlung?[{betragCent:5000,methode:'ueberweisung'}]:[],
    partnerhausAbwicklung:partner
  };
  const state={buchung:'offen',queue:'ausstehend',data};
  const queueRecord={id:'job-1',mitarbeiter_id:'staff-1',buchung_id:'booking-1'};
  const query=async(sql,params=[])=>{
    statements.push({sql,params});
    if(/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql))return {rows:[],rowCount:0};
    if(sql.includes('SELECT id,mitarbeiter_id,buchung_id FROM brilon_mitarbeiter_buchungsbestaetigungen')){
      return {rows:[queueRecord],rowCount:1};
    }
    if(sql.includes('SELECT aktiv,')&&sql.includes('FROM brilon_pruef_mitarbeitende'))
      return {rows:[{aktiv:true,freigegeben:true}],rowCount:1};
    if(sql.includes('SELECT id,data,status FROM brilon_buchungen'))
      return {rows:[{id:'booking-1',status:state.buchung,data:state.data}],rowCount:1};
    if(sql.includes('SELECT id,buchung_id,mitarbeiter_id FROM brilon_mitarbeiter_buchungsbestaetigungen'))
      return {rows:[queueRecord],rowCount:1};
    if(sql.includes('SELECT status FROM brilon_mitarbeiter_buchungsbestaetigungen'))
      return {rows:[{status:state.queue}],rowCount:1};
    if(sql.includes('UPDATE brilon_buchungen SET status=\'bestaetigt\''))
      state.buchung='bestaetigt';
    if(sql.includes('UPDATE brilon_mitarbeiter_buchungsbestaetigungen SET status=\'wird_versendet\''))
      state.queue='wird_versendet';
    if(sql.includes('UPDATE brilon_mitarbeiter_buchungsbestaetigungen SET status=\'angenommen\''))
      state.queue='angenommen';
    if(sql.includes('UPDATE brilon_mitarbeiter_buchungsbestaetigungen SET status=\'fehlgeschlagen\''))
      state.queue='fehlgeschlagen';
    if(sql.includes('UPDATE'))return {rows:[],rowCount:1};
    throw new Error('Unerwartete Testabfrage: '+sql);
  };
  const pool={query,async connect(){return {query,release(){}};}};
  const api=createPruefungApi({
    pool,admin:async()=>true,reply:()=>{},body:async()=>({}),
    sameOriginMutation:()=>true,limit:()=>true,
    brevoMail:async()=>{},scanForMalware:async()=>({sauber:true}),
    buchungsbestaetigungsEmail:async mail=>{emails.push(mail);return {status:mailerStatus};},
    env:{EMPLOYEE_BOOKING_CONFIRMATIONS_ENABLED:'true',
      BANK_NAME:'Testbank',BANK_IBAN:'DE00123456780000000000'}
  });
  return {api,statements,emails,state};
}

test('Zeitgesteuerte Trainerzusage ohne Anzahlung versendet nur Vormerkung und lässt Buchung offen',async()=>{
  const x=scenario();
  await x.api.sendDueBookingConfirmations();
  assert.equal(x.emails.length,1);
  assert.match(x.emails[0].betreff,/unverbindlichen Terminanfrage/);
  assert.match(x.emails[0].text,/unverbindliche Buchungsanfrage/);
  assert.equal(x.state.buchung,'offen');
  assert.equal(x.state.queue,'angenommen');
  assert.ok(x.statements.some(x=>x.sql.includes('zahlungsinfo_gesendet_am=COALESCE')));
  assert.ok(!x.statements.some(x=>x.sql.includes("SET status='bestaetigt'")),
    'Ohne Anzahlung muss der Status offen bleiben');
});

test('Nach 25 Prozent Zahlung darf zeitgesteuerte Trainerzusage verbindlich werden',async()=>{
  const x=scenario({anzahlung:true});
  await x.api.sendDueBookingConfirmations();
  assert.equal(x.emails.length,1);
  assert.match(x.emails[0].text,/verbindlich bestätigt/);
  assert.doesNotMatch(x.emails[0].text,/unverbindliche Buchungsanfrage/);
  assert.equal(x.state.buchung,'bestaetigt');
  assert.equal(x.state.queue,'angenommen');
});

test('Bei Partnerabrechnung wird Gast ohne eigene Zahlungsforderung bestätigt',async()=>{
  const x=scenario({partner:true});
  await x.api.sendDueBookingConfirmations();
  assert.equal(x.emails.length,1);
  assert.match(x.emails[0].text,/Abrechnung erfolgt über das Partnerhaus/);
  assert.doesNotMatch(x.emails[0].text,/IBAN:/);
  assert.equal(x.state.buchung,'bestaetigt');
});

test('Ungeklärter E-Mail-Versand bestätigt keine Buchung',async()=>{
  const x=scenario({anzahlung:true,mailerStatus:'ungeklaert'});
  await x.api.sendDueBookingConfirmations();
  assert.equal(x.state.buchung,'offen');
  assert.equal(x.state.queue,'fehlgeschlagen');
});
