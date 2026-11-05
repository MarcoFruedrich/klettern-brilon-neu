'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPruefzugangsbereinigung}=require('../lib/pruef-zugangsbereinigung');

test('Bereinigung entfernt abgelaufene Zugänge und verbrauchte Einladungen, keine Prüfberichte',async()=>{
  let sql='';
  const service=createPruefzugangsbereinigung({pool:{async query(statement){
    sql+='\n'+statement;
    if(statement.includes('to_regclass'))return {rows:[{name:'brilon_pruef_einladungen'}]};
    if(statement.includes('DELETE FROM brilon_pruef_einladungen'))return {rowCount:2};
    return {rows:[{sitzungen:2,pruefcodes:3,kopplungscodes:1}]};
  }}});
  assert.deepEqual(await service.bereinige(),{sitzungen:2,pruefcodes:3,kopplungscodes:1,einladungen:2});
  assert.match(sql,/DELETE FROM brilon_pruef_sessions WHERE ablauf<=NOW\(\)/);
  assert.match(sql,/DELETE FROM brilon_pruef_codes WHERE ablauf<=NOW\(\)/);
  assert.match(sql,/DELETE FROM brilon_pruef_tablet_kopplungen\s+WHERE verwendet_am IS NOT NULL OR ablauf<=NOW\(\)/);
  assert.match(sql,/DELETE FROM brilon_pruef_einladungen\s+WHERE verwendet_am IS NOT NULL OR widerrufen_am IS NOT NULL OR ablauf<=NOW\(\)/);
  assert.doesNotMatch(sql,/DELETE FROM brilon_pruef_berichte|DELETE FROM brilon_pruef_stationsereignisse|DELETE FROM brilon_buchungen/);
});

test('Ohne Datenbank erfolgt keine Bereinigung',async()=>{
  const service=createPruefzugangsbereinigung({pool:null});
  assert.deepEqual(await service.bereinige(),{sitzungen:0,pruefcodes:0,kopplungscodes:0,einladungen:0});
});

test('Ältere Datenbanken ohne Einladungstabelle behalten die übrige Bereinigung',async()=>{
  const statements=[];
  const service=createPruefzugangsbereinigung({pool:{async query(statement){
    statements.push(statement);
    if(statement.includes('to_regclass'))return {rows:[{name:null}]};
    return {rows:[{sitzungen:1,pruefcodes:2,kopplungscodes:3}]};
  }}});
  assert.deepEqual(await service.bereinige(),{sitzungen:1,pruefcodes:2,kopplungscodes:3,einladungen:0});
  assert.equal(statements.some(sql=>sql.includes('DELETE FROM brilon_pruef_einladungen')),false);
});
