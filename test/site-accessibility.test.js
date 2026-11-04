'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..','site');

test('Öffentliche Seite und Verwaltung bieten einen fokussierbaren Sprung zum Hauptinhalt',()=>{
  for(const file of ['index.html','admin.html']){
    const html=fs.readFileSync(path.join(root,file),'utf8');
    assert.match(html,/<a class="skip-link" href="#main-content">Zum Inhalt springen<\/a>/,`${file}: Skip-Link fehlt`);
    assert.match(html,/<main\b[^>]*id="main-content"[^>]*tabindex="-1"/,`${file}: fokussierbares Hauptziel fehlt`);
  }
});

test('Styles zeigen Tastaturfokus und respektieren reduzierte Bewegung',()=>{
  const css=fs.readFileSync(path.join(root,'style.css'),'utf8');
  assert.match(css,/:where\(a, button, input, select, textarea, summary, \[tabindex\]\):focus-visible/);
  assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css,/\.skip-link:focus-visible\s*\{\s*transform:\s*translateY\(0\)/);
});
