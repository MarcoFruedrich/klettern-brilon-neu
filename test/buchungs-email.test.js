'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buchungsDetails,buchungsstatusNachricht,zahlungsinformationenText}=require('../lib/buchungs-email');

test('Buchungsanfrage enthält stabile Referenz, Termin und vollständige Preisaufteilung',()=>{
  const details=buchungsDetails({
    buchungsnummer:'MUELLER-MAX-151126',name:'Max Mueller',datum:'2026-11-15',angebot:'Klettern',
    teilnehmer:6,uhrzeit:'10:00',ende:'12:00 Uhr',telefon:'Nicht angegeben',nachricht:'',
    gesamtpreis:120.5,anzahlung:30.13,restbetrag:90.37
  });
  assert.match(details,/Buchungsnummer: MUELLER-MAX-151126/);
  assert.match(details,/Datum: 2026-11-15/);
  assert.match(details,/Gesamtpreis: 120,50 €/);
  assert.match(details,/Anzahlung \(25 %\): 30,13 €/);
  assert.match(details,/Restbetrag \(75 %\): 90,37 €/);
});

test('Buchungsanfrage berechnet die Preisanteile centgenau, wenn sie nicht gespeichert sind',()=>{
  const details=buchungsDetails({gesamtpreis:79.99});
  assert.match(details,/Gesamtpreis: 79,99 €/);
  assert.match(details,/Anzahlung \(25 %\): 20,00 €/);
  assert.match(details,/Restbetrag \(75 %\): 59,99 €/);
});

test('Einzelplatz-Anmeldung nennt Preis pro Person und verlangt keine Anzahlung',()=>{
  const details=buchungsDetails({buchungsnummer:'MUSTER-1',angebot:'Individualklettern',
    buchungsmodus:'einzelplatz',mindestteilnehmer:5,gesamtpreis:18,anzahlung:0,restbetrag:18});
  assert.match(details,/Einzelplatzpreis: 18,00 €/);
  assert.match(details,/Keine Anzahlung erforderlich/);
  assert.match(details,/findet ab 5 Anmeldungen statt/);
  assert.doesNotMatch(details,/25 %|Anzahlung \(25 %\)/);
});

test('Bestätigung einer Einzelplatzreservierung enthält keine Anzahlungsregel',()=>{
  const message=buchungsstatusNachricht('bestaetigt',{
    buchungsmodus:'einzelplatz',mindestteilnehmer:5,buchungsnummer:'MUSTER-1'
  },null);
  assert.match(message.betreff,/Kletterplatz ist bestätigt/);
  assert.match(message.text,/Anzahlung ist nicht erforderlich/i);
  assert.match(message.text,/ab 5 Anmeldungen/);
  assert.match(message.text,/Buchungsnummer: MUSTER-1/);
  assert.doesNotMatch(message.text,/25 %/);
});

test('Bestätigungsnachricht enthält Referenznummer und tatsächlichen Zahlungsstand',()=>{
  const message=buchungsstatusNachricht('bestaetigt',{buchungsnummer:'MUELLER-MAX-151126'},
    {gesamtCent:12050,anzahlungCent:3013,erhaltenCent:3013,offenCent:9037});
  assert.equal(message.betreff,'Deine Buchung ist bestätigt – Klettern & Abenteuer Brilon');
  assert.match(message.text,/Buchungsnummer: MUELLER-MAX-151126/);
  assert.match(message.text,/Gesamtpreis: 120,50 €/);
  assert.match(message.text,/Anzahlung \(25 %\): 30,13 €/);
  assert.match(message.text,/Tatsächlich erfasst: 30,13 €/);
  assert.match(message.text,/Noch offen: 90,37 €/);
});

test('Zahlungsinformationen verwenden die stabile Buchungsnummer als Überweisungszweck',()=>{
  const text=zahlungsinformationenText({name:'Max Mueller',buchungsnummer:'MUELLER-MAX-151126',
    angebot:'Klettern',datum:'2026-11-15',gesamtpreis:120.5},
  {bankName:'Testbank',iban:'DE0012345678',bookingId:'fallback-id'});
  assert.match(text,/Buchungsnummer: MUELLER-MAX-151126/);
  assert.match(text,/Anzahlung von 25 %: 30,13\s?€/);
  assert.match(text,/Restbetrag vor Ort: 90,37\s?€/);
  assert.match(text,/Verwendungszweck: MUELLER-MAX-151126/);
  assert.doesNotMatch(text,/fallback-id/);
});

test('Zahlungsinformationen fallen bei Altbuchungen ohne Referenz auf die gespeicherte Buchungs-ID zurück',()=>{
  const text=zahlungsinformationenText({gesamtpreis:40},{bankName:'Testbank',iban:'DE00',bookingId:'legacy-id'});
  assert.match(text,/Verwendungszweck: legacy-id/);
});
