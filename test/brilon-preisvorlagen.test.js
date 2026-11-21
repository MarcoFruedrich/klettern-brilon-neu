'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../site/brilon-preisvorlagen.js'),'utf8');
const sandbox={window:{}};
vm.runInNewContext(source,sandbox);
const {get}=sandbox.window.BrilonPreisvorlagen;
const serialize=x=>JSON.parse(JSON.stringify(x));
test('Kindergeburtstage sind eigenständige 3- und 4-Stunden-Programme',()=>{
 assert.deepEqual(serialize(get('Kindergeburtstag – 3 Stunden voller Spaß und Abenteuer!').stufen),
  [{min:5,max:10,preis:130,dauer:180},{min:11,max:15,preis:160,dauer:180}]);
 assert.deepEqual(serialize(get('Kindergeburtstag XL – 4 Stunden Spaß, Abenteuer und gemeinsame Zeit!').stufen),
  [{min:5,max:10,preis:150,dauer:240},{min:11,max:15,preis:180,dauer:240}]);
});
test('Olympiade, Team, Abseilen und Toprope verwenden identische 3/4-Stunden-Staffeln',()=>{
 const std=[{min:5,max:10,preis:165,dauer:180},{min:5,max:10,preis:220,dauer:240},
  {min:11,max:15,preis:225,dauer:180},{min:11,max:15,preis:300,dauer:240}];
 for(const name of ['Kletter-Olympiade','Team am Seil','Abseilabenteuer','Klettern & Toprope']){
  assert.deepEqual(serialize(get(name).stufen),std,name);
 }
});
test('Sonderfälle sind nur die ausdrücklich zugelassenen Stunden',()=>{
 assert.deepEqual(serialize(get('Kletterführerschein – Grundlagen').stufen),
 [{min:5,max:10,preis:220,dauer:240},{min:11,max:15,preis:300,dauer:240}]);
 assert.deepEqual(serialize(get('Strickleiter-Challenge').stufen),
 [{min:5,max:10,preis:110,dauer:120},{min:11,max:15,preis:150,dauer:120}]);
 assert.equal(get('Ihr Abenteuer – auch direkt bei Ihnen vor Ort!'),null);
});
test('Kein impliziter DB-Schreibvorgang durch die Preisvorlagen',()=>{
 const admin=fs.readFileSync(path.join(__dirname,'../site/admin.js'),'utf8');
 assert.match(admin,/Brilon-Preisstaffeln ins Formular übernehmen/);
 assert.match(admin,/istNurBrilon=sites.length===1/);
 assert.match(admin,/programmStufenEditor\(tierEditor,brilonVorlage.stufen\)/);
 assert.match(admin,/Erst „Programm speichern“ schreibt die Preise/);
});
