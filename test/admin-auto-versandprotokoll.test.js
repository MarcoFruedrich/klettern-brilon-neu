'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {auswerten}=require('../site/admin-versandstatus');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const booking={data:{partnerhausAbwicklung:false,zahlungsinfoVersand:{status:'angenommen'}},
  zahlungsinfo_gesendet_am:'2026-11-21T08:37:00Z',
  kundenmail:{status:'gesendet',faellig_ab:'2026-11-21T08:36:00Z',
    versendet_am:'2026-11-21T08:37:00Z',anlass_mitarbeiter_id:'test-staff-id'}};

test('Nach zwei Minuten: Zahlungsinformation automatisch angenommen, nicht nachweislich zugestellt',()=>{
  const result=auswerten(booking);
  assert.equal(result.status,'gesendet');
  assert.equal(result.tone,'success');
  assert.match(result.hinweis,/Automatische Zahlungsinformationen nach Mitarbeiterzusage/);
  assert.match(result.detail,/Zustellung ins Postfach nicht nachgewiesen/);
  assert.equal(result.empfaenger,'Kunde');
});
test('Partner-Abrechnung vermerkt ausschließlich die Partnerinformation',()=>{
  const result=auswerten({data:{partnerhausAbwicklung:true},
    kundenmail:{status:'gesendet',versendet_am:'2026-11-21T08:36:12Z',anlass_mitarbeiter_id:'staff'}});
  assert.match(result.hinweis,/Automatische Partnerinformation/);
  assert.equal(result.empfaenger,'Netzwerkpartner');
  assert.doesNotMatch(result.hinweis,/Zahlungsinformationen/);
});
test('Zweiminütiges Zeitfenster geplant und nach Fälligkeit als überfällig dargestellt',()=>{
  const pending=auswerten({...booking,kundenmail:{status:'geplant',faellig_ab:'2026-11-21T08:36:00Z'}},
    Date.parse('2026-11-21T08:36:15Z'));
  assert.equal(pending.tone,'neutral');
  assert.match(pending.detail,/Vorgesehener Versand/);
  const overdue=auswerten({...booking,kundenmail:{status:'geplant',faellig_ab:'2026-11-21T08:36:00Z'}},
    Date.parse('2026-11-21T08:38:00Z'));
  assert.match(overdue.hinweis,/überfällig/);
  assert.equal(overdue.tone,'warning');
});
test('Fehler und nicht automatisch versendete historische Zahlungen werden korrekt bezeichnet',()=>{
  const fail=auswerten({data:{},kundenmail:{status:'fehler',fehler:'BREVO_HTTP_400'}});
  assert.match(fail.detail,/BREVO_HTTP_400/);
  assert.equal(fail.tone,'warning');
  const manual=auswerten({data:{},zahlungsinfo_gesendet_am:'2026-11-21T08:37:00Z'});
  assert.match(manual.hinweis,/Versandart nicht eindeutig/);
  assert.doesNotMatch(manual.hinweis,/Automatische/);
});
test('Booking-Liste und Monatskalender erhalten den persistierten Queue-Status samt Uhrzeit und Fehler',()=>{
  const server=read('server.js');
  const selections=server.match(/FROM brilon_kundenbestaetigungen q\s+WHERE q.buchung_id=brilon_buchungen.id\) AS kundenmail/g)||[];
  assert.equal(selections.length,3);
  assert.match(server,/SELECT id,data,status,bearbeitungsnotiz,created_at,zahlungsinfo_gesendet_am,/);
});
test('Verwaltungs-Buchungsformular und rechter Kalenderbereich zeigen dieselben Zustände',()=>{
  const admin=read('site/admin.js'),cal=read('site/admin-kalender-v2.js'),html=read('site/admin.html');
  assert.match(admin,/KletternAdminVersandstatus\?\.auswerten\(b\)/);
  assert.match(cal,/KletternAdminVersandstatus\?\.auswerten\(e\)/);
  assert.match(cal,/kundenmail:row\?\.kundenmail\|\|null/);
  assert.match(cal,/Status: Buchung bestätigt/);
  assert.match(html,/admin-versandstatus.js/);
  assert.ok(html.indexOf('admin-versandstatus.js')<html.indexOf('<script src="/admin.js'));
});
