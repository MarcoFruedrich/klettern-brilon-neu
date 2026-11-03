
const login = document.getElementById('login');
const workspace = document.getElementById('workspace');
const status = document.getElementById('status');
let refreshSequenz=0;
let bookingPage=1;
let zahlungsPage=1,zahlungsLadeSequenz=0;
let csrfToken=null;
let adminBuchbareProgramme=[];

async function adminCsrfTokenLaden(){
  if(csrfToken)return csrfToken;
  const r=await fetch('/api/admin/csrf',{credentials:'same-origin'});
  const daten=await r.json();
  if(!r.ok)throw Error(daten.error||'Admin-Sitzung ist abgelaufen.');
  if(typeof daten.csrfToken!=='string')throw Error('CSRF-Token konnte nicht geladen werden.');
  csrfToken=daten.csrfToken;
  return csrfToken;
}

async function api(path, options = {}) {
  const method=String(options.method||'GET').toUpperCase();
  const headers=new Headers(options.headers||{});
  if(!['GET','HEAD','OPTIONS'].includes(method)&&path!=='/api/admin/login')
    headers.set('X-CSRF-Token',await adminCsrfTokenLaden());
  const r = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error || 'Fehler');
  if(path==='/api/admin/login')csrfToken=j.csrfToken||null;
  if(path==='/api/admin/logout')csrfToken=null;
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

