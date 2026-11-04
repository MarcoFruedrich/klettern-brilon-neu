'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function navigationFixture(){
  const listeners=new Map();
  const attributes=new Map([['aria-expanded','false'],['aria-label','Menü öffnen']]);
  const classes=new Set();
  const menuToggle={
    textContent:'☰',
    addEventListener(type,callback){listeners.set(`toggle:${type}`,callback);},
    getAttribute(name){return attributes.get(name)||null;},
    setAttribute(name,value){attributes.set(name,value);},
    focus(){this.focused=true;}
  };
  const links=[0,1].map(index=>({addEventListener(type,callback){listeners.set(`link${index}:${type}`,callback);}}));
  const siteNav={
    classList:{toggle(name,force){if(force)classes.add(name);else classes.delete(name);}},
    querySelectorAll(selector){assert.equal(selector,'a');return links;}
  };
  const document={
    getElementById(id){return id==='menuToggle'?menuToggle:id==='siteNav'?siteNav:null;},
    addEventListener(type,callback){listeners.set(`document:${type}`,callback);}
  };
  const source=fs.readFileSync(path.join(__dirname,'..','site','navigation.js'),'utf8');
  vm.runInNewContext(source,{document});
  return {listeners,attributes,classes,menuToggle};
}

test('Startseite bindet die getestete Mobile-Navigation ein',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','site','index.html'),'utf8');
  assert.match(html,/<script src="\/navigation\.js"><\/script>/);
  assert.match(html,/aria-controls="siteNav" aria-expanded="false" aria-label="Menü öffnen"/);
});

test('Mobile-Navigation hält Zustand und Beschriftung synchron und schließt per Escape',()=>{
  const f=navigationFixture();
  f.listeners.get('toggle:click')();
  assert.equal(f.attributes.get('aria-expanded'),'true');
  assert.equal(f.attributes.get('aria-label'),'Menü schließen');
  assert.equal(f.classes.has('open'),true);
  f.listeners.get('document:keydown')({key:'Escape'});
  assert.equal(f.attributes.get('aria-expanded'),'false');
  assert.equal(f.attributes.get('aria-label'),'Menü öffnen');
  assert.equal(f.classes.has('open'),false);
  assert.equal(f.menuToggle.focused,true,'Fokus kehrt nach Escape zum Menütaster zurück');
});

test('Ein Navigationslink schließt das Menü und setzt den zugänglichen Zustand zurück',()=>{
  const f=navigationFixture();
  f.listeners.get('toggle:click')();
  f.listeners.get('link0:click')();
  assert.equal(f.attributes.get('aria-expanded'),'false');
  assert.equal(f.attributes.get('aria-label'),'Menü öffnen');
  assert.equal(f.classes.has('open'),false);
});
