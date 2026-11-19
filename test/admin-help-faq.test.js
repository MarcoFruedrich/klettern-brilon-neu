'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const site=path.join(__dirname,'..','site');
const html=fs.readFileSync(path.join(site,'admin.html'),'utf8');
const js=fs.readFileSync(path.join(site,'contextual-hilfe.js'),'utf8');
const css=fs.readFileSync(path.join(site,'contextual-hilfe.css'),'utf8');

test('Alle Hauptbereiche haben einen eigenen kontextbezogenen Hilfetext',()=>{
  const ids=[...html.matchAll(/<section\b[^>]*\bid="([^"]+)"[^>]*data-admin-view\b/g)].map(x=>x[1]);
  assert.ok(ids.length>=25,'Verwaltungsbereiche vorhanden');
  for(const id of ids)assert.ok(js.includes("'"+id+"':"),'Fehlender Hinweis für '+id);
  assert.match(js,/Bereich '+/);
  assert.match(css,/\.admin-page \.admin-view>h2 \.context-help/);
});

test('FAQ erläutert alle Schlüsselprozesse und enthält mindestens 50 konkrete Antworten',()=>{
  const begin=html.indexOf('<section id="admin-faq-section"');
  const end=html.indexOf('</section>',begin);
  assert.ok(begin>0&&end>begin);
  const faq=html.slice(begin,end);
  assert.ok((faq.match(/<details>/g)||[]).length>=50);
  for(const phrase of ['Standortzuordnung speichern','180 und 240 Minuten','Medienbibliothek',
    'Besuchergruppen','Netzwerkpartner-Abzug','QR-Anmeldung','Prüfprotokoll',
    'Wissensportal','Buchungs- oder Rechnungsmail']){
    assert.ok(faq.includes(phrase),'FAQ enthält: '+phrase);
  }
});

test('Fragezeichen sind zugänglich, per Tastatur schließbar und stören den Login nicht',()=>{
  assert.match(js,/button\.setAttribute\('aria-label'/);
  assert.match(js,/button\.setAttribute\('aria-expanded'/);
  assert.match(js,/event\.key==='Escape'/);
  assert.match(js,/label\.closest\('#login, #staff-login, #partner-login-form/);
  assert.match(js,/new MutationObserver/);
  assert.match(html,/contextual-hilfe\.js\?v=20261118-admin-help-full/);
});
