
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
    const alleBuchungen = await api('/api/admin/buchungen');
    const suchtext = (document.getElementById('bookings-search')?.value || '').trim().toLocaleLowerCase('de-DE');
    const statusFilter = document.getElementById('bookings-status-filter')?.value || 'alle';
    const bookings = alleBuchungen.filter(b => {
      const d=b.data || {};
      const durchsuchbar=[d.name,d.buchungsnummer,b.buchungsnummer,d.email,d.angebot].join(' ').toLocaleLowerCase('de-DE');
      return (!suchtext || durchsuchbar.includes(suchtext)) &&
        (statusFilter==='alle' || (b.status || 'offen')===statusFilter);
    });

    login.hidden = true;
    workspace.hidden = false;
    
    await erlebnisangeboteLaden();
    await orteLaden();
    await gpsTourenLaden(alleBuchungen);

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

      if (b.data.buchungsnummer) {
        c.append(el('p', 'Buchungsnummer: ' + b.data.buchungsnummer));
      }
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

if (Number.isFinite(gesamtpreis) && gesamtpreis >= 0) {
  const zahlungen = Array.isArray(b.data.zahlungen) ? b.data.zahlungen : [];
  if (b.data.zahlungsstatus && zahlungen.length === 0) {
    const altHinweis=el('p','Altes Zahlungskennzeichen vorhanden, aber ohne einzelnen Zahlungseintrag. Bitte tatsächlichen Eingang prüfen.');
    altHinweis.className='payment-warning';c.append(altHinweis);
  }
  const erhaltenCent = zahlungen.reduce((summe, z) => summe + Number(z.betragCent || 0), 0);
  const gesamtCent = Math.round(gesamtpreis * 100);
  const restbetragCent = Math.max(0, gesamtCent - erhaltenCent);
  const anzahlungCent = Math.round(gesamtCent * 0.25);

  const euro = cent => (cent / 100).toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR'
  });

  const zahlungsInfo = el('div');
  zahlungsInfo.style.padding = '12px';
  zahlungsInfo.style.margin = '12px 0';
  zahlungsInfo.style.background = '#f1f5f9';
  zahlungsInfo.style.borderRadius = '8px';

  zahlungsInfo.append(
    el('p', 'Gesamtpreis: ' + euro(gesamtCent)),
    el('p', 'Tatsächlich eingegangen: ' + euro(erhaltenCent)),
    el('p', 'Offener Restbetrag: ' + euro(restbetragCent)),
    el('p', '25 % Anzahlung: ' + euro(anzahlungCent) +
      (erhaltenCent >= anzahlungCent ? ' – erreicht' : ' – noch nicht erreicht'))
  );

  const zahlungsformular = document.createElement('form');
  zahlungsformular.className = 'payment-entry';
  zahlungsformular.innerHTML = '<label>Eingegangener Betrag (€)<input name="betrag" type="number" min="0.01" max="' +
    (restbetragCent / 100).toFixed(2) + '" step="0.01" required></label>' +
    '<label>Zahlungsart<select name="methode"><option value="ueberweisung">Überweisung</option>' +
    '<option value="bar">Bar</option><option value="karte">Karte</option><option value="sonstiges">Sonstiges</option></select></label>' +
    '<label>Interne Notiz (optional)<input name="notiz" maxlength="300"></label>' +
    '<button class="btn secondary" type="submit">Zahlungseingang erfassen</button>';
  if (restbetragCent === 0) zahlungsformular.hidden = true;
  zahlungsformular.addEventListener('submit', async event => {
    event.preventDefault();
    const button = zahlungsformular.querySelector('button');
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(zahlungsformular));
      await api('/api/admin/buchungen/' + encodeURIComponent(b.id) + '/zahlungen', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(values)
      });
      await refresh();
    } catch (err) {
      meldung.textContent = 'Zahlung konnte nicht erfasst werden: ' + err.message;
      button.disabled = false;
    }
  });

  for (const z of zahlungen) {
    const cent = Number(z.betragCent || 0);
    zahlungsInfo.append(el('small', new Date(z.erhaltenAm).toLocaleString('de-DE') +
      ' · ' + euro(cent) + ' · ' + z.methode + (z.notiz ? ' · ' + z.notiz : '')));
  }

  c.append(zahlungsInfo, zahlungsformular);
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
        bearbeitungsnotiz: notiz.value
      })
    });

    b.status = ergebnis.status;
    b.bearbeitungsnotiz = notiz.value;
    auswahl.value = b.status;

    statusZeile.textContent =
      'Bearbeitungsstatus: ' + statusNamen[b.status];

    meldung.textContent = 'Änderungen gespeichert.';
    await refresh();
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
    await kalenderLaden();
  } catch (err) {

    meldung.textContent = 'Fehler beim Löschen: ' + err.message;
    loeschen.disabled = false;
  }
};

     const zahlungSenden = el('button', 'Zahlungsinformationen senden');
      
