
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
          await api('/api/admin/buchungen/' + b.id, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              status: auswahl.value,
              bearbeitungsnotiz: notiz.value
            })
          });

          b.status = auswahl.value;
          b.bearbeitungsnotiz = notiz.value;

          statusZeile.textContent =
            'Bearbeitungsstatus: ' + statusNamen[b.status];

          meldung.textContent = 'Änderungen gespeichert.';
        } catch (err) {
          meldung.textContent = 'Fehler: ' + err.message;
        } finally {
          speichern.disabled = false;
        }
      };

      c.append(speichern, meldung);
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

      kalenderEintraege.append(karte);
    }
  } catch (err) {
    kalenderFormStatus.textContent =
      'Kalendereinträge konnten nicht geladen werden: ' + err.message;
  }
}

kalenderFormular.onsubmit = async event => {
  event.preventDefault();

  const knopf = kalenderFormular.querySelector('button[type="submit"]');
  knopf.disabled = true;
  kalenderFormStatus.textContent = 'Termin wird gespeichert ...';

  try {
    const daten = Object.fromEntries(
      new FormData(kalenderFormular).entries()
    );

    await api('/api/admin/kalender', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(daten)
    });

    kalenderFormular.reset();
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


