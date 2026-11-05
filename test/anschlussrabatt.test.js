'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { anschlussrabatte } = require('../lib/anschlussrabatt');
const programm = (id, start, ende) => ({
  id, start: '2026-11-15T' + start + ':00+01:00',
  ende: '2026-11-15T' + ende + ':00+01:00', preisCent: 10000
});
test('Zwei direkte Anschlussprogramme erhalten beide 10 Prozent', () => {
  const ergebnis = anschlussrabatte([
    programm('A', '10:00', '11:00'),
    programm('B', '11:00', '12:00')
  ]);
  assert.deepEqual(ergebnis.map(p => p.rabattCent), [1000, 1000]);
});
test('Mittleres Programm bekommt Rabatt nur einmal', () => {
  const ergebnis = anschlussrabatte([
    programm('A', '10:00', '11:00'),
    programm('B', '11:00', '12:00'),
    programm('C', '12:00', '13:00')
  ]);
  assert.deepEqual(ergebnis.map(p => p.rabattCent), [1000, 1000, 1000]);
});
test('Zeitluecke gibt keinen Rabatt', () => {
  const ergebnis = anschlussrabatte([
    programm('A', '10:00', '11:00'),
    programm('B', '11:30', '12:30')
  ]);
  assert.deepEqual(ergebnis.map(p => p.rabattCent), [0, 0]);
});
