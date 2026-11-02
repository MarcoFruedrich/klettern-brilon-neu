'use strict';
// Menschlich lesbare Buchungsreferenz für Kunden und Banküberweisungen.
// Eine unveränderliche UUID bleibt die technische Identität der Buchung.
function nameTeile(v) {
  const teile=String(v||'').trim().split(/\s+/).filter(Boolean);
  if(teile.length<2) throw new Error('Bitte Vor- und Nachnamen angeben.');
  return {vorname:teile[0],nachname:teile.slice(1).join(' ')};
}
function norm(v) {
  return v.replace(/Ä/g,'AE').replace(/Ö/g,'OE').replace(/Ü/g,'UE')
    .replace(/ä/g,'AE').replace(/ö/g,'OE').replace(/ü/g,'UE').replace(/ß/g,'SS')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'');
}
function buchungsnummer(name,datum,zaehler=1) {
  const {vorname,nachname}=nameTeile(name);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new Error('Ungültiges Veranstaltungsdatum.');
  const [jahr,monat,tag]=datum.split('-').map(Number);
  const pruefung=new Date(Date.UTC(jahr,monat-1,tag));
  if(pruefung.getUTCFullYear()!==jahr||pruefung.getUTCMonth()!==monat-1||pruefung.getUTCDate()!==tag)
    throw new Error('Ungültiges Veranstaltungsdatum.');
  if(!Number.isSafeInteger(zaehler)||zaehler<1) throw new Error('Ungültige laufende Nummer.');
  const basis=norm(nachname)+'-'+norm(vorname)+'-'+String(tag).padStart(2,'0')+
    String(monat).padStart(2,'0')+String(jahr).slice(-2);
  return basis+(zaehler===1?'':'-'+String(zaehler).padStart(2,'0'));
}
module.exports={buchungsnummer};
