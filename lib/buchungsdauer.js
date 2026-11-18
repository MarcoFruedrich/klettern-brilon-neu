'use strict';

// Fallback für ältere Programme ohne individuell gespeicherte Teilnehmerstufen.
const FAKTOREN = [
  { bis: 4, faktor: 0.6 },
  { bis: 10, faktor: 1 },
  { bis: 15, faktor: 1.2 },
  { bis: 20, faktor: 1.4 },
  { bis: 1000, faktor: 1.6 }
];

function buchungsdauerBerechnen(teilnehmer, basisdauer) {
  const anzahl = Number(teilnehmer);
  const basis = Number(basisdauer);
  if (!Number.isInteger(anzahl) || anzahl < 1 || anzahl > 1000 ||
      !Number.isInteger(basis) || basis < 15 || basis > 1440) return null;
  const staffel = FAKTOREN.find(eintrag => anzahl <= eintrag.bis);
  return Math.max(15, Math.round((basis * staffel.faktor) / 5) * 5);
}

function buchungsdauerFuerProgramm(teilnehmer, programm, programmdauer = null) {
  const anzahl=Number(teilnehmer),basis=Number(programm?.dauer);
  const auswahl=programmdauer===null||programmdauer===''?null:Number(programmdauer);
  if(!Number.isInteger(anzahl)||anzahl<1||anzahl>1000||!Number.isInteger(basis)||basis<15||basis>1440||
     (auswahl!==null&&(!Number.isInteger(auswahl)||auswahl<15||auswahl>1440)))return null;
  if(programm?.dauer_modus==='fest')return auswahl===null||auswahl===basis?basis:null;
  const alle=Array.isArray(programm?.gruppenstufen)?programm.gruppenstufen:[];
  if(alle.length){
    const passende=alle.filter(item=>
      Number.isInteger(Number(item?.min))&&Number.isInteger(Number(item?.max))&&
      anzahl>=Number(item.min)&&anzahl<=Number(item.max));
    // Keine willkürliche Auswahl, wenn dieselbe Gruppe 180 und 240 Minuten buchen kann.
    const stufe=auswahl===null?(passende.length===1?passende[0]:null):
      passende.find(item=>Number(item.dauer)===auswahl);
    if(!stufe)return null;
    const dauer=Number(stufe.dauer);
    return Number.isInteger(dauer)&&dauer>=15&&dauer<=1440?dauer:null;
  }
  // Historische Angebote ohne gespeicherte Einzelstaffeln behalten ihr altes Verhalten.
  return auswahl===null?buchungsdauerBerechnen(anzahl,basis):null;
}

module.exports = { buchungsdauerBerechnen, buchungsdauerFuerProgramm };
