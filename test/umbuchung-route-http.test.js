'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {terminGeaendert}=require('../lib/terminwechsel-sicherheit');

const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const from=source.indexOf('const rescheduleDecision=route.match(');
const to=source.indexOf("if(route==='/api/admin/rechnungsdaten'",from);
assert.ok(from>0&&to>from);
const routeCode=source.slice(from,to);
const args=['req','res','route','admin','sameOriginMutation','pool','body','reply',
  'reservierungsTransaktion','pruefeBuchungskonflikt','buchungsfenster',
  'heuteInBerlin','terminGeaendert','safeText','brevoMail','crypto','console'];
const routeHandler=new Function(...args,'return (async()=>{'+routeCode+
  'return {status:404};})()');

function run({staffStatus='bestaetigt',queueStatus='gesendet',invoice=false,
  sameTime=false,decision='freigegeben'}={}){
  const changes=[],mails=[];
  const bookingId='550e8400-e29b-41d4-a716-446655440000';
  const requestId='550e8400-e29b-41d4-a716-446655440050';
  const original={name:'Gast',email:'gast@example.test',angebot:'Klettern pur',
    buchungsnummer:'KA-123',teilnehmer:8,datum:sameTime?'2026-12-09':'2026-12-07',
    uhrzeit:sameTime?'11:00':'10:00',dauer:180,veranstaltungsort:'Brilon',
    bestaetigungsEmail:{status:'angenommen',versuch:'alter-versuch'}};
  const row={anfrage_id:requestId,buchung_id:bookingId,anfrage_status:'wartet_verwaltung',
    anliegen:'umbuchung',wunschdatum:'2026-12-09',wunschzeit:'11:00:00',
    buchungsstatus:'bestaetigt',data:original,buchungsnummer:'KA-123'};
  let assignments=[{mitarbeiter_id:'550e8400-e29b-41d4-a716-446655440001',
    status:staffStatus,name:'Trainer',email:'trainer@example.test'}];
  const client={async query(sql,params=[]){
    if(sql.includes('SELECT r.id AS anfrage_id'))return {rowCount:1,rows:[row]};
    if(sql.includes('SELECT id FROM brilon_rechnungen'))
      return {rowCount:invoice?1:0,rows:invoice?[{id:'invoice'}]:[]};
    if(sql.includes('SELECT status FROM brilon_kundenbestaetigungen'))
      return {rowCount:1,rows:[{status:queueStatus}]};
    if(sql.includes('SELECT e.mitarbeiter_id'))return {rowCount:assignments.length,rows:assignments};
    if(sql.includes('DELETE FROM brilon_einsaetze')){
      changes.push({operation:'clear-staff'});assignments=[];return {rowCount:1,rows:[]};
    }
    if(sql.includes('UPDATE brilon_kundenbestaetigungen')){
      changes.push({operation:'clear-queue'});return {rowCount:1,rows:[]};
    }
    if(sql.includes('UPDATE brilon_buchungen SET data=')){
      changes.push({operation:'update-booking',params});return {rowCount:1,rows:[]};
    }
    if(sql.includes('UPDATE brilon_buchungswiderrufe SET status')){
      changes.push({operation:'update-request',params});return {rowCount:1,rows:[]};
    }
    throw Error('Unexpected SQL '+sql.slice(0,100));
  }};
  const pool={async query(sql,params=[]){
    changes.push({operation:'followup',params});return {rowCount:1,rows:[]};
  }};
  const pending=routeHandler({method:'PATCH'},{},'/api/admin/umbuchungsanfragen/'+requestId,
    async()=>true,()=>true,pool,async()=>({status:decision}),
    (_res,status,data)=>({status,data}),async callback=>callback(client),
    async()=>null,()=>[600,780],()=> '2026-11-20',terminGeaendert,
    (value,max=200)=>String(value||'').slice(0,max),
    async(...params)=>{mails.push(params);},
    {randomUUID:()=> '550e8400-e29b-41d4-a716-446655440099'},
    {error(){}});
  return {pending,changes,mails};
}

test('Geänderter Termin erfordert erneute Mitarbeitereinteilung',async()=>{
  const x=run(),response=await x.pending;
  assert.equal(response.status,200);
  assert.equal(response.data.benoetigtNeueMitarbeiterzusage,true);
  assert.ok(x.changes.some(item=>item.operation==='clear-staff'));
  assert.ok(x.changes.some(item=>item.operation==='update-booking'&&item.params[2]===true));
  assert.equal(x.mails.length,2);
});
test('Unveränderte Uhrzeit mit Sekunden löst keinen Personalreset aus',async()=>{
  const x=run({sameTime:true}),response=await x.pending;
  assert.equal(response.status,200);
  assert.equal(response.data.benoetigtNeueMitarbeiterzusage,false);
  assert.ok(!x.changes.some(item=>item.operation==='clear-staff'));
});
test('Bestehende Rechnung sperrt Umbuchung',async()=>{
  const x=run({invoice:true}),response=await x.pending;
  assert.equal(response.status,409);
  assert.match(response.data.error,/Rechnung/);
  assert.ok(!x.changes.some(item=>item.operation==='clear-staff'));
});
test('Laufende Buchungsbestätigung sperrt Umbuchung',async()=>{
  const x=run({queueStatus:'versand_laeuft'}),response=await x.pending;
  assert.equal(response.status,409);
  assert.ok(!x.changes.some(item=>item.operation==='clear-staff'));
});
test('Abgeschlossene Mitarbeiterstunden sperren Umbuchung',async()=>{
  const x=run({staffStatus:'abgeschlossen'}),response=await x.pending;
  assert.equal(response.status,409);
  assert.ok(!x.changes.some(item=>item.operation==='clear-staff'));
});
test('Abgelehnte Umbuchung erhält alle bisherigen Einteilungen',async()=>{
  const x=run({decision:'abgelehnt'}),response=await x.pending;
  assert.equal(response.status,200);
  assert.ok(!x.changes.some(item=>item.operation==='clear-staff'));
});
