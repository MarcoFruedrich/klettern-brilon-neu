'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {svg,dataUri}=require('../site/qr-etiketten');

test('GPS-Etikett erzeugt lokal ein SVG mit QR-Matrix und Ruhezone',()=>{
  const target='https://klettern-abenteuer.de/gps.html?station=STATION-012345';
  const image=svg(target);
  assert.match(image,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(image,/viewBox="0 0 \d+ \d+"/);
  assert.match(image,/<path d="M[\d ]+h1v1h-1z/);
  assert.ok(image.includes('aria-label="QR-Code"'));
  assert.ok(!image.includes(target),'Zieladresse wird in die Grafik codiert statt als sichtbarer Text eingebettet');
  assert.ok(dataUri(target).startsWith('data:image/svg+xml;charset=utf-8,'));
});

test('GPS-Etikett weist leere oder überlange Inhalte zurück',()=>{
  assert.throws(()=>svg(' '),/ungültig/i);
  assert.throws(()=>svg('x'.repeat(2001)),/ungültig/i);
});
