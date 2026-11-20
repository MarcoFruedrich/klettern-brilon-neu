'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createSpontanGruppenApi}=require('../lib/spontangruppen-api');

const invoiceId=crypto.randomUUID(),zeitId=crypto.randomUUID();
const participant1=crypto.randomUUID(),participant2=crypto.randomUUID();
const bookingUuid=crypto.randomUUID();
const fakeReq={method:'POST',headers:{}};
const reply=(_res,status,data)=>({status,data});
const baseDeps={admin:async()=>true,staffSession:async()=>({mitarbeiter_id:bookingUuid}),
  reply,body:async()=>({}),sameOriginMutation:()=>true,limit:()=>true,brevoMail:async()=>{},
  env:{BOOKING_NOTIFY_EMAIL:''}};

test('Partnerrechnung verwendet einen gültigen, stabilen UUID-Idempotenzschlüssel beim Versand',async()=>{
  const sent=[];let state='ausstehend';
  const invoice={id:invoiceId,rechnungsnummer:'KA-2026-NP-0001',email_status:state,
    data:{partner:{unternehmen:'Beispiel-Jugendherberge',email:'buchhaltung@example.test'},
      aussteller:{firma:'Klettern & Abenteuer'}},
    pdf:Buffer.from('%PDF-1.4\n%Test')};
  const pool={async query(sql){
    if(sql.includes('SELECT * FROM brilon_netzwerkpartner_abrechnungen')){
      return {rowCount:1,rows:[{...invoice,email_status:state}]};
    }
    if(sql.includes("UPDATE brilon_netzwerkpartner_abrechnungen SET email_status='angenommen'")){
      state='angenommen';return {rowCount:1,rows:[]};
    }
    throw new Error('Unerwartetes SQL: '+sql);
  }};
  const handler=createSpontanGruppenApi({...baseDeps,pool,
    brevoMail:async(email,subject,_text,options)=>{
      sent.push({email,subject,options});
      assert.equal(options.idempotencyKey,invoiceId,
        'Brevo akzeptiert nur einen unveränderten UUID-Idempotenzschlüssel');
      assert.match(options.idempotencyKey,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.match(options.attachments[0].name,/\.pdf$/);
    }});
  const route='/api/spontangruppen/buchhaltung/'+invoiceId+'/versenden';
  const first=await handler(fakeReq,{},new URL('https://example.test'+route),route,'127.0.0.1');
  assert.equal(first.status,200);assert.equal(first.data.status,'angenommen');
  assert.equal(sent.length,1);
  assert.equal(sent[0].email,'buchhaltung@example.test');
  const again=await handler(fakeReq,{},new URL('https://example.test'+route),route,'127.0.0.1');
  assert.equal(again.status,200);
  assert.equal(sent.length,1,'Schon angenommene Rechnung darf nicht doppelt versandt werden');
});

function presenceCase({billed=false,invalidSecond=false,duplicate=false}={}){
  const sqlCalls=[],emails=[],updates=[];
  let bodyValue={zeitId,eintraege:[{teilnahmeId:participant1,anwesend:true,personen:2}]};
  if(invalidSecond)bodyValue.eintraege.push({teilnahmeId:participant2,anwesend:true,personen:1});
  if(duplicate)bodyValue.eintraege.push({teilnahmeId:participant1,anwesend:false,personen:0});
  const databaseQuery=async(sql,params=[])=>{
    sqlCalls.push(sql);
    if(/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql))return {rows:[],rowCount:0};
    if(sql.includes('SELECT ss.standort_id FROM brilon_spontan_zeiten'))return {rows:[{standort_id:5}],rowCount:1};
    if(sql.includes('SELECT 1 FROM brilon_pruef_freigaben'))return {rows:[{}],rowCount:1};
    if(sql.includes('SELECT s.id FROM brilon_spontan_zeiten s'))return {rows:[{id:zeitId}],rowCount:1};
    if(sql.includes('SELECT id FROM brilon_netzwerkpartner_abrechnungen')){
      return billed?{rows:[{id:invoiceId}],rowCount:1}:{rows:[],rowCount:0};
    }
    if(sql.includes('UPDATE brilon_spontan_teilnahmen')){
      updates.push(params[1]);
      return invalidSecond&&params[1]===participant2?{rows:[],rowCount:0}:{rows:[{teilnahme_id:params[1]}],rowCount:1};
    }
    if(sql.includes('SELECT COALESCE(SUM(t.personen)'))return {rows:[{angemeldet:2,anwesend:2}],rowCount:1};
    if(sql.includes('SELECT s.datum,s.uhrzeit,o.name AS standort'))return {rows:[{datum:'2026-12-12',uhrzeit:'14:00:00',standort:'Jugendherberge Brilon',preis_pro_person_cent:2000}],rowCount:1};
    if(sql.includes('FROM brilon_spontan_einstellungen e')&&sql.includes('JOIN brilon_netzwerkpartner p')){
      assert.match(sql,/p\.id=e\.netzwerkpartner_id/);
      return {rows:[{email:'vereinbarter-partner@example.test'}],rowCount:1};
    }
    throw Error('Unerwartetes SQL '+sql);
  };
  const pool={query:databaseQuery,async connect(){return {query:databaseQuery,release(){}};}};
  const handler=createSpontanGruppenApi({...baseDeps,pool,body:async()=>bodyValue,
    brevoMail:async email=>{emails.push(email);}});
  const call=()=>handler(fakeReq,{},new URL('https://example.test/api/spontangruppen/anwesenheit/speichern'),
    '/api/spontangruppen/anwesenheit/speichern','127.0.0.1');
  return {call,sqlCalls,emails,updates};
}

