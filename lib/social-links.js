'use strict';

// Öffentliche Links und Sichtbarkeitssteuerung, keine API-Zugangsdaten oder Versandfunktion.
// Für neue Kanäle genügt eine Erweiterung dieser zentralen Liste.
const KANAELE=Object.freeze([
  {id:'whatsapp',name:'WhatsApp Business',hostnames:['wa.me','api.whatsapp.com','whatsapp.com','www.whatsapp.com'],
    startUrl:'https://wa.me/message/JXO6HLT34O37B1',startAktiv:true},
  {id:'instagram',name:'Instagram',hostnames:['instagram.com','www.instagram.com']},
  {id:'facebook',name:'Facebook',hostnames:['facebook.com','www.facebook.com','m.facebook.com','fb.com','www.fb.com']},
  {id:'youtube',name:'YouTube',hostnames:['youtube.com','www.youtube.com','m.youtube.com','youtu.be']},
  {id:'tiktok',name:'TikTok',hostnames:['tiktok.com','www.tiktok.com']},
  {id:'x',name:'X / Twitter',hostnames:['x.com','www.x.com','twitter.com','www.twitter.com']}
]);

function standard(){
  return KANAELE.map(item=>({id:item.id,name:item.name,url:item.startUrl||'',aktiv:item.startAktiv===true}));
}
function normalisiereGespeichert(data){
  const raw=Array.isArray(data)?data:[];
  return standard().map(item=>{
    const gefunden=raw.find(x=>x&&typeof x==='object'&&x.id===item.id);
    if(!gefunden)return item;
    // Nur gespeicherte gültige Link-Adressen veröffentlichen.
    const url=typeof gefunden.url==='string'?gefunden.url.trim():'';
    return {...item,url:pruefeUrl(item.id,url)?url:item.url,aktiv:
      gefunden.aktiv===true&&Boolean(pruefeUrl(item.id,url))};
  });
}
function pruefeUrl(id,raw){
  if(typeof raw!=='string'||raw.length>1024||!raw.trim())return false;
  const kanal=KANAELE.find(k=>k.id===id);
  if(!kanal)return false;
  try{
    const url=new URL(raw);
    return url.protocol==='https:'&&
      !url.username&&!url.password&&!url.hash&&
      (url.port===''||url.port==='443')&&
      kanal.hostnames.includes(url.hostname.toLowerCase());
  }catch{return false;}
}
function validiereAenderung(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    !Array.isArray(input.kanäle)||input.kanäle.length!==KANAELE.length)
    throw Error('Bitte alle Social-Media-Kanäle übermitteln.');
  const ids=new Set();
  return input.kanäle.map(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||typeof raw.id!=='string'||
       typeof raw.url!=='string'||typeof raw.aktiv!=='boolean')
      throw Error('Ungültige Angaben für einen Social-Media-Kanal.');
    const kanal=KANAELE.find(item=>item.id===raw.id);
    if(!kanal||ids.has(raw.id))throw Error('Unbekannter oder mehrfacher Social-Media-Kanal.');
    ids.add(raw.id);
    const url=raw.url.trim();
    if(url&&!pruefeUrl(raw.id,url))
      throw Error('Bitte für '+kanal.name+' einen gültigen HTTPS-Link zur passenden Plattform eingeben.');
    if(raw.aktiv&&!url)
      throw Error('Bitte vor dem Veröffentlichen von '+kanal.name+' einen Link hinterlegen.');
    return {id:kanal.id,name:kanal.name,url,aktiv:raw.aktiv};
  });
}
function fuerWebsite(alle){
  return alle.filter(k=>k.aktiv&&pruefeUrl(k.id,k.url)).map(({id,name,url})=>({id,name,url}));
}
module.exports={KANAELE,standard,normalisiereGespeichert,validiereAenderung,fuerWebsite,pruefeUrl};
