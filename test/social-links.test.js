'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {standard,normalisiereGespeichert,validiereAenderung,fuerWebsite}=require('../lib/social-links');

test('WhatsApp startet veröffentlicht und lässt sich deaktivieren, ohne die Adresse zu verlieren',()=>{
  const first=standard();
  const whatsapp=first.find(item=>item.id==='whatsapp');
  assert.equal(whatsapp.aktiv,true);
  assert.match(whatsapp.url,/^https:\/\/wa\.me\/message\//);
  const updated=validiereAenderung({kanäle:first.map(item=>item.id==='whatsapp'?{...item,aktiv:false}:item)});
  assert.equal(updated.find(item=>item.id==='whatsapp').url,whatsapp.url);
  assert.equal(fuerWebsite(updated).some(item=>item.id==='whatsapp'),false);
  assert.equal(normalisiereGespeichert(updated).find(item=>item.id==='whatsapp').aktiv,false);
});

test('Nur mit echter Plattform-HTTPS-Adresse kann ein Social-Media-Kanal veröffentlicht werden',()=>{
  const first=standard();
  assert.throws(()=>validiereAenderung({kanäle:first.map(item=>item.id==='youtube'
    ?{...item,url:'javascript:alert(1)',aktiv:true}:item)}),/gültigen HTTPS-Link/);
  assert.throws(()=>validiereAenderung({kanäle:first.map(item=>item.id==='facebook'
    ?{...item,url:'https://example.com/',aktiv:true}:item)}),/gültigen HTTPS-Link/);
  assert.throws(()=>validiereAenderung({kanäle:first.map(item=>item.id==='youtube'
    ?{...item,url:'',aktiv:true}:item)}),/Bitte vor dem Veröffentlichen/);
  const youtube=validiereAenderung({kanäle:first.map(item=>item.id==='youtube'
    ?{...item,url:'https://www.youtube.com/@KletternAbenteuer',aktiv:true}:item)});
  assert.equal(fuerWebsite(youtube).some(item=>item.id==='youtube'),true);
});

test('Nicht veröffentlichte Links bleiben gespeichert; doppelte IDs werden abgewiesen',()=>{
  const input=standard().map(item=>item.id==='instagram'
    ?{...item,url:'https://www.instagram.com/kletternabenteuer/',aktiv:false}:item);
  const updated=validiereAenderung({kanäle:input});
  assert.equal(updated.find(item=>item.id==='instagram').url,'https://www.instagram.com/kletternabenteuer/');
  assert.equal(fuerWebsite(updated).some(item=>item.id==='instagram'),false);
  assert.throws(()=>validiereAenderung({kanäle:[input[0],input[0],...input.slice(2)]}),/mehrfacher/);
});
