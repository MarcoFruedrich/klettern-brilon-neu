
const login = document.getElementById('login');
const workspace = document.getElementById('workspace');
const status = document.getElementById('status');

async function api(path, options = {}) {
  const r = await fetch(path, {
    credentials: 'same-origin',
    ...options
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error || 'Fehler');
  return j;
}

function el(tag, text = '') {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}

const statusNamen = {
  offen: 'Offen',
  bestaetigt: 'Bestätigt',
  abgelehnt: 'Abgelehnt',
  storniert: 'Storniert'
};

async function refresh() {
  try {
    const bookings = await api('/api/admin/buchungen');

    login.hidden = true;
    workspace.hidden = false;
    
    await erlebnisangeboteLaden();

    const box = document.getElementById('bookings');
    box.replaceChildren();

    if (!bookings.length) {
      box.append(el('p', 'Noch keine Buchungsanfragen.'));
    }

    for (const b of bookings) {
      const c = el('div');
      c.className = 'booking';

      c.append(
        el('strong', (b.data.name || 'Unbekannt') + ' – ' + (b.data.datum || ''))
      );

      for (const k of [
        'angebot', 'teilnehmer', 'uhrzeit',
        'email', 'telefon', 'nachricht'
      ]) {
        if (b.data[k]) {
          c.append(el('p', k + ': ' + b.data[k]));
        }
      }

      c.append(
        el('small', 'Eingegangen: ' +
          new Date(b.created_at).toLocaleString('de-DE'))
      );

      const gesamtpreis = Number(b.data.gesamtpreis);
let zahlungsstatus = b.data.zahlungsstatus || 'offen';

if (Number.isFinite(gesamtpreis) && gesamtpreis >= 0) {

  const erhalten =
    zahlungsstatus === 'vollstaendig' ? gesamtpreis :
    zahlungsstatus === 'anzahlung' ? Math.round(gesamtpreis * 25) / 100 :
    0;

  const restbetrag = Math.round((gesamtpreis - erhalten) * 100) / 100;

  const euro = wert => wert.toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR'
  });

  const zahlungsInfo = el('div');
  zahlungsInfo.style.padding = '12px';
  zahlungsInfo.style.margin = '12px 0';
  zahlungsInfo.style.background = '#f1f5f9';
  zahlungsInfo.style.borderRadius = '8px';

  zahlungsInfo.append(
    el('p', 'Gesamtpreis: ' + euro(gesamtpreis)),
    el('p', 'Zahlung erhalten: ' + euro(erhalten)),
    el('p', 'Offener Restbetrag: ' + euro(restbetrag))
  );

  c.append(zahlungsInfo);
}
      const statusZeile = el(
        'p',
        'Bearbeitungsstatus: ' + (statusNamen[b.status] || 'Offen')
      );
      statusZeile.style.fontWeight = 'bold';
      c.append(statusZeile);

      const statusLabel = el('label', 'Status ändern');
      statusLabel.style.display = 'block';
      statusLabel.style.marginTop = '15px';

      const auswahl = document.createElement('select');
      auswahl.style.width = '100%';
      auswahl.style.padding = '12px';
      auswahl.style.margin = '8px 0 15px';

      for (const [wert, name] of Object.entries(statusNamen)) {
        const option = document.createElement('option');
        option.value = wert;
        option.textContent = name;
        auswahl.append(option);
      }

      auswahl.value = b.status || 'offen';
      c.append(statusLabel, auswahl);

      const zahlungsLabel = el('label', 'Zahlungsstatus');
zahlungsLabel.style.display = 'block';
zahlungsLabel.style.marginTop = '15px';

const zahlungsAuswahl = document.createElement('select');
zahlungsAuswahl.style.width = '100%';
zahlungsAuswahl.style.padding = '12px';
zahlungsAuswahl.style.margin = '8px 0 15px';

[
  ['offen', 'Noch keine Zahlung erhalten'],
  ['anzahlung', '25 % Anzahlung erhalten – 75 % vor Ort offen'],
  ['vollstaendig', '100 % vollständig bezahlt']
].forEach(([wert, bezeichnung]) => {
  const option = document.createElement('option');
  option.value = wert;
  option.textContent = bezeichnung;
  zahlungsAuswahl.append(option);
});

zahlungsAuswahl.value = b.data.zahlungsstatus || 'offen';
c.append(zahlungsLabel, zahlungsAuswahl);
      const notizLabel = el('label', 'Interne Bearbeitungsnotiz');
      notizLabel.style.display = 'block';

      const notiz = document.createElement('textarea');
      notiz.value = b.bearbeitungsnotiz || '';
      notiz.maxLength = 2000;
      notiz.rows = 3;
      notiz.placeholder = 'Zum Beispiel: Rückruf vereinbart';
      notiz.style.width = '100%';
      notiz.style.boxSizing = 'border-box';
      notiz.style.padding = '12px';
      notiz.style.margin = '8px 0 15px';

      c.append(notizLabel, notiz);

      const speichern = el('button', 'Änderungen speichern');
      speichern.type = 'button';

      const meldung = el('p');
      meldung.setAttribute('role', 'status');

     speichern.onclick = async () => {
  speichern.disabled = true;
  meldung.textContent = 'Speichern läuft ...';

  try {
    const ergebnis = await api('/api/admin/buchungen/' + b.id, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: auswahl.value,
        bearbeitungsnotiz: notiz.value,
        zahlungsstatus: zahlungsAuswahl.value
      })
    });

    b.status = ergebnis.status;
    b.bearbeitungsnotiz = notiz.value;
    b.data.zahlungsstatus = zahlungsAuswahl.value;
    auswahl.value = b.status;

    statusZeile.textContent =
      'Bearbeitungsstatus: ' + statusNamen[b.status];

    meldung.textContent = 'Änderungen gespeichert.';
  } catch (err) {
    meldung.textContent = 'Fehler: ' + err.message;
  } finally {
    speichern.disabled = false;
  }
};
    
