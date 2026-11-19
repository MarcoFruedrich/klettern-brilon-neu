'use strict';

// Keep the legacy location for historic programmes while supporting several venues.
function programmOrte(programm){
  const standorte=Array.isArray(programm?.standorte)?programm.standorte:[];
  return standorte.length?standorte:[programm?.veranstaltungsort||'Brilon'];
}

function normalisiereProgrammOrte(eingabe,ersatz){
  const werte=eingabe===undefined?[ersatz]:eingabe;
  if(!Array.isArray(werte)||!werte.length||werte.length>50)return null;
  if(werte.some(wert=>typeof wert!=='string'||!wert.trim()||wert.trim().length>80))return null;
  const standorte=[...new Set(werte.map(wert=>wert.trim()))];
  return standorte.length?standorte:null;
}

module.exports={programmOrte,normalisiereProgrammOrte};
