'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { heuteInBerlin } = require('../lib/kalendertag');

test('Buchungsdatum verwendet die Ortszeit Brilon statt UTC', () => {
  assert.equal(heuteInBerlin('2026-11-01T22:30:00Z'), '2026-11-01');
  assert.equal(heuteInBerlin('2026-11-01T23:30:00Z'), '2026-11-02');
  assert.equal(heuteInBerlin('2026-03-29T21:30:00Z'), '2026-03-29');
  assert.equal(heuteInBerlin('2026-03-29T22:30:00Z'), '2026-03-30');
});

test('Ungültige Zeitpunkte werden abgewiesen', () => {
  assert.throws(() => heuteInBerlin('kein Datum'), RangeError);
});
