'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {werbedauerLesen,werbedauerPruefen}=require('../lib/tablet-werbedauer');
test('Default und gültiger globaler Tablet-Werbezeitraum',()=>{
  assert.equal(werbedauerLesen(null),11);
  assert.equal(werbedauerLesen(undefined),11);
  assert.equal(werbedauerLesen('35'),35);
  assert.equal(werbedauerLesen(120),120);
  assert.equal(werbedauerLesen('0'),11);
  assert.equal(werbedauerLesen(121),11);
  assert.equal(werbedauerPruefen({sekunden:23}),23);
  assert.throws(()=>werbedauerPruefen({sekunden:0}),/zwischen 5 und 120/);
  assert.throws(()=>werbedauerPruefen({sekunden:4.2}),/zwischen 5 und 120/);
  assert.throws(()=>werbedauerPruefen({sekunden:121}),/zwischen 5 und 120/);
  assert.throws(()=>werbedauerPruefen({sekunden:'20'}),/zwischen 5 und 120/);
});