function zahlungsButtonAktualisieren() {
  const gesendet = Boolean(b.zahlungsinfo_gesendet_am);

  zahlungSenden.textContent = gesendet
    ? '✓ Zahlungsinformationen gesendet'
    : 'Zahlungsinformationen senden';

  zahlungSenden.style.backgroundColor = gesendet ? '#168447' : '';
  zahlungSenden.style.color = gesendet ? '#ffffff' : '';
}

zahlungsButtonAktualisieren();

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
    
b.zahlungsinfo_gesendet_am = new Date().toISOString();
zahlungsButtonAktualisieren();

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

      const bildBereich = document.createElement('div');

const bildVorschau = document.createElement('img');
bildVorschau.alt = 'Foto zu ' + a.titel;
bildVorschau.style.width = '100%';
bildVorschau.style.maxWidth = '300px';
bildVorschau.style.aspectRatio = '4 / 3';
bildVorschau.style.objectFit = 'cover';
bildVorschau.style.borderRadius = '8px';
bildVorschau.style.marginTop = '12px';

if (a.bild_url) {
  bildVorschau.src = a.bild_url;
  bildBereich.append(bildVorschau);
}

const bildAuswahl = document.createElement('input');
bildAuswahl.type = 'file';
bildAuswahl.accept = 'image/jpeg,image/png,image/webp';
bildAuswahl.style.display = 'block';
bildAuswahl.style.margin = '12px 0';

const bildButton = document.createElement('button');
bildButton.type = 'button';
bildButton.className = 'btn';
bildButton.textContent = 'Bild hochladen';

bildButton.onclick = async () => {
  const datei = bildAuswahl.files[0];

  if (!datei) {
    alert('Bitte zuerst ein Bild auswählen.');
    return;
  }

  if (datei.size > 5 * 1024 * 1024) {
    alert('Das Bild darf maximal 5 MB groß sein.');
    return;
  }

  bildButton.disabled = true;

  try {
    const antwort = await fetch(
      '/api/admin/aktionen/' + encodeURIComponent(a.id) + '/bild',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': datei.type
        },
        body: datei
      }
    );

    const ergebnis = await antwort.json();

    if (!antwort.ok) {
      throw new Error(ergebnis.error || 'Upload fehlgeschlagen.');
    }

    bildVorschau.src = ergebnis.bild_url;

    if (!bildVorschau.parentNode) {
      bildBereich.prepend(bildVorschau);
    }

    alert('Bild erfolgreich hochgeladen.');
  } catch (fehler) {
    alert('Fehler beim Bildupload: ' + fehler.message);
  } finally {
    bildButton.disabled = false;
  }
};

bildBereich.append(bildAuswahl, bildButton);
c.append(bildBereich);
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

