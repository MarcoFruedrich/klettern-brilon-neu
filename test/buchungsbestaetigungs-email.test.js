'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createBuchungsbestaetigungsMailer}=require('../lib/buchungsbestaetigungs-email');

function testMailer(sendEmail){
  const gespeicherte=[];
  const pool={query:async(_sql,params)=>{
    gespeicherte.push(JSON.parse(params[0]).bestaetigungsEmail);
    return {rows:[{id:params[1]}],rowCount:1};
  }};
  const zeitpunkte=['2026-11-03T15:36:55.000Z','2026-11-03T15:36:56.000Z'];
  const mail=createBuchungsbestaetigungsMailer({pool,sendEmail,logger:{error(){}},now:()=>new Date(zeitpunkte.shift())});
  return {mail,gespeicherte};
}

test('protokolliert Versuch und Annahme der Buchungsbestätigung durch den Anbieter',async()=>{
  const {mail,gespeicherte}=testMailer(async()=>{});
  const result=await mail({buchungId:'booking-1',email:'kunde@example.test',betreff:'Bestätigt',text:'Text'});
  assert.deepEqual(gespeicherte.map(item=>item.status),['wird_versendet','angenommen']);
  assert.equal(result.versuchtAm,'2026-11-03T15:36:55.000Z');
  assert.equal(result.angenommenAm,'2026-11-03T15:36:56.000Z');
  assert.equal(result.fehler,null);
});

test('protokolliert eine eindeutige Fehlermeldung des Mailversands',async()=>{
  const {mail,gespeicherte}=testMailer(async()=>{throw new Error('E-Mail-Versand ist nicht konfiguriert.');});
  const result=await mail({buchungId:'booking-1',email:'kunde@example.test',betreff:'Bestätigt',text:'Text'});
  assert.equal(gespeicherte.at(-1).status,'fehlgeschlagen');
  assert.equal(gespeicherte.at(-1).fehler,'E-Mail-Versand ist nicht konfiguriert.');
  assert.equal(result.angenommenAm,null);
});

test('markiert einen unklaren Verbindungsstatus ohne automatische Wiederholung',async()=>{
  const {mail,gespeicherte}=testMailer(async()=>{const error=new Error('Verbindungsstatus ungeklärt');error.uncertain=true;throw error;});
  const result=await mail({buchungId:'booking-1',email:'kunde@example.test',betreff:'Bestätigt',text:'Text'});
  assert.equal(gespeicherte.at(-1).status,'ungeklaert');
  assert.equal(result.status,'ungeklaert');
});
