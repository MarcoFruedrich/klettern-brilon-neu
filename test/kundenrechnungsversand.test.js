'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createKundenrechnungsversand}=require('../lib/kundenrechnungsversand');

const id=crypto.randomUUID(),buchungId=crypto.randomUUID();
function scenario({initial='ausstehend',email='kunde@example.test',partnerhaus=false,hold=false,mailFailure=null}={}){
  let state=initial,mailCount=0;
  const sqlHistory=[];
  const invoice={id,buchung_id:buchungId,rechnungsnummer:'KA-2026-0100',
    data:{aussteller:{firma:'Klettern & Abenteuer Brilon'}},pdf:Buffer.from('%PDF-1.4\nTest')};
  let release;
  const awaitingRelease=new Promise(resolve=>{release=resolve;});
  let started;
  const mailStarted=new Promise(resolve=>{started=resolve;});
  const pool={async query(sql,args=[]){
    sqlHistory.push({sql,args});
    if(sql.includes("SET email_status='unklar'")&&sql.includes('RETURNING id,buchung_id')){
      if(!['ausstehend','fehlgeschlagen','ohne_empfaenger'].includes(state))return {rowCount:0,rows:[]};
      state='unklar';
      return {rowCount:1,rows:[invoice]};
    }
    if(sql.includes('SELECT rechnungsnummer,email_status FROM brilon_rechnungen'))
      return {rowCount:1,rows:[{rechnungsnummer:invoice.rechnungsnummer,email_status:state}]};
    if(sql.includes("SELECT data->>'email' AS email"))
      return {rowCount:1,rows:[{email,partnerhaus}]};
    if(sql.includes("SET email_status='angenommen'")){
      state='angenommen';return {rowCount:1,rows:[]};
    }
    if(sql.includes("SET email_status='ohne_empfaenger'")){
      state='ohne_empfaenger';return {rowCount:1,rows:[]};
    }
    if(sql.includes('SET email_status=$1')){
      state=args[0];return {rowCount:1,rows:[]};
    }
    if(sql.includes('SET data=jsonb_set')){
      return {rowCount:1,rows:[]};
    }
    throw Error('Unerwartete Testabfrage: '+sql);
  }};
  const mail=async(to,subject,text,options)=>{
    mailCount++;started();
    if(hold)await awaitingRelease;
    if(mailFailure)throw mailFailure;
    assert.equal(to,email);
    assert.equal(options.idempotencyKey,id,'Die UUID der Kundenrechnung gilt als Versand-Schlüssel');
    assert.match(options.attachments[0].name,/\.pdf$/);
    assert.match(options.attachments[0].content,/^[a-zA-Z0-9+/=]+$/);
    assert.match(subject,/Rechnung/);
    assert.match(text,/KA-2026-0100/);
  };
  return {send:createKundenrechnungsversand({pool,brevoMail:mail}),mailStarted,
    release:()=>release(),state:()=>state,mails:()=>mailCount,sqlHistory};
}

test('Kundenrechnung wird einmal übergeben; bestätigte Wiederholung versendet nicht erneut',async()=>{
  const x=scenario();
  const first=await x.send(id);
  assert.equal(first.status,'angenommen');
  assert.equal(x.mails(),1);
  const second=await x.send(id);
  assert.equal(second.status,'angenommen');
  assert.equal(x.mails(),1);
});

test('Zeitgleiche Rechnungsanforderungen dürfen nur einmal an den Anbieter gelangen',async()=>{
  const x=scenario({hold:true});
  const first=x.send(id);
  await x.mailStarted;
  const overlapping=await x.send(id);
  assert.equal(overlapping.status,'unklar');
  assert.equal(overlapping.blockiert,true);
  assert.equal(x.mails(),1);
  x.release();
  assert.equal((await first).status,'angenommen');
  assert.equal(x.mails(),1);
});

test('Unklare Brevo-Übertragung sperrt weitere automatische und manuelle Versuche',async()=>{
  const error=new Error('Verbindungsabbruch nach unbekannter Annahme');error.uncertain=true;
  const x=scenario({mailFailure:error});
  assert.equal((await x.send(id)).status,'unklar');
  const next=await x.send(id);
  assert.equal(next.status,'unklar');
  assert.equal(next.blockiert,true);
  assert.match(next.hinweis,/zuerst beim E-Mail-Anbieter prüfen/);
  assert.equal(x.mails(),1);
});

test('Bekannter Versandfehler wird dokumentiert und darf gezielt erneut probiert werden',async()=>{
  const error=new Error('Brevo HTTP 400');error.uncertain=false;
  const x=scenario({mailFailure:error});
  const result=await x.send(id);
  assert.equal(result.status,'fehlgeschlagen');
  assert.equal(x.state(),'fehlgeschlagen');
  assert.equal(x.mails(),1);
  // Ein erneuter Versuch nach einem definitiven HTTP-Fehler ist erlaubt;
  // die Testumgebung verwendet weiter denselben fehlgeschlagenen Anbieter.
  const second=await x.send(id);
  assert.equal(second.status,'fehlgeschlagen');
  assert.equal(x.mails(),2);
});

test('Fehlende Kundenadresse führt nicht zu einem Versand',async()=>{
  const x=scenario({email:''});
  const result=await x.send(id);
  assert.equal(result.status,'ohne_empfaenger');
  assert.equal(x.mails(),0);
  assert.equal(x.state(),'ohne_empfaenger');
});

test('Partnerhausbuchungen lösen keine direkte Kundenrechnung aus',async()=>{
  const x=scenario({partnerhaus:true});
  const result=await x.send(id);
  assert.equal(result.status,'ohne_empfaenger');
  assert.equal(x.mails(),0);
  assert.equal(x.state(),'ohne_empfaenger');
});