async function gpsTourenLaden(buchungen) {
  const tourSelect=document.querySelector('#gps-game-form [name="tourId"]');
  const buchungSelect=document.querySelector('#gps-game-form [name="buchungId"]');
  const liste=document.getElementById('gps-tour-list');
  if(!tourSelect||!buchungSelect||!liste)return;
  try{
    const tours=await api('/api/admin/gps/touren');
    liste.replaceChildren();tourSelect.replaceChildren();buchungSelect.replaceChildren();
    for(const tour of tours){
      const card=el('article');card.className='booking';
      card.append(el('strong',tour.titel),el('p',`${tour.stationen.length} Stationen · ${tour.schwierigkeitsgrad} · ${tour.altersgruppe}`),
        el('p',`${tour.aktiv?'Aktiv':'Deaktiviert'} · ${tour.buchbar?'buchbar':'nicht buchbar'} · ${tour.startpunkt} → ${tour.ziel}`));
      const edit=el('button','Bearbeiten / Kontrollcodes erneuern');edit.type='button';edit.className='btn secondary';
      edit.onclick=()=>{
        const form=document.getElementById('gps-tour-form');form.elements.id.value=tour.id;
        for(const key of ['titel','beschreibung','schwierigkeitsgrad','altersgruppe','startpunkt','ziel','dauer','preis'])form.elements[key].value=tour[key]??'';
        form.elements.buchbar.checked=tour.buchbar;form.elements.aktiv.checked=tour.aktiv;
        form.elements.stationen.value=JSON.stringify(tour.stationen.map(s=>({...s,kontrollcode:''})),null,2);
        form.querySelector('button[type="submit"]').textContent='GPS-Tour speichern';
        document.getElementById('gps-tour-status').textContent='Beim Speichern müssen neue Kontrollcodes für alle Stationen eingetragen werden.';
        form.scrollIntoView({behavior:'smooth',block:'start'});
      };
      const toggle=el('button',tour.aktiv?'Deaktivieren':'Aktivieren');toggle.type='button';toggle.className='btn secondary';
      toggle.onclick=async()=>{await api('/api/admin/gps/touren/'+encodeURIComponent(tour.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({aktiv:!tour.aktiv})});await gpsTourenLaden(buchungen);};
      const gaeste=el('button','Gästeliste anzeigen');gaeste.type='button';gaeste.className='btn secondary';
      gaeste.onclick=async()=>{
        try{const entries=await api('/api/gps/gaesteliste?tour='+encodeURIComponent(tour.id));
          card.querySelector('.gps-guests')?.remove();
          const guests=el('div');guests.className='gps-guests';
          guests.append(el('h4','Öffentliche Teilnahmen'));
          if(!entries.length)guests.append(el('p','Noch keine freigegebenen Einträge.'));
          for(const entry of entries)guests.append(el('p',`${entry.name} · ${entry.datum} · ${Math.floor(entry.dauer_sekunden/60)} Min.`));
          card.append(guests);
        }catch(error){status.textContent=error.message;}
      };
      const qr=el('details');const summary=el('summary','QR-Zieladressen anzeigen');qr.append(summary);
      for(const station of tour.stationen){
        const target=location.origin+'/gps.html?station='+encodeURIComponent(station.qrId);
        const a=document.createElement('a');a.href=target;a.textContent=station.id+': '+target;a.target='_blank';a.rel='noopener';
        const p=el('p');p.append(a);qr.append(p);
      }
      card.append(edit,toggle,gaeste,qr);liste.append(card);
      if(tour.aktiv&&tour.buchbar){const o=el('option',tour.titel);o.value=tour.id;tourSelect.append(o);}
    }
    const placeholder=el('option','Tour auswählen');placeholder.value='';tourSelect.prepend(placeholder);
    for(const booking of buchungen.filter(b=>b.status==='bestaetigt')){
      const o=el('option',`${booking.data.buchungsnummer||''} · ${booking.data.name||'Unbekannt'} · ${booking.data.datum||''}`);
      o.value=booking.id;buchungSelect.append(o);
    }
    const noBooking=el('option','Bestätigte Buchung auswählen');noBooking.value='';buchungSelect.prepend(noBooking);
  }catch(error){document.getElementById('gps-tour-status').textContent='GPS-Verwaltung nicht verfügbar: '+error.message;}
}

document.getElementById('gps-tour-form')?.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;const statusGps=document.getElementById('gps-tour-status');
  try{
    const fields=Object.fromEntries(new FormData(form));
    let stationen;try{stationen=JSON.parse(fields.stationen);}catch{throw new Error('Stations-JSON ist ungültig.');}
    const id=fields.id;delete fields.id;
    const result=await api(id?'/api/admin/gps/touren/'+encodeURIComponent(id):'/api/admin/gps/touren',{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...fields,stationen,buchbar:form.elements.buchbar.checked,aktiv:form.elements.aktiv.checked})});
    statusGps.textContent=id?'GPS-Tour aktualisiert.':'Tour angelegt: '+result.id;form.reset();
    form.querySelector('button[type="submit"]').textContent='GPS-Tour anlegen';await refresh();
  }catch(error){statusGps.textContent='Fehler: '+error.message;}
});

