
document.getElementById('year').textContent=new Date().getFullYear();
const qrAnmeldung=new URLSearchParams(window.location.search).get('zugang')==='jh-brilon';
const date=document.querySelector('input[name=datum]');
// Veranstaltungsort Brilon: YYYY-MM-DD unabhängig von Browser-Sprache und Gerätezeitzone.
function buchungstagInBerlin(zeitpunkt=new Date()){
  const teile=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(zeitpunkt);
  const feld=Object.fromEntries(teile.map(teil=>[teil.type,teil.value]));
  return feld.year+'-'+feld.month+'-'+feld.day;
}
if(date)date.min=buchungstagInBerlin();

const verfuegbarkeit = document.getElementById('datum-verfuegbarkeit');
let sperrzeiten = [];
let sperrzeitenGeladen = false;
function datumIstGesperrt(datum){
  const standort=standortAuswahl?.value||'';
  const passend=sperrzeiten.filter(e=>!Array.isArray(e.standorte)||!e.standorte.length||
    (standort&&e.standorte.includes(standort)));
  return sperrzeitenGeladen&&window.sperrzeitEnthaelt(datum,passend);
}
function datumTeilweiseBelegt(datum){
  const standort=standortAuswahl?.value||'';
  return sperrzeitenGeladen&&sperrzeiten.some(entry=>{
    if(Array.isArray(entry.standorte)&&entry.standorte.length&&
      (!standort||!entry.standorte.includes(standort)))return false;
    const end=typeof entry.enddatum==='string'?entry.enddatum:entry.datum;
    if(datum<entry.datum||datum>end)return false;
    const timeMinutes=value=>{
      if(typeof value!=='string')return null;
      const match=value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
      return match?Number(match[1])*60+Number(match[2]):null;
    };
    const start=timeMinutes(entry.uhrzeit),finish=timeMinutes(entry.endzeit);
    if(start===null||finish===null||finish<=start)return false;
    if(entry.datum===end)return true;
    return datum===entry.datum||datum===end;
  });
}
const uhrzeitAuswahl = document.getElementById('buchungs-uhrzeit');
const uhrzeitHinweis = document.getElementById('uhrzeit-hinweis');
const angebotAuswahl = document.getElementById('angebot-auswahl');
const standortAuswahl = document.getElementById('buchungs-standort');
let angeboteCache=[];
window.ausgewaehlterAngebotsStandort='alle';
let verfuegbarkeitsAnfrage=0;
let sonderaktionsPrefix='';
let ausgewaehlteSonderaktion=null;
let angeboteFertig=false;
let geladeneAktionen=null;
let angebotslinkAngewendet=false;
// Angebote aus WhatsApp führen in dasselbe reguläre Buchungsformular.
function angebotBuchungslink(typ,id){
  const url=new URL('/',window.location.origin);
  url.searchParams.set(typ,String(id));
  url.hash='buchung';
  return url.pathname+url.search+url.hash;
}
function angebotslinkAnwenden(){
  if(!angeboteFertig||angebotslinkAngewendet)return;
  const query=new URLSearchParams(window.location.search);
  const id=query.get('programm'),aktionId=query.get('aktion');
  if(!id&&!aktionId)return;
  if(aktionId&&geladeneAktionen===null)return;
  angebotslinkAngewendet=true;
  if(aktionId){
    const aktion=geladeneAktionen.find(item=>String(item.id||item.sonderaktion_id)===aktionId);
    if(aktion)sonderaktionAnfragen(aktion);
    return;
  }
  const programm=angeboteCache.find(item=>String(item.id)===id);
  if(!programm)return;
  const orte=Array.isArray(programm.veranstaltungsorte)&&programm.veranstaltungsorte.length?
    programm.veranstaltungsorte:[programm.veranstaltungsort].filter(Boolean);
  const ort=orte.find(name=>Array.from(standortAuswahl.options).some(option=>option.value===name));
  if(!ort)return;
  standortAuswahl.value=ort;
  standortAuswahl.dispatchEvent(new Event('change',{bubbles:true}));
  angebotAuswahl.value=programm.name;
  angebotAuswahl.dispatchEvent(new Event('change',{bubbles:true}));
}
function dauerFuer(teilnehmer,angebotName){
  const programm=angeboteCache.find(a=>a.name===angebotName);
  const anzahl=Number(teilnehmer),basis=Number(programm?.dauer);
  if(!Number.isInteger(anzahl)||anzahl<1||!Number.isFinite(basis)||basis<15)return 150;
  if(programm?.dauer_modus==='fest')return basis;
  if(Array.isArray(programm?.gruppenstufen)&&programm.gruppenstufen.length){
    const stufe=programm.gruppenstufen.find(item=>anzahl>=Number(item.min)&&anzahl<=Number(item.max));
    return stufe?Number(stufe.dauer):null;
  }
  const faktor=anzahl<=4?0.6:anzahl<=10?1:anzahl<=15?1.2:anzahl<=20?1.4:1.6;
  return Math.max(15,Math.round((basis*faktor)/5)*5);
}

