'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createKundenbestaetigungService}=require('../lib/kundenbestaetigung-service');

test('Zweiminütiger Mail-Timer wird nach der Mitarbeiterzusage gezielt gestellt und Warteschlange startet sofort',async()=>{
  let scans=0,intervals=0,timeoutCallback;
  const now=Date.parse('2026-11-21T08:34:11.000Z');
  const due=new Date(now+2*60*1000);
  const timers={
    setInterval(fn,ms){assert.equal(ms,15000);intervals++;return {unref(){}};},
    setTimeout(fn,ms){assert.equal(ms,120250);timeoutCallback=fn;return {unref(){}};},
    clearTimeout(){}
  };
  const pool={
    async query(sql){
      if(sql.includes('SELECT b.id FROM brilon_buchungen b'))
        return {rowCount:1,rows:[{id:'test-booking'}]};
      if(sql.includes('SELECT verzoegerung_minuten AS'))
        return {rowCount:1,rows:[{verzoegerungMinuten:2,ruhebeginn:'18:00',ruheende:'09:00'}]};
      if(sql.includes('INSERT INTO brilon_kundenbestaetigungen'))
        return {rowCount:1,rows:[{faellig_ab:due}]};
      throw Error('Unknown query: '+sql);
    },
    async connect(){
      scans++;
      return {
        async query(sql){
          if(sql==='BEGIN'||sql==='ROLLBACK')return {rowCount:0,rows:[]};
          if(sql.includes('SELECT q.buchung_id,b.data'))return {rowCount:0,rows:[]};
          throw Error('Unexpected transaction SQL: '+sql);
        },
        release(){}
      };
    }
  };
  const service=createKundenbestaetigungService({
    pool,brevoMail:async()=>{throw Error('Should not email before due');},
    workTimers:timers,now:()=>now
  });
  await service.startWorker();
  assert.equal(scans,1,'Serverstart untersucht bestehende überfällige Nachrichten');
  const result=await service.schedule('test-booking','test-trainer');
  assert.equal(result.geplant,true);
  assert.equal(intervals,1);
  assert.equal(typeof timeoutCallback,'function');
  timeoutCallback();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scans,2,'Beim Fälligkeitstermin wird die Warteschlange nochmals verarbeitet');
  await service.startWorker();
  assert.equal(intervals,1,'Pro Prozess gibt es nur einen Polling-Timer');
});

test('Fehlerzustand und überfällige Planung sind in beiden Benutzeroberflächen erkennbar',()=>{
  const staff=fs.readFileSync(path.join(__dirname,'..','site','einsatzplanung-mitarbeiter.js'),'utf8');
  const admin=fs.readFileSync(path.join(__dirname,'..','site','einsatzplanung-admin.js'),'utf8');
  const api=fs.readFileSync(path.join(__dirname,'..','lib','einsatzplanung-api.js'),'utf8');
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(staff,/Kunden-\/Zahlungsinformation ist überfällig/);
  assert.match(staff,/\['fehler','abgebrochen'\]/);
  assert.match(admin,/VERSAND ÜBERFÄLLIG/);
  assert.match(admin,/pending\.fehler/);
  assert.match(api,/q\.faellig_ab,q\.status,q\.versendet_am,q\.fehler/);
  assert.match(server,/kundenService\.startWorker\(\)/);
  assert.doesNotMatch(server,/kundenService\.processQueue\(\)\.catch/);
});
