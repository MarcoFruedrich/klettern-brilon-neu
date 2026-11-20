'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {programmAmStandort}=require('../lib/programm-standorte-buchung');
const src=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
test('Mehrfachstandorte auch als Nebenstandort buchbar',()=>{
  const p={veranstaltungsort:'Brilon',veranstaltungsorte:['Brilon','Olpe']};
  assert.equal(programmAmStandort(p,'Olpe'),true);
  assert.equal(programmAmStandort(p,'Brilon'),true);
  assert.equal(programmAmStandort(p,'Sundern'),false);
  assert.equal(programmAmStandort({veranstaltungsort:'Brilon'},'Olpe'),false);
});
test('Anschlussangebote benötigen Freigabe am Standort der ursprünglichen Buchung',()=>{
  assert.match(src,/if\(!programmAmStandort\(p,base\.veranstaltungsort\)\)continue/);
  assert.match(src,/if\(!programmAmStandort\(p,original\.veranstaltungsort\)\)return \{standort:false\}/);
  assert.match(src,/if\(result\.standort===false\)/);
});

test('Kapazitätsprüfung bei Umbuchung und Verwaltung trennt alle Standorte',()=>{
  assert.equal((src.match(/AND data->>'veranstaltungsort'=\$5/g)||[]).length,2);
  assert.equal((src.match(/SELECT kapazitaet FROM brilon_angebote WHERE name=\$1 AND \(veranstaltungsort=\$2/g)||[]).length,2);
  assert.match(src,/\[id,data\.datum,data\.angebot,data\.uhrzeit,data\.veranstaltungsort\]/);
  assert.match(src,/\[row\.buchung_id,shifted\.datum,shifted\.angebot,shifted\.uhrzeit,shifted\.veranstaltungsort\]/);
});
