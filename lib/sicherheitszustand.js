'use strict';

function abgelaufeneEintraegeEntfernen(map, jetzt = Date.now()) {
  for (const [key, ende] of map) {
    if (!Number.isFinite(ende) || ende <= jetzt) map.delete(key);
  }
}

function erstelleRateLimiter({ maxSchluessel = 10000, bereinigungAlle = 128, uhr = Date.now } = {}) {
  if (!Number.isInteger(maxSchluessel) || maxSchluessel < 1 ||
      !Number.isInteger(bereinigungAlle) || bereinigungAlle < 1 || typeof uhr !== 'function')
    throw new TypeError('Ungültige Rate-Limit-Einstellungen.');

  const versuche = new Map();
  let aufrufe = 0;

  function bereinigen(jetzt) {
    for (const [key, zeiten] of versuche) {
      const aktuell = zeiten.filter(zeit => zeit > jetzt - 600000);
      if (aktuell.length) versuche.set(key, aktuell);
      else versuche.delete(key);
    }
  }

  return {
    erlauben(key, maximum = 12, fenster = 600000) {
      if (typeof key !== 'string' || !Number.isInteger(maximum) || maximum < 1 ||
          !Number.isFinite(fenster) || fenster <= 0)
        throw new TypeError('Ungültige Rate-Limit-Anfrage.');

      const jetzt = uhr();
      if (++aufrufe % bereinigungAlle === 0) bereinigen(jetzt);

      const vorhandene = versuche.get(key);
      if (!vorhandene && versuche.size >= maxSchluessel) {
        bereinigen(jetzt);
        if (versuche.size >= maxSchluessel) return false;
      }

      const aktuelle = (versuche.get(key) || []).filter(zeit => zeit > jetzt - fenster);
      if (aktuelle.length >= maximum) {
        versuche.set(key, aktuelle.slice(-maximum));
        return false;
      }
      aktuelle.push(jetzt);
      versuche.set(key, aktuelle);
      return true;
    },
    anzahlSchluessel() { return versuche.size; }
  };
}

function adminLoginErlauben(limiter,ip,accountId){
  const ipErlaubt=limiter.erlauben('admin-login-ip:'+String(ip).slice(0,128),6,600000);
  if(!ipErlaubt)return false;
  return limiter.erlauben('admin-login-account:'+String(accountId).slice(0,128),30,600000);
}

module.exports = { abgelaufeneEintraegeEntfernen, erstelleRateLimiter, adminLoginErlauben };
