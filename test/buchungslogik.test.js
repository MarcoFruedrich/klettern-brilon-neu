'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { preisFuerTeilnehmer, zahlungsstand, zahlungErgaenzen, statusPruefen, konflikt } = require('../lib/buchungslogik');

test('Preis wird anhand einer passenden Teilnehmerstaffel in Cent berechnet', () => {
  assert.equal(preisFuerTeilnehmer({'5-10': 125.50}, 6), 12550);
  assert.equal(preisFuerTeilnehmer({'5-10': 125.50}, 4), null);
});
test('Anzahlung und tatsächliche Zahlungseingänge bleiben centgenau', () => {
  assert.deepEqual(zahlungsstand(10001, [{betragCent: 2500}, {betragCent: 1000}]), {
    gesamtCent: 10001, anzahlungCent: 2500, restNachAnzahlungCent: 7501,
    erhaltenCent: 3500, offenCent: 6501, anzahlungErreicht: true, vollstaendigBezahlt: false
  });
});
test('Ein Zahlungseingang wird einzeln ergänzt; ungültige und zu hohe Beträge werden abgelehnt', () => {
  const result = zahlungErgaenzen(10000, [{betragCent:2500,methode:'bar'}], 5000, 'ueberweisung');
  assert.equal(result.stand.erhaltenCent, 7500);
  assert.equal(result.stand.offenCent, 2500);
  assert.throws(() => zahlungErgaenzen(10000, [], 10001, 'karte'), /offenen Rest/);
  assert.throws(() => zahlungErgaenzen(10000, [], 1, 'paypal'), /Zahlungsart/);
});
test('Buchungsstatus und Teilnehmerzahl werden validiert', () => {
  assert.equal(statusPruefen('storniert'), 'storniert');
  assert.throws(() => statusPruefen('bezahlt'), /status/i);
  assert.throws(() => preisFuerTeilnehmer({}, 0), /Teilnehmerzahl/);
});
test('Buchungszeitfenster grenzen sich ohne Doppelbuchung direkt aneinander', () => {
  assert.equal(konflikt([540, 690], [690, 840]), false);
  assert.equal(konflikt([540, 690], [689, 840]), true);
});
