'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {DEFAULT_VISITOR_GROUPS,prepareVisitorGroups,validateVisitorGroups,sichereBesucherBildUrl}
  =require('../visitor-groups');
const site=p=>readFileSync(path.join(__dirname,'..','site',p),'utf8');

test('Sechs eindeutig benannte Besuchergruppen mit Bild und Vorteilen sind vorhanden',()=>{
  assert.deepEqual(DEFAULT_VISITOR_GROUPS.map(g=>g.id),
    ['familien','kindergeburtstage','schulen','vereine','jugendgruppen','unternehmen']);
  assert.ok(DEFAULT_VISITOR_GROUPS.every(g=>g.titel&&g.bild&&g.punkte.length));
});
test('Geänderte Gruppenreihenfolge und Programmzuordnungen bleiben erhalten',()=>{
  const changed=DEFAULT_VISITOR_GROUPS.map(g=>({...g,punkte:[...g.punkte]})).reverse();
  changed[0].programmIds=[12,13,13];
  const result=validateVisitorGroups(changed);
  assert.equal(result.error,undefined);
  assert.equal(result.gruppen[0].id,'unternehmen');
  assert.deepEqual(result.gruppen[0].programmIds,[12,13]);
  assert.equal(prepareVisitorGroups(result.gruppen)[0].id,'unternehmen');
});
test('Besuchergruppe kann deaktiviert werden, ohne ihre Programmzuordnung zu verlieren',()=>{
  const modified=DEFAULT_VISITOR_GROUPS.map(g=>({...g}));
  modified[1].aktiv=false;modified[1].programmIds=[44];
  const stored=validateVisitorGroups(modified).gruppen;
  assert.equal(stored[1].aktiv,false);
  assert.deepEqual(stored[1].programmIds,[44]);
});
test('Manipulierte Bildadressen und falsche IDs werden abgewehrt',()=>{
  assert.equal(sichereBesucherBildUrl('javascript:alert(1)'),'');
  assert.equal(sichereBesucherBildUrl('https://evil.example/photo.jpg'),'');
  assert.equal(sichereBesucherBildUrl('/fotos/../../secret.jpg'),'');
  assert.equal(sichereBesucherBildUrl('/fotos/halle.jpg'),'/fotos/halle.jpg');
  const invalid=DEFAULT_VISITOR_GROUPS.map(g=>({...g}));
  invalid[0].bild='data:text/html,<script>alert(1)</script>';
  assert.match(validateVisitorGroups(invalid).error,/Ungültige/);
  invalid[0].bild='/fotos/halle.jpg';invalid[0].id='falsch';
  assert.match(validateVisitorGroups(invalid).error,/sechs Besuchergruppen/);
});
test('Öffentliche Webseite bindet Navigationspunkt, sechs Kacheln und Filter ein',()=>{
  const page=site('index.html');
  assert.match(page,/href="#besuchergruppen"/);
  assert.match(page,/id="standortwahl"/);
  assert.match(page,/id="angebote-standort-filter"/);
  assert.match(page,/id="besuchergruppen-kacheln"/);
  assert.match(page,/id="besuchergruppen-filterhinweis"/);
  assert.ok(page.indexOf('id="standortwahl"')<page.indexOf('id="angebote"'));
  assert.ok(page.indexOf('id="angebote"')<page.indexOf('id="besuchergruppen"'));
  assert.match(page,/besuchergruppen\.js/);
  const js=site('app.js');
  assert.match(js,/besuchergruppePasst/);
  assert.match(js,/besuchergruppenwechsel/);
  assert.match(js,/window\.ausgewaehlterAngebotsStandort/);
  assert.match(page,/<option value="alle" selected>Alle Standorte<\/option>/);
  assert.match(js,/alle\.value='alle'/);
  assert.match(js,/alleStandorte/);
});
test('Verwaltungsseite hat Steuerungen und geschützte API zum Speichern',()=>{
  const page=site('admin.html');
  assert.match(page,/id="besuchergruppen-admin-speichern"/);
  assert.match(page,/<section id="besuchergruppen-admin-section"[^>]*data-admin-view/);
  assert.match(page,/href="#besuchergruppen-admin-section" data-admin-view-link/);
  assert.match(page,/besuchergruppen-admin\.js/);
  const adminJs=site('admin.js');
  assert.match(adminJs,/programme:\[[^\]]*'besuchergruppen-admin-section'/);
  const source=readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(source,/route==='\/api\/besuchergruppen'/);
  assert.match(source,/route==='\/api\/admin\/besuchergruppen'/);
  assert.match(source,/validateVisitorGroups/);
  assert.match(source,/jsonb_set\(COALESCE\(data/);
});
