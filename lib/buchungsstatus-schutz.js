'use strict';
/**
 * Abgelehnte oder stornierte Buchungen sind endgültig beendet.
 * Eine Wiederaufnahme benötigt einen eigenständigen, revisionsfähigen
 * Vorgang mit erneuter Verfügbarkeits- und Zahlungsprüfung.
 */
function statuswechselGrund(vorher,nachher){
  if(['storniert','abgelehnt'].includes(vorher)&&vorher!==nachher)
    return 'Eine stornierte oder abgelehnte Buchung darf nicht direkt wieder aktiviert werden. Bitte eine neue Buchungsanfrage anlegen und Verfügbarkeit sowie Zahlungen neu prüfen.';
  return null;
}
module.exports={statuswechselGrund};
