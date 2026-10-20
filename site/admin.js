
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
