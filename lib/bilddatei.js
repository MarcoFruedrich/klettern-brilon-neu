'use strict';

const MAX_BYTES=5*1024*1024;
const MAX_DIMENSION=12000;
const MAX_PIXELS=40_000_000;

function dimensionenPruefen(width,height){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||
     width>MAX_DIMENSION||height>MAX_DIMENSION||width*height>MAX_PIXELS)
    throw new Error('Bildabmessungen sind ungültig oder zu groß.');
  return {width,height};
}

function png(buffer){
  const signatur=Buffer.from([137,80,78,71,13,10,26,10]);
  if(buffer.length<45||!buffer.subarray(0,8).equals(signatur))throw new Error('Ungültige PNG-Datei.');
  let offset=8,width=0,height=0,hatBilddaten=false,hatEnde=false;
  while(offset+12<=buffer.length){
    const laenge=buffer.readUInt32BE(offset);
    const typ=buffer.toString('ascii',offset+4,offset+8);
    const ende=offset+12+laenge;
    if(ende>buffer.length)throw new Error('Unvollständige PNG-Datei.');
    if(offset===8&& (typ!=='IHDR'||laenge!==13))throw new Error('PNG-Kopfdaten fehlen.');
    if(typ==='IHDR'){
      if(offset!==8||laenge!==13)throw new Error('Ungültige PNG-Kopfdaten.');
      width=buffer.readUInt32BE(offset+8);height=buffer.readUInt32BE(offset+12);
      const bitDepth=buffer[offset+16],colorType=buffer[offset+17],compression=buffer[offset+18],filter=buffer[offset+19],interlace=buffer[offset+20];
      const allowed={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if(!allowed[colorType]?.includes(bitDepth)||compression!==0||filter!==0||interlace>1)
        throw new Error('Nicht unterstütztes PNG-Format.');
    }
    if(typ==='acTL')throw new Error('Animierte PNG-Dateien werden nicht unterstützt.');
    if(typ==='IDAT'&&laenge>0)hatBilddaten=true;
    if(typ==='IEND'){
      if(laenge!==0||!hatBilddaten||ende!==buffer.length)throw new Error('Unvollständiges PNG-Bild.');
      hatEnde=true;break;
    }
    offset=ende;
  }
  if(!hatEnde)throw new Error('PNG-Endmarke fehlt.');
  return dimensionenPruefen(width,height);
}

function jpeg(buffer){
  if(buffer.length<12||buffer[0]!==0xff||buffer[1]!==0xd8||buffer.at(-2)!==0xff||buffer.at(-1)!==0xd9)
    throw new Error('Ungültige oder unvollständige JPEG-Datei.');
  let offset=2,width=0,height=0,hatScan=false;
  const frameMarker=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  while(offset<buffer.length-2){
    if(buffer[offset]!==0xff)throw new Error('Ungültige JPEG-Segmentstruktur.');
    while(offset<buffer.length&&buffer[offset]===0xff)offset++;
    const marker=buffer[offset++];
    if(marker===0xda){
      if(offset+2>buffer.length)break;
      const laenge=buffer.readUInt16BE(offset);
      if(laenge<2||offset+laenge>=buffer.length-2||!width||!height)throw new Error('JPEG-Bilddaten fehlen.');
      hatScan=true;break;
    }
    if(marker===0xd9)break;
    if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    if(offset+2>buffer.length)throw new Error('Unvollständiges JPEG-Segment.');
    const laenge=buffer.readUInt16BE(offset);
    if(laenge<2||offset+laenge>buffer.length)throw new Error('Unvollständiges JPEG-Segment.');
    if(frameMarker.has(marker)){
      if(laenge<8)throw new Error('Ungültige JPEG-Bildgröße.');
      height=buffer.readUInt16BE(offset+3);width=buffer.readUInt16BE(offset+5);
    }
    offset+=laenge;
  }
  if(!hatScan)throw new Error('JPEG-Bilddaten fehlen.');
  return dimensionenPruefen(width,height);
}

function webp(buffer){
  if(buffer.length<30||buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WEBP'||
     buffer.readUInt32LE(4)+8!==buffer.length)throw new Error('Ungültige oder unvollständige WebP-Datei.');
  let offset=12,width=0,height=0,hatBildblock=false;
  while(offset+8<=buffer.length){
    const typ=buffer.toString('ascii',offset,offset+4),laenge=buffer.readUInt32LE(offset+4),start=offset+8,ende=start+laenge+(laenge%2);
    if(ende>buffer.length)throw new Error('Unvollständiger WebP-Block.');
    if(typ==='VP8X'){
      if(laenge<10)throw new Error('Ungültiger WebP-Kopfblock.');
      if(buffer[start]&0x02)throw new Error('Animierte WebP-Dateien werden nicht unterstützt.');
      width=1+buffer[start+4]+(buffer[start+5]<<8)+(buffer[start+6]<<16);
      height=1+buffer[start+7]+(buffer[start+8]<<8)+(buffer[start+9]<<16);
    }else if(typ==='VP8 '){
      if(laenge<10||buffer[start+3]!==0x9d||buffer[start+4]!==0x01||buffer[start+5]!==0x2a)
        throw new Error('Ungültiger WebP-Bildblock.');
      width=buffer.readUInt16LE(start+6)&0x3fff;height=buffer.readUInt16LE(start+8)&0x3fff;
      hatBildblock=true;
    }else if(typ==='VP8L'){
      if(laenge<5||buffer[start]!==0x2f)throw new Error('Ungültiger WebP-Bildblock.');
      const b1=buffer[start+1],b2=buffer[start+2],b3=buffer[start+3],b4=buffer[start+4];
      width=1+b1+((b2&0x3f)<<8);height=1+(b2>>6)+(b3<<2)+((b4&0x0f)<<10);
      hatBildblock=true;
    }
    if(width&&height&&hatBildblock)break;
    offset=ende;
  }
  if(!width||!height)throw new Error('WebP-Bilddaten fehlen.');
  return dimensionenPruefen(width,height);
}

function analysiereBild(buffer,mimeType){
  if(!Buffer.isBuffer(buffer)||buffer.length===0||buffer.length>MAX_BYTES)
    throw new Error('Bildgröße muss zwischen 1 Byte und 5 MB liegen.');
  if(mimeType==='image/png')return png(buffer);
  if(mimeType==='image/jpeg')return jpeg(buffer);
  if(mimeType==='image/webp')return webp(buffer);
  throw new Error('Nur JPG, PNG und WebP erlaubt.');
}

async function bereinigeBild(buffer,mimeType){
  analysiereBild(buffer,mimeType);
  const sharp=require('sharp');
  const format={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'}[mimeType];
  try{
    const bereinigt=await sharp(buffer,{
      animated:false,
      failOn:'warning',
      limitInputPixels:MAX_PIXELS,
      sequentialRead:true
    }).rotate().toFormat(format,{
      ...(format==='jpeg'?{quality:85,progressive:true}:{}),
      ...(format==='png'?{compressionLevel:9,adaptiveFiltering:true}:{}),
      ...(format==='webp'?{quality:85,effort:4}:{})
    }).toBuffer();
    analysiereBild(bereinigt,mimeType);
    return bereinigt;
  }catch{
    throw new Error('Bild konnte nicht sicher neu codiert werden.');
  }
}

module.exports={analysiereBild,bereinigeBild,MAX_BYTES,MAX_DIMENSION,MAX_PIXELS};
