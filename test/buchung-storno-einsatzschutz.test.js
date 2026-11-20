'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {statuswechselGrund}=require('../lib/buchungsstatus-schutz');
const {createEinsatzplanungApi}=require('../lib/einsatzplanung-api');
const {calculateLoad,checkRest}=require('../lib/einsatzplanung');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');

test('Stornierte Buchungen können nicht durch normales Status-PATCH erneut aktiviert werden',()=>{
  for(const old of ['storniert','abgelehnt'])
    for(const next of ['offen','bestaetigt'])
      assert.match(statuswechselGrund(old,next),/neue Buchungsanfrage/);
  assert.equal(statuswechselGrund('storniert','storniert'),null);
  assert.equal(statuswechselGrund('offen','bestaetigt'),null);
  assert.equal(statuswechselGrund('bestaetigt','storniert'),null);
});

test('Buchungsstatus wird unter FOR UPDATE geprüft, bevor Daten geändert werden',()=>{
  const start=server.indexOf("const alt=await client.query(");
  const tail=server.slice(start,start+6500);
  assert.ok(start>0);
  assert.match(tail,/SELECT id,data,status FROM brilon_buchungen WHERE id=\$1 FOR UPDATE/);
  assert.match(tail,/statuswechselGrund\(alterStatus,status\)/);
  assert.match(tail,/statuswechselGesperrt/);
});

test('Stornierte Einsätze belasten weder Arbeitszeit noch Ruhezeit; erledigte Stunden bleiben erhalten',async()=>{
  const id='550e8400-e29b-41d4-a716-446655440001',queries=[];
  const entries=[
    {buchung_id:'active',buchungsstatus:'offen',status:'eingeteilt',
      datum:'2026-11-17',uhrzeit:'09:00',arbeitsminuten:120},
    {buchung_id:'cancelled',buchungsstatus:'storniert',status:'bestaetigt',
      datum:'2026-11-18',uhrzeit:'08:00',arbeitsminuten:240},
    {buchung_id:'worked',buchungsstatus:'storniert',status:'abgeschlossen',
      datum:'2026-11-19',uhrzeit:'12:00',arbeitsminuten:120,ist_minuten:60}
  ];
  const filter=(e)=>['offen','bestaetigt'].includes(e.buchungsstatus)||e.status==='abgeschlossen';
  const pool={async query(sql){
    queries.push(sql);
    if(sql.startsWith('SELECT * FROM brilon_beschaeftigung'))
      return {rows:[{art:'vollzeit',wochenstunden:40,stundenlohn_cent:2000}],rowCount:1};
    if(sql.includes('e.bewerbung_am,e.zugewiesen_am')){
      assert.match(sql,/b\.status IN \('offen','bestaetigt'\) OR e\.status='abgeschlossen'/);
      return {rows:entries.filter(filter),rowCount:2};
    }
    throw Error('Unerwartete Abfrage: '+sql.slice(0,100));
  }};
  const api=createEinsatzplanungApi({pool,admin:async()=>true,
    staffSession:async()=>null,reply:(_r,status,data)=>({status,data}),
    body:async()=>({}),sameOriginMutation:()=>true,brevoMail:async()=>{},
    kundenService:{schedule:async()=>({geplant:false})}});
  const result=await api({method:'GET'},{},new URL('https://example.test/?datum=2026-11-18'),
    '/api/admin/einsatzplanung/stunden/'+id);
  assert.equal(result.status,200);
  assert.equal(result.data.geplantWocheStunden,3);
  assert.equal(result.data.geleistetWocheStunden,1);
  assert.deepEqual(checkRest(entries.filter(filter),'2026-11-18','08:00',120,'new'),[]);
  assert.ok(queries.length>=2);
});

test('Sowohl manuelle Einteilung als auch Mitarbeiterzusage ignorieren stornierte Buchungen',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','lib','einsatzplanung-api.js'),'utf8');
  const match=source.match(/JOIN brilon_buchungen b ON b\.id=e\.buchung_id\s+WHERE e\.mitarbeiter_id=\$1\s+AND \(b\.status IN \('offen','bestaetigt'\) OR e\.status='abgeschlossen'\)/g)||[];
  assert.equal(match.length,2);
  const workload=calculateLoad([
    {buchung_id:'active',status:'eingeteilt',datum:'2026-11-17',arbeitsminuten:120},
    {buchung_id:'actual',status:'abgeschlossen',datum:'2026-11-19',arbeitsminuten:120,ist_minuten:60}
  ],'2026-11-18');
  assert.equal(workload.weekMin,180);
  assert.equal(workload.weekWorkedMin,60);
});
