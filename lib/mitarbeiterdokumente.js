'use strict';

const MAX_EINGABE_BYTES=4*1024*1024;
const MAX_AUSGABE_BYTES=500*1024;
const MAX_PIXELS=40_000_000;
const MIME_TYPEN=new Set(['image/jpeg','image/png','image/webp']);

function dateinameBereinigen(value){
  const name=typeof value==='string'?value:'Bescheinigung';
  const leaf=name.split(/[\\/]/).pop();
  const cleaned=leaf.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,100);
  return (cleaned.replace(/\.[^.]*$/,'').trim()||'Bescheinigung')+'.jpg';
}

async function bereinigeMitarbeiterdokument(dokument){
  const bezeichnung=typeof dokument?.bezeichnung==='string'?dokument.bezeichnung.trim():'';
  const dataUrl=typeof dokument?.daten==='string'?dokument.daten:'';
  if(bezeichnung.length<2||bezeichnung.length>100)
    throw new RangeError('Bezeichnung einer Bescheinigung muss 2 bis 100 Zeichen lang sein.');
  const match=dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match||!MIME_TYPEN.has(match[1])||dataUrl.length>Math.ceil(MAX_EINGABE_BYTES*4/3)+64)
    throw new RangeError('Bescheinigungen müssen als JPG-, PNG- oder WebP-Foto hochgeladen werden.');
  const input=Buffer.from(match[2],'base64');
  if(input.length<50||input.length>MAX_EINGABE_BYTES||input.toString('base64')!==match[2])
    throw new RangeError('Foto einer Bescheinigung ist leer, ungültig oder größer als 4 MB.');
  try{
    const sharp=require('sharp');
    const decoder=sharp(input,{animated:true,failOn:'warning',limitInputPixels:MAX_PIXELS,sequentialRead:true});
    const metadata=await decoder.metadata();
    if((metadata.pages||1)>1)throw new Error('Animierte Bilder werden nicht unterstützt.');
    const output=await sharp(input,{animated:false,failOn:'warning',limitInputPixels:MAX_PIXELS,sequentialRead:true})
      .rotate().resize(2200,2200,{fit:'inside',withoutEnlargement:true})
      .flatten({background:'#ffffff'}).jpeg({quality:82,progressive:true}).toBuffer();
    if(output.length<50||output.length>MAX_AUSGABE_BYTES)
      throw new Error('Komprimiertes Foto überschreitet die zulässige Größe.');
    return {bezeichnung,dateiname:dateinameBereinigen(dokument.dateiname),mime_type:'image/jpeg',daten:output};
  }catch(error){
    if(error instanceof RangeError)throw error;
    throw new RangeError('Foto einer Bescheinigung ist ungültig, animiert oder nach Komprimierung noch zu groß.');
  }
}

module.exports={bereinigeMitarbeiterdokument,MAX_EINGABE_BYTES,MAX_AUSGABE_BYTES};
