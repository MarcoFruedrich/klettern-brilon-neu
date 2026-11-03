'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Admin-Sprungnavigation verweist auf vorhandene Verwaltungsbereiche',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','site','admin.html'),'utf8');
  const nav=html.match(/<nav class="admin-navigation"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav,'Verwaltungsnavigation muss vorhanden sein');
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
  const targets=[...nav.matchAll(/href="#([^"]+)"/g)].map(match=>match[1]);
  const views=new Set([...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*\bdata-admin-view(?:\s|>)/g)]
    .map(match=>match[1]));
  assert.ok(targets.length>=5,'wichtige Verwaltungsbereiche sollen direkt erreichbar sein');
  assert.equal(new Set(targets).size,targets.length,'Sprungziele sollen eindeutig sein');
  for(const target of targets){
    assert.ok(ids.has(target),`Sprungziel #${target} fehlt`);
    assert.ok(views.has(target),`Sprungziel #${target} muss eine eigene Ansicht öffnen`);
  }
});

test('GPS-Touren nutzen Stationskarten mit Reihenfolge statt eines JSON-Textfelds',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','site','admin.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'..','site','admin.js'),'utf8');
  assert.match(html,/id="gps-station-add"/);
  assert.match(html,/id="gps-stations"/);
  assert.doesNotMatch(html,/<textarea[^>]*name="stationen"/);
  for(const field of ['Stations-ID','QR-Kennung','Frage','Antwort 1','Antwort 2','Richtige Antwort','Breitengrad','Längengrad'])
    assert.ok(js.includes(`'${field}'`),`Stationsfeld ${field} fehlt`);
  assert.match(js,/gpsStationenFormWert\(\)/);
  assert.match(js,/Vorhandene Kontrollcodes bleiben erhalten/);
});