function euroCent(cent){
  return (cent/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
}

function zahlungsuebersichtRendern(ergebnis){
  const summary=document.getElementById('payment-overview-summary');
  const list=document.getElementById('payment-overview-list');
  if(!summary||!list)return;
  const totals=ergebnis.summen;
  summary.replaceChildren();
  for(const [label,value] of [
    ['Tatsächlich eingegangen',euroCent(totals.eingegangenCent)],
    ['Offene Restbeträge',euroCent(totals.offenCent)],
    ['Erfasste Zahlungseingänge',String(totals.zahlungseingaenge)],
    ['Dokumentierte Gutschriften',euroCent(totals.gutschriftCent)]
  ]){
    const card=el('article');card.className='booking payment-total';
    card.append(el('small',label),el('strong',value));summary.append(card);
  }
  const entries=ergebnis.eintraege;
  const pages=Math.max(1,Math.ceil(ergebnis.anzahl/ergebnis.proSeite));
  const pager=document.getElementById('payment-overview-pagination');
  if(pager)pager.hidden=ergebnis.anzahl<=ergebnis.proSeite;
  const prev=document.getElementById('payment-overview-prev');
  const next=document.getElementById('payment-overview-next');
  const info=document.getElementById('payment-overview-page-info');
  if(prev)prev.disabled=ergebnis.seite<=1;
  if(next)next.disabled=ergebnis.seite>=pages;
  if(info)info.textContent=`Seite ${ergebnis.seite} / ${pages} · ${ergebnis.anzahl} Buchungen`;
  list.replaceChildren();
  if(!entries.length){list.append(el('p','Für diesen Filter gibt es keine Buchungen.'));return;}
  const methoden={ueberweisung:'Überweisung',bar:'Bar',karte:'Karte',sonstiges:'Sonstiges'};
  for(const entry of entries){
    const card=el('article');card.className='booking payment-record';
    const title=entry.buchungsnummer?`${entry.buchungsnummer} · ${entry.name}`:entry.name;
    card.append(el('strong',title),el('p',`${entry.angebot} · ${entry.datum||'ohne Datum'} · ${statusNamen[entry.status]||entry.status}`));
    card.append(el('p',`Gesamtpreis: ${entry.gesamtpreisCent===null?'nicht hinterlegt':euroCent(entry.gesamtpreisCent)} · Eingegangen: ${euroCent(entry.eingegangenCent)} · Offen: ${euroCent(entry.offenCent)}`));
    if(entry.gutschriftCent)card.append(el('p',`Gutschrift: ${euroCent(entry.gutschriftCent)} · Auszahlung manuell`));
    if(entry.zahlungen.length){
      const detail=el('details');detail.append(el('summary',`${entry.zahlungen.length} Zahlungseingang/-eingänge anzeigen`));
      for(const payment of entry.zahlungen){
        const date=payment.erhaltenAm?new Date(payment.erhaltenAm):null;
        const dateText=date&&!Number.isNaN(date.getTime())?date.toLocaleString('de-DE'):'Zeitpunkt nicht hinterlegt';
        const amount=Number.isSafeInteger(payment.betragCent)&&payment.betragCent>0?euroCent(payment.betragCent):'Betrag ungültig';
        detail.append(el('p',`${dateText} · ${amount} · ${methoden[payment.methode]||'Zahlungsart unbekannt'}${payment.notiz?' · '+payment.notiz:''}`));
      }
      card.append(detail);
    }else card.append(el('p','Noch kein tatsächlicher Zahlungseingang erfasst.'));
    list.append(card);
  }
}

async function zahlungsuebersichtLaden(){
  const sequenz=++zahlungsLadeSequenz;
  const filter=document.getElementById('payment-overview-filter')?.value||'alle';
  try{
    const result=await api(`/api/admin/zahlungsuebersicht?seite=${zahlungsPage}&filter=${encodeURIComponent(filter)}`);
    if(sequenz!==zahlungsLadeSequenz)return;
    const pages=Math.max(1,Math.ceil(result.anzahl/result.proSeite));
    if(zahlungsPage>pages){zahlungsPage=pages;return zahlungsuebersichtLaden();}
    zahlungsuebersichtRendern(result);
  }catch(error){
    if(sequenz!==zahlungsLadeSequenz)return;
    document.getElementById('payment-overview-list')?.replaceChildren(el('p','Zahlungsübersicht konnte nicht geladen werden: '+error.message));
  }
}

async function refresh() {
  const aktuelleSequenz=++refreshSequenz;
  try {
    const suchtext=(document.getElementById('bookings-search')?.value||'').trim();
    const statusFilter=document.getElementById('bookings-status-filter')?.value||'alle';
    const query=new URLSearchParams({suche:suchtext,status:statusFilter,seite:String(bookingPage)});
    const bookingResult=await api('/api/admin/buchungen?'+query.toString());
    const bookings=bookingResult.buchungen;
    if(aktuelleSequenz!==refreshSequenz)return;
    await zahlungsuebersichtLaden();

    login.hidden = true;
    workspace.hidden = false;
    
    await erlebnisangeboteLaden();
    await orteLaden();
    await gpsTourenLaden();
    if(aktuelleSequenz!==refreshSequenz)return;

    const box = document.getElementById('bookings');
    box.replaceChildren();
    const resultLabel=document.getElementById('booking-results-summary');
    const seiten= Math.max(1,Math.ceil(bookingResult.anzahl/bookingResult.proSeite));
    if(bookingPage>seiten){bookingPage=seiten;await refresh();return;}
    if(resultLabel)resultLabel.textContent=`${bookingResult.anzahl} Buchung(en) gefunden · Seite ${bookingResult.seite} von ${seiten}`;
    const pagination=document.getElementById('bookings-pagination');
    const previous=document.getElementById('bookings-prev');
    const next=document.getElementById('bookings-next');
    const pageInfo=document.getElementById('bookings-page-info');
    if(pagination)pagination.hidden=bookingResult.anzahl<=bookingResult.proSeite;
    if(previous)previous.disabled=bookingPage<=1;
    if(next)next.disabled=bookingPage>=seiten;
    if(pageInfo)pageInfo.textContent=`Seite ${bookingPage} / ${seiten}`;

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
if(b.data.buchungsmodus==='einzelplatz'){
  zahlungSenden.disabled=true;
  zahlungSenden.textContent='Keine Anzahlung erforderlich';
  zahlungSenden.title='Für diese Einzelplatzreservierung wird keine Anzahlung angefordert.';
}
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
      const exportLink=el('a','Alle Buchungen dieser Kontakt-E-Mail exportieren (JSON)');
      exportLink.href='/api/admin/buchungen/'+encodeURIComponent(b.id)+'/export';
      exportLink.className='btn secondary';
      exportLink.setAttribute('download','');
      exportLink.title='Alle Buchungen mit derselben Kontakt-E-Mail und zugehörige GPS-Teilnahmedaten exportieren; Zugangsdaten und interne Notizen bleiben ausgeschlossen';
    c.append(speichern, zahlungSenden, exportLink, loeschen, meldung);
      box.append(c);
    }

    const offers = await api('/api/admin/aktionen');
    const list = document.getElementById('special-list');
    list.replaceChildren();

    for (const a of offers) {
      const c = el('div');
      c.className = 'booking';

      c.append(
        el('strong', a.titel),
        el('p', (a.datum || '') + ' ' + (a.beschreibung || '')),
        el('p',a.programm_id?
          'Explizit verknüpft mit Programm-ID: '+a.programm_id+
          ' (Verfügbarkeit wird bei Anfragen neu geprüft)':
          'Unabhängige Aktion – kein Programm automatisch ausgewählt')
      );

      const offerLabel=el('label','Buchbares Programm der Aktion');
      const offerSelect=document.createElement('select');
      const emptyOption=el('option','Kein Programm automatisch auswählen');
      emptyOption.value='';offerSelect.append(emptyOption);
      for(const program of adminBuchbareProgramme){
        const option=el('option',program.name+' · '+program.veranstaltungsort);
        option.value=String(program.id);offerSelect.append(option);
      }
      const current=String(a.programm_id||'');
      if(current&&!adminBuchbareProgramme.some(p=>String(p.id)===current)){
        const unavailable=el('option','Bisheriger Programmbezug ist nicht mehr buchbar');
        unavailable.value=current;unavailable.disabled=true;
        offerSelect.append(unavailable);
      }
      offerSelect.value=current;offerLabel.append(offerSelect);
      const saveLink=el('button','Programmzuordnung speichern');
      saveLink.type='button';saveLink.className='btn secondary';
      const saveStatus=el('p');saveStatus.setAttribute('role','status');
      saveLink.addEventListener('click',async()=>{
        saveLink.disabled=true;
        try{
          await api('/api/admin/aktionen/'+encodeURIComponent(a.id)+'/programm',{
            method:'PATCH',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({programm_id:offerSelect.value})
          });
          saveStatus.textContent='Programmzuordnung gespeichert.';
          await refresh();
        }catch(error){
          saveStatus.textContent='Zuordnung nicht gespeichert: '+error.message;
        }finally{saveLink.disabled=false;}
      });
      c.append(offerLabel,saveLink,saveStatus);

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
          'Content-Type': datei.type,
          'X-CSRF-Token': await adminCsrfTokenLaden()
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

let gpsBuchungsSeite=1,gpsBuchungsLauf=0,gpsBuchungsSuchTimer;

async function gpsBuchungenLaden(){
  const lauf=++gpsBuchungsLauf;
  const form=document.getElementById('gps-game-form');
  const tourId=form?.elements.tourId.value||'';
  const select=form?.elements.buchungId;
  const status=document.getElementById('gps-booking-results');
  const pager=document.getElementById('gps-booking-pagination');
  const info=document.getElementById('gps-booking-page-info');
  const prev=document.getElementById('gps-booking-prev');
  const next=document.getElementById('gps-booking-next');
  if(!select||!status)return;
  const vorher=select.value;
  select.replaceChildren();
  const empty=el('option',tourId?'Buchung auswählen':'Zuerst eine GPS-Tour auswählen');
  empty.value='';select.append(empty);
  select.disabled=true;
  if(pager)pager.hidden=true;
  if(!tourId){status.textContent='Wähle zuerst eine aktive GPS-Tour.';return;}
  status.textContent='Bestätigte Buchungen werden geladen …';
  const query=new URLSearchParams({tourId,seite:String(gpsBuchungsSeite),
    suche:document.getElementById('gps-booking-search')?.value.trim()||''});
  try{
    const daten=await api('/api/admin/gps/buchungen?'+query);
    if(lauf!==gpsBuchungsLauf)return;
    const pages=Math.max(1,Math.ceil(daten.anzahl/daten.proSeite));
    if(gpsBuchungsSeite>pages){gpsBuchungsSeite=pages;return gpsBuchungenLaden();}
    for(const buchung of daten.buchungen){
      const option=el('option',[buchung.buchungsnummer||'',buchung.name||'Unbekannt',
        buchung.datum||''].filter(Boolean).join(' · '));
      option.value=buchung.id;select.append(option);
    }
    if(vorher&&daten.buchungen.some(b=>b.id===vorher))select.value=vorher;
    select.disabled=!daten.buchungen.length;
    status.textContent=daten.anzahl
      ?daten.anzahl+' passende bestätigte Buchung(en) gefunden.'
      :'Keine passende bestätigte Buchung für diese Tour gefunden.';
    if(pager)pager.hidden=daten.anzahl<=daten.proSeite;
    if(info)info.textContent='Seite '+daten.seite+' / '+pages;
    if(prev)prev.disabled=gpsBuchungsSeite<=1;
    if(next)next.disabled=gpsBuchungsSeite>=pages;
  }catch(error){
    if(lauf!==gpsBuchungsLauf)return;
    status.textContent='Buchungen konnten nicht geladen werden: '+error.message;
  }
}

document.querySelector('#gps-game-form [name="tourId"]')?.addEventListener('change',()=>{
  gpsBuchungsSeite=1;gpsBuchungenLaden();
});
document.getElementById('gps-booking-search')?.addEventListener('input',()=>{
  clearTimeout(gpsBuchungsSuchTimer);gpsBuchungsSeite=1;
  gpsBuchungsSuchTimer=setTimeout(gpsBuchungenLaden,250);
});
document.getElementById('gps-booking-prev')?.addEventListener('click',()=>{
  if(gpsBuchungsSeite>1){gpsBuchungsSeite--;gpsBuchungenLaden();}
});
document.getElementById('gps-booking-next')?.addEventListener('click',()=>{
  gpsBuchungsSeite++;gpsBuchungenLaden();
});

let gpsZugangsSeite=1,gpsZugangsSequenz=0;
async function gpsZugaengeLaden(){
  const seq=++gpsZugangsSequenz;
  const list=document.getElementById('gps-access-list');
  const status=document.getElementById('gps-access-status');
  const pager=document.getElementById('gps-access-pagination');
  const prev=document.getElementById('gps-access-prev');
  const next=document.getElementById('gps-access-next');
  const info=document.getElementById('gps-access-page-info');
  if(!list||!status)return;
  const tourId=document.getElementById('gps-access-tour')?.value||'';
  const query=new URLSearchParams({seite:String(gpsZugangsSeite)});
  if(tourId)query.set('tourId',tourId);
  list.replaceChildren();
  status.textContent='Spielzugänge werden geladen …';
  if(pager)pager.hidden=true;
  try{
    const result=await api('/api/admin/gps/spiele?'+query);
    if(seq!==gpsZugangsSequenz)return;
    const pages=Math.max(1,Math.ceil(result.anzahl/result.proSeite));
    if(gpsZugangsSeite>pages){gpsZugangsSeite=pages;return gpsZugaengeLaden();}
    status.textContent=result.anzahl
      ?result.anzahl+' ausgestellte Spielzugänge gefunden.'
      :'Noch keine Spielzugänge für diese Auswahl vorhanden.';
    if(pager)pager.hidden=result.anzahl<=result.proSeite;
    if(info)info.textContent='Seite '+result.seite+' / '+pages;
    if(prev)prev.disabled=gpsZugangsSeite<=1;
    if(next)next.disabled=gpsZugangsSeite>=pages;
    for(const game of result.spiele){
      const card=el('article');card.className='booking';
      const states={ausgestellt:'Ausgestellt',gestartet:'Gestartet',
        abgeschlossen:'Abgeschlossen',gesperrt:'Gesperrt',
        nicht_freigegeben:'Derzeit nicht freigegeben'};
      const date=v=>v?new Date(v).toLocaleString('de-DE'):'—';
      card.append(el('strong',game.buchungsnummer||game.name||'GPS-Spielzugang'),
        el('p',[game.tour,game.name,game.datum].filter(Boolean).join(' · ')),
        el('p','Status: '+(states[game.status]||'Unbekannt')),
        el('p','Ausgestellt: '+date(game.erstelltAm)+' · Gestartet: '+date(game.gestartetAm)),
        el('p','Beendet: '+date(game.abgeschlossenAm)+
          (game.gesperrtAm?' · Gesperrt: '+date(game.gesperrtAm):'')));
      if(game.status!=='gesperrt'){
        const revoke=el('button','Zugang dauerhaft sperren');
        revoke.type='button';revoke.className='btn danger';
        revoke.addEventListener('click',async()=>{
          if(!confirm('Diesen Spielzugang dauerhaft sperren? Das unterbricht auch laufende Spiele.'))return;
          revoke.disabled=true;
          try{
            await api('/api/admin/gps/spiele/'+encodeURIComponent(game.id)+'/sperren',
              {method:'PATCH'});
            await gpsZugaengeLaden();
          }catch(error){
            status.textContent='Sperrung fehlgeschlagen: '+error.message;
            revoke.disabled=false;
          }
        });
        card.append(revoke);
      }
      list.append(card);
    }
  }catch(error){
    if(seq!==gpsZugangsSequenz)return;
    status.textContent='Spielzugänge konnten nicht geladen werden: '+error.message;
  }
}
document.getElementById('gps-access-tour')?.addEventListener('change',()=>{
  gpsZugangsSeite=1;gpsZugaengeLaden();
});
document.getElementById('gps-access-refresh')?.addEventListener('click',gpsZugaengeLaden);
document.getElementById('gps-access-prev')?.addEventListener('click',()=>{
  if(gpsZugangsSeite>1){gpsZugangsSeite--;gpsZugaengeLaden();}
});
document.getElementById('gps-access-next')?.addEventListener('click',()=>{
  gpsZugangsSeite++;gpsZugaengeLaden();
});

async function gpsTourenLaden() {
  const tourSelect=document.querySelector('#gps-game-form [name="tourId"]');
  const buchungSelect=document.querySelector('#gps-game-form [name="buchungId"]');
  const gaestelistenTour=document.getElementById('admin-guestbook-tour');
  const zugangsTour=document.getElementById('gps-access-tour');
  const liste=document.getElementById('gps-tour-list');
  if(!tourSelect||!buchungSelect||!liste)return;
  try{
    const vorherigeTour=tourSelect.value;
    const vorherigerZugangsFilter=zugangsTour?.value||'';
    const tours=await api('/api/admin/gps/touren');
    liste.replaceChildren();tourSelect.replaceChildren();
    if(zugangsTour){
      const alle=el('option','Alle GPS-Touren');alle.value='';zugangsTour.replaceChildren(alle);
    }
    if(gaestelistenTour){
      const alle=el('option','Alle Touren');alle.value='';gaestelistenTour.replaceChildren(alle);
    }
    for(const tour of tours){
      if(gaestelistenTour){const option=el('option',tour.titel);option.value=tour.id;gaestelistenTour.append(option);}
      if(zugangsTour){const option=el('option',tour.titel);option.value=tour.id;zugangsTour.append(option);}
      const card=el('article');card.className='booking';
      card.append(el('strong',tour.titel),el('p',`${tour.stationen.length} Stationen · ${tour.schwierigkeitsgrad} · ${tour.altersgruppe}`),
        el('p',`${tour.aktiv?'Aktiv':'Deaktiviert'} · ${tour.buchbar?'buchbar':'nicht buchbar'} · ${tour.startpunkt} → ${tour.ziel}`));
      const edit=el('button','Bearbeiten / Kontrollcodes erneuern');edit.type='button';edit.className='btn secondary';
      edit.onclick=()=>{
        const form=document.getElementById('gps-tour-form');form.elements.id.value=tour.id;
        for(const key of ['titel','beschreibung','schwierigkeitsgrad','altersgruppe','startpunkt','ziel','dauer','preis'])form.elements[key].value=tour[key]??'';
        form.elements.buchbar.checked=tour.buchbar;form.elements.aktiv.checked=tour.aktiv;
        gpsStationenRendern(tour.stationen);
        form.querySelector('button[type="submit"]').textContent='GPS-Tour speichern';
        document.getElementById('gps-tour-status').textContent='Vorhandene Kontrollcodes bleiben erhalten, wenn Stations-ID und QR-Kennung gleich bleiben. Für neue Stationen oder geänderte Stations-IDs beziehungsweise QR-Kennungen einen neuen 4- bis 8-stelligen Code eingeben.';
        form.scrollIntoView({behavior:'smooth',block:'start'});
      };
      const toggle=el('button',tour.aktiv?'Deaktivieren':'Aktivieren');toggle.type='button';toggle.className='btn secondary';
      toggle.onclick=async()=>{await api('/api/admin/gps/touren/'+encodeURIComponent(tour.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({aktiv:!tour.aktiv})});await gpsTourenLaden();};
      const gaeste=el('button','Gästeliste anzeigen');gaeste.type='button';gaeste.className='btn secondary';
      gaeste.onclick=async()=>{
        if(gaestelistenTour)gaestelistenTour.value=tour.id;
        await adminGaestelisteLaden();
        document.getElementById('admin-guestbook-section')?.scrollIntoView({behavior:'smooth',block:'start'});
      };
      const qr=el('details');const summary=el('summary','QR-Zieladressen anzeigen');qr.append(summary);
      for(const station of tour.stationen){
        const target=location.origin+'/gps.html?station='+encodeURIComponent(station.qrId);
        const a=document.createElement('a');a.href=target;a.textContent=station.id+': '+target;a.target='_blank';a.rel='noopener';
        const p=el('p');p.append(a);qr.append(p);
      }
      const print=el('button','QR-Etiketten drucken');print.type='button';print.className='btn secondary';
      print.onclick=()=>gpsEtikettenDrucken(tour);
      card.append(edit,toggle,gaeste,qr,print);liste.append(card);
      if(tour.aktiv&&tour.buchbar){const o=el('option',tour.titel);o.value=tour.id;tourSelect.append(o);}
    }
    const placeholder=el('option','Tour auswählen');placeholder.value='';tourSelect.prepend(placeholder);
    if(vorherigeTour&&Array.from(tourSelect.options).some(o=>o.value===vorherigeTour))
      tourSelect.value=vorherigeTour;
    if(zugangsTour&&vorherigerZugangsFilter&&
      Array.from(zugangsTour.options).some(o=>o.value===vorherigerZugangsFilter))
      zugangsTour.value=vorherigerZugangsFilter;
    await gpsBuchungenLaden();
    await gpsZugaengeLaden();
  }catch(error){document.getElementById('gps-tour-status').textContent='GPS-Verwaltung nicht verfügbar: '+error.message;}
}

function gpsStationenBeschriften(){
  const container=document.getElementById('gps-stations');
  if(!container)return;
  Array.from(container.querySelectorAll('.gps-station-editor')).forEach((station,index)=>{
    const legend=station.querySelector('legend');
    if(legend)legend.textContent=`Station ${index+1}`;
    const up=station.querySelector('[data-station-action="up"]');
    const down=station.querySelector('[data-station-action="down"]');
    if(up)up.disabled=index===0;
    if(down)down.disabled=index===container.children.length-1;
  });
}

function gpsStationenRendern(stationen=[]){
  const container=document.getElementById('gps-stations');
  if(!container)return;
  container.replaceChildren();
  for(const [index,station] of stationen.entries()){
    const card=document.createElement('fieldset');card.className='gps-station-editor';
    const legend=document.createElement('legend');legend.textContent=`Station ${index+1}`;card.append(legend);
    const fields=document.createElement('div');fields.className='gps-station-fields';
    const input=(labelText,key,value,type='text',options={})=>{
      const label=document.createElement('label');label.textContent=labelText;
      const control=document.createElement('input');control.type=type;control.dataset.stationField=key;
      control.value=value??'';control.required=options.required===true;
      if(options.maxLength!==undefined)control.maxLength=options.maxLength;
      if(options.min!==undefined)control.min=String(options.min);
      if(options.max!==undefined)control.max=String(options.max);
      if(options.step!==undefined)control.step=String(options.step);
      if(options.pattern)control.pattern=options.pattern;
      if(options.inputmode)control.inputMode=options.inputmode;
      label.append(control);fields.append(label);return control;
    };
    input('Stations-ID','id',station.id||`station-${index+1}`,'text',{required:true,maxLength:80});
    input('QR-Kennung','qrId',station.qrId||`BRILON-${String(index+1).padStart(3,'0')}`,'text',{required:true,maxLength:120});
    const question=input('Frage','frage',station.frage,'text',{required:true,maxLength:500});
    question.className='gps-station-question';
    input('Antwort 1','answer0',station.antworten?.[0],'text',{required:true,maxLength:160});
    input('Antwort 2','answer1',station.antworten?.[1],'text',{required:true,maxLength:160});
    const correctLabel=document.createElement('label');correctLabel.textContent='Richtige Antwort';
    const correct=document.createElement('select');correct.dataset.stationField='loesungIndex';
    for(const [value,title] of [[0,'Antwort 1'],[1,'Antwort 2']]){
      const option=document.createElement('option');option.value=String(value);option.textContent=title;correct.append(option);
    }
    correct.value=String(Number(station.loesungIndex)===1?1:0);correctLabel.append(correct);fields.append(correctLabel);
    input('Breitengrad','latitude',station.latitude,'number',{required:true,min:-90,max:90,step:'any'});
    input('Längengrad','longitude',station.longitude,'number',{required:true,min:-180,max:180,step:'any'});
    const code=input('Neuer Kontrollcode (4–8 Ziffern)','kontrollcode',station.kontrollcode,'text',{maxLength:8,pattern:'[0-9]{4,8}',inputmode:'numeric'});
    code.autocomplete='new-password';code.placeholder='Bei unveränderter Station leer lassen';
    const actions=document.createElement('div');actions.className='gps-station-actions';
    const button=(label,action)=>{const b=document.createElement('button');b.type='button';b.className='btn secondary';b.textContent=label;b.dataset.stationAction=action;actions.append(b);return b;};
    button('Nach oben','up').addEventListener('click',()=>{const previous=card.previousElementSibling;if(previous)container.insertBefore(card,previous);gpsStationenBeschriften();});
    button('Nach unten','down').addEventListener('click',()=>{const next=card.nextElementSibling;if(next)container.insertBefore(next,card);gpsStationenBeschriften();});
    button('Station entfernen','remove').addEventListener('click',()=>{card.remove();gpsStationenBeschriften();});
    card.append(fields,actions);container.append(card);
  }
  gpsStationenBeschriften();
}

document.getElementById('gps-station-add')?.addEventListener('click',()=>{
  const container=document.getElementById('gps-stations');
  const cards=Array.from(container?.querySelectorAll('.gps-station-editor')||[]);
  const existing=cards.map(card=>{
    const fields=Object.fromEntries(Array.from(card.querySelectorAll('[data-station-field]'))
      .map(field=>[field.dataset.stationField,field.value]));
    return {...fields,antworten:[fields.answer0,fields.answer1]};
  });
  let next=1;
  while(existing.some(station=>station.id===`station-${next}`||station.qrId===`BRILON-${String(next).padStart(3,'0')}`))next++;
  gpsStationenRendern([...existing,{id:`station-${next}`,qrId:`BRILON-${String(next).padStart(3,'0')}`,antworten:[],loesungIndex:0}]);
});

function gpsStationenFormWert(){
  const cards=Array.from(document.querySelectorAll('#gps-stations .gps-station-editor'));
  if(!cards.length)throw new Error('Füge mindestens eine Station hinzu.');
  return cards.map((card,index)=>{
    const value=key=>card.querySelector(`[data-station-field="${key}"]`)?.value.trim()??'';
    const code=value('kontrollcode');
    if(code&&!/^\d{4,8}$/.test(code))throw new Error(`Station ${index+1}: Der Kontrollcode muss 4 bis 8 Ziffern enthalten.`);
    return {id:value('id'),qrId:value('qrId'),frage:value('frage'),
      antworten:[value('answer0'),value('answer1')],loesungIndex:Number(value('loesungIndex')),
      latitude:Number(value('latitude')),longitude:Number(value('longitude')),kontrollcode:code};
  });
}

function gpsEtikettenDrucken(tour){
  const printWindow=window.open('','_blank');
  if(!printWindow){status.textContent='Druckansicht wurde vom Browser blockiert. Bitte Pop-ups für diese Seite erlauben.';return;}
  printWindow.opener=null;
  const doc=printWindow.document;doc.open();doc.write('<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GPS-Etiketten</title></head><body></body></html>');doc.close();
  const style=doc.createElement('style');
  style.textContent='*{box-sizing:border-box}body{font:16px/1.4 system-ui,sans-serif;color:#173d34;margin:0;padding:20px}.toolbar{position:sticky;top:0;background:#fff;padding:8px 0 16px}.toolbar button{font:inherit;font-weight:700;padding:12px 18px}.sheet{display:grid;grid-template-columns:repeat(auto-fit,minmax(75mm,1fr));gap:8mm}.label{border:1px solid #62776d;border-radius:3mm;padding:7mm;text-align:center;break-inside:avoid}.label h2{font-size:17pt;margin:0 0 3mm}.label p{font-size:11pt;margin:2mm 0}.label img{display:block;width:56mm;height:56mm;margin:4mm auto}.hint{font-size:9pt;color:#40564d}@media print{body{padding:0}.toolbar{display:none}.sheet{grid-template-columns:repeat(2,1fr);gap:5mm}.label{min-height:85mm}.label img{width:52mm;height:52mm}}';
  doc.head.append(style);
  doc.title=`QR-Etiketten · ${tour.titel}`;
  const toolbar=doc.createElement('div');toolbar.className='toolbar';
  const printButton=doc.createElement('button');printButton.type='button';printButton.textContent='Etiketten drucken';printButton.onclick=()=>printWindow.print();toolbar.append(printButton);
  const heading=doc.createElement('p');heading.textContent=`GPS-Tour: ${tour.titel} · ${tour.stationen.length} Stationsetiketten · Zahlencodes sind nicht enthalten.`;toolbar.append(heading);doc.body.append(toolbar);
  const sheet=doc.createElement('main');sheet.className='sheet';
  try{
    for(const station of tour.stationen){
      const target=new URL('/gps.html',location.origin);target.searchParams.set('station',station.qrId);
      const label=doc.createElement('article');label.className='label';
      const title=doc.createElement('h2');title.textContent=tour.titel;label.append(title);
      const image=doc.createElement('img');image.alt=`QR-Code für Station ${station.id}`;image.src=window.GPSQrEtiketten.dataUri(target.toString());label.append(image);
      const name=doc.createElement('p');name.textContent=`Station ${station.id}`;label.append(name);
      const note=doc.createElement('p');note.className='hint';note.textContent='QR-Code scannen und den vor Ort ausgegebenen Zahlencode eingeben.';label.append(note);
      sheet.append(label);
    }
  }catch(error){printWindow.close();status.textContent='QR-Etiketten konnten nicht erstellt werden: '+error.message;return;}
  doc.body.append(sheet);
}

async function adminGaestelisteLaden(){
  const list=document.getElementById('admin-guestbook-list');
  const message=document.getElementById('admin-guestbook-status');
  const tour=document.getElementById('admin-guestbook-tour')?.value||'';
  if(!list||!message)return;
  message.textContent='Einträge werden geladen …';list.replaceChildren();
  try{
    const query=tour?'?tour='+encodeURIComponent(tour):'';
    const entries=await api('/api/admin/gps/gaesteliste'+query);
    if(!entries.length){message.textContent='Keine freigegebenen Gästelisteneinträge vorhanden.';return;}
    message.textContent=`${entries.length} freigegebene Einträge`;
    for(const entry of entries){
      const card=el('article');card.className='booking';
      const minutes=Math.floor(Number(entry.dauer_sekunden||0)/60);
      const seconds=String(Number(entry.dauer_sekunden||0)%60).padStart(2,'0');
      card.append(el('strong',entry.name||'Name nicht angegeben'),
        el('p',`${entry.tour||'GPS-Tour'} · ${entry.datum||'Datum unbekannt'}`),
        el('p',`Benötigte Zeit: ${minutes} Min. ${seconds} Sek.`));
      if(entry.einwilligung_am){
        const timestamp=new Date(entry.einwilligung_am);
        if(!Number.isNaN(timestamp.getTime()))card.append(el('small',`Öffentliche Einwilligung erfasst: ${timestamp.toLocaleString('de-DE')}`));
      }
      if(entry.einwilligung_version)card.append(el('small',`Einwilligungstext-Version: ${entry.einwilligung_version}`));
      const remove=el('button','Öffentlichen Eintrag entfernen');remove.type='button';remove.className='danger';
      remove.onclick=async()=>{
        if(!window.confirm(`Den öffentlichen Namenseintrag „${entry.name}“ entfernen? Spielabschluss und Spielzeit bleiben erhalten.`))return;
        remove.disabled=true;
        try{
          await api('/api/admin/gps/gaesteliste/'+encodeURIComponent(entry.id),{method:'DELETE'});
          await adminGaestelisteLaden();
        }catch(error){message.textContent='Eintrag konnte nicht entfernt werden: '+error.message;remove.disabled=false;}
      };
      card.append(remove);
      list.append(card);
    }
  }catch(error){message.textContent='Gästeliste konnte nicht geladen werden: '+error.message;}
}

document.getElementById('admin-guestbook-load')?.addEventListener('click',adminGaestelisteLaden);

document.getElementById('gps-tour-form')?.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;const statusGps=document.getElementById('gps-tour-status');
  try{
    const fields=Object.fromEntries(new FormData(form));
    const stationen=gpsStationenFormWert();
    const id=fields.id;delete fields.id;
    const result=await api(id?'/api/admin/gps/touren/'+encodeURIComponent(id):'/api/admin/gps/touren',{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...fields,stationen,buchbar:form.elements.buchbar.checked,aktiv:form.elements.aktiv.checked})});
    statusGps.textContent=id?'GPS-Tour aktualisiert.':'Tour angelegt: '+result.id;form.reset();
    gpsStationenRendern([]);form.querySelector('button[type="submit"]').textContent='GPS-Tour anlegen';await refresh();
  }catch(error){statusGps.textContent='Fehler: '+error.message;}
});

