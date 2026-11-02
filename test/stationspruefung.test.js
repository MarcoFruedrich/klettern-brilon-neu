'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {emailGueltig,passwortHash,passwortPruefen,codeHash,programmPruefen}=require('../lib/stationspruefung');

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