const buchbareUhrzeiten = [
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
  '19:00'
];

function uhrzeitenAnzeigen() {
  if (!uhrzeitAuswahl) return;

  uhrzeitAuswahl.replaceChildren();

  const platzhalter = document.createElement('option');
  platzhalter.value = '';
  platzhalter.textContent = 'Bitte Anfangszeit auswählen';
  uhrzeitAuswahl.append(platzhalter);

  const zeiten=[...buchbareUhrzeiten];
  if(ausgewaehlteSonderaktion?.datum===date?.value&&/^\d{2}:\d{2}$/.test(ausgewaehlteSonderaktion.uhrzeit||''))
    zeiten.push(ausgewaehlteSonderaktion.uhrzeit);
  [...new Set(zeiten)].sort().forEach(uhrzeit => {
    const option = document.createElement('option');
    option.value = uhrzeit;
    option.textContent = uhrzeit + ' Uhr'+(ausgewaehlteSonderaktion?.uhrzeit===uhrzeit?' · festes Tagesangebot':'');
    uhrzeitAuswahl.append(option);
  });

  uhrzeitHinweis.textContent =
    'Bitte wähle deine gewünschte Anfangszeit.';
}
uhrzeitenAnzeigen();

async function belegteUhrzeitenLaden() {
  if (!uhrzeitAuswahl) return;
  const anfrageId=++verfuegbarkeitsAnfrage;
  if (!date.value) {
    uhrzeitenAnzeigen();
    uhrzeitAuswahl.disabled = true;
    uhrzeitHinweis.textContent = 'Bitte zuerst einen Termin auswählen.';
    return;
  }

  const datum = date.value;
  if(datumIstGesperrt(datum)){
    uhrzeitenAnzeigen();
    uhrzeitAuswahl.disabled=true;
    uhrzeitHinweis.textContent='Dieser Tag ist gesperrt. Bitte wähle ein anderes Datum.';
    return;
  }
  const teilnehmer = Number(
    document.getElementById('buchungs-teilnehmer')?.value
  );
  const angebot=angebotAuswahl?.value;
  const teilnehmerWert=document.getElementById('buchungs-teilnehmer')?.value;
  if(!angebot){
    uhrzeitenAnzeigen();
    uhrzeitAuswahl.disabled=true;
    uhrzeitHinweis.textContent='Bitte zuerst Standort und Angebot auswählen.';
    return;
  }
  const vorherigeAuswahl = uhrzeitAuswahl.value;

  uhrzeitHinweis.textContent = 'Freie Uhrzeiten werden geprüft …';
  uhrzeitAuswahl.disabled = true;

  try {
    const antwort = await fetch(
      '/api/belegte-zeiten?datum=' + encodeURIComponent(datum) +
      '&teilnehmer=' + encodeURIComponent(teilnehmer) +
      '&angebot=' + encodeURIComponent(angebot) +
      '&standort=' + encodeURIComponent(standortAuswahl?.value||'')+
      (qrAnmeldung?'&zugang=jh-brilon':'')+
      (ausgewaehlteSonderaktion?.sonderaktion_id?'&sonderaktion_id='+encodeURIComponent(ausgewaehlteSonderaktion.sonderaktion_id):'')
    );

    if (!antwort.ok) throw new Error('Verfügbarkeit nicht abrufbar');

    const daten = await antwort.json();

    if (anfrageId!==verfuegbarkeitsAnfrage || date.value!==datum ||
        angebotAuswahl?.value!==angebot ||
        document.getElementById('buchungs-teilnehmer')?.value!==teilnehmerWert ||
        datumIstGesperrt(datum)) return;

    // Der Server prüft jedes auswählbare Startfenster gegen die belegten Zeiträume.
    const belegteZeiten = new Set(
      daten.zeiten.filter(eintrag => eintrag.belegt)
        .map(eintrag => eintrag.uhrzeit)
    );
    const platzDaten=new Map(daten.zeiten.filter(e=>Number.isInteger(e.freie_plaetze))
      .map(e=>[e.uhrzeit,e]));

    uhrzeitenAnzeigen();

    for (const option of uhrzeitAuswahl.options) {
      if (belegteZeiten.has(option.value)) {
        option.disabled = true;
        option.textContent = option.value + ' Uhr – Belegt';
      }else if(platzDaten.has(option.value)){
        const platz=platzDaten.get(option.value);
        const status=platz.angemeldet>=platz.mindestteilnehmer
          ?`${platz.angemeldet} angemeldet`
          :`${platz.angemeldet}/${platz.mindestteilnehmer} angemeldet`;
        option.textContent=`${option.value} Uhr · ${platz.folgegruppe?'Folgegruppe möglich · ':`noch ${platz.freie_plaetze} Plätze · `}${status}`;
      }
    }

    if (vorherigeAuswahl &&
        !belegteZeiten.has(vorherigeAuswahl)) {
      uhrzeitAuswahl.value = vorherigeAuswahl;
    }

    uhrzeitHinweis.textContent =
      'Belegte Anfangszeiten sind nicht auswählbar. ' +
      'Die endgültige Verfügbarkeit wird beim Absenden geprüft.';

    if (typeof buchungsdauerBerechnen === 'function') {
      buchungsdauerBerechnen();
    }
  } catch (fehler) {
    if(anfrageId!==verfuegbarkeitsAnfrage)return;
    uhrzeitenAnzeigen();
    uhrzeitHinweis.textContent =
      'Verfügbarkeit derzeit nicht abrufbar. ' +
      'Bitte versuche es später erneut.';
    uhrzeitAuswahl.disabled = true;
  } finally {
    if (anfrageId===verfuegbarkeitsAnfrage &&
        date.value===datum && angebotAuswahl?.value===angebot &&
        document.getElementById('buchungs-teilnehmer')?.value===teilnehmerWert &&
        !datumIstGesperrt(datum) &&
        !uhrzeitHinweis.textContent.includes('nicht abrufbar')) {
      uhrzeitAuswahl.disabled = false;
    }
  }
}