const loeschen = el('button', 'Buchungsanfrage löschen');
loeschen.type = 'button';
loeschen.className = 'danger';

loeschen.onclick = async () => {
  const bestaetigt = confirm(
    'Möchtest du diese Buchungsanfrage wirklich dauerhaft löschen?'
  );

  if (!bestaetigt) return;

  loeschen.disabled = true;
  meldung.textContent = 'Buchungsanfrage wird gelöscht ...';

  try {
    await api('/api/admin/buchungen/' + encodeURIComponent(b.id), {
      method: 'DELETE'
    });

    c.remove();
  } catch (err) {
    meldung.textContent = 'Fehler beim Löschen: ' + err.message;
    loeschen.disabled = false;
  }
};

     const zahlungSenden = el('button', 'Zahlungsinformationen senden');
zahlungSenden.type = 'button';
zahlungSenden.disabled = false;
  zahlungSenden.onclick = async () => {
  const bestaetigt = confirm(
    'Möchtest du die Zahlungsinformationen wirklich an diesen Kunden senden?'
  );

  if (!bestaetigt) return;

  zahlungSenden.disabled = true;
  meldung.textContent = 'Zahlungsinformationen werden gesendet ...';

  try {
    await api('/api/admin/buchungen/' + encodeURIComponent(b.id) + '/zahlung', {
      method: 'POST'
    });

    meldung.textContent = 'Zahlungsinformationen erfolgreich versendet.';
  } catch (fehler) {
    meldung.textContent = 'Fehler beim Zahlungsversand: ' + fehler.message;
  } finally {
    zahlungSenden.disabled = false;
  }
};    
zahlungSenden.title = 'Zahlungsinformationen per E-Mail an den Kunden senden';
    c.append(speichern, zahlungSenden, loeschen, meldung);
      box.append(c);
    }

    const offers = await api('/api/aktionen');
    const list = document.getElementById('special-list');
    list.replaceChildren();

    for (const a of offers) {
      const c = el('div');
      c.className = 'booking';

      c.append(
        el('strong', a.titel),
        el('p', (a.datum || '') + ' ' + (a.beschreibung || ''))
      );

      const btn = el('button', 'Löschen');
      btn.className = 'danger';

      btn.onclick = async () => {
        if (confirm('Angebot wirklich löschen?')) {
          try {
            await api('/api/admin/aktionen/' + a.id, {
              method: 'DELETE'
            });
            refresh();
          } catch (e) {
            status.textContent = e.message;
          }
        }
      };

      c.append(btn);
      list.append(c);
    }
  } catch (e) {
    login.hidden = false;
    workspace.hidden = true;
    status.textContent = e.message;
  }
}

