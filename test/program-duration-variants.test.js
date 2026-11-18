'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { preisFuerTeilnehmer } = require('../lib/buchungslogik');
const { buchungsdauerFuerProgramm } = require('../lib/buchungsdauer');

// Server-Prüfung direkt testen, damit Formular-, API- und Buchungslogik
// weiterhin dieselben vier Varianten unterstützen.
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=source.indexOf('function pruefeProgrammstufen(');
const end=source.indexOf("if (route === '/api/admin/angebote' && req.method === 'POST')",start);
assert.ok(start>0&&end>start,'Servervalidierung muss auffindbar sein');
const { pruefeProgrammstufen, preiseAusStufen } =
  new Function(source.slice(start,end)+'\nreturn { pruefeProgrammstufen, preiseAusStufen };')();

const gruppenstufen=[
  {min:1,max:10,preis:165,dauer:180},
  {min:11,max:15,preis:225,dauer:180},
  {min:1,max:10,preis:220,dauer:240},
  {min:11,max:15,preis:300,dauer:240}
];
const programm={dauer:180,dauer_modus:'gruppenstufe',gruppenstufen};

test('Alle vier Preis- und Dauerstaffeln bleiben trotz gleicher Teilnehmerbereiche gespeichert',()=>{
  const result=pruefeProgrammstufen(gruppenstufen,20,'gruppe',180,'gruppenstufe');
  assert.equal(result.error,undefined);
  assert.equal(result.stufen.length,4);
  assert.deepEqual(preiseAusStufen(result.stufen),{'1-10':165,'11-15':225});
  assert.deepEqual(result.stufen.map(s=>s.dauer).sort((a,b)=>a-b),[180,180,240,240]);
});

test('Gleiche Teilnehmerbereiche sind bei gleicher Dauer weiterhin nicht erlaubt',()=>{
  const result=pruefeProgrammstufen([...gruppenstufen,
    {min:5,max:9,preis:199,dauer:180}],20,'gruppe',180,'gruppenstufe');
  assert.match(result.error,/Überschneidung/);
});

test('Jede Variante erhält den passenden Preis und die passende Dauer',()=>{
  const preise=preiseAusStufen(gruppenstufen);
  for(const [teilnehmer,dauer,preis] of [[6,180,165],[6,240,220],[12,180,225],[12,240,300]]){
    assert.equal(preisFuerTeilnehmer(preise,teilnehmer,gruppenstufen,dauer),preis*100);
    assert.equal(buchungsdauerFuerProgramm(teilnehmer,programm,dauer),dauer);
  }
});

test('Fehlende oder ungültige Dauer wählt keine zufällige Variante',()=>{
  const preise=preiseAusStufen(gruppenstufen);
  assert.equal(preisFuerTeilnehmer(preise,6,gruppenstufen),null);
  assert.equal(buchungsdauerFuerProgramm(6,programm),null);
  assert.equal(preisFuerTeilnehmer(preise,6,gruppenstufen,300),null);
  assert.equal(buchungsdauerFuerProgramm(6,programm,300),null);
});

test('Einzelne und historische Staffeln funktionieren ohne zusätzliche Auswahl',()=>{
  const einzelne=[{min:1,max:10,preis:165,dauer:180}];
  assert.equal(preisFuerTeilnehmer({'1-10':165},6,einzelne),16500);
  assert.equal(buchungsdauerFuerProgramm(6,{dauer:180,dauer_modus:'gruppenstufe',gruppenstufen:einzelne}),180);
  assert.equal(preisFuerTeilnehmer({'5-10':155},6,[]),15500);
  assert.equal(buchungsdauerFuerProgramm(6,{dauer:180,gruppenstufen:[]}),180);
});
