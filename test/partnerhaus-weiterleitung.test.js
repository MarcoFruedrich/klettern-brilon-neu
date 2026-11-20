'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPartnerhausWeiterleitung}=require('../lib/partnerhaus-weiterleitung');

function example({kontakt='partner@example.test',kunde='kunde@example.test',status='bestaetigt',partner=true,
  ready=false,initialStatus='',dbFailAfterSend=false,mailImpl=async()=>{}}={}){
  let state=initialStatus,attempt='',sends=0;
  const data={partnerhausAbwicklung:partner,partnerhausKontaktEmail:kontakt,
    partnerhausKontaktName:'Partner',angebot:'Klettern',datum:'2026-12-10',
    uhrzeit:'10:00',veranstaltungsort:'Jugendherberge Brilon',teilnehmer:8,
    name:'Muster',email:kunde,buchungsnummer:'KA-001'};
  const pool={async query(sql,params=[]){
    if(sql.includes("NOT IN ('wird_versendet','angenommen','unklar')")){
      if((status!=='bestaetigt'&&!(status==='offen'&&ready))||
        !partner||['wird_versendet','angenommen','unklar'].includes(state))
        return {rowCount:0,rows:[]};
      assert.match(sql,/NOT EXISTS\(SELECT 1 FROM brilon_einsaetze e/);
      state='wird_versendet';attempt=params[1];
      return {rowCount:1,rows:[{data:{...data},status}]};
    }
    if(sql.includes("SELECT status,data #>> '{partnerhausWeiterleitung,status}'")){
      return {rowCount:1,rows:[{status,mail_status:state}]};
    }
    if(sql.includes("'AND data #>> '{partnerhausWeiterleitung,status}'='wird_versendet'")||
      sql.includes("AND data #>> '{partnerhausWeiterleitung,status}'='wird_versendet'")){
      if(dbFailAfterSend)throw new Error('DB interruption');
      if(state!=='wird_versendet'||params[1]!==attempt)return {rowCount:0,rows:[]};
      state=JSON.parse(params[2]).status;
      return {rowCount:1,rows:[{id:params[0]}]};
    }
    throw new Error('Unexpected SQL '+sql);
  }};
  const service=createPartnerhausWeiterleitung({pool,brevoMail:async(...args)=>{sends++;await mailImpl(...args);}});
  return {send:()=>service('550e8400-e29b-41d4-a716-446655440000'),
    get state(){return state;},get sends(){return sends;}};
}

test('Partner wird nach Freigabe einmal informiert und der Status protokolliert',async()=>{
  let empfaenger,options;
  const f=example({mailImpl:async(e,_b,_t,o)=>{empfaenger=e;options=o;}});
  assert.equal((await f.send()).status,'angenommen');
  assert.equal(f.state,'angenommen');
  assert.equal(empfaenger,'partner@example.test');
  assert.match(options.idempotencyKey,/^[0-9a-f-]{36}$/i);
  assert.equal((await f.send()).status,'bereits_angenommen');
  assert.equal(f.sends,1);
});

test('Partnerhaus-Weiterleitung ist unabhängig von der Kunden-E-Mail',async()=>{
  const f=example({kunde:''});
  assert.equal((await f.send()).status,'angenommen');
  assert.equal(f.sends,1);
});

test('Fehlende Partner-Kontaktadresse wird dokumentiert; keine Mail geht raus',async()=>{
  const f=example({kontakt:''});
  assert.equal((await f.send()).status,'ohne_empfaenger');
  assert.equal(f.state,'ohne_empfaenger');
  assert.equal(f.sends,0);
});

test('Zwei parallele Anfragen senden niemals doppelt',async()=>{
  let finish,started;const blocked=new Promise(resolve=>{finish=resolve;});
  const begun=new Promise(resolve=>{started=resolve;});
  const f=example({mailImpl:async()=>{started();await blocked;}});
  const first=f.send();await begun;
  const second=await f.send();assert.equal(second.blockiert,true);
  finish();
  assert.equal((await first).status,'angenommen');
  assert.equal(f.sends,1);
});

test('Unklarer Providerstatus bleibt für erneuten Versand gesperrt',async()=>{
  const f=example({mailImpl:async()=>{const e=new Error('timeout');e.uncertain=true;throw e;}});
  assert.equal((await f.send()).status,'unklar');
  assert.equal((await f.send()).status,'unklar');
  assert.equal(f.sends,1);
});

test('Eindeutig abgelehnter Versand ist als Fehler nachvollziehbar',async()=>{
  const f=example({mailImpl:async()=>{throw new Error('rejected');}});
  assert.equal((await f.send()).status,'fehlgeschlagen');
  assert.equal(f.state,'fehlgeschlagen');
});

test('Nach Providerannahme aber DB-Fehler keine ungesicherte Wiederholung',async()=>{
  const f=example({dbFailAfterSend:true});
  assert.equal((await f.send()).status,'unklar');
  assert.equal((await f.send()).blockiert,true);
  assert.equal(f.sends,1);
});

test('Direktbuchung und nicht bestätigte Buchung lösen keine Partner-E-Mail aus',async()=>{
  const direct=example({partner:false}),pending=example({status:'offen'});
  assert.equal((await direct.send()).blockiert,true);
  assert.equal((await pending.send()).blockiert,true);
  assert.equal(direct.sends,0);assert.equal(pending.sends,0);
});

test('Partner erhält nach allen Zusagen eine personalbezogene, noch unverbindliche Freigabe',async()=>{
  let recipient,subject,message;
  const x=example({status:'offen',ready:true,mailImpl:async(to,s,t)=>{
    recipient=to;subject=s;message=t;
  }});
  assert.equal((await x.send()).status,'angenommen');
  assert.equal(recipient,'partner@example.test');
  assert.match(subject,/Alle Mitarbeiter haben zugesagt/);
  assert.match(message,/Alle aktuell für diesen Termin zugewiesenen Mitarbeitenden haben zugesagt/);
  assert.match(message,/noch nicht verbindlich/);
  assert.match(message,/Die verbindliche Buchung und die Abrechnung erfolgen direkt/);
  assert.equal((await x.send()).status,'bereits_angenommen');
  assert.equal(x.sends,1);
});
test('Partner-Weiterleitung bleibt bei noch offenen Mitarbeiterzusagen gesperrt',async()=>{
  const x=example({status:'offen',ready:false});
  assert.equal((await x.send()).blockiert,true);
  assert.equal(x.sends,0);
});
