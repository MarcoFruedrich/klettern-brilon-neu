'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sharp=require('sharp');
const {analysiereBild,bereinigeBild}=require('../lib/bilddatei');

test('Angebotsbilder: vollständige JPG- und PNG-Dateien liefern geprüfte Abmessungen',()=>{
  const png=analysiereBild(fs.readFileSync('site/klettern-brilon-icon.png'),'image/png');
  assert.deepEqual(png,{width:512,height:512});
  const jpeg=analysiereBild(fs.readFileSync('site/fotos/kletterwand.jpg'),'image/jpeg');
  assert.deepEqual(jpeg,{width:1152,height:1536});
});

test('Angebotsbilder: Signatur ohne vollständigen Bildinhalt wird abgelehnt',()=>{
  assert.throws(()=>analysiereBild(Buffer.from([0xff,0xd8,0xff]),'image/jpeg'),/JPEG/);
  assert.throws(()=>analysiereBild(Buffer.from('RIFF0000WEBP'),'image/webp'),/WebP/);
});

test('Angebotsbilder: übergroße Pixelmaße und animierte WebP-Dateien werden abgelehnt',()=>{
  const png=Buffer.from(fs.readFileSync('site/klettern-brilon-icon.png'));
  png.writeUInt32BE(7000,16);png.writeUInt32BE(7000,20);
  assert.throws(()=>analysiereBild(png,'image/png'),/abmessungen/i);

  const webp=Buffer.alloc(30);
  webp.write('RIFF',0,'ascii');webp.writeUInt32LE(22,4);webp.write('WEBP',8,'ascii');
  webp.write('VP8X',12,'ascii');webp.writeUInt32LE(10,16);webp[20]=0x02;
  assert.throws(()=>analysiereBild(webp,'image/webp'),/Animierte/);
});

test('Angebotsbilder: MIME-Typ und tatsächliches Format müssen übereinstimmen',()=>{
  const png=fs.readFileSync('site/klettern-brilon-icon.png');
  assert.throws(()=>analysiereBild(png,'image/jpeg'),/JPEG/);
  assert.throws(()=>analysiereBild(png,'image/svg+xml'),/Nur JPG/);
});

test('Angebotsbilder werden neu codiert und private Metadaten entfernt',async()=>{
  const jpegWithExif=await sharp({create:{width:8,height:6,channels:3,background:'#336699'}})
    .jpeg().withExif({IFD0:{ImageDescription:'private location data'}}).toBuffer();
  const pngWithProfile=await sharp({create:{width:7,height:5,channels:4,background:'#aa7744'}})
    .png().withMetadata({density:300}).toBuffer();
  const webp=await sharp(pngWithProfile).webp().toBuffer();

  assert.ok((await sharp(jpegWithExif).metadata()).exif,'Test-JPEG enthält EXIF vor der Bereinigung');
  assert.equal((await sharp(pngWithProfile).metadata()).density,300,
    'Test-PNG enthält Dichte-Metadaten vor der Bereinigung');

  for(const [mime,input,format,width,height] of [
    ['image/jpeg',jpegWithExif,'jpeg',8,6],
    ['image/png',pngWithProfile,'png',7,5],
    ['image/webp',webp,'webp',7,5]
  ]){
    const output=await bereinigeBild(input,mime);
    const metadata=await sharp(output).metadata();
    assert.equal(metadata.format,format);
    assert.equal(metadata.width,width);
    assert.equal(metadata.height,height);
    assert.equal(metadata.exif,undefined);
    assert.equal(metadata.xmp,undefined);
    assert.equal(metadata.icc,undefined);
    assert.ok(output.length>0);
  }
});

test('Beschädigte, aber signaturähnliche Bilddaten werden vom Decoder verworfen',async()=>{
  const broken=Buffer.concat([
    Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x02,0xff,0xda,0x00,0x02]),
    Buffer.alloc(16,0),Buffer.from([0xff,0xd9])
  ]);
  await assert.rejects(bereinigeBild(broken,'image/jpeg'),/JPEG|neu codiert/i);
});
