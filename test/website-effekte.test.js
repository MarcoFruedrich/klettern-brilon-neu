'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {standardEffekte,pruefeWebsiteEffekte,leseWebsiteEffekte}=require('../lib/website-effekte');
test('Effekte sind bei der Erstinstallation aus Sicherheitsgründen deaktiviert',()=>{
  const settings=standardEffekte();
  assert.equal(settings.aktiv,false);
  assert.equal(settings.aktiveId,null);
  assert.ok(settings.eintraege.some(x=>x.id==='herbst'));
  assert.ok(settings.eintraege.some(x=>x.id==='flossbau'));
});
test('Verwaltung kann neue Effekte mit eigenem Namen und Symbol speichern',()=>{
  const config={aktiv:true,aktiveId:'regenbogen',eintraege:[{
    id:'regenbogen',name:'Regenbogen',symbol:'🌈',anzahl:7,dauerSekunden:25
  }]};
  assert.deepEqual(pruefeWebsiteEffekte(config),config);
});
test('Ungültige Symbole, doppelte Kennungen und übermäßige Last werden abgewiesen',()=>{
  const config=standardEffekte();
  assert.throws(()=>pruefeWebsiteEffekte({...config,aktiv:true}),/Effekt auswählen/);
  assert.throws(()=>pruefeWebsiteEffekte({...config,eintraege:[config.eintraege[0],config.eintraege[0]]}),/gültigen Namen/);
  assert.throws(()=>pruefeWebsiteEffekte({...config,eintraege:[{...config.eintraege[0],symbol:'<script>'}]}),/gültigen Namen/);
  assert.throws(()=>pruefeWebsiteEffekte({...config,eintraege:[{...config.eintraege[0],anzahl:500}]}),/gültigen Namen/);
  assert.equal(leseWebsiteEffekte({aktiv:true,eintraege:[],aktiveId:'fehlend'}).aktiv,false);
});