login.onsubmit = async e => {
  e.preventDefault();

  try {
    await api('/api/admin/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      })
    });

    document.getElementById('password').value = '';
    status.textContent = '';
    refresh();
  } catch (err) {
    status.textContent = err.message;
  }
};

document.getElementById('logout').onclick = async () => {
  await api('/api/admin/logout', {
    method: 'POST'
  });
  location.reload();
};

document.getElementById('special-form').onsubmit = async e => {
  e.preventDefault();

  try {
    await api('/api/admin/aktionen', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(
        Object.fromEntries(new FormData(e.target).entries())
      )
    });

    e.target.reset();
    status.textContent = 'Angebot veröffentlicht';
    refresh();
  } catch (err) {
    status.textContent = err.message;
  }
};

refresh();

/* Buchungskalender – Klettern & Abenteuer Brilon */

let kalenderDatum = new Date();
kalenderDatum.setDate(1);

let kalenderBuchungen = [];

const kalenderMonat = document.getElementById('calendar-month');
const kalenderRaster = document.getElementById('calendar-grid');
const kalenderInfo = document.getElementById('calendar-info');

const kalenderFarben = {
  offen: '#facc15',
  bestaetigt: '#22c55e',
  abgelehnt: '#ef4444',
  storniert: '#94a3b8'
};