const teilnehmerEingabe = document.getElementById('buchungs-teilnehmer');
const dauerAnzeige = document.getElementById('buchungs-dauer');
const endzeitAnzeige = document.getElementById('buchungs-endzeit');

function buchungsdauerBerechnen() {
  if (!teilnehmerEingabe || !dauerAnzeige) return;

  const anzahl = Number(teilnehmerEingabe.value);
  const dauer=dauerFuer(anzahl,angebotAuswahl?.value);
  if(!Number.isInteger(dauer)||dauer<15){dauerAnzeige.textContent='Für diese Gruppengröße ist keine Dauerstufe hinterlegt.';if(endzeitAnzeige)endzeitAnzeige.textContent='';return;}

  const dauerMinuten = dauer % 60;
  const stunden = Math.floor(dauer / 60);

  dauerAnzeige.textContent =
    'Voraussichtliche Dauer: ' +
    (stunden ? stunden + ' Std. ' : '') + (dauerMinuten ? dauerMinuten + ' Min.' : '');

  if (endzeitAnzeige) {
    const startzeit = uhrzeitAuswahl?.value;

    if (!startzeit) {
      endzeitAnzeige.textContent =
        'Bitte Anfangszeit auswählen, um die Endzeit zu berechnen.';
    } else {
      const [startStunden, startMinuten] =
        startzeit.split(':').map(Number);

      const endeMinuten =
        startStunden * 60 + startMinuten + dauer;

      const endeStunden = Math.floor(endeMinuten / 60);
      const restMinuten = endeMinuten % 60;

      const endzeit =
        String(endeStunden).padStart(2, '0') + ':' +
        String(restMinuten).padStart(2, '0');

      endzeitAnzeige.textContent =
        'Voraussichtliches Ende: ' + endzeit + ' Uhr';
    }
  }
}

if (teilnehmerEingabe) {
  teilnehmerEingabe.addEventListener('input', buchungsdauerBerechnen);
  teilnehmerEingabe.addEventListener('input', belegteUhrzeitenLaden);
  buchungsdauerBerechnen();
}

if (uhrzeitAuswahl) {
  uhrzeitAuswahl.addEventListener('change', buchungsdauerBerechnen);
}

function datumPruefen() {
  const gewaehltesDatum = date.value;

  if (!gewaehltesDatum) {
    verfuegbarkeit.textContent = '';
    return;
  }

  if (!sperrzeitenGeladen) {
    verfuegbarkeit.textContent =
      'Verfügbarkeit derzeit nicht abrufbar. Wir prüfen deine Anfrage.';
    return;
  }

  const gesperrt=datumIstGesperrt(gewaehltesDatum);

  verfuegbarkeit.textContent = gesperrt
    ? '⛔ Für diesen Tag liegt eine ganztägige Sperrzeit vor.'
    : datumTeilweiseBelegt(gewaehltesDatum)
      ? '◷ Bereits gebuchte Zeitfenster sind belegt. Davor, dazwischen oder danach kannst du freie Zeiten anfragen.'
      : '✓ Für diesen Tag kannst du eine Terminanfrage stellen.';
}

const kalenderBereich = document.getElementById('buchungskalender');
let kalenderMonat = new Date();
kalenderMonat.setDate(1);

