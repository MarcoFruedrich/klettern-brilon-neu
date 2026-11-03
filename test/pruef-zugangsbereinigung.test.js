'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPruefzugangsbereinigung}=require('../lib/pruef-zugangsbereinigung');

test('Bereinigung löscht nur abgelaufene Sitzungen, Prüfcodes und verbrauchte/abgelaufene Kopplungscodes',async()=>{
  let sql='';
  const service=createPruefzugangsbereinigung({pool:{async query(statement){
    sql=statement;
    return {rows:[{sitzungen:2,pruefcodes:3,kopplungscodes:1}]};
  }}});
  assert.deepEqual(await service.bereinige(),{sitzungen:2,pruefcodes:3,kopplungscodes:1});
  assert.match(sql,/DELETE FROM brilon_pruef_sessions WHERE ablauf<=NOW\(\)/);
  assert.match(sql,/DELETE FROM brilon_pruef_codes WHERE ablauf<=NOW\(\)/);
  assert.match(sql,/DELETE FROM brilon_pruef_tablet_kopplungen\s+WHERE verwendet_am IS NOT NULL OR ablauf<=NOW\(\)/);
  assert.doesNotMatch(sql,/DELETE FROM brilon_pruef_berichte|DELETE FROM brilon_pruef_stationsereignisse|DELETE FROM brilon_buchungen/);
});

test('Ohne Datenbank erfolgt keine Bereinigung',async()=>{
  const service=createPruefzugangsbereinigung({pool:null});
  assert.deepEqual(await service.bereinige(),{sitzungen:0,pruefcodes:0,kopplungscodes:0});
});