let eigeneKalenderTermine = [];
function kalenderAnzeigen() {
  if (!kalenderRaster) return;

  kalenderRaster.replaceChildren();

  kalenderMonat.textContent = kalenderDatum.toLocaleDateString(
    'de-DE',
    { month: 'long', year: 'numeric' }
  );

  const jahr = kalenderDatum.getFullYear();
  const monat = kalenderDatum.getMonth();

  const ersterTag = new Date(jahr, monat, 1);
  const anzahlTage = new Date(jahr, monat + 1, 0).getDate();
  const startPosition = (ersterTag.getDay() + 6) % 7;

  kalenderRaster.style.display = 'grid';
  kalenderRaster.style.gridTemplateColumns = 'repeat(7, minmax(0, 1fr))';
  kalenderRaster.style.gap = '5px';

  for (const name of ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']) {
    const kopf = document.createElement('div');
    kopf.textContent = name;
    kopf.style.textAlign = 'center';
    kopf.style.fontWeight = 'bold';
    kopf.style.padding = '8px 0';
    kalenderRaster.append(kopf);
  }

  for (let i = 0; i < startPosition; i++) {
    kalenderRaster.append(document.createElement('div'));
  }

  for (let tag = 1; tag <= anzahlTage; tag++) {
    const datum = [
      jahr,
      String(monat + 1).padStart(2, '0'),
      String(tag).padStart(2, '0')
    ].join('-');

    const termine = kalenderBuchungen.filter(
      b => b.data && b.data.datum === datum &&
        !['abgelehnt', 'storniert'].includes(b.status)
    );

const eigeneTermine = eigeneKalenderTermine.filter(e => {
  const beginn = e.datum;
  const ende = e.enddatum || e.datum;
  return datum >= beginn && datum <= ende;
});

    const feld = document.createElement('button');
    feld.type = 'button';
    feld.textContent = String(tag);
    feld.style.minHeight = '65px';
    feld.style.padding = '6px';
    feld.style.border = '1px solid #526477';
    feld.style.borderRadius = '5px';
    feld.style.background = '#1b2b3a';
    feld.style.color = 'white';
    feld.style.cursor = 'pointer';

    if (termine.length) {
      const hatBestaetigung = termine.some(
        b => b.status === 'bestaetigt'
      );

      feld.style.borderColor = hatBestaetigung
        ? kalenderFarben.bestaetigt
        : kalenderFarben.offen;

      const anzahl = document.createElement('div');
      anzahl.textContent = termine.length +
        (termine.length === 1 ? ' Termin' : ' Termine');
      anzahl.style.fontSize = '11px';
      anzahl.style.marginTop = '6px';
      anzahl.style.color = hatBestaetigung
        ? kalenderFarben.bestaetigt
        : kalenderFarben.offen;

      feld.append(anzahl);
    }
    
if (eigeneTermine.length) {
  const hatSperrzeit = eigeneTermine.some(
    e => e.typ === 'sperrzeit'
  );

  feld.style.borderColor = hatSperrzeit
    ? '#ef4444'
    : '#38bdf8';

  const anzahlEigene = document.createElement('div');

  anzahlEigene.textContent =
    eigeneTermine.length +
    (hatSperrzeit ? ' Sperrzeit/Termin' : ' eigener Termin');

  anzahlEigene.style.fontSize = '11px';
  anzahlEigene.style.marginTop = '4px';
  anzahlEigene.style.color = hatSperrzeit
    ? '#ef4444'
    : '#38bdf8';

  feld.append(anzahlEigene);
}


    feld.onclick = () => {
      kalenderInfo.replaceChildren();

      const titel = document.createElement('strong');
      titel.textContent = new Date(jahr, monat, tag)
        .toLocaleDateString('de-DE');
      kalenderInfo.append(titel);

     if (!termine.length && !eigeneTermine.length) {
        kalenderInfo.append(
          document.createTextNode(' – Keine aktiven Buchungsanfragen.')
        );
        return;
      }

      for (const b of termine) {
        const eintrag = document.createElement('p');
        eintrag.textContent =
          (b.data.uhrzeit || 'Uhrzeit offen') + ' – ' +
          (b.data.angebot || 'Kletterangebot') + ' – ' +
          (b.data.name || 'Unbekannt') + ' (' +
          (statusNamen[b.status] || 'Offen') + ')';

        kalenderInfo.append(eintrag);
      }
    
for (const e of eigeneTermine) {
  const eintrag = document.createElement('p');

  const art = e.typ === 'sperrzeit'
    ? 'GESPERRT'
    : 'Eigener Klettertermin';

  const beginn = e.uhrzeit
    ? e.uhrzeit.slice(0, 5) + ' Uhr'
    : 'Ganztägig';

  const ende = e.endzeit
    ? ' bis ' + e.endzeit.slice(0, 5) + ' Uhr'
    : '';

  eintrag.textContent =
    art + ': ' + e.titel + ' – ' + beginn + ende;

  if (e.beschreibung) {
    eintrag.textContent += ' – ' + e.beschreibung;
  }

  eintrag.style.color = e.typ === 'sperrzeit'
    ? '#ef4444'
    : '#38bdf8';

  kalenderInfo.append(eintrag);
}

};
    kalenderRaster.append(feld);
  }
}

async function kalenderLaden() {
  try {
    kalenderBuchungen = await api('/api/admin/buchungen');
    kalenderAnzeigen();
  } catch (err) {
    kalenderInfo.textContent =
      'Kalender konnte nicht geladen werden: ' + err.message;
  }
}

document.getElementById('calendar-prev').onclick = () => {
  kalenderDatum.setMonth(kalenderDatum.getMonth() - 1);
  kalenderAnzeigen();
};

document.getElementById('calendar-next').onclick = () => {
  kalenderDatum.setMonth(kalenderDatum.getMonth() + 1);
  kalenderAnzeigen();
};

const bisherigesRefresh = refresh;

refresh = async function() {
  await bisherigesRefresh();

  if (!workspace.hidden) {
    await kalenderLaden();
  }
};

if (!workspace.hidden) {
  kalenderLaden();
}

/* Eigene Termine und Sperrzeiten speichern und anzeigen */

const kalenderFormular = document.getElementById('calendar-form');
const kalenderFormStatus = document.getElementById('calendar-form-status');
const kalenderEintraege = document.getElementById('calendar-entries');

