'use strict';

// Kundenlesbare Buchungsreferenz. Die Eindeutigkeit wird später in der
// Buchungstransaktion durch eine Datenbank-UNIQUE-Constraint abgesichert.
function normalisiereName(wert) {
  return String(wert || '')
    .replace(/ä/gi, 'ae').replace(/ö/gi, 'oe').replace(/ü/gi, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buchungsreferenz(nachname, vorname, datum, nummer = 1) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new Error('Datum muss YYYY-MM-DD sein.');
  const [jahr, monat, tag] = datum.split('-').map(Number);
  const d = new Date(Date.UTC(jahr, monat - 1, tag));
  if (d.getUTCFullYear() !== jahr || d.getUTCMonth() !== monat - 1 || d.getUTCDate() !== tag)
    throw new Error('Ungültiges Veranstaltungsdatum.');
  const n = normalisiereName(nachname), v = normalisiereName(vorname);
  if (!n || !v) throw new Error('Vorname und Nachname sind erforderlich.');
  if (!Number.isSafeInteger(nummer) || nummer < 1) throw new Error('Ungültige laufende Nummer.');
  const basis = n + '-' + v + '-' + String(tag).padStart(2, '0') +
    String(monat).padStart(2, '0') + String(jahr).slice(-2);
  return nummer === 1 ? basis : basis + '-' + String(nummer).padStart(2, '0');
}

module.exports = { normalisiereName, buchungsreferenz };
