'use strict';
const DEFAULT_SEKUNDEN=11;
const MIN_SEKUNDEN=5;
const MAX_SEKUNDEN=120;
function werbedauerLesen(wert){
  const zahl=Number(wert);
  return Number.isSafeInteger(zahl)&&zahl>=MIN_SEKUNDEN&&zahl<=MAX_SEKUNDEN
    ?zahl:DEFAULT_SEKUNDEN;
}
function werbedauerPruefen(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||
    typeof data.sekunden!=='number'||!Number.isSafeInteger(data.sekunden)||
    data.sekunden<MIN_SEKUNDEN||data.sekunden>MAX_SEKUNDEN)
    throw Error('Bitte eine Anzeigedauer zwischen 5 und 120 Sekunden eingeben.');
  return data.sekunden;
}
module.exports={DEFAULT_SEKUNDEN,MIN_SEKUNDEN,MAX_SEKUNDEN,werbedauerLesen,werbedauerPruefen};
