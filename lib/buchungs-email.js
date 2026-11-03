'use strict';

function euro(betrag){
  const zahl=Number(betrag);
  if(!Number.isFinite(zahl))return 'Nicht angegeben';
  return zahl.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
}

function buchungsDetails(data){
  const details=[
    `Buchungsnummer: ${data.buchungsnummer||'Nicht angegeben'}`,
    `Name: ${data.name||'Nicht angegeben'}`,
    `Datum: ${data.datum||'Nicht angegeben'}`,
    `Angebot: ${data.angebot||'Nicht angegeben'}`,
    `Teilnehmer: ${data.teilnehmer||'Nicht angegeben'}`,
    `Beginn: ${data.uhrzeit||'Nach Absprache'} Uhr`,
    `Ende: ${data.ende||'nach Absprache'}`,
    `Telefon: ${data.telefon||'Nicht angegeben'}`,
    `Nachricht: ${data.nachricht||'Keine'}`
  ];
  const gesamt=Number(data.gesamtpreis);
  if(Number.isFinite(gesamt)&&gesamt>=0){
    if(data.buchungsmodus==='einzelplatz'){
      details.push(`Einzelplatzpreis: ${euro(gesamt)}`,'Keine Anzahlung erforderlich.',
        `Der Termin findet ab ${Number(data.mindestteilnehmer)||5} Anmeldungen statt.`);
    }else{
      const anzahlung=typeof data.anzahlung==='number'&&Number.isFinite(data.anzahlung)
        ?data.anzahlung:Math.round(gesamt*25)/100;
      const restbetrag=typeof data.restbetrag==='number'&&Number.isFinite(data.restbetrag)
        ?data.restbetrag:Math.round((gesamt-anzahlung)*100)/100;
      details.push(`Gesamtpreis: ${euro(gesamt)}`,`Anzahlung (25 %): ${euro(anzahlung)}`,`Restbetrag (75 %): ${euro(restbetrag)}`);
    }
  }
  return details.join('\n');
}

function buchungsstatusNachricht(status,data,stand){
  if(data?.buchungsmodus==='einzelplatz'&&status==='bestaetigt')return {
    betreff:'Dein Kletterplatz ist bestätigt – Klettern & Abenteuer Brilon',
    text:`Dein Platz ist bestätigt. Eine Anzahlung ist nicht erforderlich. Der Termin findet ab ${Number(data.mindestteilnehmer)||5} Anmeldungen statt.\n\nBuchungsnummer: ${data.buchungsnummer||'Nicht angegeben'}`
  };
  const nachrichten={
    bestaetigt:{
      betreff:'Deine Buchung ist bestätigt – Klettern & Abenteuer Brilon',
      text:stand
        ?`Deine Buchung wurde verbindlich bestätigt.\n\nGesamtpreis: ${euro(stand.gesamtCent/100)}\nAnzahlung (25 %): ${euro(stand.anzahlungCent/100)}\nTatsächlich erfasst: ${euro(stand.erhaltenCent/100)}\nNoch offen: ${euro(stand.offenCent/100)}.`
        :'Deine Buchung wurde verbindlich bestätigt.'
    },
    abgelehnt:{
      betreff:'Rückmeldung zu deiner Buchungsanfrage – Klettern Brilon',
      text:'Leider können wir deine Buchungsanfrage nicht annehmen.'
    },
    storniert:{
      betreff:'Deine Buchung wurde storniert – Klettern Brilon',
      text:'Deine Buchung wurde storniert.'
    }
  };
  const nachricht=nachrichten[status];
  if(!nachricht)return null;
  return {
    betreff:nachricht.betreff,
    text:`${nachricht.text}\n\nBuchungsnummer: ${data.buchungsnummer||'Nicht angegeben'}`
  };
}

function zahlungsinformationenText(kunde,{bankName,iban,bookingId}){
  const gesamtpreis=Number(kunde.gesamtpreis);
  const anzahlung=Math.round(gesamtpreis*25)/100;
  const restbetrag=Math.round((gesamtpreis-anzahlung)*100)/100;
  const euroVoll=betrag=>Number(betrag).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
  return [
    `Hallo ${kunde.name||''},`,
    '',
    'vielen Dank für deine Buchungsanfrage bei Klettern & Abenteuer Brilon.',
    '',
    `Buchungsnummer: ${kunde.buchungsnummer||bookingId}`,
    `Angebot: ${kunde.angebot}`,
    `Datum: ${kunde.datum}`,
    `Gesamtpreis: ${euroVoll(gesamtpreis)}`,
    '',
    'Zahlungsmöglichkeiten:',
    `1. Anzahlung von 25 %: ${euroVoll(anzahlung)}`,
    `   Restbetrag vor Ort: ${euroVoll(restbetrag)}`,
    `2. Vollständige Vorauszahlung: ${euroVoll(gesamtpreis)}`,
    '',
    'Bankverbindung:',
    `Bank: ${bankName||''}`,
    `IBAN: ${iban||''}`,
    `Verwendungszweck: ${kunde.buchungsnummer||bookingId}`,
    '',
    'Bitte überweise den gewählten Betrag innerhalb von 48 Stunden.',
    'Bei kurzfristigen Buchungen bitten wir um sofortige Überweisung.',
    '',
    'Bei einer Anzahlung kannst du den Restbetrag',
    'am Veranstaltungstag bar oder per Karte bezahlen.',
    '',
    'Die Buchung wird erst nach Eingang der erforderlichen Zahlung',
    'und unserer ausdrücklichen Bestätigung verbindlich.',
    '',
    'Viele Grüße',
    'Klettern & Abenteuer Brilon'
  ].join('\n');
}

module.exports={buchungsDetails,buchungsstatusNachricht,zahlungsinformationenText};
