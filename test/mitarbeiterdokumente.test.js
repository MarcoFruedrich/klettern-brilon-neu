'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const {bereinigeMitarbeiterdokument}=require('../lib/mitarbeiterdokumente');

test('Mitarbeiterbescheinigungen werden als bereinigtes JPEG gespeichert',async()=>{
  const image=await sharp({create:{width:1200,height:1600,channels:3,background:'#f5f5f5'}})
    .jpeg().withExif({IFD0:{ImageDescription:'private metadata'}}).toBuffer();
  const result=await bereinigeMitarbeiterdokument({
    bezeichnung:'Kletterqualifikation',dateiname:'C:\\private\\Kletterschein.png',
    daten:'data:image/jpeg;base64,'+image.toString('base64')
  });
  assert.equal(result.bezeichnung,'Kletterqualifikation');
  assert.equal(result.dateiname,'Kletterschein.jpg');
  assert.equal(result.mime_type,'image/jpeg');
  assert.ok(result.daten.length<=500*1024);
  const metadata=await sharp(result.daten).metadata();
  assert.equal(metadata.format,'jpeg');
  assert.equal(metadata.exif,undefined,'EXIF-Daten dürfen nicht erhalten bleiben');
});

test('Mitarbeiterbescheinigungen lehnen ungültige Typen und Bezeichnungen ab',async()=>{
  await assert.rejects(bereinigeMitarbeiterdokument({
    bezeichnung:'A',dateiname:'test.pdf',daten:'data:application/pdf;base64,AA=='
  }),/Bezeichnung/);
  await assert.rejects(bereinigeMitarbeiterdokument({
    bezeichnung:'Bescheinigung',dateiname:'test.pdf',daten:'data:application/pdf;base64,AA=='
  }),/JPG-, PNG- oder WebP/);
});
