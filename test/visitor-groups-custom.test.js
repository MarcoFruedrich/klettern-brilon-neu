'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DEFAULT_VISITOR_GROUPS,prepareVisitorGroups,validateVisitorGroups}=require('../visitor-groups');

test('eigene Besuchergruppen und Beschreibung bis 650 Zeichen bleiben erhalten',()=>{
  const custom={id:'gruppe-123',titel:'Meine eigene Gruppe',icon:'👥',farbe:'#599f47',
    beschreibung:'A'.repeat(650),punkte:[],bild:'',programmIds:[],aktiv:true};
  const list=[...DEFAULT_VISITOR_GROUPS,custom];
  const result=validateVisitorGroups(list);
  assert.equal(result.error,undefined);
  assert.equal(result.gruppen.length,7);
  assert.equal(result.gruppen[6].titel,custom.titel);
  assert.equal(result.gruppen[6].beschreibung.length,650);
  assert.deepEqual(prepareVisitorGroups(result.gruppen),result.gruppen);
});
test('selbst geänderte Reihenfolge und nur eine Gruppe bleiben gespeichert',()=>{
  const lone={...DEFAULT_VISITOR_GROUPS[0],titel:'Familien und Freunde',beschreibung:'Abenteuer'};
  const result=validateVisitorGroups([lone]);
  assert.equal(result.error,undefined);
  assert.deepEqual(result.gruppen.map(g=>g.id),['familien']);
});
test('zu lange Texte und doppelte Gruppenkennungen werden abgelehnt',()=>{
  const original={...DEFAULT_VISITOR_GROUPS[0]};
  assert.match(validateVisitorGroups([{...original,beschreibung:'X'.repeat(651)}]).error,/Ungültige Felder/);
  assert.match(validateVisitorGroups([original,original]).error,/Ungültige Gruppenliste/);
});
