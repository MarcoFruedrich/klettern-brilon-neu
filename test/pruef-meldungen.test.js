'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPruefMeldungen}=require('../lib/pruef-meldungen');

function mockOutbox(){
  const record={status:'ausstehend',versuche:0};
  const state={mailCalls:0,record};
  const pool={async query(sql,params){
    if(sql.includes('SET status=\'sendet\'')){
      if(!['ausstehend','fehlgeschlagen','nicht_konfiguriert'].includes(record.status))
        return {rowCount:0,rows:[]};
      record.status='sendet';record.versuche++;
      return {rowCount:1,rows:[{bericht_id:params[0],versuche:record.versuche}]};
    }
    if(sql.includes('SELECT status FROM brilon_pruef_meldungen'))
      return {rowCount:1,rows:[{status:record.status}]};
    if(sql.includes('SELECT p.programm,p.beginn')){
      return {rowCount:1,rows:[{programm:'Kletterkurs',beginn:'2027-04-01T10:00',
        pruefer:'CI Prüfer',pruefungen:[
          {station:'Boulderwand',zustand:'mangel',beschreibung:'Sicherungsseil beschädigt'},
          {station:'Kletterwand',zustand:'hinweis',beschreibung:'Beschriftung verblasst'}]}]};
    }
    if(sql.includes('SET status=\'angenommen\'')){
      if(state.failAfterAccept)throw Error('Datenbank kurzfristig nicht erreichbar');
      record.status='angenommen';return {rowCount:1,rows:[]};
    }
    if(sql.includes('SET status=\'fehlgeschlagen\'')){
      record.status='fehlgeschlagen';return {rowCount:1,rows:[]};
    }
    if(sql.includes('SET status=\'nicht_konfiguriert\'')){
      record.status='nicht_konfiguriert';return {rowCount:1,rows:[]};
    }
    throw Error('Unerwartetes SQL '+sql);
  }};
  return {pool,state};
}
const bericht='550e8400-e29b-41d4-a716-446655440011';

test('Sicherheitsmangel-Mail: eine Annahme, keine Duplikate bei parallelen Versuchen',async()=>{
  const {pool,state}=mockOutbox();
  const deliveries=[];
  const mail=async(to,subject,body)=>{state.mailCalls++;deliveries.push({to,subject,body});};
  const service=createPruefMeldungen({pool,brevoMail:mail,
    env:{PRUEF_MANGEL_EMAIL:'sicherheit@example.test'}});
  const [a,b]=await Promise.all([service.send(bericht),service.send(bericht)]);
  assert.equal(state.mailCalls,1);
  assert.ok([a.status,b.status].includes('gesendet'));
  assert.equal(state.record.status,'angenommen');
  assert.equal((await service.send(bericht)).status,'gesendet');
  assert.equal(state.mailCalls,1);
  assert.match(deliveries[0].body,/Sicherungsseil beschädigt/);
  assert.doesNotMatch(deliveries[0].body,/Beschriftung verblasst/,
    'Hinweise sind keine sicherheitsrelevanten Mängelmeldungen');
});
test('Versandfehler kann nach manueller Freigabe erneut versucht werden',async()=>{
  const {pool,state}=mockOutbox();
  let n=0;
  const service=createPruefMeldungen({pool,brevoMail:async()=>{n++;if(n===1)throw Error('Testversand fehlgeschlagen');},
    env:{PRUEF_MANGEL_EMAIL:'pruefung@example.test'}});
  assert.equal((await service.send(bericht)).status,'fehlgeschlagen');
  assert.equal(state.record.status,'fehlgeschlagen');
  assert.equal((await service.send(bericht)).status,'gesendet');
  assert.equal(n,2);
  assert.equal(state.record.versuche,2);
});
test('Ohne Empfängeradresse kein Mailaufruf, aber sichtbar wiederholbarer Eintrag',async()=>{
  const {pool,state}=mockOutbox();let calls=0;
  const service=createPruefMeldungen({pool,brevoMail:async()=>calls++,env:{}});
  assert.equal((await service.send(bericht)).status,'nicht_konfiguriert');
  assert.equal(calls,0);
  assert.equal(state.record.status,'nicht_konfiguriert');
});
test('Akzeptierte Mail mit DB-Fehler bleibt ungeklärt und wird nicht blind erneut gesendet',async()=>{
  const {pool,state}=mockOutbox();state.failAfterAccept=true;let count=0;
  const service=createPruefMeldungen({pool,brevoMail:async()=>count++,
    env:{PRUEF_MANGEL_EMAIL:'pruefung@example.test'}});
  assert.equal((await service.send(bericht)).status,'versand_ungeklaert');
  assert.equal(state.record.status,'sendet');
  assert.equal((await service.send(bericht)).status,'versand_ungeklaert');
  assert.equal(count,1);
});
