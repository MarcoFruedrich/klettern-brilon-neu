'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Admin-Sprungnavigation verweist auf vorhandene Verwaltungsbereiche',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','site','admin.html'),'utf8');
  const nav=html.match(/<nav class="admin-navigation"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav,'Verwaltungsnavigation muss vorhanden sein');
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
  const targets=[...nav.matchAll(/href="#([^"]+)"/g)].map(match=>match[1]);
  assert.ok(targets.length>=5,'wichtige Verwaltungsbereiche sollen direkt erreichbar sein');
  assert.equal(new Set(targets).size,targets.length,'Sprungziele sollen eindeutig sein');
  for(const target of targets)assert.ok(ids.has(target),`Sprungziel #${target} fehlt`);
});
