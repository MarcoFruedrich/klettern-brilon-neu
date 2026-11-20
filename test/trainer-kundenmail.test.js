'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {kundenmailNachTrainerzusage}=require('../lib/trainer-kundenmail');

const base={
  name:'Musterfamilie',angebot:'Klettergeburtstag',datum:'2026-12-05',
  uhrzeit:'14:00',buchungsnummer:'TEST-GRUPPE-123',
  buchungsmodus:'gruppe',gesamtpreis:200,zahlungen:[]
};
const bank={bankName:'Musterbank',iban:'DE00123456780000000000',bookingId:'TEST-GRUPPE-123'};

test('Trainerzusage ohne Anzahlung ist nur eine unverbindliche Vormerkung mit Zahlungsdaten',()=>{
  const mail=kundenmailNachTrainerzusage(base,bank);
  assert.equal(mail.verbindlich,false);
  assert.match(mail.betreff,/Zahlungsinformationen.*unverbindlichen/i);
  assert.match(mail.text,/unverbindliche Buchungsanfrage/);
  assert.match(mail.text,/Anzahlung von 25 %/);
  assert.match(mail.text,/50,00/);
  assert.match(mail.text,/DE00123456780000000000/);
  assert.doesNotMatch(mail.text,/Deine Buchung wurde verbindlich bestätigt/);
});

test('Nach erfassten 25 Prozent und Trainerzusage wird eine verbindliche Bestätigung vorbereitet',()=>{
  const mail=kundenmailNachTrainerzusage({...base,zahlungen:[{betragCent:5000,methode:'ueberweisung'}]},bank);
  assert.equal(mail.verbindlich,true);
  assert.match(mail.text,/verbindlich bestätigt/);
  assert.match(mail.text,/Tatsächlich erfasst: 50,00 €/);
  assert.doesNotMatch(mail.text,/Bis dahin bleibt es eine unverbindliche Buchungsanfrage/);
  assert.doesNotMatch(mail.text,/Bitte überweise den gewählten Betrag/);
});

test('Bei Teilzahlung unter 25 Prozent darf keine verbindliche Buchung bestätigt werden',()=>{
  const mail=kundenmailNachTrainerzusage({...base,zahlungen:[{betragCent:4999,methode:'bar'}]},bank);
  assert.equal(mail.verbindlich,false);
  assert.match(mail.text,/unverbindliche Buchungsanfrage/);
});

test('Partnerhausbuchung wird ohne eigene Zahlungsaufforderung an den Gast bestätigt',()=>{
  const mail=kundenmailNachTrainerzusage({...base,gesamtpreis:null,partnerhausAbwicklung:true},{bookingId:'PARTNER-123'});
  assert.equal(mail.verbindlich,true);
  assert.match(mail.text,/Abrechnung erfolgt über das Partnerhaus/);
  assert.match(mail.text,/keine eigene Anzahlung/);
  assert.doesNotMatch(mail.text,/IBAN:|Überweisung:|Anzahlung von 25 %/);
});

test('Einzelplatz ohne Anzahlung behält seine besondere Bestätigungsregel',()=>{
  const mail=kundenmailNachTrainerzusage({...base,buchungsmodus:'einzelplatz',mindestteilnehmer:5},bank);
  assert.equal(mail.verbindlich,true);
  assert.match(mail.text,/Anzahlung ist nicht erforderlich/);
  assert.match(mail.text,/ab 5 Anmeldungen/);
});

test('Fehlender Gruppenpreis und fehlende Bankdaten führen nicht zu einer irreführenden E-Mail',()=>{
  assert.throws(()=>kundenmailNachTrainerzusage({...base,gesamtpreis:null},bank),/Gesamtpreis/);
  assert.throws(()=>kundenmailNachTrainerzusage(base,{}),/Bankdaten fehlen/);
});

test('Ungültige Zahlungsdaten werden nicht stillschweigend als bezahlt interpretiert',()=>{
  assert.throws(()=>kundenmailNachTrainerzusage({...base,zahlungen:[{betragCent:-5000}]},bank),/Zahlung/);
});
