'use strict';

// Buchungstage gelten am Veranstaltungsort in Deutschland, nicht nach UTC.
function heuteInBerlin(zeitpunkt = new Date()) {
  const d = zeitpunkt instanceof Date ? zeitpunkt : new Date(zeitpunkt);
  if (Number.isNaN(d.getTime())) throw new RangeError('Ungültiger Zeitpunkt');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

module.exports = { heuteInBerlin };
