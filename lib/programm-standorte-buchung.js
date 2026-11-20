'use strict';
function programmAmStandort(programm,standort){
  if(!programm||typeof standort!=='string'||!standort.trim())return false;
  const liste=Array.isArray(programm.veranstaltungsorte)&&programm.veranstaltungsorte.length
    ?programm.veranstaltungsorte:[programm.veranstaltungsort].filter(Boolean);
  return liste.includes(standort);
}
module.exports={programmAmStandort};
