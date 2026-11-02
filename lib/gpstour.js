'use strict';

const { kontrollcodeHash } = require('./gpsspiel');

function text(wert, max) {
  return typeof wert === 'string' ? wert.trim().slice(0, max) : '';
}

function gpsTourSpeichern(d, vorherigeTour = null, secret) {
  if (typeof secret !== 'string' || secret.length < 32)
    throw new Error('GPS_CODE_SECRET muss mindestens 32 Zeichen lang sein.');
  const titel = text(d.titel, 120), beschreibung = text(d.beschreibung, 2000);
  const schwierigkeitsgrad = text(d.schwierigkeitsgrad, 30), altersgruppe = text(d.altersgruppe, 80);
  const startpunkt = text(d.startpunkt, 160), ziel = text(d.ziel, 160);
  const dauer = Number(d.dauer), preis = Number(d.preis);
  if (!titel || !startpunkt || !ziel || !Number.isInteger(dauer) || dauer < 15 || dauer > 1440 ||
      !Number.isFinite(preis) || preis < 0 || !Array.isArray(d.stationen) ||
      d.stationen.length < 1 || d.stationen.length > 60)
    throw new Error('Tourdaten oder Stationsanzahl sind ungültig.');

  const ids = new Set(), qrIds = new Set();
  const alteStationen = new Map((Array.isArray(vorherigeTour?.stationen) ? vorherigeTour.stationen : [])
    .map(station => [station.id, station]));
  const stationen = d.stationen.map((s, index) => {
    const id = text(s.id, 80) || 'station-' + (index + 1);
    const qrId = text(s.qrId, 120), frage = text(s.frage, 500);
    const code = text(s.kontrollcode, 8);
    const antworten = Array.isArray(s.antworten) ? s.antworten.map(a => text(a, 160)) : [];
    const latitude = Number(s.latitude), longitude = Number(s.longitude), loesungIndex = Number(s.loesungIndex);
    const alt = alteStationen.get(id);
    const hash = code && /^\d{4,8}$/.test(code)
      ? kontrollcodeHash(code, secret)
      : alt && alt.qrId === qrId && /^[a-f0-9]{64}$/i.test(alt.kontrollcodeHash || '')
        ? alt.kontrollcodeHash
        : null;

    if (ids.has(id) || qrIds.has(qrId) || !qrId || !frage || !hash ||
        (code && !/^\d{4,8}$/.test(code)) || antworten.length !== 2 || antworten.some(a => !a) ||
        ![0, 1].includes(loesungIndex) || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180)
      throw new Error('Station ' + (index + 1) + ' ist unvollständig oder ungültig.');

    ids.add(id);
    qrIds.add(qrId);
    return { id, qrId, frage, antworten, loesungIndex, latitude, longitude, kontrollcodeHash: hash };
  });
  return {
    titel,
    angebotName: 'GPS-Schatzsuche: ' + titel,
    beschreibung,
    schwierigkeitsgrad,
    altersgruppe,
    startpunkt,
    ziel,
    dauer,
    preis,
    buchbar: d.buchbar === true,
    stationen
  };
}

function gpsTourAdminAnsicht(data) {
  return { ...data, stationen: data.stationen.map(({ kontrollcodeHash: _hash, ...station }) => station) };
}

module.exports = { gpsTourSpeichern, gpsTourAdminAnsicht };
