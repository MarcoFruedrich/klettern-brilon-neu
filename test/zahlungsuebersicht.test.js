'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {summiere}=require('../site/zahlungsuebersicht');

test('Zahlungsübersicht zählt tatsächliche Eingänge, offene Beträge und Gutschriften getrennt',()=>{
  const result=summiere([
    {id:'a',status:'bestaetigt',data:{name:'Team A',gesamtpreis:125,zahlungen:[{betragCent:2500},{betragCent:1000}]}},
    {id:'b',status:'storniert',data:{gesamtpreis:50,zahlungen:[{betragCent:5000}]}},
    {id:'c',status:'bestaetigt',data:{gesamtpreis:90,zahlungsgutschriftCent:1000,zahlungen:[{betragCent:10000}]}}
  ]);
  assert.equal(result.eingegangenCent,18500);
  assert.equal(result.offenCent,9000);
  assert.equal(result.gutschriftCent,1000);
  assert.equal(result.zahlungseingaenge,4);
  assert.equal(result.eintraege.find(item=>item.id==='b').offenCent,0);
});

test('Ungültige Zahlungseinträge erhöhen den Zahlungssaldo nicht',()=>{
  const result=summiere([{status:'offen',data:{gesamtpreis:30,zahlungen:[
    {betragCent:1000},{betragCent:-500},{betragCent:1.5},{betragCent:Number.MAX_SAFE_INTEGER+1}
  ]}}]);
  assert.equal(result.eingegangenCent,1000);
  assert.equal(result.offenCent,2000);
  assert.equal(result.zahlungseingaenge,1);
});
