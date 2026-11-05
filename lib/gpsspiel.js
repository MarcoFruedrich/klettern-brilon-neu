'use strict';

const crypto = require('node:crypto');

function sichereGleichheit(a, b) {
  const aa = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function kontrollcodeHash(code, secret) {
  if (typeof secret !== 'string' || secret.length < 32)
    throw new Error('GPS_CODE_SECRET muss mindestens 32 Zeichen lang sein.');
  return crypto.createHmac('sha256', secret).update(String(code)).digest('hex');
}

function stationFuerSpiel(tour, stationIndex) {
  if (!tour || !Array.isArray(tour.stationen) || !Number.isInteger(stationIndex) ||
      stationIndex < 0 || stationIndex >= tour.stationen.length)
    throw new RangeError('Station nicht gefunden.');
  const { id, frage, antworten } = tour.stationen[stationIndex];
  if (!Array.isArray(antworten) || antworten.length !== 2)
    throw new Error('Jede Station benötigt genau zwei Antwortmöglichkeiten.');
  // Nachfolgende Koordinaten, QR-Kennungen, Codes und Lösungen verlassen nie den Server.
  return { station: stationIndex + 1, gesamt: tour.stationen.length, id, frage, antworten };
}

function stationPruefen(tour, spiel, eingabe, secret) {
  if (!spiel || spiel.abgeschlossen || spiel.stationIndex < 0 ||
      spiel.stationIndex >= tour.stationen.length)
    throw new Error('Dieses Spiel ist nicht aktiv.');
  const station = tour.stationen[spiel.stationIndex];
  if (!sichereGleichheit(eingabe?.qrId, station.qrId))
    return { korrekt: false, grund: 'qr' };
  const codeKorrekt = station.kontrollcodeHash
    ? sichereGleichheit(kontrollcodeHash(eingabe?.kontrollcode, secret), station.kontrollcodeHash)
    : sichereGleichheit(eingabe?.kontrollcode, station.kontrollcode);
  if (!codeKorrekt)
    return { korrekt: false, grund: 'code' };
  if (!Number.isInteger(eingabe?.antwort) || ![0, 1].includes(eingabe.antwort) ||
      eingabe.antwort !== station.loesungIndex)
    return { korrekt: false, grund: 'antwort' };
  const naechsterIndex = spiel.stationIndex + 1;
  const abgeschlossen = naechsterIndex >= tour.stationen.length;
  return {
    korrekt: true,
    spiel: { ...spiel, stationIndex: naechsterIndex, abgeschlossen },
    naechsteStation: abgeschlossen ? null : stationFuerSpiel(tour, naechsterIndex)
  };
}

function gpsSpieldauer(startMs, endeMs) {
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endeMs) || endeMs < startMs)
    throw new RangeError('Ungültige Spielzeiten.');
  return Math.floor((endeMs - startMs) / 1000);
}

module.exports = { stationFuerSpiel, stationPruefen, gpsSpieldauer, kontrollcodeHash };
