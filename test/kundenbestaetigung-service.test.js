'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createKundenbestaetigungService}=require('../lib/kundenbestaetigung-service');

function mockFall({angezahlt=false,partner=false,zahlungsinfoStatus=null,manuellGesendetAm=null,
  laufenderManuellerVersand=false}={}){
  const mails=[],updates=[];let available=true;
  const data={email:'kunde@example.test',name:'Max Muster',vorname:'Max',
    angebot:'Kistenklettern',datum:'2026-11-08',uhrzeit:'12:00',buchungsnummer:'MUSTER-MAX-081126',
    buchungsmodus:'gruppe',gesamtpreis:100,anzahlung:25,restbetrag:75,
    zahlungen:angezahlt?[{betragCent:2500,methode:'ueberweisung'}]:[],
    ...(partner?{partnerhausAbwicklung:true}:{}),
    ...(zahlungsinfoStatus?{zahlungsinfoVersand:{status:zahlungsinfoStatus}}:{})};
  const pool={
    async query(sql,params=[]){
      if(sql.includes('SELECT data FROM brilon_rechnungsdaten'))
        return {rows:[{data:{bankname:'Testbank',iban:'DE00123456780000000000'}}],rowCount:1};
      if(sql.includes('SELECT zahlungsinfo_gesendet_am')){
        return {rows:[{zahlungsinfo_gesendet_am:manuellGesendetAm,
          status:laufenderManuellerVersand?'unklar':zahlungsinfoStatus}],rowCount:1};
      }
      if(sql.includes('UPDATE brilon_kundenbestaetigungen')){
        updates.push({kind:'queue',params,sql});return {rows:[],rowCount:1};
      }
      if(sql.includes('UPDATE brilon_buchungen')){
        updates.push({kind:'booking',params,sql});
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
          return {rows:[{offen:0,bestaetigt:1}],rowCount:1};
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

test('Partnerhausbuchungen lösen keine direkte Zahlungsaufforderung oder Buchungsbestätigung aus',async()=>{
  const x=mockFall({partner:true});
  await x.service.processQueue();
  assert.equal(x.mails.length,0);
  assert.ok(!x.updates.some(v=>v.kind==='booking'));
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
