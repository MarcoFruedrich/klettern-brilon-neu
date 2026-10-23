
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

async function belegteUhrzeitenLaden() {
  if (!uhrzeitAuswahl || !date.value) return;

  const datum = date.value;
  const teilnehmer = Number(
    document.getElementById('buchungs-teilnehmer')?.value
  );

  const dauer =
    teilnehmer >= 5 && teilnehmer <= 10 ? 150 :
    teilnehmer >= 11 && teilnehmer <= 15 ? 180 :
    teilnehmer >= 16 && teilnehmer <= 20 ? 210 : null;

  const vorherigeAuswahl = uhrzeitAuswahl.value;

  uhrzeitHinweis.textContent = 'Freie Uhrzeiten werden geprüft …';
  uhrzeitAuswahl.disabled = true;

  try {
    const antwort = await fetch(
      '/api/belegte-zeiten?datum=' + encodeURIComponent(datum) +
      '&teilnehmer=' + encodeURIComponent(teilnehmer)
    );

    if (!antwort.ok) throw new Error('Verfügbarkeit nicht abrufbar');

    const daten = await antwort.json();

    if (date.value !== datum) return;

    // Die bisherige Serverabfrage liefert einzelne belegte Startzeiten.
    // Für eine vollständige Überschneidungsprüfung benötigen wir
    // zusätzlich die Anfangs- und Endzeiten aller Reservierungen.
    // Bis dahin zeigen wir nur die direkt gemeldeten Belegungen an.
    const belegteZeiten = new Set(
      daten.zeiten.filter(eintrag => eintrag.belegt)
        .map(eintrag => eintrag.uhrzeit)
    );

    uhrzeitenAnzeigen();

    for (const option of uhrzeitAuswahl.options) {
      if (belegteZeiten.has(option.value)) {
        option.disabled = true;
        option.textContent = option.value + ' Uhr – Belegt';
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
    uhrzeitenAnzeigen();
    uhrzeitHinweis.textContent =
      'Verfügbarkeit derzeit nicht abrufbar. ' +
      'Bitte versuche es später erneut.';
    uhrzeitAuswahl.disabled = true;
  } finally {
    if (date.value === datum &&
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
  let dauer = null;

  if (anzahl >= 5 && anzahl <= 10) {
    dauer = 150;
  } else if (anzahl >= 11 && anzahl <= 15) {
    dauer = 180;
  } else if (anzahl >= 16 && anzahl <= 20) {
    dauer = 210;
  }

  if (dauer === null) {
    dauerAnzeige.textContent =
      'Individuelle Anfrage – Dauer nach Absprache';

    if (endzeitAnzeige) endzeitAnzeige.textContent = '';
    return;
  }

  const stunden = Math.floor(dauer / 60);
  const minuten = dauer % 60;

  dauerAnzeige.textContent =
    'Voraussichtliche Dauer: ' +
    stunden + (minuten ? ',5' : '') + ' Stunden';

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
      belegteUhrzeitenLaden();
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

const form = document.getElementById('booking');

form.addEventListener('submit', async e => {
  e.preventDefault();

  const status = document.getElementById('booking-status');
  const btn = form.querySelector('button[type=submit]');
  const data = Object.fromEntries(new FormData(form).entries());

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

    status.textContent =
      '✓ BUCHUNGSANFRAGE ERFOLGREICH! Dein gewünschter Termin wurde vorläufig reserviert. Vielen Dank für deine Anfrage bei Klettern & Abenteuer Brilon! Wir melden uns persönlich bei dir.';

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

// Tages- und Sonderangebote
async function specials() {
  const root = document.getElementById('specials');

  try {
    const r = await fetch('/api/aktionen');
    if (!r.ok) throw Error();

    const items = await r.json();
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

      const t = document.createElement('p');
      t.textContent = item.beschreibung || '';

      const preisAnzeige = document.createElement('p');

if (item.preis !== undefined && item.preis !== null && item.preis !== '') {
  const preis = Number(String(item.preis).replace(',', '.'));

  preisAnzeige.textContent = Number.isFinite(preis)
    ? 'Preis: ' + preis.toLocaleString('de-DE', {
        style: 'currency',
        currency: 'EUR'
      })
    : 'Preis auf Anfrage';
} else {
  preisAnzeige.textContent = 'Preis auf Anfrage';
}
      a.append(h, d, t, preisAnzeige);
      root.append(a);
    }
  } catch {
    root.textContent = 'Sonderangebote derzeit nicht abrufbar.';
  }
}

specials();

async function angeboteLaden() {
  const auswahl = document.getElementById('angebot-auswahl');
  if (!auswahl) return;

  try {
    const res = await fetch('/api/angebote');
    if (!res.ok) throw new Error('Angebote nicht erreichbar');

    const angebote = await res.json();

    for (const angebot of angebote) {
      const option = document.createElement('option');
      option.value = angebot.name;
      option.textContent = angebot.name;
      auswahl.appendChild(option);
    }
  } catch (fehler) {
    console.error('Erlebnisangebote konnten nicht geladen werden:', fehler);
  }
}

angeboteLaden();

async function preisanzeigeStarten() {
  const auswahl = document.getElementById('angebot-auswahl');
  const teilnehmer = document.getElementById('buchungs-teilnehmer');
  const anzeige = document.getElementById('angebots-preis');
  const bildAnzeige = document.getElementById('angebots-bildanzeige');

  if (!auswahl || !teilnehmer || !anzeige) return;

  try {
    const res = await fetch('/api/angebote');
    if (!res.ok) throw new Error('Preise nicht erreichbar');

    const angebote = await res.json();

    function preisAktualisieren() {
      const angebot = angebote.find(a => a.name === auswahl.value);
      const anzahl = Number(teilnehmer.value);

      anzeige.textContent = '';

      if (!angebot) return;
      bildAnzeige.innerHTML = '';

      if (angebot.bild_url) {
        const foto = document.createElement('img');
        foto.src = angebot.bild_url;
        foto.alt = angebot.name;
        foto.style.width = '100%';
        foto.style.maxWidth = '450px';
        foto.style.aspectRatio = '4 / 3';
        foto.style.objectFit = 'cover';
        foto.style.objectPosition = 'center';
        foto.style.borderRadius = '10px';
        foto.style.marginBottom = '12px';
        foto.style.display = 'block';

        bildAnzeige.appendChild(foto);
      }

      if (angebot.beschreibung) {
        const beschreibung = document.createElement('p');
        beschreibung.textContent = angebot.beschreibung;
        bildAnzeige.appendChild(beschreibung);
      }

      let gruppe = '';

      if (anzahl >= 5 && anzahl <= 10) gruppe = '5-10';
      else if (anzahl <= 15 && anzahl >= 11) gruppe = '11-15';
      else if (anzahl <= 20 && anzahl >= 16) gruppe = '16-20';

      const preis = angebot.preise?.[gruppe];

      if (preis !== undefined && preis !== null) {
        anzeige.textContent = 'Gruppenpreis: ' +
          Number(preis).toLocaleString('de-DE', {
            style: 'currency',
            currency: 'EUR'
          });
      } else {
        anzeige.textContent = 'Preis auf Anfrage';
      }
    }

    auswahl.addEventListener('change', preisAktualisieren);
    teilnehmer.addEventListener('input', preisAktualisieren);
    preisAktualisieren();

  } catch (fehler) {
    console.error('Preisanzeige:', fehler);
  }
}

preisanzeigeStarten();
