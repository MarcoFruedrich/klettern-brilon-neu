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
  const views=new Set([...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*\bdata-admin-view(?:\s|>)/g)]
    .map(match=>match[1]));
  assert.ok(targets.length>=5,'wichtige Verwaltungsbereiche sollen direkt erreichbar sein');
  assert.equal(new Set(targets).size,targets.length,'Sprungziele sollen eindeutig sein');
  for(const target of targets){
    assert.ok(ids.has(target),`Sprungziel #${target} fehlt`);
    assert.ok(views.has(target),`Sprungziel #${target} muss eine eigene Ansicht öffnen`);
  }
});

test('Mitarbeiter und Portal-Inhalte haben eigene Verwaltungsansichten und geschützte Mitarbeiteransicht',()=>{
  const root=path.join(__dirname,'..','site');
  const admin=fs.readFileSync(path.join(root,'admin.html'),'utf8');
  const portal=fs.readFileSync(path.join(root,'mitarbeiterbereich.html'),'utf8');
  const portalJs=fs.readFileSync(path.join(root,'mitarbeiterbereich.js'),'utf8');
  const staffApi=fs.readFileSync(path.join(__dirname,'..','lib','stationspruefung-api.js'),'utf8');
  for(const target of ['mitarbeiter-section','mitarbeiter-einladen-section','mitarbeiterbereiche-admin-section']){
    assert.match(admin,new RegExp(`<a[^>]*href="#${target}"[^>]*data-admin-view-link>`));
    assert.match(admin,new RegExp(`id="${target}"[^>]*data-admin-view`));
  }
  assert.match(admin,/data-subnav-group="kontakte"/,'Kontaktverwaltung erhält eigene waagerechte Untermenüs');
  assert.match(admin,/>Kontaktverwaltung<\/a>/);
  assert.match(admin,/data-subnav-group="programme"[\s\S]*href="#gps-verwaltung"/,'GPS-Touren liegen im Programm-Untermenü');
  assert.match(portal,/id="staff-login"/);
  assert.match(portal,/id="staff-profile-form"/);
  assert.match(portalJs,/\/api\/pruefung\/login/);
  assert.match(portalJs,/\/api\/pruefung\/profil/);
  assert.match(staffApi,/WHERE aktiv=true ORDER BY lower\(name\),id/);
  assert.match(staffApi,/route==='\/api\/pruefung\/profil'&&req\.method==='PATCH'/);
  assert.match(portalJs,/node\('div',area\.inhalt\)/,'Portaltext muss als Klartext ausgegeben werden');
  assert.doesNotMatch(portalJs,/innerHTML\s*=\s*area\.inhalt/,'Portalinhalte dürfen nicht als HTML interpretiert werden');
});

test('GPS-Touren nutzen Stationskarten mit Reihenfolge statt eines JSON-Textfelds',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','site','admin.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'..','site','admin.js'),'utf8');
  assert.match(html,/id="gps-station-add"/);
  assert.match(html,/id="gps-stations"/);
  assert.doesNotMatch(html,/<textarea[^>]*name="stationen"/);
  for(const field of ['Stations-ID','QR-Kennung','Frage','Antwort 1','Antwort 2','Richtige Antwort','Breitengrad','Längengrad'])
    assert.ok(js.includes(`'${field}'`),`Stationsfeld ${field} fehlt`);
  assert.match(js,/gpsStationenFormWert\(\)/);
  assert.match(js,/Vorhandene Kontrollcodes bleiben erhalten/);
});
