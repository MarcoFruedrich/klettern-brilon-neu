'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {bilderDerBesuchergruppen}=require('../lib/medien-referenzen');

test('Medienpool erkennt Gruppenbilder und Gruppen-Icons als bereits verwendet',()=>{
  const cover='https://example.supabase.co/storage/v1/object/public/angebotsbilder/medien/cover.png';
  const icon='https://example.supabase.co/storage/v1/object/public/angebotsbilder/medien/icon.jpg';
  const urls=bilderDerBesuchergruppen([{daten:[
    {id:'familien',bild:cover,iconBild:icon},
    {id:'schulen',bild:cover,iconBild:''},
    {id:'unternehmen',bild:'/fotos/halle.jpg'}
  ]}]);
  assert.deepEqual([...urls],[cover,icon,'/fotos/halle.jpg']);
});

test('Fehlende oder ungültige Gruppendatensätze verursachen keine falschen Medienreferenzen',()=>{
  const urls=bilderDerBesuchergruppen([
    {daten:null},{daten:'keine-liste'},{daten:[null,{},4,{bild:0,iconBild:false}]}
  ]);
  assert.equal(urls.size,0);
  assert.equal(bilderDerBesuchergruppen(null).size,0);
});

test('Medienserver schützt auch Besuchermotive vor Löschen und benennt deren Quellen korrekt',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  assert.match(source,/for\(const url of await benutzteGruppenbilder\(\)\)verwendeteUrls\.add\(url\)/);
  assert.match(source,/\(await benutzteGruppenbilder\(\)\)\.has\(url\)/);
  assert.match(source,/aktualisiertAm:item\.updated_at\|\|item\.created_at/);
});
