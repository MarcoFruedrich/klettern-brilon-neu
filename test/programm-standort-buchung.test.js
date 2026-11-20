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
