'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sperrzeitEnthaelt=require('../site/sperrzeit');

test('Sperrzeit-Helfer umfasst beide Randtage und einzelne Tage',()=>{
  const ranges=[{datum:'2027-03-16',enddatum:'2027-03-17'},{datum:'2027-03-20'}];
  assert.equal(sperrzeitEnthaelt('2027-03-15',ranges),false);
  assert.equal(sperrzeitEnthaelt('2027-03-16',ranges),true);
  assert.equal(sperrzeitEnthaelt('2027-03-17',ranges),true);
  assert.equal(sperrzeitEnthaelt('2027-03-18',ranges),false);
  assert.equal(sperrzeitEnthaelt('2027-03-20',ranges),true);
});

test('Öffentlicher Kalender aktualisiert nach Datumseingabe die Verfügbarkeit',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','site','index.html'),'utf8');
  const app=fs.readFileSync(path.join(__dirname,'..','site','app.js'),'utf8');
  assert.match(html,/<script src="\/sperrzeit\.js"><\/script><script src="\/app\.js"><\/script>/);
  const handler=app.match(/date\.addEventListener\('change',\s*\(\)\s*=>\s*\{([\s\S]*?)\n\}\);/);
  assert.ok(handler,'Datumsfeld muss einen Änderungs-Handler haben');
  assert.match(handler[1],/belegteUhrzeitenLaden\(\)/);
  assert.match(app,/uhrzeitAuswahl\.disabled\s*=\s*true/);
  assert.match(app,/anfrageId!==verfuegbarkeitsAnfrage \|\| date\.value!==datum/,
    'Eine ältere Antwort darf neuere Anfragen und geänderte Tage nicht überschreiben');
  assert.match(app,/datumIstGesperrt\(datum\)\) return;/,
    'Eine verspätete Antwort darf inzwischen gesperrte Tage nicht freischalten');
  assert.match(app,/anfrageId===verfuegbarkeitsAnfrage[\s\S]*?!datumIstGesperrt\(datum\)/,
    'Nur die aktuellste Verfügbarkeitsantwort darf eine Auswahl wieder aktivieren');
});