document.getElementById('gps-game-form')?.addEventListener('submit',async event=>{
  event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));
  const target=document.getElementById('gps-game-status');
  try{
    const result=await api('/api/admin/gps/spiele',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
    const link=location.origin+result.zugangslink;target.replaceChildren(el('span','Spielzugang (einmalig kopieren): '));
    const anchor=document.createElement('a');anchor.href=link;anchor.textContent=link;anchor.target='_blank';anchor.rel='noopener';target.append(anchor);
  }catch(error){target.textContent='Fehler: '+error.message;}
});

let bookingFilterTimer;
document.getElementById('bookings-search')?.addEventListener('input', () => {
  clearTimeout(bookingFilterTimer);
  bookingFilterTimer=setTimeout(refresh,250);
});
document.getElementById('bookings-status-filter')?.addEventListener('change', () => refresh());

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
    daten.verfuegbare_termine=(daten.verfuegbare_termine||'').split('\n').map(x=>x.trim()).filter(Boolean);
    daten.buchbar=neuesAngebotForm.elements.buchbar.checked;
    daten.veroeffentlicht=neuesAngebotForm.elements.veroeffentlicht.checked;

    try {
      await api('/api/admin/angebote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(daten)
      });

      neuesAngebotForm.reset();
      await refresh();
      status.textContent='Neues Erlebnisangebot wurde gespeichert.';
    } catch (fehler) {
      alert('Speichern fehlgeschlagen: ' + fehler.message);
    }
  });
}

async function orteLaden(){
  const select=document.getElementById('angebot-ort');if(!select)return;
  try{
    const orte=await api('/api/admin/orte');select.replaceChildren();
    for(const ort of orte){const o=el('option',ort.name);o.value=ort.name;select.append(o);}
  }catch(error){status.textContent='Veranstaltungsorte konnten nicht geladen werden: '+error.message;}
}

