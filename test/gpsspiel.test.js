'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stationFuerSpiel, stationPruefen, gpsSpieldauer } = require('../lib/gpsspiel');

const tour = { stationen: [
  {id:'s1', qrId:'qr-a', kontrollcode:'1234', frage:'Frage 1?', antworten:['A','B'], loesungIndex:1, latitude:51.4, longitude:8.6},
  {id:'s2', qrId:'qr-b', kontrollcode:'5678', frage:'Frage 2?', antworten:['C','D'], loesungIndex:0, latitude:51.5, longitude:8.7}
]};

test('Spielansicht liefert nur die aktive Station ohne Folgekoordinaten', () => {
  assert.deepEqual(stationFuerSpiel(tour, 0), {station:1, gesamt:2, id:'s1', frage:'Frage 1?', antworten:['A','B']});
});
test('Falscher QR-Code, Kontrollcode oder Antwort geben die Station nicht frei', () => {
  const spiel = {stationIndex:0, abgeschlossen:false};
  assert.equal(stationPruefen(tour, spiel, {qrId:'qr-x', kontrollcode:'1234', antwort:1}).grund, 'qr');
  assert.equal(stationPruefen(tour, spiel, {qrId:'qr-a', kontrollcode:'0000', antwort:1}).grund, 'code');
  assert.equal(stationPruefen(tour, spiel, {qrId:'qr-a', kontrollcode:'1234', antwort:0}).grund, 'antwort');
});
test('Richtige Stationsdaten geben nur die unmittelbar folgende Station frei', () => {
  const result = stationPruefen(tour, {stationIndex:0, abgeschlossen:false}, {qrId:'qr-a', kontrollcode:'1234', antwort:1});
  assert.equal(result.korrekt, true);
  assert.equal(result.spiel.stationIndex, 1);
  assert.equal(result.naechsteStation.id, 's2');
  assert.equal('latitude' in result.naechsteStation, false);
});
test('Parallele Gruppen behalten unabhängige Stationsstände', () => {
  const gruppeA = {stationIndex:0, abgeschlossen:false};
  const gruppeB = {stationIndex:0, abgeschlossen:false};
  const weiter = stationPruefen(tour, gruppeA, {qrId:'qr-a', kontrollcode:'1234', antwort:1});
  assert.equal(weiter.spiel.stationIndex, 1);
  assert.equal(gruppeA.stationIndex, 0);
  assert.equal(gruppeB.stationIndex, 0);
});
test('Spieldauer wird in ganzen Sekunden berechnet', () => {
  assert.equal(gpsSpieldauer(1000, 12500), 11);
  assert.throws(() => gpsSpieldauer(4, 2), /Spielzeiten/);
});
