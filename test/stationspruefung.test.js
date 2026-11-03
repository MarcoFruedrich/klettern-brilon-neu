'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const sharp=require('sharp');
const {emailGueltig,passwortHash,passwortPruefen,codeHash,programmPruefen,pruefFoto,fotoBereinigen}=require('../lib/stationspruefung');

test('Prüfpersonal: Passwörter werden gesalzen gehasht und konstant verglichen',()=>{
  const hash=passwortHash('Pruefung-Local-Secret-2026!');
  assert.match(hash,/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(passwortPruefen('Pruefung-Local-Secret-2026!',hash),true);
  assert.equal(passwortPruefen('falsch',hash),false);
  assert.notEqual(passwortHash('Pruefung-Local-Secret-2026!'),hash,'Neue Salze erzeugen unterschiedliche Hashwerte');
  assert.throws(()=>passwortHash('kurz'),RangeError);
  assert.equal(emailGueltig('team@example.test'),true);
  assert.equal(emailGueltig('keine-mail'),false);
});
test('Vor-Ort-Code: sechs Ziffern werden mit getrenntem Geheimnis authentifiziert',()=>{
  const secret=crypto.randomBytes(32).toString('hex');
  assert.match(codeHash('000123',secret),/^[a-f0-9]{64}$/);
  assert.notEqual(codeHash('000123',secret),codeHash('000124',secret));
  assert.throws(()=>codeHash('abc',secret),RangeError);
  assert.throws(()=>codeHash('123456','zu-kurz'));
});
test('Stationsprüfung akzeptiert alle gewählten Stationen nur mit eindeutigen Ergebnissen',()=>{
  const now=new Date('2026-11-02T10:00:00Z');
  const fields={programm:'Kletterkurs Brilon',beginn:'2026-11-02T15:00',
    pruefungen:[{stationId:'a',zustand:'ok'},{stationId:'b',zustand:'mangel',
      beschreibung:'Lose Aufhängung an der Station – sofort sperren'}]};
  const result=programmPruefen(fields,['a','b'],now);
  assert.equal(result.hatMangel,true);
  assert.equal(result.pruefungen.length,2);
  assert.throws(()=>programmPruefen({...fields,pruefungen:[
    {stationId:'a',zustand:'mangel',beschreibung:'kurz'}]},['a','b'],now),/Beschreibung/);
  assert.throws(()=>programmPruefen({...fields,pruefungen:[
    {stationId:'a',zustand:'ok'},{stationId:'a',zustand:'ok'}]},['a','b'],now),/doppelt/);
  assert.throws(()=>programmPruefen({...fields,pruefungen:[
    {stationId:'c',zustand:'ok'}]},['a','b'],now),/inaktiv/);
  assert.throws(()=>programmPruefen({...fields,beginn:'2026-11-01T15:00'},['a','b'],now),/vergangen/);
  assert.throws(()=>programmPruefen({...fields,beginn:'2026-11-02T10:30'},['a','b'],now),/vergangen/);
  assert.equal(programmPruefen({...fields,pruefungen:[{stationId:'a',zustand:'ok'}]},['a'],now).hatMangel,false);
});

test('Mängelfoto: nur kleine JPEG-Belege für defekte Stationen',()=>{
  const fake=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(95,0),Buffer.from([255,217])]);
  const jpeg='data:image/jpeg;base64,'+fake.toString('base64');
  assert.equal(pruefFoto(jpeg),jpeg);
  assert.equal(pruefFoto(null),null);
  assert.throws(()=>pruefFoto('data:image/png;base64,'+fake.toString('base64')),/JPEG/);
  assert.throws(()=>pruefFoto('data:image/jpeg;base64,'+Buffer.alloc(80001).toString('base64')),/JPEG/);
  const base={programm:'Test',beginn:'2027-03-15T12:00',pruefungen:[
    {stationId:'a',zustand:'ok',foto:jpeg}]};
  assert.equal(programmPruefen(base,['a'],new Date('2026-11-02T11:00:00Z')).pruefungen[0].foto,null,
    'Fotos zu mängelfreien Stationen werden nicht gespeichert');
  const broken={...base,pruefungen:[{stationId:'a',zustand:'mangel',
    beschreibung:'Karabiner am oberen Umlenkpunkt beschädigt',foto:jpeg}]};
  assert.equal(programmPruefen(broken,['a'],new Date('2026-11-02T11:00:00Z')).pruefungen[0].foto,jpeg);
});

test('Mängelfoto wird serverseitig auf 640 Pixel begrenzt und von Metadaten bereinigt',async()=>{
  const input=await sharp({create:{width:1200,height:900,channels:3,background:'#3870a0'}})
    .jpeg().withExif({IFD0:{ImageDescription:'private location data'}}).toBuffer();
  const source='data:image/jpeg;base64,'+input.toString('base64');
  assert.ok((await sharp(input).metadata()).exif);
  const sanitized=await fotoBereinigen(source);
  const result=Buffer.from(sanitized.slice('data:image/jpeg;base64,'.length),'base64');
  const metadata=await sharp(result).metadata();
  assert.equal(metadata.width,640);
  assert.equal(metadata.height,480);
  assert.equal(metadata.exif,undefined);
  assert.ok(result.length<=80_000);
  await assert.rejects(fotoBereinigen('data:image/jpeg;base64,'+
    Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(95,0),Buffer.from([255,217])]).toString('base64')),
  /sicher bereinigt/);
});

test('Nicht sicherheitsrelevanter Hinweis bleibt eine Nachprüfung ohne Stationssperre',()=>{
  const now=new Date('2026-11-02T10:00:00Z');
  const reported=programmPruefen({programm:'Kletterangebot',
    beginn:'2026-11-02T15:00',pruefungen:[
      {stationId:'a',zustand:'hinweis',beschreibung:'Markierung der Griffnummer etwas verblasst'}
    ]},['a'],now);
  assert.equal(reported.hatMangel,false,'Hinweise dürfen keinen Sicherheitsmangel erzeugen');
  assert.equal(reported.hatHinweis,true);
  assert.equal(reported.pruefungen[0].zustand,'hinweis');
  assert.match(reported.pruefungen[0].beschreibung,/Markierung/);
  assert.throws(()=>programmPruefen({programm:'Test',beginn:'2026-11-02T15:00',
    pruefungen:[{stationId:'a',zustand:'hinweis',beschreibung:'klein'}]},['a'],now),/Beschreibung/);
  const mixed=programmPruefen({programm:'Test',beginn:'2026-11-02T15:00',
    pruefungen:[{stationId:'a',zustand:'hinweis',beschreibung:'Unleserliches Stationsschild'},
      {stationId:'b',zustand:'mangel',beschreibung:'Unsicherer Karabiner am Tragseil'}]
  },['a','b'],now);
  assert.equal(mixed.hatMangel,true);
  assert.equal(mixed.hatHinweis,true);
});