async function eigeneKalenderEintraegeLaden() {
  try {
    const eintraege = await api('/api/admin/kalender');
    eigeneKalenderTermine = eintraege;
kalenderAnzeigen();
    kalenderEintraege.replaceChildren();

    if (!eintraege.length) {
      kalenderEintraege.append(
        el('p', 'Noch keine eigenen Termine oder Sperrzeiten eingetragen.')
      );
      return;
    }

    for (const eintrag of eintraege) {
      const karte = el('div');
      karte.className = 'booking';

      karte.append(
        el('strong',
          (eintrag.typ === 'sperrzeit' ? 'Gesperrt: ' : 'Termin: ') +
          eintrag.titel
        )
      );

      let zeitraum = eintrag.datum;

      if (eintrag.enddatum) {
        zeitraum += ' bis ' + eintrag.enddatum;
      }

      if (eintrag.uhrzeit) {
        zeitraum += ' | ' + eintrag.uhrzeit.slice(0, 5) + ' Uhr';
      }

      if (eintrag.endzeit) {
        zeitraum += ' bis ' + eintrag.endzeit.slice(0, 5) + ' Uhr';
      }

      karte.append(el('p', zeitraum));

      if (eintrag.beschreibung) {
        karte.append(el('p', eintrag.beschreibung));
      }

      const bearbeitenButton = document.createElement('button');
bearbeitenButton.type = 'button';
bearbeitenButton.className = 'btn secondary';
bearbeitenButton.textContent = 'Termin bearbeiten';

bearbeitenButton.onclick = () => {
  kalenderBearbeitenId = eintrag.id;

  for (const name of [
    'typ', 'titel', 'datum', 'enddatum',
    'uhrzeit', 'endzeit', 'beschreibung'
  ]) {
    const feld = kalenderFormular.elements.namedItem(name);
    if (feld) feld.value = eintrag[name] || '';
  }

  kalenderFormular.querySelector('button[type="submit"]').textContent =
    'Änderungen speichern';

  kalenderFormStatus.textContent =
    'Du bearbeitest jetzt: ' + eintrag.titel;

  kalenderFormular.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
};

karte.append(bearbeitenButton);
          const loeschenButton = document.createElement('button');
    loeschenButton.type = 'button';
    loeschenButton.className = 'btn secondary';
    loeschenButton.textContent = 'Termin löschen';

    loeschenButton.onclick = async () => {
      if (!confirm('Diesen Termin oder diese Sperrzeit wirklich löschen?')) {
        return;
      }

      loeschenButton.disabled = true;

      try {
        await api('/api/admin/kalender/' + encodeURIComponent(eintrag.id), {
          method: 'DELETE'
        });

        await eigeneKalenderEintraegeLaden();
        kalenderFormStatus.textContent = 'Kalendereintrag erfolgreich gelöscht.';
      } catch (err) {
        kalenderFormStatus.textContent = 'Löschen fehlgeschlagen: ' + err.message;
        loeschenButton.disabled = false;
      }
    };

    karte.append(loeschenButton);
      kalenderEintraege.append(karte);
    }
  } catch (err) {
    kalenderFormStatus.textContent =
      'Kalendereinträge konnten nicht geladen werden: ' + err.message;
  }
}

let kalenderBearbeitenId = null;
kalenderFormular.onsubmit = async event => {
  event.preventDefault();

  const knopf = kalenderFormular.querySelector('button[type="submit"]');
  knopf.disabled = true;
  kalenderFormStatus.textContent = 'Termin wird gespeichert ...';

  try {
    const daten = Object.fromEntries(
      new FormData(kalenderFormular).entries()
    );

    await api(
  kalenderBearbeitenId
    ? '/api/admin/kalender/' + encodeURIComponent(kalenderBearbeitenId)
    : '/api/admin/kalender',
  {
     method: kalenderBearbeitenId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(daten)
    });

    kalenderFormular.reset();
    kalenderBearbeitenId = null;
knopf.textContent = 'Termin oder Sperrzeit speichern';
    kalenderFormStatus.textContent = 'Termin erfolgreich gespeichert.';

    await eigeneKalenderEintraegeLaden();
  } catch (err) {
    kalenderFormStatus.textContent =
      'Fehler beim Speichern: ' + err.message;
  } finally {
    knopf.disabled = false;
  }
};

const bisherigesKalenderLaden = kalenderLaden;

kalenderLaden = async function() {
  await bisherigesKalenderLaden();

  if (!workspace.hidden) {
    await eigeneKalenderEintraegeLaden();
  }
};

/* ==========================================
   ANGEBOTE UND PREISE VERWALTEN
   ========================================== */