function kalenderAnzeigen() {
  if (!kalenderBereich) return;

  kalenderBereich.replaceChildren();

  const kopf = document.createElement('div');
  kopf.className = 'kalender-kopf';

  const zurueck = document.createElement('button');
  zurueck.type = 'button';
  zurueck.textContent = '←';

  const titel = document.createElement('strong');
  titel.textContent = kalenderMonat.toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric'
  });

  const weiter = document.createElement('button');
  weiter.type = 'button';
  weiter.textContent = '→';

  zurueck.onclick = () => {
    const vorherigerMonat = new Date(
      kalenderMonat.getFullYear(),
      kalenderMonat.getMonth() - 1,
      1
    );

    const aktuellerMonat = new Date();
    aktuellerMonat.setDate(1);
    aktuellerMonat.setHours(0, 0, 0, 0);

    if (vorherigerMonat < aktuellerMonat) return;

    kalenderMonat = vorherigerMonat;
    kalenderAnzeigen();
  };

  weiter.onclick = () => {
    kalenderMonat.setMonth(kalenderMonat.getMonth() + 1);
    kalenderAnzeigen();
  };

  kopf.append(zurueck, titel, weiter);
  kalenderBereich.append(kopf);

  const tage = document.createElement('div');
  tage.className = 'kalender-tage';

  for (const name of ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']) {
    const zelle = document.createElement('span');
    zelle.textContent = name;
    zelle.className = 'kalender-wochentag';
    tage.append(zelle);
  }

  const jahr = kalenderMonat.getFullYear();
  const monat = kalenderMonat.getMonth();
  const ersterTag = new Date(jahr, monat, 1);
  const leerfelder = (ersterTag.getDay() + 6) % 7;
  const anzahlTage = new Date(jahr, monat + 1, 0).getDate();

  for (let i = 0; i < leerfelder; i++) {
    tage.append(document.createElement('span'));
  }

  const heute = new Date();
  heute.setHours(0, 0, 0, 0);

  for (let tag = 1; tag <= anzahlTage; tag++) {
    const datumObjekt = new Date(jahr, monat, tag);
    const datumWert =
      jahr + '-' +
      String(monat + 1).padStart(2, '0') + '-' +
      String(tag).padStart(2, '0');

    const gesperrt=datumIstGesperrt(datumWert);
    const teilweiseBelegt=!gesperrt&&datumTeilweiseBelegt(datumWert);

    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.textContent = tag;
    knopf.className = 'kalender-tag';

    if (gesperrt) knopf.classList.add('gesperrt');
    else if (teilweiseBelegt) {
      knopf.classList.add('teilweise-belegt');
      knopf.title='Bereits gebuchte Zeitfenster – andere Uhrzeiten können noch frei sein';
      knopf.setAttribute('aria-label',tag+' teilweise belegt; andere Zeiten können noch frei sein');
    } else if (sperrzeitenGeladen) knopf.classList.add('frei');

    if (date.value === datumWert) {
      knopf.classList.add('ausgewaehlt');
    }

    if (datumObjekt < heute || gesperrt) {
      knopf.disabled = true;
    }

    knopf.onclick = () => {
      date.value = datumWert;
      datumPruefen();
      kalenderAnzeigen();
      belegteUhrzeitenLaden();
    };

    tage.append(knopf);
  }

  kalenderBereich.append(tage);
  const legend=document.createElement('div');
  legend.className='kalender-legende';
  legend.setAttribute('aria-label','Kalenderlegende');
  const legende=[
    ['frei','Freie Termine – Buchungsanfrage möglich'],
    ['teilweise-belegt','Bereits gebuchte Zeitfenster – andere Uhrzeiten können frei sein'],
    ['gesperrt','Sperrzeit – an diesem Tag keine Buchung möglich']
  ];
  for(const [klasse,beschreibung] of legende){
    const item=document.createElement('span');item.className='kalender-legende-eintrag';
    const farbe=document.createElement('i');farbe.className='kalender-legende-farbe '+klasse;farbe.setAttribute('aria-hidden','true');
    const text=document.createElement('span');text.textContent=beschreibung;
    item.append(farbe,text);legend.append(item);
  }
  kalenderBereich.append(legend);
}

kalenderAnzeigen();

date.addEventListener('change', () => {
  if (date.value) {
    const [jahr, monat] = date.value.split('-').map(Number);
    kalenderMonat = new Date(jahr, monat - 1, 1);
  }

  datumPruefen();
  kalenderAnzeigen();
  belegteUhrzeitenLaden();
});

fetch('/api/sperrzeiten')
  .then(antwort => {
    if (!antwort.ok) throw new Error('Nicht erreichbar');
    return antwort.json();
  })
  .then(daten => {
    sperrzeiten = daten;
    sperrzeitenGeladen = true;
    datumPruefen();
    kalenderAnzeigen();
    belegteUhrzeitenLaden();
  })
  .catch(() => {
    sperrzeitenGeladen = false;
    datumPruefen();
  });

