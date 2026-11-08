'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {minutes,weekBounds,calculateLoad,checkLimits,moneyLimit}=require('../lib/einsatzplanung');
test('Einsatzdauer aus Minuten oder Uhrzeiten',()=>{
  assert.equal(minutes({dauer:150}),150);
  assert.equal(minutes({uhrzeit:'10:00',endzeit:'12:30'}),150);
  assert.equal(minutes({uhrzeit:'10:00',endzeit:'09:30'}),null);
});
test('Kalenderwoche startet montags, auch beim Jahreswechsel',()=>{
  assert.deepEqual(weekBounds('2027-01-01'),['2026-12-28','2027-01-04']);
});
test('Nur bestätigte, eingeteilte und tatsächliche Stunden belasten das Konto',()=>{
  const entries=[
    {buchung_id:'a',datum:'2026-11-02',status:'beworben',arbeitsminuten:300},
    {buchung_id:'b',datum:'2026-11-03',status:'eingeteilt',arbeitsminuten:150},
    {buchung_id:'c',datum:'2026-11-04',status:'abgeschlossen',arbeitsminuten:180,ist_minuten:120},
    {buchung_id:'d',datum:'2026-10-29',status:'bestaetigt',arbeitsminuten:60}
  ];
  const x=calculateLoad(entries,'2026-11-05');
  assert.equal(x.weekMin,270);
  assert.equal(x.monthMin,270);
  assert.equal(x.weekWorkedMin,120);
  assert.equal(calculateLoad(entries,'2026-11-05','b').weekMin,120);
});
test('2026 Minijobgrenze mit individuellem Stundenlohn',()=>{
  assert.equal(moneyLimit({},2026),60300);
  assert.equal(moneyLimit({},2027),null);
  assert.deepEqual(checkLimits({art:'minijob',stundenlohn_cent:1500,monatsstunden:40},
    {weekMin:0,monthMin:2400,yearMin:2400},10,'2026-11-05'),[]);
  assert.match(checkLimits({art:'minijob',stundenlohn_cent:1500,monatsstunden:40},
    {weekMin:0,monthMin:2400,yearMin:2400},60,'2026-11-05').join(' '),/Monat/);
});
test('30-Stunden-Vertrag meldet Überschreitungen',()=>{
  assert.match(checkLimits({art:'teilzeit',wochenstunden:30},
    {weekMin:1740,monthMin:1740,yearMin:1740},120,'2026-11-05').join(' '),/Woche/);
  assert.deepEqual(checkLimits({art:'vollzeit',wochenstunden:40},
    {weekMin:1800,monthMin:1800,yearMin:1800},120,'2026-11-05'),[]);
});
