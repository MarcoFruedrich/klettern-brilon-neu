'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { gpsTourSpeichern, gpsTourAdminAnsicht } = require('../lib/gpstour');
const { kontrollcodeHash } = require('../lib/gpsspiel');

const secret = 'test-only-secret-with-at-least-32-characters';
const station = (overrides = {}) => ({
  id: 'station-1', qrId: 'brilon-001', frage: 'Welche Figur steht am Brunnen?',
  antworten: ['Petrus', 'Ein Drache'], loesungIndex: 0,
  latitude: 51.394, longitude: 8.572, kontrollcode: '123456', ...overrides
});
const tour = (stations, overrides = {}) => ({
  titel: 'Brilon entdecken', startpunkt: 'Marktplatz', ziel: 'Marktplatz',
  dauer: 60, preis: 45, stationen: stations, ...overrides
});

test('Neue Touren verlangen einen gültigen Stationscode und speichern nur dessen Hash', () => {
  const erstellt = gpsTourSpeichern(tour([station()]), null, secret);
  assert.equal(erstellt.stationen[0].kontrollcodeHash, kontrollcodeHash('123456', secret));
  assert.equal('kontrollcode' in erstellt.stationen[0], false);
  assert.throws(() => gpsTourSpeichern(tour([station({ kontrollcode: '' })]), null, secret), /Station 1/);
});

test('Bearbeiten erhält den Hash für dieselbe Station und QR-Kennung', () => {
  const alt = gpsTourSpeichern(tour([station()]), null, secret);
  const eingabe = station({ kontrollcode: '' , frage: 'Welche Figur ist am Brunnen?' });
  const aktualisiert = gpsTourSpeichern(tour([eingabe], { beschreibung: 'Überarbeitet' }), alt, secret);
  assert.equal(aktualisiert.stationen[0].kontrollcodeHash, alt.stationen[0].kontrollcodeHash);
  assert.equal(aktualisiert.stationen[0].frage, 'Welche Figur ist am Brunnen?');
});

test('Eine geänderte QR-Kennung benötigt einen neuen Code', () => {
  const alt = gpsTourSpeichern(tour([station()]), null, secret);
  assert.throws(() => gpsTourSpeichern(tour([station({ qrId: 'brilon-002', kontrollcode: '' })]), alt, secret), /Station 1/);
  const neu = gpsTourSpeichern(tour([station({ qrId: 'brilon-002', kontrollcode: '987654' })]), alt, secret);
  assert.equal(neu.stationen[0].kontrollcodeHash, kontrollcodeHash('987654', secret));
});

test('Admin-Ansicht gibt weder Code noch Hash zurück', () => {
  const gespeichert = gpsTourSpeichern(tour([station()]), null, secret);
  const ansicht = gpsTourAdminAnsicht(gespeichert);
  assert.equal('kontrollcode' in ansicht.stationen[0], false);
  assert.equal('kontrollcodeHash' in ansicht.stationen[0], false);
});
