'use strict';
const {zahlungsstand}=require('./buchungslogik');
const {buchungsstatusNachricht,zahlungsinformationenText}=require('./buchungs-email');

// Die Trainerzusage allein macht eine direkt abgerechnete Gruppenbuchung
// nicht verbindlich. Bei Partnerhausabwicklung schuldet der Gast keine
// eigene Anzahlung an Klettern & Abenteuer.
function kundenmailNachTrainerzusage(data,{bankName='',iban='',bookingId=''}={}){
  const partner=data?.partnerhausAbwicklung===true;
  const name=data?.name||[data?.vorname,data?.nachname].filter(Boolean).join(' ')||'';
  if(partner){
    return {
      verbindlich:true,
      betreff:'Deine Buchung ist bestätigt – Klettern & Abenteuer',
      text:`Hallo ${name},\n\ndeine Buchung für ${data.angebot||'das Programm'} am ${data.datum||'vereinbarten Termin'} um ${data.uhrzeit||'vereinbarter Zeit'} Uhr ist verbindlich bestätigt.\n\nBuchungsnummer: ${data.buchungsnummer||bookingId}\nDie Abrechnung erfolgt über das Partnerhaus. Bitte zahle keine eigene Anzahlung an Klettern & Abenteuer.\n\nGut Seil!\nKlettern & Abenteuer`
    };
  }
  const gesamt=data?.gesamtpreis;
  if(typeof gesamt!=='number'||!Number.isFinite(gesamt)||gesamt<0||
    !Number.isSafeInteger(Math.round(gesamt*100)))
    throw new Error('Gesamtpreis fehlt oder ist ungültig; keine automatische Buchungsbestätigung.');
  const einzelplatz=data.buchungsmodus==='einzelplatz';
  const stand=zahlungsstand(Math.round(gesamt*100),Array.isArray(data.zahlungen)?data.zahlungen:[]);
  const verbindlich=einzelplatz||stand.anzahlungErreicht;
  if(!verbindlich){
    if(!bankName?.trim()||!iban?.trim())
      throw new Error('Bankdaten fehlen; unverbindliche Zahlungsinformationen dürfen nicht ohne Bankverbindung versendet werden.');
    return {
      verbindlich:false,
      betreff:'Zahlungsinformationen zu deiner unverbindlichen Terminanfrage – Klettern & Abenteuer',
      text:zahlungsinformationenText({...data,name},{bankName,iban,bookingId})
    };
  }
  const msg=buchungsstatusNachricht('bestaetigt',{...data,name},stand);
  return {
    verbindlich:true,
    betreff:msg.betreff,
    text:`Hallo ${name},\n\n${msg.text}\n\nGut Seil!\nKlettern & Abenteuer`
  };
}
module.exports={kundenmailNachTrainerzusage};
