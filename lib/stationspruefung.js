'use strict';
const crypto = require('node:crypto');

function emailGueltig(email){
  return typeof email==='string' && email.length<=180 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function passwortHash(passwort,salz=crypto.randomBytes(16).toString('hex')){
  if(typeof passwort!=='string'||passwort.length<6||passwort.length>200)
    throw new RangeError('Passwort muss 6 bis 200 Zeichen enthalten.');
  if(!/^[0-9a-f]{32}$/.test(salz))throw new Error('Ungültiges Passwortsalz.');
  return 'scrypt$'+salz+'$'+crypto.scryptSync(passwort,Buffer.from(salz,'hex'),64).toString('hex');
}
function passwortPruefen(passwort,hash){
  if(typeof passwort!=='string'||typeof hash!=='string'||passwort.length>200)return false;
  const parts=hash.split('$');
  if(parts.length!==3||parts[0]!=='scrypt'||!/^[0-9a-f]{32}$/.test(parts[1])||
     !/^[0-9a-f]{128}$/.test(parts[2]))return false;
  const expected=Buffer.from(parts[2],'hex');
  return crypto.timingSafeEqual(crypto.scryptSync(passwort,Buffer.from(parts[1],'hex'),64),expected);
}
function codeHash(code,secret){
  if(typeof secret!=='string'||secret.length<32)throw new Error('STATION_CHECK_SECRET fehlt.');
  if(!/^\d{6}$/.test(code))throw new RangeError('Prüfcode muss sechs Ziffern haben.');
  return crypto.createHmac('sha256',secret).update('stationspruefung:v1:'+code).digest('hex');
}
function pruefFoto(foto){
  if(foto===undefined||foto===null||foto==='')return null;
  if(typeof foto!=='string'||foto.length>115000||
     !/^data:image\/jpeg;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(foto))
    throw new RangeError('Das Stationsfoto muss ein kleines JPEG sein (maximal 80 KB).');
  const data=Buffer.from(foto.slice('data:image/jpeg;base64,'.length),'base64');
  if(data.length<50||data.length>80000||
     data[0]!==0xff||data[1]!==0xd8||data[2]!==0xff||
     data.at(-2)!==0xff||data.at(-1)!==0xd9)
    throw new RangeError('JPEG-Foto ist ungültig oder zu groß.');
  return foto;
}

async function fotoBereinigen(foto){
  const gueltig=pruefFoto(foto);
  if(!gueltig)return null;
  const input=Buffer.from(gueltig.slice('data:image/jpeg;base64,'.length),'base64');
  try{
    const sharp=require('sharp');
    const output=await sharp(input,{animated:false,failOn:'warning',limitInputPixels:40_000_000})
      .rotate()
      .resize(640,640,{fit:'inside',withoutEnlargement:true})
      .jpeg({quality:55,progressive:true})
      .toBuffer();
    if(output.length<50||output.length>80_000)
      throw new Error('Bereinigtes Foto ist zu groß.');
    return 'data:image/jpeg;base64,'+output.toString('base64');
  }catch{
    throw new RangeError('Stationsfoto ist ungültig oder konnte nicht sicher bereinigt werden.');
  }
}

function programmPruefen(d,stationsIds,zeitpunkt=new Date()){
  const programm=typeof d?.programm==='string'?d.programm.trim():'';
  const beginn=typeof d?.beginn==='string'?d.beginn:'';
  if(!programm||programm.length>120||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(beginn))
    throw new RangeError('Programm und geplante Startzeit fehlen.');
  const datum=beginn.slice(0,10);
  const parsed=new Date(datum+'T12:00:00Z');
  const jetztBerlin=new Intl.DateTimeFormat('sv-SE',{
    timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).format(zeitpunkt).replace(' ','T');
  if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==datum||
     beginn<jetztBerlin)
    throw new RangeError('Prüfdatum ist ungültig oder vergangen.');
  if(!Array.isArray(d.pruefungen)||d.pruefungen.length<1||d.pruefungen.length>30)
    throw new RangeError('Mindestens eine verwendete Station ist zu prüfen.');
  const stationSet=new Set(stationsIds);
  const seen=new Set();
  const pruefungen=d.pruefungen.map(p=>{
    const id=typeof p?.stationId==='string'?p.stationId:'';
    if(!stationSet.has(id)||seen.has(id))throw new RangeError('Station fehlt, ist inaktiv oder doppelt.');
    seen.add(id);
    if(!['ok','hinweis','mangel'].includes(p.zustand))throw new RangeError('Für jede Station muss ein Prüfergebnis angegeben werden.');
    const beschreibung=typeof p.beschreibung==='string'?p.beschreibung.trim():'';
    if(beschreibung.length>2000||(p.zustand!=='ok'&&beschreibung.length<10))
      throw new RangeError('Hinweise und Mängel erfordern eine Beschreibung mit mindestens 10 Zeichen.');
    return {stationId:id,zustand:p.zustand,beschreibung:p.zustand!=='ok'?beschreibung:'',
      foto:p.zustand!=='ok'?pruefFoto(p.foto):null};
  });
  if(pruefungen.filter(p=>p.foto).length>3)
    throw new RangeError('Pro Prüfbericht sind maximal drei Fotos erlaubt.');
  return {programm,beginn,pruefungen,hatMangel:pruefungen.some(p=>p.zustand==='mangel'),
    hatHinweis:pruefungen.some(p=>p.zustand==='hinweis')};
}
module.exports={emailGueltig,passwortHash,passwortPruefen,codeHash,programmPruefen,pruefFoto,fotoBereinigen};
