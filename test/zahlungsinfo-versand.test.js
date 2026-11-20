'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createZahlungsinfoVersand}=require('../lib/zahlungsinfo-versand');

function fixture(mail){
  let state='',timestamp=null,sends=0,failFinish=false;
  const pool={async query(sql,args=[]){
    if(sql.includes('zahlungsinfo_gesendet_am IS NULL')){
      if(timestamp||state==='unklar'||state==='angenommen')return {rowCount:0,rows:[]};
      state='unklar';return {rowCount:1,rows:[{id:args[0]}]};
    }
    if(sql.includes('SELECT zahlungsinfo_gesendet_am'))
      return {rowCount:1,rows:[{zahlungsinfo_gesendet_am:timestamp,status:state}]};
    if(sql.includes("'fehlgeschlagen'")&&sql.includes('UPDATE brilon_buchungen')){
      if(state!=='unklar')return {rowCount:0,rows:[]};
      state='fehlgeschlagen';return {rowCount:1,rows:[{id:args[0]}]};
    }
    if(sql.includes("SET zahlungsinfo_gesendet_am=NOW()")){
      if(failFinish)throw Error('Database update interrupted');
      if(state!=='unklar')return {rowCount:0,rows:[]};
      state='angenommen';timestamp='2026-11-20T19:00:00Z';
      return {rowCount:1,rows:[{zahlungsinfo_gesendet_am:timestamp}]};
    }
    throw Error('Unexpected SQL');
  }};
  const versenden=createZahlungsinfoVersand({pool,brevoMail:async(...args)=>{
    sends++;return mail?.(...args);
  }});
  return {send:()=>versenden({buchungId:'550e8400-e29b-41d4-a716-446655440000',
    email:'kunde@example.test',text:'Zahlungsinformationen'}),get sends(){return sends;},
    get status(){return state;},set failFinish(v){failFinish=v;},
    set alreadySent(v){timestamp=v;}};
}

test('Zahlungsinformationen werden nur einmal an den Anbieter übergeben',async()=>{
  const f=fixture();
  const first=await f.send(),second=await f.send();
  assert.equal(first.status,'angenommen');
  assert.equal(second.status,'bereits_angenommen');
  assert.equal(f.sends,1);
});

test('Gleichzeitige Anforderungen senden nicht doppelt',async()=>{
  let complete;
  const pending=new Promise(resolve=>{complete=resolve;});
  const f=fixture(()=>pending);
  const first=f.send();await new Promise(resolve=>setImmediate(resolve));
  const second=await f.send();
  assert.equal(second.status,'unklar');
  complete();assert.equal((await first).status,'angenommen');
  assert.equal(f.sends,1);
});

test('Unklare Brevo-Verbindung bleibt gesperrt',async()=>{
  const f=fixture(()=>{const error=new Error('network');error.uncertain=true;throw error;});
  assert.equal((await f.send()).status,'unklar');
  assert.equal((await f.send()).status,'unklar');
  assert.equal(f.sends,1);
});

test('Bekannt fehlgeschlagene Anbieteranfrage erlaubt einen erneuten Versuch',async()=>{
  let fails=true;
  const f=fixture(()=>{if(fails)throw Error('invalid request');});
  assert.equal((await f.send()).status,'fehlgeschlagen');
  fails=false;assert.equal((await f.send()).status,'angenommen');
  assert.equal(f.sends,2);
});

test('DB-Ausfall nach Providerannahme führt nicht zu erneuter Zahlungsemail',async()=>{
  const f=fixture();f.failFinish=true;
  assert.equal((await f.send()).status,'unklar');
  assert.equal((await f.send()).status,'unklar');
  assert.equal(f.sends,1);
});

test('Bereits dokumentierter Altversand wird nicht erneut ausgelöst',async()=>{
  const f=fixture();f.alreadySent='2026-11-19T12:00:00Z';
  assert.equal((await f.send()).status,'bereits_angenommen');
  assert.equal(f.sends,0);
});
