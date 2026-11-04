'use strict';

/**
 * Anschlussangebot: Zwei zeitlich benachbarte Programme werden jeweils um
 * 10 % rabattiert. Ein Programm bekommt auch bei zwei Nachbarn nur EINMAL
 * Rabatt. Preise sind in ganzen Cent anzugeben.
 *
 * Erwartet [{id, start, ende, preisCent}] mit ISO-Zeitstempeln.
 * Die Entscheidung, ob eine Anschlussbuchung zulässig ist, erfolgt separat.
 */
function anschlussrabatte(programme, rabattProzent = 10) {
  if (!Array.isArray(programme)) throw new TypeError('Programme müssen ein Array sein.');
  if (rabattProzent !== 10) throw new RangeError('Anschlussrabatt beträgt 10 %.');
  const termine = programme.map(p => {
    if (!p || typeof p.id !== 'string' || !p.id) throw new Error('Programm-ID fehlt.');
    if (!Number.isSafeInteger(p.preisCent) || p.preisCent < 0) throw new Error('Ungültiger Preis.');
    const start = Date.parse(p.start), ende = Date.parse(p.ende);
    if (!Number.isFinite(start) || !Number.isFinite(ende) || ende <= start)
      throw new Error('Ungültiger Programmzeitraum.');
    return { ...p, startMs:start, endeMs:ende };
  }).sort((a,b) => a.startMs - b.startMs);
  if (new Set(termine.map(p => p.id)).size !== termine.length)
    throw new Error('Programm-IDs müssen eindeutig sein.');

  const rabattiert = new Set();
  for (let i=1; i<termine.length; i++) {
    const vorher = termine[i-1], nachher = termine[i];
    // Nur direkt anschließende Programme, ohne Lücke und ohne Überlappung.
    if (vorher.endeMs === nachher.startMs) {
      rabattiert.add(vorher.id);
      rabattiert.add(nachher.id);
    }
  }
  return programme.map(p => {
    const rabattCent = rabattiert.has(p.id) ? Math.round(p.preisCent * 0.10) : 0;
    return { id:p.id, originalCent:p.preisCent, rabattCent, endpreisCent:p.preisCent-rabattCent };
  });
}

module.exports = { anschlussrabatte };
