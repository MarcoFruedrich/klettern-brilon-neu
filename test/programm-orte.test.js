'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {programmOrte,normalisiereProgrammOrte}=require('../lib/programm-orte');

test('alte Programme behalten ihren einzigen Standort',()=>{
  assert.deepEqual(programmOrte({veranstaltungsort:'Brilon'}),['Brilon']);
  assert.deepEqual(programmOrte({veranstaltungsort:'Olpe',standorte:[]}),['Olpe']);
});
test('mehrere Standorte bleiben in der gewählten Reihenfolge erhalten',()=>{
  assert.deepEqual(normalisiereProgrammOrte(['Brilon','Olpe','Rüthen','Olpe']),['Brilon','Olpe','Rüthen']);
  assert.deepEqual(programmOrte({veranstaltungsort:'Brilon',standorte:['Brilon','Olpe']}),['Brilon','Olpe']);
});
test('ungültige oder leere Standortauswahl wird abgewiesen',()=>{
  assert.equal(normalisiereProgrammOrte([]),null);
  assert.equal(normalisiereProgrammOrte(['']),null);
  assert.equal(normalisiereProgrammOrte('Brilon'),null);
  assert.equal(normalisiereProgrammOrte(['Brilon',17]),null);
});
test('Legacy-Aufrufer dürfen einen Standort übergeben',()=>{
  assert.deepEqual(normalisiereProgrammOrte(undefined,'Brilon'),['Brilon']);
});
