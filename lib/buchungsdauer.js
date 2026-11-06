'use strict';

// Die im Angebot gepflegte Dauer gilt als Richtwert für Gruppen mit 5–10 Personen.
// Andere Gruppengrößen werden anhand derselben Staffel wie die Preisgruppen angepasst.
const FAKTOREN = [
  { bis: 4, faktor: 0.6 },
  { bis: 10, faktor: 1 },
  { bis: 15, faktor: 1.2 },
  { bis: 20, faktor: 1.4 },
  { bis: 150, faktor: 1.6 }
];

function buchungsdauerBerechnen(teilnehmer, basisdauer) {
  const anzahl = Number(teilnehmer);
  const basis = Number(basisdauer);
  if (!Number.isInteger(anzahl) || anzahl < 1 || anzahl > 150 ||
      !Number.isInteger(basis) || basis < 15 || basis > 1440) return null;
  const staffel = FAKTOREN.find(eintrag => anzahl <= eintrag.bis);
  return Math.max(15, Math.round((basis * staffel.faktor) / 5) * 5);
}

module.exports = { buchungsdauerBerechnen };
