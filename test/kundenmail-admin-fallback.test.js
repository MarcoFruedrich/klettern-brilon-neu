'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const api=fs.readFileSync(path.join(__dirname,'..','lib','einsatzplanung-api.js'),'utf8');
const queue=fs.readFileSync(path.join(__dirname,'..','lib','kundenbestaetigung-service.js'),'utf8');
const admin=fs.readFileSync(path.join(__dirname,'..','site','einsatzplanung-admin.js'),'utf8');
test('Überfällige Nachricht kann authentifiziert und gezielt erneut geprüft werden, nicht vor Ablauf der Frist',()=>{
  assert.match(api,/checkDue&&method==='POST'/);
  assert.match(api,/if\(!sameOriginMutation\(req\)\)/);
  assert.match(api,/status!=='geplant'/);
  assert.match(api,/faellig_ab\)\.getTime\(\)>Date\.now\(\)/);
  assert.match(api,/kundenService\.processQueue\(checkDue\[1\]\)/);
});
test('Prüflauf ist auf die eine Buchung beschränkt und benutzt dieselbe DB-Sperre',()=>{
  assert.match(queue,/async function processQueue\(onlyBookingId=null\)/);
  assert.match(queue,/\(\$1::uuid IS NULL OR q\.buchung_id=\$1::uuid\)/);
  assert.match(queue,/FOR UPDATE OF q SKIP LOCKED/);
  assert.match(admin,/Versand jetzt prüfen/);
});