document.getElementById('ort-hinzufuegen')?.addEventListener('click',async()=>{
  const input=document.getElementById('neuer-ort-name');
  try{const ort=await api('/api/admin/orte',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:input.value})});
    await orteLaden();document.getElementById('angebot-ort').value=ort.name;input.value='';status.textContent='Veranstaltungsort hinzugefügt.';
  }catch(error){status.textContent='Ort konnte nicht gespeichert werden: '+error.message;}
});

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

    for (const angebot of angebote.filter(a=>!a.name.startsWith('GPS-Schatzsuche:'))) {
      const eintrag = document.createElement('div');
      eintrag.className = 'card';

      const titel = document.createElement('h3');
      titel.textContent = angebot.name;

     const beschreibung = document.createElement('textarea');
beschreibung.value = angebot.beschreibung || '';
beschreibung.rows = 4;
beschreibung.placeholder = 'Beschreibung des Angebots eingeben';
beschreibung.style.width = '100%';

      const metadaten=document.createElement('div');
      const feld=(labelText,value,name,type='text')=>{
        const label=document.createElement('label');label.textContent=labelText;
        const input=type==='textarea'?document.createElement('textarea'):document.createElement('input');
        input.name=name;input.value=value??'';label.append(input);metadaten.append(label);return input;
      };
      const programmName=feld('Programmname',angebot.name,'name');
      const kategorie=feld('Kategorie',angebot.kategorie,'kategorie');
      const zielgruppe=feld('Zielgruppe',angebot.zielgruppe,'zielgruppe');
      const veranstaltungsort=feld('Veranstaltungsort',angebot.veranstaltungsort,'veranstaltungsort');
      const kapazitaet=feld('Kapazität',angebot.kapazitaet,'kapazitaet','number');
      kapazitaet.min='1';kapazitaet.max='500';
      const termine=feld('Verfügbare Termine (ein Datum je Zeile)',(angebot.verfuegbare_termine||[]).join('\n'),'verfuegbare_termine','textarea');
      const hinweise=feld('Besondere Hinweise',angebot.hinweise,'hinweise','textarea');
      const bookable=document.createElement('input');bookable.type='checkbox';bookable.checked=angebot.buchbar===true;
      const publish=document.createElement('input');publish.type='checkbox';publish.checked=angebot.veroeffentlicht===true;
      const check=(labelText,input)=>{const l=document.createElement('label');l.className='check';const s=el('span',labelText);l.append(input,s);metadaten.append(l);};
      check('Buchbar',bookable);check('Auf Website veröffentlichen',publish);

      const details = document.createElement('p');
      details.textContent =
        'Dauer: ' + angebot.dauer + ' Minuten | ' +
        (angebot.aktiv ? 'Aktiv' : 'Deaktiviert') + ' · ' +
        (angebot.buchbar ? 'buchbar' : 'nicht buchbar') + ' · ' +
        (angebot.veroeffentlicht ? 'veröffentlicht' : 'nicht veröffentlicht');

      
const preisbereich = document.createElement('div');

const gruppen = [
  ['1-4', '1–4 Personen'],
  ['5-10', '5–10 Personen'],
  ['11-15', '11–15 Personen'],
  ['16-20', '16–20 Personen'],
  ['21-150', '21–150 Personen']
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



      eintrag.append(titel, beschreibung, details,metadaten);
      eintrag.appendChild(preisbereich);
      const bildBereich = document.createElement('div');

const bildVorschau = document.createElement('img');
bildVorschau.alt = 'Foto zum Angebot ' + angebot.name;
bildVorschau.style.maxWidth = '300px';
bildVorschau.style.width = '100%';
bildVorschau.style.marginTop = '12px';
bildVorschau.style.borderRadius = '8px';

if (angebot.bild_url) {
  bildVorschau.src = angebot.bild_url;
  bildBereich.appendChild(bildVorschau);
}

const bildAuswahl = document.createElement('input');
bildAuswahl.type = 'file';
bildAuswahl.accept = 'image/jpeg,image/png,image/webp';
bildAuswahl.style.display = 'block';
bildAuswahl.style.marginTop = '12px';

const bildButton = document.createElement('button');
bildButton.type = 'button';
bildButton.className = 'btn';
bildButton.textContent = 'Bild hochladen';

bildButton.addEventListener('click', async () => {
  const datei = bildAuswahl.files[0];

  if (!datei) {
    alert('Bitte zuerst ein Bild auswählen.');
    return;
  }

  if (datei.size > 5 * 1024 * 1024) {
    alert('Das Bild darf maximal 5 MB groß sein.');
    return;
  }

  bildButton.disabled = true;

  try {
    const antwort = await fetch(
      '/api/admin/angebote/' + angebot.id + '/bild',
      {
        method: 'POST',
        headers: {
          'Content-Type': datei.type
        },
        body: datei
      }
    );

    const ergebnis = await antwort.json();

    if (!antwort.ok) {
      throw new Error(ergebnis.error || 'Upload fehlgeschlagen.');
    }

    bildVorschau.src = ergebnis.bild_url;
    if (!bildVorschau.parentNode) {
      bildBereich.insertBefore(bildVorschau, bildAuswahl);
    }

    alert('Bild erfolgreich hochgeladen.');
  } catch (fehler) {
    alert('Fehler beim Bildupload: ' + fehler.message);
  } finally {
    bildButton.disabled = false;
  }
});

bildBereich.append(bildAuswahl, bildButton);
eintrag.appendChild(bildBereich);
      
const preisButton = document.createElement('button');
preisButton.type = 'button';
preisButton.className = 'btn';
preisButton.textContent = 'Programm speichern';

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
      body: JSON.stringify({
  preise,
  aktiv: aktivSchalter.checked,
        beschreibung: beschreibung.value,
        name:programmName.value,kategorie:kategorie.value,zielgruppe:zielgruppe.value,
        veranstaltungsort:veranstaltungsort.value,kapazitaet:Number(kapazitaet.value),
        verfuegbare_termine:termine.value.split('\n').map(x=>x.trim()).filter(Boolean),
        hinweise:hinweise.value,buchbar:bookable.checked,veroeffentlicht:publish.checked
})
    });

    alert('Gruppenpreise erfolgreich gespeichert.');
    await erlebnisangeboteLaden();
  } catch (fehler) {
    alert('Speichern fehlgeschlagen: ' + fehler.message);
  } finally {
    preisButton.disabled = false;
  }
});

  
const aktivSchalter = document.createElement('input');
aktivSchalter.type = 'checkbox';
aktivSchalter.checked = angebot.aktiv === true;
aktivSchalter.style.display = 'none';

