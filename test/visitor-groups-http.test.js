'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DEFAULT_VISITOR_GROUPS,prepareVisitorGroups,validateVisitorGroups}=require('../visitor-groups');

const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=server.indexOf("if(route==='/api/besuchergruppen'");
const end=server.indexOf("if(route==='/api/admin/rechnungsdaten'&&req.method==='GET')",start);
assert.ok(start>=0&&end>start,'Besuchergruppen-API muss im Server vorhanden sein');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const route=new AsyncFunction('route','req','res','pool','body','reply','admin',
  'DEFAULT_VISITOR_GROUPS','prepareVisitorGroups','validateVisitorGroups',server.slice(start,end));
const reply=(_res,status,payload)=>({status,payload});
const run=(routeName,method,pool,authorized=true,data)=>route(
  routeName,{method},{},pool,async()=>data,reply,async()=>authorized,
  DEFAULT_VISITOR_GROUPS,prepareVisitorGroups,validateVisitorGroups);
const fakeDb=()=>({
  calls:[],async query(sql,params=[]){
    this.calls.push({sql,params});
    if(sql.startsWith('SELECT'))return {rowCount:1,rows:[{gruppen:null}]};
    if(sql.startsWith('UPDATE'))return {rowCount:1,rows:[{id:1}]};
    throw Error('Unexpected query');
  }
});

test('Öffentliche API liefert ohne eigene Datenbankeinträge sechs Besuchergruppen',async()=>{
  const result=await run('/api/besuchergruppen','GET',fakeDb());
  assert.equal(result.status,200);
  assert.equal(result.payload.length,6);
});
test('Öffentliche API funktioniert mit fehlender Datenbank',async()=>{
  const result=await run('/api/besuchergruppen','GET',null);
  assert.equal(result.status,200);
  assert.equal(result.payload.length,6);
});
test('Admin-API verlangt Anmeldung zum Lesen und Ändern',async()=>{
  const db=fakeDb();
  assert.equal(await run('/api/admin/besuchergruppen','GET',db,false),undefined);
  assert.equal(await run('/api/admin/besuchergruppen','PUT',db,false),undefined);
  assert.equal(db.calls.length,0);
});
test('Admin-API speichert nur validierte Gruppen in vorhandene JSONB-Einstellungen',async()=>{
  const db=fakeDb(),groups=DEFAULT_VISITOR_GROUPS.map(g=>({...g})).reverse();
  groups[0].programmIds=[7,11];groups[0].beschreibung='Test';
  const result=await run('/api/admin/besuchergruppen','PUT',db,true,{gruppen:groups});
  assert.equal(result.status,200);
  assert.equal(result.payload.gruppen[0].id,'unternehmen');
  assert.deepEqual(result.payload.gruppen[0].programmIds,[7,11]);
  assert.match(db.calls[0].sql,/jsonb_set/);
  assert.deepEqual(JSON.parse(db.calls[0].params[0])[0].programmIds,[7,11]);
});
test('Admin-API lehnt ungültige Bildadresse ohne DB-Mutation ab',async()=>{
  const db=fakeDb(),groups=DEFAULT_VISITOR_GROUPS.map(g=>({...g}));
  groups[0].bild='javascript:alert(1)';
  const result=await run('/api/admin/besuchergruppen','PUT',db,true,{gruppen:groups});
  assert.equal(result.status,400);
  assert.equal(db.calls.length,0);
});