document.getElementById('gps-game-form')?.addEventListener('submit',async event=>{
  event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));
  const target=document.getElementById('gps-game-status');
  try{
    const result=await api('/api/admin/gps/spiele',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
    const link=location.origin+result.zugangslink;target.replaceChildren(el('span','Spielzugang (einmalig kopieren): '));
    const anchor=document.createElement('a');anchor.href=link;anchor.textContent=link;anchor.target='_blank';anchor.rel='noopener';target.append(anchor);
    await gpsZugaengeLaden();
  }catch(error){target.textContent='Fehler: '+error.message;}
});

let bookingFilterTimer;
document.getElementById('bookings-search')?.addEventListener('input', () => {
  clearTimeout(bookingFilterTimer);
  bookingPage=1;
  bookingFilterTimer=setTimeout(refresh,250);
});
document.getElementById('bookings-status-filter')?.addEventListener('change', () => {bookingPage=1;refresh();});
document.getElementById('bookings-prev')?.addEventListener('click',()=>{if(bookingPage>1){bookingPage--;refresh();}});
document.getElementById('bookings-next')?.addEventListener('click',()=>{bookingPage++;refresh();});
document.getElementById('payment-overview-filter')?.addEventListener('change', () => {zahlungsPage=1;zahlungsuebersichtLaden();});
document.getElementById('payment-overview-prev')?.addEventListener('click',()=>{if(zahlungsPage>1){zahlungsPage--;zahlungsuebersichtLaden();}});
document.getElementById('payment-overview-next')?.addEventListener('click',()=>{zahlungsPage++;zahlungsuebersichtLaden();});

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
        password: document.getElementById('password').value,
        totp: document.getElementById('totp-code').value
      })
    });

    document.getElementById('password').value = '';
    document.getElementById('totp-code').value = '';
    status.textContent = '';
    refresh();
  } catch (err) {
    document.getElementById('totp-code').value = '';
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
let kalenderLadeSequenz=0;
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
  const aktuelleSequenz=++kalenderLadeSequenz;
  const monat=`${kalenderDatum.getFullYear()}-${String(kalenderDatum.getMonth()+1).padStart(2,'0')}`;
  try {
    const buchungen=await api('/api/admin/kalenderbuchungen?monat='+encodeURIComponent(monat));
    if(aktuelleSequenz!==kalenderLadeSequenz)return;
    kalenderBuchungen=buchungen;
    kalenderAnzeigen();
  } catch (err) {
    if(aktuelleSequenz!==kalenderLadeSequenz)return;
    kalenderInfo.textContent =
      'Kalender konnte nicht geladen werden: ' + err.message;
  }
}

