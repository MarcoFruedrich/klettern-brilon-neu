'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {terminGeaendert,direkterTerminwechselGrund}=require('../lib/terminwechsel-sicherheit');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const queue=fs.readFileSync(path.join(__dirname,'..','lib','kundenbestaetigung-service.js'),'utf8');

test('Terminvergleich erkennt Datum, Uhrzeit und Dauer, aber keine reine Notiz',()=>{
  const alt={datum:'2026-12-04',uhrzeit:'10:00',dauer:180};
  assert.equal(terminGeaendert(alt,{datum:'2026-12-05'}),true);
  assert.equal(terminGeaendert(alt,{uhrzeit:'11:00'}),true);
  assert.equal(terminGeaendert(alt,{dauer:240}),true);
  assert.equal(terminGeaendert(alt,{datum:'2026-12-04',uhrzeit:'10:00',dauer:'180'}),false);
  assert.equal(terminGeaendert(alt,null),false);
});
test('Bestätigte Buchung ist gegen direkte Terminänderung geschützt',()=>{
  assert.match(direkterTerminwechselGrund('bestaetigt',0),/bestätigte Buchung/);
  assert.match(direkterTerminwechselGrund('offen',1),/Einteilungen/);
  assert.equal(direkterTerminwechselGrund('offen',0),null);
});
test('Admin-Terminänderung ist durch Mitarbeiterprüfung abgesichert',()=>{
  assert.match(server,/if\(terminGeaendert\(buchungsdaten,aenderungen\)\)/);
  assert.match(server,/if\(ergebnis\.terminwechselGesperrt\)/);
});
test('Freigegebene Umbuchung hebt Personalzusagen auf und bleibt zunächst offen',()=>{
  assert.match(server,/DELETE FROM brilon_einsaetze[\s\S]*?status IN \('beworben','eingeteilt','bestaetigt','abgelehnt'\)/);
  assert.match(server,/status=CASE WHEN \$3::boolean THEN 'offen'/);
  assert.match(server,/benoetigtNeueMitarbeiterzusage/);
  assert.match(server,/Mitarbeiterzusagen gelten für den neuen Termin nicht/);
});
test('Vorherige Versandbestätigungen bleiben in der Historie',()=>{
  assert.match(server,/bestaetigungsEmailHistorie/);
  assert.match(server,/partnerhausWeiterleitungHistorie/);
});
test('Aktive Kundenmail und abgeschlossene Arbeitszeiten sperren den Terminwechsel',()=>{
  assert.match(server,/bestaetigungsversandLaeuft/);
  assert.match(server,/personalBereitsAbgeschlossen/);
});
test('Nach neuer Mitarbeiterzusage darf die Kundenbestätigung erneut eingeplant werden',()=>{
  assert.match(queue,/ON CONFLICT\(buchung_id\) DO UPDATE SET/);
  assert.match(queue,/WHERE brilon_kundenbestaetigungen\.status IN \('abgebrochen','fehler','gesendet'\)/);
});
