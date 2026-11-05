'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buchungsreferenz } = require('../lib/buchungsreferenz');

test('Buchungsnummer aus Name und Veranstaltungstag', () => {
  assert.equal(buchungsreferenz('Müller', 'Max', '2026-11-15'), 'MUELLER-MAX-151126');
});
test('Doppelte Buchungsnummer erhält Suffix', () => {
  assert.equal(buchungsreferenz('Müller', 'Max', '2026-11-15', 2), 'MUELLER-MAX-151126-02');
});
test('Ungültige Daten werden zurückgewiesen', () => {
  assert.throws(() => buchungsreferenz('Müller', 'Max', '2026-02-30'));
  assert.throws(() => buchungsreferenz('', 'Max', '2026-11-15'));
});