document.getElementById('calendar-prev').onclick = () => {
  kalenderDatum.setMonth(kalenderDatum.getMonth() - 1);
  kalenderLaden();
};

document.getElementById('calendar-next').onclick = () => {
  kalenderDatum.setMonth(kalenderDatum.getMonth() + 1);
  kalenderLaden();
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
    daten.mindestteilnehmer=Number(daten.mindestteilnehmer||5);
    daten.preis_pro_person=Number(daten.preis_pro_person||0);

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
  const select=document.getElementById('angebot-ort');
  const liste=document.getElementById('admin-place-list');
  if(!select&&!liste)return;
  try{
    const orte=await api('/api/admin/orte');
    if(select){select.replaceChildren();for(const ort of orte){const o=el('option',ort.name);o.value=ort.name;select.append(o);}}
    if(liste){
      liste.replaceChildren();
      if(!orte.length)liste.append(el('p','Noch keine Veranstaltungsorte angelegt.'));
      for(const ort of orte){const card=el('article');card.className='booking';card.append(el('strong',ort.name),el('p','Aktiv und für neue Programme auswählbar'));liste.append(card);}
    }
  }catch(error){status.textContent='Veranstaltungsorte konnten nicht geladen werden: '+error.message;}
}

document.getElementById('admin-place-form')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget,message=document.getElementById('admin-place-status');
  const button=form.querySelector('button[type="submit"]');button.disabled=true;
  try{
    const result=await api('/api/admin/orte',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:form.elements.name.value})});
    await orteLaden();
    const select=document.getElementById('angebot-ort');if(select)select.value=result.name;
    form.reset();message.textContent=`Veranstaltungsort „${result.name}“ ist jetzt auswählbar.`;
  }catch(error){message.textContent='Ort konnte nicht gespeichert werden: '+error.message;}
  finally{button.disabled=false;}
});

