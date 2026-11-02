'use strict';

const BUCHUNGSSTATUS = new Set(['offen', 'bestaetigt', 'abgelehnt', 'storniert']);

function preisInCent(preis) {
  const wert = Number(preis);
  if (!Number.isFinite(wert) || wert < 0) throw new RangeError('Ungültiger Preis.');
  return Math.round(wert * 100);
}

function preisFuerTeilnehmer(preise, teilnehmer) {
  if (!Number.isInteger(teilnehmer) || teilnehmer < 1 || teilnehmer > 150)
    throw new RangeError('Ungültige Teilnehmerzahl.');
  const staffel = teilnehmer <= 4 ? '1-4' : teilnehmer <= 10 ? '5-10' :
    teilnehmer <= 15 ? '11-15' : teilnehmer <= 20 ? '16-20' : '21-150';
  const wert = preise?.[staffel];
  return wert === undefined || wert === null ? null : preisInCent(wert);
}

function zahlungsstand(gesamtCent, zahlungen = []) {
  if (!Number.isSafeInteger(gesamtCent) || gesamtCent < 0)
    throw new RangeError('Gesamtbetrag muss in Cent angegeben werden.');
  if (!Array.isArray(zahlungen)) throw new TypeError('Zahlungen müssen eine Liste sein.');
  const erhaltenCent = zahlungen.reduce((summe, zahlung) => {
    if (!zahlung || !Number.isSafeInteger(zahlung.betragCent) || zahlung.betragCent <= 0)
      throw new RangeError('Zahlung muss einen positiven Centbetrag enthalten.');
    return summe + zahlung.betragCent;
  }, 0);
  const anzahlungCent = Math.round(gesamtCent * 0.25);
  return {
    gesamtCent,
    anzahlungCent,
    restNachAnzahlungCent: gesamtCent - anzahlungCent,
    erhaltenCent,
    offenCent: Math.max(0, gesamtCent - erhaltenCent),
    anzahlungErreicht: erhaltenCent >= anzahlungCent,
    vollstaendigBezahlt: erhaltenCent >= gesamtCent
  };
}

function preisNachAnschlussrabatt(gesamtCent, rabattCent, zahlungen = []) {
  if (!Number.isSafeInteger(rabattCent) || rabattCent < 0 || rabattCent > gesamtCent)
    throw new RangeError('Ungültiger Anschlussrabatt.');
  const neuerGesamtCent = gesamtCent - rabattCent;
  const stand = zahlungsstand(neuerGesamtCent, zahlungen);
  return {
    gesamtCent: neuerGesamtCent,
    rabattCent,
    erhaltenCent: stand.erhaltenCent,
    offenCent: stand.offenCent,
    gutschriftCent: Math.max(0, stand.erhaltenCent - neuerGesamtCent)
  };
}

function preisBeiAnschlussstorno(aktuellerCent, basisCent, zahlungen = []) {
  if (!Number.isSafeInteger(aktuellerCent) || aktuellerCent < 0 ||
      !Number.isSafeInteger(basisCent) || basisCent < aktuellerCent)
    throw new RangeError('Ungültige Preisbasis für die Rabattkorrektur.');
  const stand = zahlungsstand(basisCent, zahlungen);
  return {
    gesamtCent: basisCent,
    erhaltenCent: stand.erhaltenCent,
    offenCent: stand.offenCent,
    gutschriftCent: Math.max(0, stand.erhaltenCent - basisCent)
  };
}

function zahlungErgaenzen(gesamtCent, zahlungen, betragCent, methode) {
  const stand = zahlungsstand(gesamtCent, zahlungen);
  if (!Number.isSafeInteger(betragCent) || betragCent <= 0)
    throw new RangeError('Zahlbetrag muss positiv und in Cent angegeben werden.');
  if (!['ueberweisung', 'bar', 'karte', 'sonstiges'].includes(methode))
    throw new RangeError('Ungültige Zahlungsart.');
  if (betragCent > stand.offenCent) throw new RangeError('Zahlbetrag übersteigt den offenen Rest.');
  const neueZahlungen = [...zahlungen, { betragCent, methode }];
  return { zahlungen: neueZahlungen, stand: zahlungsstand(gesamtCent, neueZahlungen) };
}

function statusPruefen(status) {
  if (!BUCHUNGSSTATUS.has(status)) throw new RangeError('Ungültiger Buchungsstatus.');
  return status;
}

function konflikt(a, b) {
  if (!Array.isArray(a) || a.length !== 2 || !Array.isArray(b) || b.length !== 2 ||
      !a.every(Number.isFinite) || !b.every(Number.isFinite) || a[1] <= a[0] || b[1] <= b[0])
    throw new RangeError('Ungültiges Buchungszeitfenster.');
  return a[0] < b[1] && b[0] < a[1];
}

module.exports = { preisInCent, preisFuerTeilnehmer, zahlungsstand, preisNachAnschlussrabatt, preisBeiAnschlussstorno, zahlungErgaenzen, statusPruefen, konflikt };
