'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {customerConfirmationDue,parts}=require('../lib/kundenbestaetigungszeiten');
test('Vertrauensbestätigung außerhalb Ruhezeit: zwei Stunden später',()=>{
  const date=new Date('2026-11-05T09:00:00+01:00');
  assert.equal(customerConfirmationDue(date).toISOString(),'2026-11-05T10:00:00.000Z');
});
test('Spätnachmittag: Versand am Folgetag um 9 Uhr Berlin',()=>{
  const date=new Date('2026-11-05T17:30:00+01:00');
  assert.equal(customerConfirmationDue(date).toISOString(),'2026-11-06T08:00:00.000Z');
});
test('Abend und früher Morgen bleiben bis zum nächsten Tag 9 Uhr ausgesetzt',()=>{
  assert.equal(customerConfirmationDue('2026-11-05T19:00:00+01:00').toISOString(),'2026-11-06T08:00:00.000Z');
  assert.equal(customerConfirmationDue('2026-11-05T07:45:00+01:00').toISOString(),'2026-11-06T08:00:00.000Z');
});
test('Sommerzeit berücksichtigt Berlin, 9 Uhr bleibt 9 Uhr',()=>{
  const x=customerConfirmationDue('2026-07-05T19:00:00+02:00');
  assert.equal(parts(x).hour,9);
  assert.equal(x.toISOString(),'2026-07-06T07:00:00.000Z');
});