const form = document.getElementById('booking');
if(qrAnmeldung){
  const intake=document.getElementById('hostel-qr-intake'),room=document.getElementById('hostel-room-number');
  if(intake)intake.hidden=false;if(room)room.required=true;
  const site=document.getElementById('buchungs-standort');
  if(site){site.value='Jugendherberge Brilon';site.dispatchEvent(new Event('change',{bubbles:true}));}
}
const agbCheckbox=document.getElementById('booking-agb');
const agbStatus=document.getElementById('booking-agb-status');
const agbVersionField=document.createElement('input');
agbVersionField.type='hidden';agbVersionField.name='agbVersion';form.append(agbVersionField);
fetch('/api/agb').then(async response=>{
  const data=await response.json();
  if(!response.ok||!data.aktiv||!data.text||!data.version)throw new Error(data.error||'Geschäftsbedingungen sind noch nicht veröffentlicht.');
  agbVersionField.value=String(data.version);
  document.getElementById('booking-agb-text').textContent=data.text;
  agbStatus.textContent=`Aktuelle Fassung ${data.version}. Du kannst die Bedingungen vor dem Absenden über den Link öffnen.`;
}).catch(error=>{
  agbCheckbox.disabled=true;
  agbStatus.textContent=error.message||'Geschäftsbedingungen konnten nicht geladen werden.';
});
const empfehlungsfeld=document.getElementById('empfehlungsfeld');
const empfehlungBestaetigt=document.getElementById('empfehlung-bestaetigt');
const empfehlungsEmailFeld=document.getElementById('empfehlung-email-feld');
const empfehlungsEmail=document.getElementById('empfehlungsgeber-email');
empfehlungBestaetigt?.addEventListener('change',()=>{
  const aktiv=empfehlungBestaetigt.checked;
  empfehlungsEmailFeld.hidden=!aktiv;empfehlungsEmail.required=aktiv;
  if(!aktiv)empfehlungsEmail.value='';
});
fetch('/api/empfehlungsaktion').then(async response=>{
  const data=await response.json();
  if(!response.ok||!data.aktiv)return;
  document.getElementById('empfehlungstext-kurz').textContent=data.text||'';
  empfehlungsfeld.hidden=false;
}).catch(()=>{});
const gastStatus=form.querySelector('#ist-gast');
const gastEinrichtungFeld=form.querySelector('#gast-einrichtung-feld');
const gastEinrichtung=form.querySelector('#gast-einrichtung');
function gastEingabeAktualisieren(){const ja=gastStatus.value==='ja';gastEinrichtungFeld.hidden=!ja;gastEinrichtung.required=ja;if(!ja)gastEinrichtung.value='';}
gastStatus.addEventListener('change',gastEingabeAktualisieren);
gastEingabeAktualisieren();
const invoiceAddressChoice=form.querySelector('#rechnung-adresse-erforderlich');
const invoiceAddressFields=form.querySelector('#rechnungsanschrift-feld');
const invoiceAddressInputs=['rechnungsFirma','rechnungsStrasse','rechnungsPlz','rechnungsOrt']
  .map(name=>form.elements.namedItem(name));
function invoiceAddressUpdate(){
  const required=Boolean(invoiceAddressChoice?.checked);
  invoiceAddressFields.hidden=!required;
  for(const input of invoiceAddressInputs){
    input.required=required&&input.name!=='rechnungsFirma';
    if(!required)input.value='';
  }
}
invoiceAddressChoice?.addEventListener('change',invoiceAddressUpdate);
invoiceAddressUpdate();

