'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { abgelaufeneEintraegeEntfernen, erstelleRateLimiter } = require('../lib/sicherheitszustand');

test('Rate-Limits zählen pro Schlüssel und verfallen nach dem Zeitfenster', () => {
  let jetzt = 1000;
  const limit = erstelleRateLimiter({ uhr: () => jetzt });
  assert.equal(limit.erlauben('ip-a', 2, 1000), true);
  assert.equal(limit.erlauben('ip-a', 2, 1000), true);
  assert.equal(limit.erlauben('ip-a', 2, 1000), false);
  assert.equal(limit.erlauben('ip-b', 2, 1000), true);
  jetzt = 2001;
  assert.equal(limit.erlauben('ip-a', 2, 1000), true);
});

test('Rate-Limit-Schlüssel sind begrenzt und abgelaufene Buckets werden entfernt', () => {
  let jetzt = 1000;
  const limit = erstelleRateLimiter({ maxSchluessel: 2, bereinigungAlle: 99, uhr: () => jetzt });
  assert.equal(limit.erlauben('a', 1, 1000), true);
  assert.equal(limit.erlauben('b', 1, 1000), true);
  assert.equal(limit.erlauben('c', 1, 1000), false);
  jetzt = 601001;
  assert.equal(limit.erlauben('c', 1, 1000), true);
  assert.equal(limit.anzahlSchluessel(), 1);
});

test('Sitzungsbereinigung entfernt nur abgelaufene oder ungültige Ablaufwerte', () => {
  const sessions = new Map([['expired', 99], ['active', 101], ['invalid', NaN]]);
  abgelaufeneEintraegeEntfernen(sessions, 100);
  assert.deepEqual([...sessions.keys()], ['active']);
});
