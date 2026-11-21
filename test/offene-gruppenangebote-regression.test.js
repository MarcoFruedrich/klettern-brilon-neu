'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const load=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('Offene Gruppenangebote erlauben individuelle Mindestzahlen und Kapazitaeten',()=>{
  const server=load('server.js');
  assert.doesNotMatch(server,/kapazitaet<5\|\|kapazitaet>12/);
  assert.doesNotMatch(server,/mindestteilnehmer<5\|\|mindestteilnehmer>kapazitaet/);
  assert.match(server,/mindestteilnehmer<1\|\|mindestteilnehmer>kapazitaet/);
  assert.match(server,/buchungsmodus: einzelplatz\?'einzelplatz':'gruppe'/);
  assert.match(server,/einzelplatz&&teilnehmer!==1/);
  assert.match(server,/preis_pro_person/);
  assert.match(server,/kapazitaet\)-angemeldet/);
});
test('Verwaltung erfasst Mindestzahl, Maximalzahl und Einzelpreis unabhaengig vom Gruppenpreis',()=>{
  const html=load('site/admin.html');
  const admin=load('site/admin.js');
  assert.match(html,/Offenes Gruppenangebot – Einzelanmeldung/);
  assert.match(html,/name="mindestteilnehmer" type="number" min="1" max="500"/);
  assert.match(html,/name="preis_pro_person"/);
  assert.match(admin,/mindest\.min='1';mindest\.max='500'/);
  assert.match(admin,/angebotsKapazitaet\.max = '500'/);
});
test('Oeffentliche Buchung zeigt freie Plaetze und Anzahl fuer Mindestdurchfuehrung',()=>{
  const app=load('site/app.js');
  assert.match(app,/platz\.angemeldet>=platz\.mindestteilnehmer/);
  assert.match(app,/noch \$\{platz\.freie_plaetze\} Plätze/);
  assert.match(app,/input\.value='1';input\.min='1';input\.max='1'/);
});