form.addEventListener('submit', async e => {
  e.preventDefault();

  const status = document.getElementById('booking-status');
  const btn = form.querySelector('button[type=submit]');
  const data = Object.fromEntries(new FormData(form).entries());
  if(qrAnmeldung)data.anmeldeweg='jh-brilon-qr';

  status.textContent = 'Anfrage wird gesendet …';
  btn.disabled = true;

  try {
    const res = await fetch('/api/buchungen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const json = await res.json();

    if (!res.ok) {
      throw new Error(json.error || 'Übertragung fehlgeschlagen');
    }

    status.textContent = qrAnmeldung
      ? `✓ Anmeldung eingegangen. Dein Zeitfenster ist vorläufig reserviert${json.buchungsgruppe?' in '+json.buchungsgruppe:''}. Buchungsnummer: ${json.buchungsnummer}. Wir melden uns bei dir.`
      : json.einzelplatz
      ? `✓ Platz reserviert. Buchungsnummer: ${json.buchungsnummer}. Keine Anzahlung erforderlich. Der Termin findet ab ${json.mindestteilnehmer} Anmeldungen statt.` + (data.empfehlungBestaetigt==='on'?' Die Verwaltung kann die Buchung erst bestätigen, nachdem der Empfehlungsgeber den Bestätigungslink per E-Mail angeklickt hat.':'')
      : '✓ BUCHUNGSANFRAGE ERFOLGREICH! Deine Buchungsnummer: ' + json.buchungsnummer + '. Dein gewünschter Termin wurde vorläufig reserviert. Wir melden uns persönlich bei dir.' + (data.empfehlungBestaetigt==='on'?' Die Verwaltung kann die Buchung erst bestätigen, nachdem der Empfehlungsgeber den Bestätigungslink per E-Mail angeklickt hat.':'');

    status.style.color = '#167c3a';
    status.style.fontWeight = 'bold';
    status.style.fontSize = '1.15rem';
    status.style.padding = '18px';
    status.style.border = '2px solid #167c3a';
    status.style.borderRadius = '10px';
    status.style.backgroundColor = '#e8f7ec';

    status.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });

    form.reset();
    sonderaktionsPrefix='';
    const angebotHinweis=document.getElementById('selected-special');
    if(angebotHinweis)angebotHinweis.hidden=true;
    ausgewaehlteSonderaktion=null;
    const specialId=form.querySelector('input[name="sonderaktion_id"]');if(specialId)specialId.value='';
    const participants=document.getElementById('buchungs-teilnehmer');if(participants)participants.readOnly=false;
  } catch (err) {
    status.textContent = '⚠ Buchung nicht möglich: ' + err.message;
    status.style.color = '#a61b1b';
    status.style.fontWeight = 'bold';
    status.style.fontSize = '1.15rem';
    status.style.padding = '18px';
    status.style.border = '2px solid #a61b1b';
    status.style.borderRadius = '10px';
    status.style.backgroundColor = '#fff0f0';

    status.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  } finally {
    btn.disabled = false;
  }
});

// Öffentliche Tagesaktion: Nur eine unverbindliche Anfrage vorbereiten.
// Es gibt keine automatische Rabatt-/Preis-Zusage oder verbindliche Reservierung.
function sonderaktionAnfragen(aktion){
  const nachricht=form.querySelector('textarea[name="nachricht"]');
  const hinweis=document.getElementById('selected-special');
  if(!nachricht||!hinweis)return;
  const titel=String(aktion.titel||'').trim().slice(0,120);
  if(!titel)return;
  const exactSlot=Boolean(aktion.uhrzeit&&aktion.endzeit&&aktion.veranstaltungsort&&aktion.programm_id);
  ausgewaehlteSonderaktion=exactSlot?aktion:null;
  let specialInput=form.querySelector('input[name="sonderaktion_id"]');
  if(!specialInput){specialInput=document.createElement('input');specialInput.type='hidden';specialInput.name='sonderaktion_id';form.append(specialInput);}
  specialInput.value=exactSlot?(aktion.sonderaktion_id||''):'';
  const datumswert=typeof aktion.datum==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(aktion.datum)?
    aktion.datum:'';
  const prefix='Anfrage zur Sonderaktion: '+titel+
    (datumswert?' (Termin: '+datumswert+')':'')+'\n';
  // Replace only the prefix inserted by us. Preserve personal wishes.
  let rest=nachricht.value;
  if(sonderaktionsPrefix&&rest.startsWith(sonderaktionsPrefix))
    rest=rest.slice(sonderaktionsPrefix.length);
  nachricht.value=(prefix+rest).slice(0,2000);
  sonderaktionsPrefix=prefix;

  // Programme are explicitly assigned in administration using their stable ID.
  // An equal or similar title is never sufficient to associate a booking.
  const programm=aktion.programm_id==null?null:
    angeboteCache.find(a=>String(a.id)===String(aktion.programm_id));
  // A special action can be independent of the programme catalogue. Avoid
  // silently retaining a programme selected for an earlier special.
  if(standortAuswahl){
    standortAuswahl.value=aktion.veranstaltungsort||programm?.veranstaltungsort||'';
    standortAuswahl.dispatchEvent(new Event('change',{bubbles:true}));
  }
  angebotAuswahl.value=programm?.name||'';
  angebotAuswahl.dispatchEvent(new Event('change',{bubbles:true}));
  const participants=document.getElementById('buchungs-teilnehmer');
  if(participants&&Number.isInteger(Number(aktion.teilnehmer))&&Number(aktion.teilnehmer)>0){
    participants.value=String(Number(aktion.teilnehmer));participants.readOnly=true;
    participants.dispatchEvent(new Event('input',{bubbles:true}));
  }
  const verfuegbar=programm?.verfuegbare_termine;
  const tagFreigegeben=!Array.isArray(verfuegbar)||!verfuegbar.length||
    verfuegbar.includes(datumswert);
  if(datumswert&&datumswert>=buchungstagInBerlin()&&tagFreigegeben){
    date.value=datumswert;
    date.dispatchEvent(new Event('change',{bubbles:true}));
  }
  uhrzeitenAnzeigen();

  hinweis.hidden=false;
  hinweis.textContent='Ausgewählte Sonderaktion: '+titel+
    (datumswert?' · '+datumswert:'')+
    (aktion.uhrzeit?' · fester Zeitraum '+aktion.uhrzeit+'–'+(aktion.endzeit||'')+' Uhr':'')+
    (aktion.veranstaltungsort?' · '+aktion.veranstaltungsort:'')+
    (programm?' · verknüpftes Programm: '+programm.name:
      ' · noch kein buchbares Programm verknüpft. Bitte Programm auswählen oder uns kontaktieren.')+
    ' Preis und Verfügbarkeit werden erst nach Prüfung der Anfrage bestätigt.';
  form.scrollIntoView({behavior:'smooth',block:'start'});
  nachricht.focus({preventScroll:true});
}

