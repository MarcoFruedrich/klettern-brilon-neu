'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { preisFuerTeilnehmer, zahlungsstand, preisNachAnschlussrabatt, preisBeiAnschlussstorno, zahlungErgaenzen, statusPruefen, konflikt } = require('../lib/buchungslogik');

test('Preis wird anhand einer passenden Teilnehmerstaffel in Cent berechnet', () => {
  assert.equal(preisFuerTeilnehmer({'5-10': 125.50}, 6), 12550);
  assert.equal(preisFuerTeilnehmer({'5-10': 125.50}, 4), null);
  assert.equal(preisFuerTeilnehmer({'1-4': 80,'21-150':300}, 4), 8000);
  assert.equal(preisFuerTeilnehmer({'21-150':300}, 150), 30000);
});
test('Anzahlung und tatsächliche Zahlungseingänge bleiben centgenau', () => {
  assert.deepEqual(zahlungsstand(10001, [{betragCent: 2500}, {betragCent: 1000}]), {
    gesamtCent: 10001, anzahlungCent: 2500, restNachAnzahlungCent: 7501,
    erhaltenCent: 3500, offenCent: 6501, anzahlungErreicht: true, vollstaendigBezahlt: false
  });
});
test('Anschlussrabatt senkt den Restbetrag unter Berücksichtigung bisheriger Zahlungen', () => {
  assert.deepEqual(preisNachAnschlussrabatt(10000, 1000, [{betragCent:2500}]), {
    gesamtCent:9000, rabattCent:1000, erhaltenCent:2500, offenCent:6500, gutschriftCent:0
  });
});
test('Anschlussrabatt weist eine Überzahlung als Gutschrift aus', () => {
  assert.deepEqual(preisNachAnschlussrabatt(10000, 1000, [{betragCent:9500}]), {
    gesamtCent:9000, rabattCent:1000, erhaltenCent:9500, offenCent:0, gutschriftCent:500
  });
  assert.throws(() => preisNachAnschlussrabatt(1000, 1100, []), /Anschlussrabatt/);
});
test('Storno der Anschlussbuchung stellt die Preisbasis wieder her und berechnet den Rest neu', () => {
  assert.deepEqual(preisBeiAnschlussstorno(9000, 10000, [{betragCent:2500}]), {
    gesamtCent:10000, erhaltenCent:2500, offenCent:7500, gutschriftCent:0
  });
  assert.deepEqual(preisBeiAnschlussstorno(9000, 10000, [{betragCent:10500}]), {
    gesamtCent:10000, erhaltenCent:10500, offenCent:0, gutschriftCent:500
  });
  assert.throws(() => preisBeiAnschlussstorno(10000, 9000, []), /Preisbasis/);
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
