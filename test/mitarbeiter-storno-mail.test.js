'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMitarbeiterStornoMail}=require('../lib/mitarbeiter-storno-mail');
const bookingId='550e8400-e29b-41d4-a716-446655440000',staffId='550e8400-e29b-41d4-a716-446655440001';
function fixture({staff=true,email='trainer@example.test',bookingStatus='storniert',mail=async()=>{},dbFails=false}={}){
  let state='',versuch='',number=0;
  const pool={async query(sql,args=[]){
    if(sql.startsWith('SELECT e.mitarbeiter_id'))
      return {rowCount:staff?1:0,rows:staff?[{mitarbeiter_id:staffId,name:'Trainer',email}]:[]};
    if(sql.includes("NOT IN ('wird_versendet','angenommen','unklar')")){
      if(!['storniert','abgelehnt'].includes(bookingStatus)||['wird_versendet','angenommen','unklar'].includes(state))
        return {rowCount:0,rows:[]};
      versuch=JSON.parse(args[2]).versuch;state='wird_versendet';
      return {rowCount:1,rows:[{data:{angebot:'Klettern',datum:'2026-12-15',uhrzeit:'11:00',veranstaltungsort:'Brilon'}}]};
    }
    if(sql.includes("'status']='wird_versendet'")){
      if(dbFails)throw Error('DB down');
      if(versuch!==args[2]||state!=='wird_versendet')return {rowCount:0,rows:[]};
      state=JSON.parse(args[3]).status;return {rowCount:1,rows:[{id:bookingId}]};
    }
    throw Error('Unexpected SQL: '+sql);
  }};
  const sender=createMitarbeiterStornoMail({pool,brevoMail:async(...args)=>{number++;await mail(...args);}});
  return {send:()=>sender(bookingId),get sends(){return number;},get state(){return state;}};
}
test('Storno-Benachrichtigung erreicht den Mitarbeiter und wird einmal versendet',async()=>{
  const x=fixture();
  assert.equal((await x.send()).ergebnisse[0].status,'angenommen');
  assert.equal((await x.send()).ergebnisse[0].blockiert,true);
  assert.equal(x.sends,1);
});
test('Ohne Personal entsteht keine E-Mail',async()=>{
  const x=fixture({staff:false});assert.equal((await x.send()).anzahl,0);assert.equal(x.sends,0);
});
test('Fehlende E-Mail-Adresse wird dokumentiert',async()=>{
  const x=fixture({email:''});assert.equal((await x.send()).ergebnisse[0].status,'keine_adresse');
  assert.equal(x.sends,0);
});
test('Paralleler Stornoversand wird blockiert',async()=>{
  let release,started;const waiting=new Promise(r=>release=r),ready=new Promise(r=>started=r);
  const x=fixture({mail:async()=>{started();await waiting;}});
  const first=x.send();await ready;
  assert.equal((await x.send()).ergebnisse[0].blockiert,true);
  release();await first;assert.equal(x.sends,1);
});
test('Unklarer Providerstatus verhindert Wiederholung',async()=>{
  const x=fixture({mail:async()=>{const e=Error('timeout');e.uncertain=true;throw e;}});
  assert.equal((await x.send()).ergebnisse[0].status,'unklar');
  assert.equal((await x.send()).ergebnisse[0].blockiert,true);
  assert.equal(x.sends,1);
});
test('Unterbrochene DB nach E-Mail-Annahme verhindert Neuversand',async()=>{
  const x=fixture({dbFails:true});
  assert.equal((await x.send()).ergebnisse[0].status,'unklar');
  assert.equal((await x.send()).ergebnisse[0].blockiert,true);
  assert.equal(x.sends,1);
});
test('Aktive Buchungen dürfen keine Storno-Mail auslösen',async()=>{
  const x=fixture({bookingStatus:'offen'});
  assert.equal((await x.send()).ergebnisse[0].blockiert,true);
  assert.equal(x.sends,0);
});
