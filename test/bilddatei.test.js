'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {analysiereBild}=require('../lib/bilddatei');

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