const aktivButton = document.createElement('button');
aktivButton.type = 'button';

function aktivButtonAktualisieren() {
  const aktiv = aktivSchalter.checked;

  aktivButton.textContent = aktiv
    ? '✓ Aktiviert'
    : '✕ Deaktiviert';

  aktivButton.style.backgroundColor = aktiv
    ? '#168447'
    : '#bd3030';

  aktivButton.style.color = '#ffffff';
  aktivButton.style.border = 'none';
  aktivButton.style.borderRadius = '8px';
  aktivButton.style.padding = '12px 20px';
  aktivButton.style.fontWeight = 'bold';
  aktivButton.style.cursor = 'pointer';
}

aktivButtonAktualisieren();

aktivButton.addEventListener('click', async () => {
  const neuerStatus = !aktivSchalter.checked;
  const preise = {};

  for (const eingabe of preisbereich.querySelectorAll('input')) {
    preise[eingabe.dataset.gruppe] = eingabe.value;
  }

  aktivButton.disabled = true;
  aktivButton.textContent = 'Wird gespeichert ...';

  try {
    await api('/api/admin/angebote/' + angebot.id, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        preise,
        aktiv: neuerStatus,
        beschreibung: beschreibung.value
      })
    });

    aktivSchalter.checked = neuerStatus;
    aktivButtonAktualisieren();
  } catch (fehler) {
    aktivButtonAktualisieren();
    alert('Aktivierung fehlgeschlagen: ' + fehler.message);
  } finally {
    aktivButton.disabled = false;
  }
});

eintrag.appendChild(aktivButton);
    
eintrag.appendChild(preisButton);

      liste.appendChild(eintrag);
    }
  } catch (fehler) {
    liste.textContent = 'Laden fehlgeschlagen: ' + fehler.message;
  }
}







