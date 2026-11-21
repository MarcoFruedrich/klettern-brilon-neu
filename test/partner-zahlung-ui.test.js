'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','site','admin.js'),'utf8');
test('Partnerbuchungen zeigen automatische Partnerinformation in der Verwaltung',()=>{
  assert.match(code,/Nach vollständiger Mitarbeiterzusage erhält/);
  assert.match(code,/automatisch eine Benachrichtigung/);
  assert.match(code,/Zahlungsinformationen über Netzwerkpartner/);
});
test('Verwaltung verhindert direkten Zahlungsversand bei Partner-Abrechnung auch nach Klick',()=>{
  assert.match(code,/const partner=b\.data\.partnerhausAbwicklung===true/);
  assert.match(code,/zahlungSenden\.disabled=partner\|\|einzelslot\|\|wirdAutomatischVersandt\|\|gesendet/);
  assert.match(code,/zahlungSenden\.title=partner/);
  assert.match(code,/zahlungSenden\.disabled=partner\|\|einzelslot\|\|wirdAutomatischVersandt\|\|gesendet/);
});
