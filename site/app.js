document.getElementById('year').textContent=new Date().getFullYear();const date=document.querySelector('input[name=datum]');date.min=new Date().toLocaleDateString('en-CA');

const verfuegbarkeit = document.getElementById('datum-verfuegbarkeit');
let sperrzeiten = [];
let sperrzeitenGeladen = false;
const uhrzeitAuswahl = document.getElementById('buchungs-uhrzeit');
const uhrzeitHinweis = document.getElementById('uhrzeit-hinweis');

const buchbareUhrzeiten = [
  '09:00',
  '10:00',
  '11:00',
  '13:00',
  '14:00',
  '15:00'
];

function uhrzeitenAnzeigen() {
  if (!uhrzeitAuswahl) return;

  uhrzeitAuswahl.replaceChildren();

  const platzhalter = document.createElement('option');
  platzhalter.value = '';
  platzhalter.textContent = 'Bitte Anfangszeit auswählen';
  uhrzeitAuswahl.append(platzhalter);

  buchbareUhrzeiten.forEach(uhrzeit => {
    const option = document.createElement('option');
    option.value = uhrzeit;
    option.textContent = uhrzeit + ' Uhr';
    uhrzeitAuswahl.append(option);
  });

  uhrzeitHinweis.textContent =
    'Bitte wähle deine gewünschte Anfangszeit.';
}
uhrzeitenAnzeigen();
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

  const gesperrt = sperrzeiten.some(eintrag =>
    gewaehltesDatum >= eintrag.datum &&
    gewaehltesDatum <= eintrag.enddatum
  );

  verfuegbarkeit.textContent = gesperrt
    ? '⛔ Dieser Tag ist gesperrt. Bitte wähle ein anderes Datum.'
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

    const gesperrt = sperrzeitenGeladen &&
      sperrzeiten.some(eintrag =>
        datumWert >= eintrag.datum &&
        datumWert <= eintrag.enddatum
      );

    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.textContent = tag;
    knopf.className = 'kalender-tag';

    if (gesperrt) knopf.classList.add('gesperrt');
    else if (sperrzeitenGeladen) knopf.classList.add('frei');

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
    };

    tage.append(knopf);
  }

  kalenderBereich.append(tage);
}

kalenderAnzeigen();


date.addEventListener('change', () => {
  if (date.value) {
    const [jahr, monat] = date.value.split('-').map(Number);
    kalenderMonat = new Date(jahr, monat - 1, 1);
  }

  datumPruefen();
  kalenderAnzeigen();
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
  })
  .catch(() => {
    sperrzeitenGeladen = false;
    datumPruefen();
  });

const form=document.getElementById('booking');form.addEventListener('submit',async e=>{e.preventDefault();const status=document.getElementById('booking-status');const btn=form.querySelector('button[type=submit]');const data=Object.fromEntries(new FormData(form).entries());status.textContent='Anfrage wird gesendet …';btn.disabled=true;try{const res=await fetch('/api/buchungen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const json=await res.json();if(!res.ok)throw new Error(json.error||'Übertragung fehlgeschlagen');status.textContent='Vielen Dank! Deine Anfrage wurde gespeichert. Wir melden uns persönlich.';form.reset()}catch(err){status.textContent='Anfrage konnte nicht gespeichert werden: '+err.message}finally{btn.disabled=false}});async function specials(){const root=document.getElementById('specials');try{const r=await fetch('/api/aktionen');if(!r.ok)throw Error();const items=await r.json();root.replaceChildren();if(!items.length){const p=document.createElement('p');p.textContent='Neue Sonderangebote werden hier veröffentlicht. Frage gerne nach freien Terminen!';root.append(p)}for(const item of items){const a=document.createElement('article');const h=document.createElement('h3');h.textContent=item.titel;const d=document.createElement('p');d.textContent=item.datum||'Termin nach Vereinbarung';const t=document.createElement('p');t.textContent=item.beschreibung||'';a.append(h,d,t);root.append(a)}}catch{root.textContent='Sonderangebote derzeit nicht abrufbar.'}}specials();