// Veröffentlichung für WhatsApp vorbereitet: Der Kunde bzw. die Verwaltung entscheidet,
 // wann und an welchen Chat ein Angebot geschickt wird. Kein automatischer Massenversand.
function whatsappTeilLink(titel,hinweise,ziel){
  const url=new URL(ziel,window.location.origin).href;
  const nachricht='Klettern & Abenteuer: '+titel+'\n'+hinweise+'\nJetzt auf der Webseite das reguläre Buchungsformular nutzen: '+url+'\nTermine, Preise und Verfügbarkeit werden bei der Buchungsanfrage geprüft.';
  return 'https://api.whatsapp.com/send?text='+encodeURIComponent(nachricht);
}
function whatsappTeilButton(titel,hinweise,ziel){
  const link=document.createElement('a');
  link.href=whatsappTeilLink(titel,hinweise,ziel);
  link.target='_blank';link.rel='noopener noreferrer';
  link.className='whatsapp-share-link';
  link.textContent='Über WhatsApp teilen';
  link.setAttribute('aria-label',titel+' über WhatsApp teilen');
  return link;
}

// Tages- und Sonderangebote
async function specials() {
  const root = document.getElementById('specials');

  try {
    const r = await fetch('/api/aktionen');
    if (!r.ok) throw Error();

    const items = await r.json();
    if(!Array.isArray(items))throw Error('Ungültige Sonderangebote');
    geladeneAktionen=items;
    angebotslinkAnwenden();
    root.replaceChildren();

    if (!items.length) {
      const p = document.createElement('p');
      p.textContent =
        'Neue Sonderangebote werden hier veröffentlicht. Frage gerne nach freien Terminen!';
      root.append(p);
    }

    for (const item of items) {
      const a = document.createElement('article');

      if (item.bild_url) {
        const bild = document.createElement('img');
        bild.src = item.bild_url;
        bild.alt = item.titel;
        bild.loading = 'lazy';
        bild.style.width = '100%';
        bild.style.aspectRatio = '4 / 3';
        bild.style.objectFit = 'cover';
        bild.style.borderRadius = '10px';
        bild.style.marginBottom = '12px';
        a.append(bild);
      }

      const h = document.createElement('h3');
      h.textContent = item.titel;

      const d = document.createElement('p');
      d.textContent = item.datum || 'Termin nach Vereinbarung';
      if(item.uhrzeit)d.textContent+=' · '+item.uhrzeit+'–'+(item.endzeit||'')+' Uhr';
      if(item.veranstaltungsort)d.textContent+=' · '+item.veranstaltungsort;

      const t = document.createElement('p');
      t.textContent = item.beschreibung || '';

      const preisAnzeige = document.createElement('p');

if (item.preis !== undefined && item.preis !== null && item.preis !== '') {
  const preis = Number(String(item.preis).replace(',', '.'));

  preisAnzeige.textContent = Number.isFinite(preis)
    ? 'Aktionspreis (vorbehaltlich Bestätigung): ' + preis.toLocaleString('de-DE', {
        style: 'currency',
        currency: 'EUR'
      })
    : 'Preis auf Anfrage';
} else {
  preisAnzeige.textContent = 'Preis auf Anfrage';
}
      a.append(h, d, t, preisAnzeige);
      const anfrageButton = document.createElement('a');
anfrageButton.href = '#buchung';
anfrageButton.className = 'btn';
anfrageButton.textContent = 'Diese Aktion anfragen';
anfrageButton.addEventListener('click',()=>sonderaktionAnfragen(item));
anfrageButton.style.display = 'inline-block';
anfrageButton.style.marginTop = '12px';

a.append(anfrageButton);
      const shareInfo=[d.textContent,t.textContent].filter(Boolean).join(' · ');
      a.append(whatsappTeilButton(item.titel,shareInfo,item.id!=null?angebotBuchungslink('aktion',item.id):'/#buchung'));
      root.append(a);
    }
  } catch {
    root.textContent = 'Sonderangebote derzeit nicht abrufbar.';
  }
}

specials();