test('Bestehende Partnerrechnung sperrt spätere Änderungen der Anwesenheit vollständig',async()=>{
  const x=presenceCase({billed:true});
  const result=await x.call();
  assert.equal(result.status,409);
  assert.match(result.data.error,/Rechnung/);
  assert.ok(x.sqlCalls.some(s=>s.startsWith('ROLLBACK')));
  assert.equal(x.sqlCalls.filter(s=>s.includes('UPDATE brilon_spontan_teilnahmen')).length,0);
  assert.equal(x.emails.length,0);
});

test('Fehler in zweitem Anwesenheitseintrag führt zur vollständigen Rücknahme',async()=>{
  const x=presenceCase({invalidSecond:true});
  const result=await x.call();
  assert.equal(result.status,409);
  assert.equal(x.updates.length,2);
  assert.ok(x.sqlCalls.includes('ROLLBACK'));
  assert.ok(!x.sqlCalls.includes('COMMIT'));
  assert.equal(x.emails.length,0);
});

test('Anwesenheitsdaten werden nur an den vereinbarten Partner geschickt',async()=>{
  const x=presenceCase();
  const result=await x.call();
  assert.equal(result.status,200);
  assert.ok(x.sqlCalls.includes('COMMIT'));
  assert.deepEqual(x.emails,['vereinbarter-partner@example.test']);
});

test('Doppelte Anwesenheitseinträge werden vor einer Änderung abgelehnt',async()=>{
  const x=presenceCase({duplicate:true});
  const result=await x.call();
  assert.equal(result.status,400);
  assert.match(result.data.error,/mehrfach/);
  assert.equal(x.updates.length,0);
  assert.ok(!x.sqlCalls.includes('BEGIN'));
});

function voteGuardCase({alreadyRegistered=false,selectedConfirmed=false}={}){
  const queries=[];
  const pool={async query(sql){
    queries.push(sql);
    if(sql.includes('SELECT id FROM brilon_spontan_sessions'))
      return {rowCount:1,rows:[{id:bookingUuid}]};
    if(sql.includes('SELECT preis_pro_person_cent,netzwerkpartner_id,abzug_typ,abzug_wert'))
      return {rowCount:1,rows:[{preis_pro_person_cent:2000,netzwerkpartner_id:invoiceId,abzug_typ:'prozent',abzug_wert:10}]};
    if(sql.includes('SELECT 1 FROM brilon_spontan_zeitstimmen v'))
      return alreadyRegistered?{rowCount:1,rows:[{}]}:{rowCount:0,rows:[]};
    if(sql.includes('SELECT id FROM brilon_spontan_zeiten')&&sql.includes('id=ANY'))
      return selectedConfirmed?{rowCount:1,rows:[{id:zeitId}]}:{rowCount:0,rows:[]};
    throw Error('Unerwartete Abstimmungsabfrage: '+sql);
  }};
  const handler=createSpontanGruppenApi({...baseDeps,pool,body:async()=>({
    ortId:5,code:'123456',teilnahmeId:participant1,
    interesse:true,personen:2,name:'Testgast',email:'gast@example.test',
    zeitenIds:[zeitId],neueZeiten:[]
  })});
  const route='/api/spontangruppen/abstimmung';
  const call=()=>handler(fakeReq,{},new URL('https://example.test'+route),route,'127.0.0.1');
  return {call,queries};
}

test('Abstimmung darf bereits bestätigte Teilnahme nicht mehr verändern',async()=>{
  const x=voteGuardCase({alreadyRegistered:true});
  const result=await x.call();
  assert.equal(result.status,409);
  assert.match(result.data.error,/bestätigten Gruppe/);
  assert.ok(!x.queries.some(sql=>/^\\s*(UPDATE|DELETE|INSERT)/i.test(sql)));
});

test('Abstimmung darf keine weiteren Personen in bereits bestätigte Zeitfenster eintragen',async()=>{
  const x=voteGuardCase({selectedConfirmed:true});
  const result=await x.call();
  assert.equal(result.status,409);
  assert.match(result.data.error,/bereits als Gruppe bestätigt/);
  assert.ok(!x.queries.some(sql=>/^\\s*(UPDATE|DELETE|INSERT)/i.test(sql)));
});