function anschlussrabattStarten() {
  const liste = document.getElementById('anschlussrabatt-positionen');
  const ergebnis = document.getElementById('anschlussrabatt-ergebnis');
  const hinzufuegen = document.getElementById('anschlussrabatt-hinzufuegen');
  const berechnen = document.getElementById('anschlussrabatt-berechnen');
  if (!liste || !ergebnis || !hinzufuegen || !berechnen) return;
  const kandidatenButton = document.getElementById('anschlussrabatt-kandidaten');
  const kandidatenDatum = document.getElementById('anschlussrabatt-datum');
  const kandidatenListe = document.getElementById('anschlussrabatt-kandidaten-liste');
  if (kandidatenButton && kandidatenDatum && kandidatenListe) {
    kandidatenButton.addEventListener('click', async () => {
      if (!kandidatenDatum.value) {
        kandidatenListe.textContent = 'Bitte zuerst ein Datum waehlen.';
        return;
      }
      kandidatenButton.disabled = true;
      kandidatenListe.textContent = 'Bestaetigte Buchungen werden geladen ...';
      try {
        const daten = await api('/api/admin/anschlussrabatt/kandidaten?datum=' +
          encodeURIComponent(kandidatenDatum.value));
        kandidatenListe.replaceChildren();
        if (!daten.kandidaten.length) {
          kandidatenListe.append(el('p', 'Keine bestaetigten Buchungen an diesem Tag.'));
        }
        const zeit = minuten => minuten === null ? 'unbekannt' :
          String(Math.floor(minuten / 60)).padStart(2, '0') + ':' +
          String(minuten % 60).padStart(2, '0');
        for (const kandidat of daten.kandidaten) {
          kandidatenListe.append(el('p',
            (kandidat.buchungsnummer || 'Ohne Buchungsnummer') + ' | ' +
            (kandidat.angebot || 'Angebot unbekannt') + ' | ' +
            zeit(kandidat.beginnMinuten) + ' bis ' +
            zeit(kandidat.endeMinuten)));
        }
        kandidatenListe.append(el('small', daten.hinweis));
      } catch (fehler) {
        kandidatenListe.textContent = 'Fehler: ' + fehler.message;
      } finally {
        kandidatenButton.disabled = false;
      }
    });
  }
  let zaehler = 0;

  function programmHinzufuegen() {
    const nummer = ++zaehler;
    const zeile = document.createElement('fieldset');
    zeile.className = 'booking';
    zeile.dataset.programmId = String(nummer);
    const titel = el('legend', 'Programm ' + nummer);
    zeile.append(titel);

    function feld(text, typ, name, wert) {
      const label = el('label', text);
      const eingabe = document.createElement('input');
      eingabe.type = typ;
      eingabe.name = name;
      eingabe.required = true;
      if (typ === 'number') {
        eingabe.min = '0';
        eingabe.step = '0.01';
      }
      if (wert) eingabe.value = wert;
      label.append(eingabe);
      zeile.append(label);
    }

    feld('Bezeichnung', 'text', 'bezeichnung', 'Programm ' + nummer);
    feld('Beginn', 'datetime-local', 'start');
    feld('Ende', 'datetime-local', 'ende');
    feld('Preis in Euro', 'number', 'preis');

    const entfernen = el('button', 'Programm entfernen');
    entfernen.type = 'button';
    entfernen.onclick = () => {
      zeile.remove();
      ergebnis.textContent = '';
    };
    zeile.append(entfernen);
    liste.append(zeile);
  }

  hinzufuegen.addEventListener('click', programmHinzufuegen);
  berechnen.addEventListener('click', async () => {
    const zeilen = Array.from(liste.querySelectorAll('fieldset'));
    if (zeilen.length < 2 || zeilen.length > 20) {
      ergebnis.textContent = 'Bitte 2 bis 20 Programme eingeben.';
      return;
    }
    const programme = [];
    for (const zeile of zeilen) {
      const eingaben = Object.fromEntries(
        Array.from(zeile.querySelectorAll('input')).map(input => [input.name, input.value])
      );
      const preis = Number(eingaben.preis);
      if (!eingaben.bezeichnung || !eingaben.start || !eingaben.ende ||
          eingaben.preis === '' || !Number.isFinite(preis) || preis < 0) {
        ergebnis.textContent = 'Bitte alle Programmfelder korrekt ausfuellen.';
        return;
      }
      programme.push({
        id: zeile.dataset.programmId,
        start: new Date(eingaben.start).toISOString(),
        ende: new Date(eingaben.ende).toISOString(),
        preisCent: Math.round(preis * 100)
      });
    }

    berechnen.disabled = true;
    ergebnis.textContent = 'Rabatt wird berechnet ...';
    try {
      const daten = await api('/api/admin/anschlussrabatt/vorschau', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ programme })
      });
      ergebnis.replaceChildren();
      const euro = cent => (cent / 100).toLocaleString('de-DE', {
        style: 'currency', currency: 'EUR'
      });
      for (const position of daten.positionen) {
        const programm = programme.find(p => p.id === position.id);
        const zeile = zeilen.find(z => z.dataset.programmId === position.id);
        const name = zeile.querySelector('[name="bezeichnung"]').value;
        ergebnis.append(el('p', name + ': ' + euro(position.endpreisCent) +
          ' (Rabatt ' + euro(position.rabattCent) + ')'));
      }
      ergebnis.append(el('strong', 'Gesamtpreis: ' +
        euro(daten.endpreisGesamtCent) + ' | Ersparnis: ' +
        euro(daten.rabattGesamtCent)));
      ergebnis.append(el('p', 'Nur Vorschau: Es wurden keine Buchungen oder Zahlungen geaendert.'));
    } catch (fehler) {
      ergebnis.textContent = 'Fehler: ' + fehler.message;
    } finally {
      berechnen.disabled = false;
    }
  });
  programmHinzufuegen();
  programmHinzufuegen();
}
anschlussrabattStarten();
