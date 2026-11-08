'use strict';

// Nur freigegebene, harmlose Texte und Symbole werden auf der Webseite angezeigt.
// Einstellungen liegen im vorhandenen JSONB-Konfigurationsdatensatz.
const DEFAULTS=[
  {id:'herbst',name:'Herbstlaub',symbol:'🍂',anzahl:9,dauerSekunden:20},
  {id:'winter',name:'Schneeflocken',symbol:'❄️',anzahl:13,dauerSekunden:25},
  {id:'fruehling',name:'Blüten',symbol:'🌸',anzahl:8,dauerSekunden:21},
  {id:'gps',name:'GPS-Abenteuer',symbol:'🧭',anzahl:3,dauerSekunden:29},
  {id:'klettern',name:'Klettern',symbol:'🧗',anzahl:3,dauerSekunden:29},
  {id:'team',name:'Teamabenteuer',symbol:'🤝',anzahl:3,dauerSekunden:29},
  {id:'huettenbau',name:'Hüttenbau',symbol:'🛖',anzahl:3,dauerSekunden:29},
  {id:'flossbau',name:'Floßbau',symbol:'🛶',anzahl:3,dauerSekunden:29}
];
function standardEffekte(){
  return {aktiv:false,aktiveId:null,eintraege:DEFAULTS.map(x=>({...x}))};
}
function pruefeWebsiteEffekte(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('Ungültige Effekt-Einstellungen.');
  if(typeof input.aktiv!=='boolean'||!Array.isArray(input.eintraege)||
     input.eintraege.length>30)throw new Error('Ungültige Effekt-Auswahl.');
  const ids=new Set();
  const eintraege=input.eintraege.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Ungültiger Effekt.');
    const id=String(item.id||''),name=String(item.name||'').trim(),symbol=String(item.symbol||'').trim();
    const anzahl=Number(item.anzahl),dauerSekunden=Number(item.dauerSekunden);
    if(!/^[a-z0-9_-]{2,50}$/.test(id)||ids.has(id)||name.length<2||name.length>60||
       [...symbol].length<1||[...symbol].length>8||/[<>\r\n]/.test(symbol)||
       !Number.isInteger(anzahl)||anzahl<1||anzahl>20||
       !Number.isInteger(dauerSekunden)||dauerSekunden<8||dauerSekunden>90)
      throw new Error('Effekt benötigt gültigen Namen, Symbol, Anzahl (1–20) und Dauer (8–90 Sekunden).');
    ids.add(id);
    return {id,name,symbol,anzahl,dauerSekunden};
  });
  const aktiveId=input.aktiveId==null?null:String(input.aktiveId);
  if(aktiveId!==null&&!ids.has(aktiveId))
    throw new Error('Der ausgewählte Effekt ist nicht vorhanden.');
  if(input.aktiv&&!aktiveId)throw new Error('Bitte einen Effekt auswählen, bevor du ihn aktivierst.');
  return {aktiv:input.aktiv,aktiveId,eintraege};
}
function leseWebsiteEffekte(value){
  if(value==null)return standardEffekte();
  try{return pruefeWebsiteEffekte(value);}catch{return standardEffekte();}
}
module.exports={standardEffekte,pruefeWebsiteEffekte,leseWebsiteEffekte};
