'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { customerConfirmationDue, settingsForAdmin } = require('../lib/kundenbestaetigungszeiten');
const { zahlungsstand } = require('../lib/buchungslogik');

test('Verwaltungsfenster: 120 Minuten, Versand vor Ruhezeit', () => {
  assert.equal(customerConfirmationDue('2026-11-09T14:00:00+01:00').toISOString(), '2026-11-09T15:00:00.000Z');
});
test('Verwaltungsfenster endet nach 18 Uhr: Kundenmail frühestens 9 Uhr', () => {
  assert.equal(customerConfirmationDue('2026-11-09T17:30:00+01:00').toISOString(), '2026-11-10T08:00:00.000Z');
});
test('Trainerzusage in der Nacht: Kundenmail frühestens 9 Uhr', () => {
  assert.equal(customerConfirmationDue('2026-11-09T23:00:00+01:00').toISOString(), '2026-11-10T08:00:00.000Z');
});
test('Verwaltungsfenster dauerhaft konfigurierbar: 30 Minuten', () => {
  const s={verzoegerungMinuten:30,ruhebeginn:'20:00',ruheende:'08:00'};
  assert.deepEqual(settingsForAdmin(s),s);
  assert.equal(customerConfirmationDue('2026-11-09T18:00:00+01:00',s).toISOString(), '2026-11-09T17:30:00.000Z');
});
test('Anzahlung und Vollzahlung sind unterschiedliche Zahlungsstände', () => {
  const deposit=zahlungsstand(10000,[{betragCent:2500,methode:'ueberweisung'}]);
  assert.equal(deposit.anzahlungErreicht,true);
  assert.equal(deposit.vollstaendigBezahlt,false);
  const paid=zahlungsstand(10000,[{betragCent:10000,methode:'ueberweisung'}]);
  assert.equal(paid.vollstaendigBezahlt,true);
});