/* Gespeicherte Erlebnisangebote anzeigen */

async function erlebnisangeboteLaden() {
  const liste = document.getElementById('angebote-admin-liste');
  if (!liste) return;

  try {
    const angebote = await api('/api/admin/angebote');
    adminBuchbareProgramme=angebote.filter(a=>!a.archiviert&&a.aktiv&&a.buchbar&&a.veroeffentlicht);
    const specialSelect=document.getElementById('special-program-select');
    if(specialSelect){
      const selected=specialSelect.value;
      specialSelect.replaceChildren();
      const empty=el('option','Unabhängige Sonderaktion – keine automatische Programmauswahl');
      empty.value='';specialSelect.append(empty);
      for(const offer of angebote.filter(a=>!a.archiviert&&a.aktiv&&a.buchbar&&a.veroeffentlicht)){
        const option=el('option',offer.name+' · '+offer.veranstaltungsort);
        option.value=String(offer.id);
        specialSelect.append(option);
      }
      if([...specialSelect.options].some(o=>o.value===selected))specialSelect.value=selected;
    }

    liste.innerHTML = '';

    if (!angebote.length) {
      liste.textContent = 'Noch keine Angebote gespeichert.';
      return;
    }

    const aktiveAngebote=angebote.filter(a=>!a.archiviert);
    for (const angebot of angebote) {
      const eintrag = document.createElement('div');
      eintrag.className = 'card';

      const titel = document.createElement('h3');
      titel.textContent = angebot.name;

      if(angebot.archiviert){
        titel.textContent='Archiviert · '+angebot.name;
        const wiederherstellen=document.createElement('button');
        wiederherstellen.type='button';wiederherstellen.textContent='Wiederherstellen';
        wiederherstellen.addEventListener('click',async()=>{
          wiederherstellen.disabled=true;
          try{await api(`/api/admin/angebote/${angebot.id}/archivieren`,{method:'PATCH',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({archiviert:false})});await erlebnisangeboteLaden();}
          catch(error){wiederherstellen.disabled=false;alert('Wiederherstellen fehlgeschlagen: '+error.message);}
        });
        eintrag.append(titel,el('p','Archivierte Angebote bleiben für bisherige Buchungen und deren Verlauf gespeichert.'),wiederherstellen);
        liste.append(eintrag);
        continue;
      }

      const reihenfolge=aktiveAngebote.findIndex(item=>String(item.id)===String(angebot.id));
      const bewegen=async richtung=>{
        const next=[...aktiveAngebote];
        const ziel=reihenfolge+richtung;
        if(ziel<0||ziel>=next.length)return;
        [next[reihenfolge],next[ziel]]=[next[ziel],next[reihenfolge]];
        try{
          await api('/api/admin/angebote/reihenfolge',{method:'PATCH',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ids:next.map(item=>item.id)})});
          await erlebnisangeboteLaden();
        }catch(error){alert('Reihenfolge konnte nicht gespeichert werden: '+error.message);}
      };
      const aufwaerts=document.createElement('button');aufwaerts.type='button';aufwaerts.textContent='↑ Nach oben';
      aufwaerts.disabled=reihenfolge<=0;aufwaerts.setAttribute('aria-label',angebot.name+' nach oben verschieben');
      aufwaerts.addEventListener('click',()=>bewegen(-1));
      const abwaerts=document.createElement('button');abwaerts.type='button';abwaerts.textContent='↓ Nach unten';
      abwaerts.disabled=reihenfolge===aktiveAngebote.length-1;abwaerts.setAttribute('aria-label',angebot.name+' nach unten verschieben');
      abwaerts.addEventListener('click',()=>bewegen(1));
      eintrag.append(aufwaerts,abwaerts);

      if(angebot.name.startsWith('GPS-Schatzsuche:')){
        eintrag.append(titel,el('p','GPS-Angebot · Inhalt und Aktivierung werden im GPS-Bereich verwaltet.'));
        const archivieren=document.createElement('button');archivieren.type='button';archivieren.textContent='Archivieren';
        archivieren.addEventListener('click',async()=>{
          if(!confirm('GPS-Angebot archivieren? Eine aktive GPS-Tour muss zuerst deaktiviert werden.'))return;
          try{await api(`/api/admin/angebote/${angebot.id}/archivieren`,{method:'PATCH',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({archiviert:true})});await erlebnisangeboteLaden();}
          catch(error){alert('Archivieren fehlgeschlagen: '+error.message);}
        });
        eintrag.append(archivieren);liste.append(eintrag);continue;
      }

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
      const dauer=feld('Dauer (Minuten)',angebot.dauer,'dauer','number');
      dauer.min='15';dauer.max='1440';dauer.step='1';
      const kapazitaet=feld('Kapazität',angebot.kapazitaet,'kapazitaet','number');
      kapazitaet.min='1';kapazitaet.max='500';
      const termine=feld('Verfügbare Termine (ein Datum je Zeile)',(angebot.verfuegbare_termine||[]).join('\n'),'verfuegbare_termine','textarea');
      const hinweise=feld('Besondere Hinweise',angebot.hinweise,'hinweise','textarea');
      const modusLabel=document.createElement('label');modusLabel.textContent='Buchungsart';
      const modus=document.createElement('select');
      for(const [value,label] of [['gruppe','Gruppenanfrage'],['einzelplatz','Einzelplätze reservieren']]){
        const option=el('option',label);option.value=value;modus.append(option);
      }
      modus.value=angebot.buchungsmodus||'gruppe';modusLabel.append(modus);metadaten.append(modusLabel);
      const mindest=feld('Mindestanmeldungen für Durchführung',angebot.mindestteilnehmer||5,'mindestteilnehmer','number');
      mindest.min='5';mindest.max='12';
      const einzelpreis=feld('Preis pro Person (€)',angebot.preis_pro_person||'','preis_pro_person','number');
      einzelpreis.min='0.01';einzelpreis.step='0.01';
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
const einzelPreisHinweis=el('p','Einzelplatzmodus: Preis gilt pro Person; Anmeldungen reservieren je einen Platz und der Termin findet ab der Mindestzahl statt.');
einzelPreisHinweis.className='hint';
const preiseGruppe=new Set();

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
  preiseGruppe.add(label);
}
function preisEingabenAktualisieren(){
  const einzel=modus.value==='einzelplatz';
  for(const label of preiseGruppe)label.hidden=einzel;
  einzelPreisHinweis.hidden=!einzel;
  mindest.parentElement.hidden=!einzel;
  einzelpreis.parentElement.hidden=!einzel;
}
modus.addEventListener('change',preisEingabenAktualisieren);
preisbereich.append(einzelPreisHinweis);
preisEingabenAktualisieren();



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
        credentials: 'same-origin',
        headers: {
          'Content-Type': datei.type,
          'X-CSRF-Token': await adminCsrfTokenLaden()
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
        veranstaltungsort:veranstaltungsort.value,dauer:Number(dauer.value),kapazitaet:Number(kapazitaet.value),
        verfuegbare_termine:termine.value.split('\n').map(x=>x.trim()).filter(Boolean),
        hinweise:hinweise.value,buchbar:bookable.checked,veroeffentlicht:publish.checked
        ,buchungsmodus:modus.value,mindestteilnehmer:Number(mindest.value),preis_pro_person:Number(einzelpreis.value||0)
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

const archivierenButton=document.createElement('button');
archivierenButton.type='button';archivierenButton.textContent='Angebot archivieren';
archivierenButton.addEventListener('click',async()=>{
  if(!confirm(`„${angebot.name}“ archivieren? Bestehende Buchungen bleiben erhalten.`))return;
  archivierenButton.disabled=true;
  try{
    await api(`/api/admin/angebote/${angebot.id}/archivieren`,{method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({archiviert:true})});
    await erlebnisangeboteLaden();
  }catch(error){archivierenButton.disabled=false;alert('Archivieren fehlgeschlagen: '+error.message);}
});
eintrag.appendChild(archivierenButton);

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
  const kandidatenVorschau = document.getElementById('anschlussrabatt-kandidaten-vorschau');
  const anwendenButton = document.getElementById('anschlussrabatt-anwenden');
  let geladeneKandidaten = [];
  const euro = cent => (cent / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  async function ausgewaehlteBuchungenVorschauen() {
    const ids = Array.from(kandidatenListe.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
    if (anwendenButton) anwendenButton.hidden = ids.length < 2;
    if (!kandidatenVorschau) return;
    kandidatenVorschau.replaceChildren();
    if (ids.length < 2) {
      kandidatenVorschau.textContent = 'Wähle mindestens zwei bestätigte Buchungen für die Rabattvorschau.';
      return;
    }
    const programme = geladeneKandidaten.filter(k => ids.includes(k.id)).map(k => ({
      id: k.id,
      start: new Date(Date.parse(kandidatenDatum.value + 'T00:00:00Z') + k.beginnMinuten * 60000).toISOString(),
      ende: new Date(Date.parse(kandidatenDatum.value + 'T00:00:00Z') + k.endeMinuten * 60000).toISOString(),
      preisCent: k.preisCent
    }));
    if (programme.some(p => p.preisCent === null)) {
      kandidatenVorschau.textContent = 'Für mindestens eine Buchung fehlt ein gültiger Preis; sie kann nicht rabattiert werden.';
      if (anwendenButton) anwendenButton.hidden = true;
      return;
    }
    try {
      const daten = await api('/api/admin/anschlussrabatt/vorschau', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ programme })
      });
      kandidatenVorschau.replaceChildren();
      for (const position of daten.positionen) {
        const kandidat = geladeneKandidaten.find(k => k.id === position.id);
        kandidatenVorschau.append(el('p', (kandidat?.buchungsnummer || kandidat?.angebot || 'Buchung') + ': ' +
          euro(position.endpreisCent) + ' (Rabatt ' + euro(position.rabattCent) + ')'));
      }
      kandidatenVorschau.append(el('strong', 'Rabatt gesamt: ' + euro(daten.rabattGesamtCent)));
      if (!daten.rabattGesamtCent && anwendenButton) anwendenButton.hidden = true;
      else if (anwendenButton) anwendenButton.hidden = false;
    } catch (fehler) {
      kandidatenVorschau.textContent = 'Vorschau fehlgeschlagen: ' + fehler.message;
      if (anwendenButton) anwendenButton.hidden = true;
    }
  }
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
        geladeneKandidaten = daten.kandidaten;
        if (!daten.kandidaten.length) {
          kandidatenListe.append(el('p', 'Keine bestaetigten Buchungen an diesem Tag.'));
        }
        const zeit = minuten => minuten === null ? 'unbekannt' :
          String(Math.floor(minuten / 60)).padStart(2, '0') + ':' +
          String(minuten % 60).padStart(2, '0');
        for (const kandidat of daten.kandidaten) {
          const label = el('label',
            (kandidat.buchungsnummer || 'Ohne Buchungsnummer') + ' | ' +
            (kandidat.angebot || 'Angebot unbekannt') + ' | ' +
            zeit(kandidat.beginnMinuten) + ' bis ' +
            zeit(kandidat.endeMinuten) + ' | ' + euro(kandidat.preisCent || 0));
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.value = kandidat.id;
          checkbox.addEventListener('change', ausgewaehlteBuchungenVorschauen);
          label.prepend(checkbox);
          kandidatenListe.append(label, document.createElement('br'));
        }
        kandidatenListe.append(el('small', daten.hinweis));
        await ausgewaehlteBuchungenVorschauen();
      } catch (fehler) {
        kandidatenListe.textContent = 'Fehler: ' + fehler.message;
      } finally {
        kandidatenButton.disabled = false;
      }
    });
  }
  if (anwendenButton) anwendenButton.addEventListener('click', async () => {
    const buchungsIds = Array.from(kandidatenListe.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
    if (buchungsIds.length < 2 || !window.confirm('Den angezeigten Anschlussrabatt jetzt dauerhaft auf die ausgewählten bestätigten Buchungen anwenden? Die Buchungsbeträge und Restbeträge werden angepasst und betroffene Kunden erhalten eine Benachrichtigung.')) return;
    anwendenButton.disabled = true;
    kandidatenVorschau.textContent = 'Rabatt wird gespeichert ...';
    try {
      const daten = await api('/api/admin/anschlussrabatt/anwenden', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ buchungsIds })
      });
      kandidatenVorschau.textContent = 'Rabatt gespeichert für ' + daten.updates.length + ' Buchungen. Preise, Zahlungen und Restbeträge wurden neu berechnet.';
      anwendenButton.hidden = true;
      kandidatenListe.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false; input.disabled = true; });
    } catch (fehler) {
      kandidatenVorschau.textContent = 'Rabatt konnte nicht angewendet werden: ' + fehler.message;
    } finally {
      anwendenButton.disabled = false;
    }
  });
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
