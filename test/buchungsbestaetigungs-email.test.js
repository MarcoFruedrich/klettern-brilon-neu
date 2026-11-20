'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createBuchungsbestaetigungsMailer}=require('../lib/buchungsbestaetigungs-email');

function testMailer(sendEmail,{finishFails=false,reserveFails=false}={}){
  const gespeicherte=[];
  let state=null;
  const pool={async query(sql,params){
    if(sql.includes("NOT IN ('wird_versendet'")){
      if(reserveFails)throw new Error('DB-Verbindung unterbrochen');
      if(state&&['wird_versendet','angenommen','ungeklaert'].includes(state.status))
        return {rows:[],rowCount:0};
      state=JSON.parse(params[0]);gespeicherte.push(state);
      return {rows:[{id:params[1]}],rowCount:1};
    }
    if(sql.includes("SELECT data #>> '{bestaetigungsEmail,status}'"))
      return {rows:[{status:state?.status}],rowCount:1};
    if(sql.includes("'{bestaetigungsEmail,versuch}'=$3")){
      if(finishFails)throw new Error('Datenbank konnte Status nicht speichern');
      const data=JSON.parse(params[0]);
      if(state?.versuch!==params[2]||state?.status!=='wird_versendet')
        return {rows:[],rowCount:0};
      state=data;gespeicherte.push(state);
      return {rows:[{id:params[1]}],rowCount:1};
    }
    throw new Error('Unerwartetes SQL');
  }};
  let clock=0;
  const mail=createBuchungsbestaetigungsMailer({
    pool,sendEmail,logger:{error(){}},
    now:()=>new Date(1762198615000+clock++*1000)
  });
  const args={buchungId:'booking-1',email:'kunde@example.test',betreff:'Bestätigt',text:'Text'};
  return {mail:()=>mail(args),gespeicherte,get status(){return state?.status;}};
}

test('protokolliert Versuch und Annahme der Buchungsbestätigung durch den Anbieter',async()=>{
  let idempotency;
  const {mail,gespeicherte}=testMailer(async(_a,_b,_c,options)=>{idempotency=options.idempotencyKey;});
  const result=await mail();
  assert.deepEqual(gespeicherte.map(item=>item.status),['wird_versendet','angenommen']);
  assert.ok(/^[0-9a-f-]{36}$/i.test(idempotency));
  assert.equal(result.angenommenAm!==null,true);
  assert.equal(result.fehler,null);
});

test('protokolliert eine eindeutige Fehlermeldung des Mailversands',async()=>{
  const {mail,gespeicherte}=testMailer(async()=>{throw new Error('E-Mail-Versand ist nicht konfiguriert.');});
  const result=await mail();
  assert.equal(gespeicherte.at(-1).status,'fehlgeschlagen');
  assert.equal(gespeicherte.at(-1).fehler,'E-Mail-Versand ist nicht konfiguriert.');
  assert.equal(result.angenommenAm,null);
});

test('markiert unklare Verbindungen und blockiert einen weiteren Versand',async()=>{
  let sends=0;
  const {mail,gespeicherte}=testMailer(async()=>{sends++;const e=new Error('Verbindungsstatus ungeklärt');e.uncertain=true;throw e;});
  assert.equal((await mail()).status,'ungeklaert');
  assert.equal((await mail()).blockiert,true);
  assert.equal(gespeicherte.at(-1).status,'ungeklaert');
  assert.equal(sends,1);
});

test('Gleichzeitige Bestätigungsversuche lösen nur eine Nachricht aus',async()=>{
  let fertig;
  const pending=new Promise(resolve=>{fertig=resolve;});
  let sends=0;
  const {mail}=testMailer(async()=>{sends++;await pending;});
  const first=mail();
  await new Promise(resolve=>setImmediate(resolve));
  const second=await mail();
  assert.equal(second.blockiert,true);
  fertig();
  assert.equal((await first).status,'angenommen');
  assert.equal(sends,1);
});

test('Bereits angenommene Bestätigung wird nicht erneut gesendet',async()=>{
  let sends=0;
  const {mail}=testMailer(async()=>{sends++;});
  assert.equal((await mail()).status,'angenommen');
  assert.equal((await mail()).status,'bereits_angenommen');
  assert.equal(sends,1);
});

test('Nach eindeutigem Anbieterfehler ist kontrollierter Neuversand möglich',async()=>{
  let sends=0;
  const {mail}=testMailer(async()=>{if(++sends===1)throw Error('nicht konfiguriert');});
  assert.equal((await mail()).status,'fehlgeschlagen');
  assert.equal((await mail()).status,'angenommen');
  assert.equal(sends,2);
});

test('DB-Ausfall vor der Reservierung löst keinen Versand aus',async()=>{
  let sends=0;
  const {mail}=testMailer(async()=>{sends++;},{reserveFails:true});
  assert.equal((await mail()).status,'ungeklaert');
  assert.equal(sends,0);
});

test('DB-Ausfall nach E-Mail-Annahme wird ungeklärt und bleibt gesperrt',async()=>{
  let sends=0;
  const {mail}=testMailer(async()=>{sends++;},{finishFails:true});
  assert.equal((await mail()).status,'ungeklaert');
  assert.equal((await mail()).blockiert,true);
  assert.equal(sends,1);
});
