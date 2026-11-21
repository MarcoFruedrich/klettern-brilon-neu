'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {customerConfirmationDue}=require('../lib/kundenbestaetigungszeiten');

test('Konfiguriertes Zeitfenster erlaubt Versand um 06:36 bei ausdruecklich deaktivierter Ruhezeit',()=>{
  const now=new Date('2026-11-21T05:34:00Z'); // 06:34 MEZ
  const due=customerConfirmationDue(now,{verzoegerungMinuten:2,ruhebeginn:'00:00',ruheende:'00:00'});
  assert.equal(due.toISOString(),'2026-11-21T05:36:00.000Z');
});

test('Ohne angepasste Ruhezeit wird ein Versand am fruehen Morgen auf 09:00 verschoben',()=>{
  const due=customerConfirmationDue(new Date('2026-11-21T05:34:00Z'),{verzoegerungMinuten:2,ruhebeginn:'18:00',ruheende:'09:00'});
  assert.equal(due.toISOString(),'2026-11-21T08:00:00.000Z');
});

test('Vertrauenspersonen-Warteschlange nutzt geplante Faelligkeit ohne weiteres festes 09-18-Uhr-Fenster',()=>{
  const code=fs.readFileSync(path.join(__dirname,'..','lib','stationspruefung-api.js'),'utf8');
  const worker=code.split('async function sendDueBookingConfirmations()')[1]?.split('const handler=async function')[0]||'';
  assert.match(worker,/WHERE status='ausstehend' AND versand_nach<=NOW\(\)/);
  assert.doesNotMatch(worker,/EXTRACT\(HOUR FROM NOW\(\) AT TIME ZONE/);
  assert.match(code,/const due=await trainerSendAt\(client\)/);
  assert.match(code,/const sendAt=await trainerSendAt\(client\)/);
});
