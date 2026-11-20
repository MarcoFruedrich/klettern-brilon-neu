'use strict';

// Ein neuer Veranstaltungszeitpunkt erfordert eine neue Mitarbeiterfreigabe.
// Reine Bearbeitungsnotizen oder Eingaben ohne tatsächliche Änderung zählen nicht.
function terminGeaendert(alt,neueWerte){
  if(!neueWerte||typeof neueWerte!=='object')return false;
  if(neueWerte.datum!==undefined&&String(neueWerte.datum)!==String(alt.datum||''))return true;
  if(neueWerte.uhrzeit!==undefined&&String(neueWerte.uhrzeit).slice(0,5)!==String(alt.uhrzeit||'').slice(0,5))return true;
  if(neueWerte.dauer!==undefined&&Number(neueWerte.dauer)!==Number(alt.dauer))return true;
  return false;
}
function direkterTerminwechselGrund(status,zugewiesene){
  if(status==='bestaetigt')
    return 'Eine bereits bestätigte Buchung darf nicht direkt verschoben werden. Bitte die geprüfte Umbuchungsfreigabe nutzen; Mitarbeiter müssen erneut zustimmen.';
  if(zugewiesene>0)
    return 'Vor einer Terminänderung müssen bestehende Mitarbeitereinteilungen in der Einsatzplanung aufgehoben und zum neuen Termin erneut vorgenommen werden.';
  return null;
}
module.exports={terminGeaendert,direkterTerminwechselGrund};