function angeboteUebersichtAnzeigen(standortFilter=''){
  const ausgabe=document.getElementById('angebote-uebersicht');
  if(!ausgabe)return;
  const einleitung=document.getElementById('angebote-einleitung');
  const standortStatus=document.getElementById('standortwahl-status');
  const alleStandorte=!standortFilter||standortFilter==='alle';
  if(einleitung)einleitung.textContent=alleStandorte
    ?'Alle buchbaren Programme unserer Standorte. Wähle oben einen Standort, um die Auswahl einzugrenzen.'
    :'Diese Programme können am Standort '+standortFilter+' angefragt werden.';
  const standortAngebote=alleStandorte?angeboteCache:angeboteCache.filter(angebot=>
    (Array.isArray(angebot.veranstaltungsorte)&&angebot.veranstaltungsorte.length
      ?angebot.veranstaltungsorte:[angebot.veranstaltungsort]).includes(standortFilter));
  if(standortStatus)standortStatus.textContent=(alleStandorte?'Alle Standorte':standortFilter)
    +': '+standortAngebote.length+' buchbare Programm'+(standortAngebote.length===1?'':'e')+' verfügbar.';
  const passend=standortAngebote.filter(angebot=>
    !window.besuchergruppePasst||window.besuchergruppePasst(angebot));
  const filterhinweis=document.getElementById('besuchergruppen-filterhinweis');
  if(filterhinweis){
    filterhinweis.replaceChildren();
    const gruppenname=window.besuchergruppeName?.();
    filterhinweis.hidden=!gruppenname;
    if(gruppenname){
      const label=document.createElement('span');
      label.textContent='Angebote für: '+gruppenname;
      const clear=document.createElement('button');
      clear.type='button';clear.textContent='Alle Besuchergruppen anzeigen';
      clear.addEventListener('click',()=>window.besuchergruppeZuruecksetzen?.());
      filterhinweis.append(label,clear);
    }
  }
  ausgabe.replaceChildren();
  if(!passend.length){
    const hinweis=document.createElement('p');
    hinweis.className='hint';
    hinweis.textContent=window.aktiveBesuchergruppe
      ?'Für diese Besuchergruppe gibt es in der aktuellen Standortauswahl keine passenden buchbaren Programme. Du kannst den Gruppenfilter zurücksetzen.'
      :alleStandorte
        ?'Derzeit sind keine veröffentlichten buchbaren Programme verfügbar.'
        :'Für diesen Standort sind derzeit keine veröffentlichten buchbaren Programme verfügbar.';
    ausgabe.append(hinweis);
    return;
  }
  passend.forEach((angebot,index)=>{
    const karte=document.createElement('article');
    karte.className='besuchergruppe-karte angebote-karte';
    karte.style.setProperty('--karten-index',String(index));
    karte.style.setProperty('--gruppe-farbe','#258451');
    const angebotOrte=Array.isArray(angebot.veranstaltungsorte)&&angebot.veranstaltungsorte.length
      ?angebot.veranstaltungsorte:[angebot.veranstaltungsort].filter(Boolean);
    const meta=!alleStandorte?'Standort: '+standortFilter:
      angebotOrte.length?`Standorte: ${angebotOrte.join(', ')}`:'';
    if(angebot.bild_url){
      const bild=document.createElement('img');
      bild.src=angebot.bild_url;
      bild.alt='Erlebnisbild: '+angebot.name;
      bild.loading='lazy';
      bild.width=640;bild.height=360;
      bild.className='besuchergruppe-bild';
      bild.addEventListener('error',()=>{
        const fallback=document.createElement('div');
        fallback.className='besuchergruppe-bild angebote-programm-bild-fallback';
        fallback.setAttribute('aria-hidden','true');
        fallback.textContent='🧗';
        bild.replaceWith(fallback);
      },{once:true});
      karte.append(bild);
    }else{
      const fallback=document.createElement('div');
      fallback.className='besuchergruppe-bild angebote-programm-bild-fallback';
      fallback.setAttribute('aria-hidden','true');
      fallback.textContent='🧗';
      karte.append(fallback);
    }
    const inhalt=document.createElement('div');
    inhalt.className='besuchergruppe-inhalt';
    const kopf=document.createElement('div');
    kopf.className='besuchergruppe-head';
    const symbol=document.createElement('span');
    symbol.className='besuchergruppe-symbol';
    symbol.setAttribute('aria-hidden','true');
    symbol.textContent='🧗';
    const titel=document.createElement('h3');
    titel.className='besuchergruppe-titel';
    titel.textContent=angebot.name;
    kopf.append(symbol,titel);
    inhalt.append(kopf);
    if(angebot.beschreibung){
      const beschreibung=document.createElement('p');
      beschreibung.className='besuchergruppe-beschreibung';
      beschreibung.textContent=angebot.beschreibung;
      inhalt.append(beschreibung);
    }
    if(meta){
      const details=documen