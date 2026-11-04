'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { zugelasseneAnschlusszeiten, anschlussPreis, erzeugeZugang, pruefeZugang } = require('../lib/anschlussangebote');

test('Anschlussangebote lassen nur direkt angrenzende volle Stunden zu', () => {
  assert.deepEqual(zugelasseneAnschlusszeiten(660, 810, 120), [
    { richtung:'davor', beginnMinuten:540, endeMinuten:660 }
  ]);
  assert.deepEqual(zugelasseneAnschlusszeiten(660, 720, 120), [
    { richtung:'davor', beginnMinuten:540, endeMinuten:660 },
    { richtung:'danach', beginnMinuten:720, endeMinuten:840 }
  ]);
  assert.deepEqual(zugelasseneAnschlusszeiten(660, 750, 90), []);
});

test('Anschlussangebotspreis berechnet 10 Prozent centgenau', () => {
  assert.deepEqual(anschlussPreis(12551), { originalCent:12551, rabattCent:1255, endpreisCent:11296 });
  assert.throws(() => anschlussPreis(-1), /Programmpreis/);
});

test('Persönlicher Angebotszugang ist signiert, läuft ab und schützt die Buchungs-ID', () => {
  const id='550e8400-e29b-41d4-a716-446655440000', secret='x'.repeat(32), now=1_800_000_000_000;
  const token=erzeugeZugang(id,secret,now);
  assert.equal(pruefeZugang(token,secret,now+1000),id);
  assert.equal(pruefeZugang(token,secret,now+366*24*60*60*1000),null);
  assert.equal(pruefeZugang(token,secret+'y',now),null);
  assert.equal(pruefeZugang(token.slice(0,-1)+'A',secret,now),null);
});
