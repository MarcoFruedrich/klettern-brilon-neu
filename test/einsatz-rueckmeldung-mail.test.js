'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createEinsatzRueckmeldungMailer}=require('../lib/einsatz-rueckmeldung-mail');

const bookingId='550e8400-e29b-41d4-a716-446655440000';
const staffId='550e8400-e29b-41d4-a716-446655440001';
function f({mail=async()=>{},adminEmail='admin@example.test',completeFails=false}={}){
  const sent=[];let state='',versuch='';
  const booking={buchungsnummer:'KA-100',angebot:'Klettern pur',datum:'2026-12-09',
    uhrzeit:'12:00',veranstaltungsort:'Brilon'};
  const pool={async query(sql,args=[]){
    if(sql.includes("NOT IN ('wird_versendet','angenommen','unklar')")){
      if(['wird_versendet','angenommen','unklar'].includes(state))
        return {rows:[],rowCount:0};
      versuch=JSON.parse(args[2]).versuch;state='wird_versendet';
      return {rows:[{data:booking}],rowCount:1};
    }
    if(sql.includes("'status']='wird_versendet'")){
      if(completeFails)throw Error('DB failed');
      if(args[2]!==versuch||state!=='wird_versendet')return {rows:[],rowCount:0};
      state=JSON.parse(args[3]).status;return {rows:[{id:bookingId}],rowCount:1};
    }
    throw Error('Unexpected SQL '+sql);
  }};
  const informiere=createEinsatzRueckmeldungMailer({
    pool,env:{BOOKING_NOTIFY_EMAIL:adminEmail},
    brevoMail:async(...args)=>{sent.push(args);await mail(...args);}
  });
  return {send:(entscheidung='bestaetigt')=>informiere({buchungId:bookingId,mitarbeiterId:staffId,
    mitarbeiterName:'Testtrainer',entscheidung,anschlussOption:'danach'}),sent,get state(){return state;}};
}
test('Zusage informiert Verwaltung und dokumentiert Annahme beim Anbieter',async()=>{
  const x=f();assert.equal((await x.send()).status,'angenommen');
  assert.equal(x.sent.length,1);
  assert.equal(x.sent[0][0],'admin@example.test');
  assert.match(x.sent[0][2],/Anschlussoption: danach/);
  assert.equal(x.state,'angenommen');
});
test('Absage enthält die richtige Entscheidung',async()=>{
  const x=f();assert.equal((await x.send('abgelehnt')).status,'angenommen');
  assert.match(x.sent[0][1],/Mitarbeiterabsage/);
});
test('Gleichzeitige Rückmeldung löst keine zweite E-Mail aus',async()=>{
  let finish,started;const pending=new Promise(r=>finish=r),open=new Promise(r=>started=r);
  const x=f({mail:async()=>{started();await pending;}});
  const first=x.send();await open;
  assert.equal((await x.send()).blockiert,true);
  finish();assert.equal((await first).status,'angenommen');assert.equal(x.sent.length,1);
});
test('Unklare Providerantwort bleibt gesperrt',async()=>{
  const x=f({mail:async()=>{const e=Error('timeout');e.uncertain=true;throw e;}});
  assert.equal((await x.send()).status,'unklar');
  assert.equal((await x.send()).blockiert,true);assert.equal(x.sent.length,1);
});
test('Fehlende Verwaltungsadresse ist dokumentiert und blockiert keine sonstige Buchungsaktion',async()=>{
  const x=f({adminEmail:''});
  assert.equal((await x.send()).status,'keine_adresse');
  assert.equal(x.sent.length,0);
});
test('Datenbankfehler nach Mailannahme bleiben unklar',async()=>{
  const x=f({completeFails:true});
  assert.equal((await x.send()).status,'unklar');
  assert.equal((await x.send()).blockiert,true);
  assert.equal(x.sent.length,1);
});
test('Definitiver Mailfehler wird sichtbar protokolliert',async()=>{
  const x=f({mail:async()=>{throw Error('Brevo 400');}});
  assert.equal((await x.send()).status,'fehlgeschlagen');
});