const angeboteAdminListe =
  document.getElementById('angebote-admin-liste');

if (angeboteAdminListe) {
  angeboteAdminListe.innerHTML = `
    <h3>Meine Erlebnisangebote</h3>
    <p>
      Hier werden künftig alle Angebote mit
      individuellen Gruppenpreisen verwaltet.
    </p>
    <p>
      Klettern, Kindergeburtstage, Pusiken,
      Kistenklettern, Baumklettern und
      weitere frei anlegbare Angebote.
    </p>
  `;
}

/* Neues Erlebnisangebot speichern */

const neuesAngebotForm =
  document.getElementById('neues-angebot-form');

if (neuesAngebotForm) {
  neuesAngebotForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const daten = Object.fromEntries(
      new FormData(neuesAngebotForm).entries()
    );

    try {
      await api('/api/admin/angebote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(daten)
      });

      neuesAngebotForm.reset();
      alert('Neues Erlebnisangebot wurde gespeichert.');
    } catch (fehler) {
      alert('Speichern fehlgeschlagen: ' + fehler.message);
    }
  });
}

/* Gespeicherte Erlebnisangebote anzeigen */

async function erlebnisangeboteLaden() {
  const liste = document.getElementById('angebote-admin-liste');
  if (!liste) return;

  try {
    const angebote = await api('/api/admin/angebote');

    liste.innerHTML = '';

    if (!angebote.length) {
      liste.textContent = 'Noch keine Angebote gespeichert.';
      return;
    }

    for (const angebot of angebote) {
      const eintrag = document.createElement('div');
      eintrag.className = 'card';

      const titel = document.createElement('h3');
      titel.textContent = angebot.name;

      const beschreibung = document.createElement('p');
      beschreibung.textContent = angebot.beschreibung || '';

      const details = document.createElement('p');
      details.textContent =
        'Dauer: ' + angebot.dauer + ' Minuten | ' +
        (angebot.aktiv ? 'Aktiv' : 'Noch nicht freigegeben');

      
const preisbereich = document.createElement('div');

const gruppen = [
  ['5-10', '5–10 Personen'],
  ['11-15', '11–15 Personen'],
  ['16-20', '16–20 Personen']
];

for (const [schluessel, bezeichnung] of gruppen) {
  const label = document.createElement('label');
  label.textContent = bezeichnung + ' – Preis in €';

  const eingabe = document.createElement('input');
  eingabe.type = 'number';
  eingabe.min = '0';
  eingabe.step = '0.01';
  eingabe.placeholder = 'Preis eingeben';
  eingabe.value = angebot.preise?.[schluessel] ?? '';

  eingabe.dataset.gruppe = schluessel;

  label.appendChild(eingabe);
  preisbereich.appendChild(label);
}



      eintrag.append(titel, beschreibung, details);
      eintrag.appendChild(preisbereich);
      
const preisButton = document.createElement('button');
preisButton.type = 'button';
preisButton.className = 'btn';
preisButton.textContent = 'Preise speichern';

preisButton.addEventListener('click', async () => {
  const preise = {};

  for (const eingabe of preisbereich.querySelectorAll('input')) {
    preise[eingabe.dataset.gruppe] = eingabe.value;
  }

  preisButton.disabled = true;

  try {
    await api('/api/admin/angebote/' + angebot.id, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ preise, aktiv: aktivSchalter.checked })
    });

    alert('Gruppenpreise erfolgreich gespeichert.');
  } catch (fehler) {
    alert('Speichern fehlgeschlagen: ' + fehler.message);
  } finally {
    preisButton.disabled = false;
  }
});

  
const aktivLabel = document.createElement('label');
const aktivSchalter = document.createElement('input');

aktivSchalter.type = 'checkbox';
aktivSchalter.checked = angebot.aktiv === true;

aktivLabel.appendChild(aktivSchalter);
aktivLabel.appendChild(
  document.createTextNode(' Angebot aktivieren')
);

eintrag.appendChild(aktivLabel);
    
eintrag.appendChild(preisButton);

      liste.appendChild(eintrag);
    }
  } catch (fehler) {
    liste.textContent = 'Laden fehlgeschlagen: ' + fehler.message;
  }
}





