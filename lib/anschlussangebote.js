'use strict';
const crypto = require('node:crypto');

function erzeugeZugang(id, secret, jetzt = Date.now()) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
      typeof secret !== 'string' || secret.length < 32)
    throw new RangeError('Ungültige Zugangsdaten.');
  const inhalt = Buffer.from(JSON.stringify({ id, ablauf: jetzt + 365 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const signatur = crypto.createHmac('sha256', secret).update(inhalt).digest('base64url');
  return inhalt + '.' + signatur;
}

function pruefeZugang(token, secret, jetzt = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof token !== 'string') return null;
  const [inhalt, signatur, extra] = token.split('.');
  if (!inhalt || !signatur || extra !== undefined) return null;
  const erwartet = crypto.createHmac('sha256', secret).update(inhalt).digest();
  let erhalten;
  try { erhalten = Buffer.from(signatur, 'base64url'); } catch { return null; }
  if (erwartet.length !== erhalten.length || !crypto.timingSafeEqual(erwartet, erhalten)) return null;
  try {
    const payload = JSON.parse(Buffer.from(inhalt, 'base64url').toString('utf8'));
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.id) ||
        !Number.isSafeInteger(payload.ablauf) || payload.ablauf <= jetzt) return null;
    return payload.id;
  } catch { return null; }
}

function zugelasseneAnschlusszeiten(beginnMinuten, endeMinuten, dauerMinuten) {
  if (!Number.isInteger(beginnMinuten) || !Number.isInteger(endeMinuten) ||
      endeMinuten <= beginnMinuten || !Number.isInteger(dauerMinuten) || dauerMinuten <= 0)
    throw new RangeError('Ungültiges Anschlusszeitfenster.');
  const auswahl = [];
  for (let start = 9 * 60; start <= 19 * 60; start += 60) {
    const ende = start + dauerMinuten;
    if (ende === beginnMinuten)
      auswahl.push({ richtung: 'davor', beginnMinuten: start, endeMinuten: ende });
    if (start === endeMinuten && ende <= 24 * 60)
      auswahl.push({ richtung: 'danach', beginnMinuten: start, endeMinuten: ende });
  }
  return auswahl;
}

function anschlussPreis(preisCent) {
  if (!Number.isSafeInteger(preisCent) || preisCent < 0)
    throw new RangeError('Ungültiger Programmpreis.');
  const rabattCent = Math.round(preisCent * 0.10);
  return { originalCent: preisCent, rabattCent, endpreisCent: preisCent - rabattCent };
}

module.exports = { zugelasseneAnschlusszeiten, anschlussPreis, erzeugeZugang, pruefeZugang };
