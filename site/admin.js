Warning: truncated output (original token count: 25999)
Total output lines: 2422


const login = document.getElementById('login');
const loginStatus = document.getElementById('login-status');
const workspace = document.getElementById('workspace');
const status = document.getElementById('status');
let refreshSequenz=0;
let bookingPage=1;
let zahlungsPage=1,zahlungsLadeSequenz=0;
let csrfToken=null;
let adminBuchbareProgramme=[];

const adminViews=Array.from(document.querySelectorAll('[data-admin-view]'));
const adminViewLinks=Array.from(document.querySelectorAll('[data-admin-view-link]'));
function adminViewFinden(target){
  const element=typeof target==='string'?document.getElementById(target):target;
  return element?.matches?.('[data-admin-view]')?element:element?.closest?.('[data-admin-view]')||null;
}
function adminAnsichtAnzeigen(target,{hash=false,focus=false}={}){
  const view=adminViewFinden(target)||document.getElementById('bookings-section');
  if(!view)return;
  for(const item of adminViews)item.hidden=item!==view;
  for(const link of adminViewLinks){
    const active=link.hash==='#'+view.id;
    if(active)link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  if(hash&&location.hash!=='#'+view.id)history.pushState(null,'','#'+view.id);
  if(focus){
    const heading=view.querySelector('h2')||view;
    if(!heading.hasAttribute('tabindex'))heading.setAttribute('tabindex','-1');
    heading.focus({preventScroll:true});
    heading.scrollIntoView({behavior:'smooth',block:'start'});
  }
}
function adminAnsichtAusHash(){
  const target=location.hash.slice(1);
  adminAnsichtAnzeigen(target||'admin-dashboard');
}
window.adminNavigateToElement=id=>{
  const element=document.getElementById(id);
  const view=adminViewFinden(element);
  if(view)adminAnsichtAnzeigen(view,{hash:true});
  if(element){
    element.scrollIntoView({behavior:'smooth',block:'start'});
    if(!element.hasAttribute('tabindex'))element.setAttribute('tabindex','-1');
    element.focus({preventScroll:true});
  }
};
for(const link of adminViewLinks){
  link.addEventListener('click',event=>{
    event.preventDefault();
    adminAnsichtAnzeigen(link.hash.slice(1),{hash:true,focus:true});
  });
}
window.addEventListener('hashchange',adminAnsichtAusHash);
window.addEventListener('popstate',adminAnsichtAusHash);

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
  if (!r.ok) {
    const fehler=Error(j.error||'Fehler');
    fehler.data=j;
    throw fehler;
  }
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
    adminAnsichtAusHash();
    
    await erlebnisangeboteLaden();
    await orteLaden();
    await mitarbeiterbereicheLaden();
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

      if(b.status==='bestaetigt'){
        const protokoll=b.data.bestaetigungsEmail;
        const versand=el('p');
        versand.className='booking-email-status';
        if(protokoll?.status==='angenommen'&&protokoll.angenommenAm){
          versand.textContent='Bestätigungs-E-Mail vom Anbieter angenommen am '+
            new Date(protokoll.angenommenAm).toLocaleString('de-DE')+
            ' (Zustellung nicht bestätigt).';
        }else if(protokoll?.status==='fehlgeschlagen'){
          versand.textContent='Bestätigungs-E-Mail fehlgeschlagen am '+
            new Date(protokoll.versuchtAm).toLocaleString('de-DE')+': '+
            (protokoll.fehler||'Unbekannter Versandfehler');
        }else if(protokoll?.status==='ungeklaert'){
          versand.textContent='Versandstatus der Bestätigungs-E-Mail ungeklärt seit '+
            new Date(protokoll.versuchtAm).toLocaleString('de-DE')+'. '+
            (protokoll.fehler||'Bitte Anbieterprotokoll prüfen; nicht automatisch erneut senden.');
        }else if(protokoll?.status==='wird_versendet'){
          versand.textContent='Bestätigungs-E-Mail wird versendet …';
        }else{
          versand.textContent='Für diese Buchung ist noch kein Versandstatus der Bestätigungs-E-Mail gespeichert.';
        }
        c.append(versand);
      }

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
    const zahlungsZeile=el('p',new Date(z.erhaltenAm).toLocaleString('de-DE') +
      ' · ' + euro(cent) + ' · ' + z.methode + (z.notiz ? ' · ' + z.notiz : ''));
    zahlungsZeile.className='payment-entry-row';
    zahlungsInfo.append(zahlungsZeile);
  }

  c.append(zahlungsInfo, zahlungsformular);

  const kundenkontaktForm=document.createElement('form');
  kundenkontaktForm.className='payment-entry customer-contact';
  kundenkontaktForm.style.gridTemplateColumns='1fr';
  const kundenkontaktTitel=el('strong','Direktnachricht an den Kunden');
  const kundenkontaktInfo=el('p',b.data.email
    ? 'Wird per E-Mail an '+b.data.email+' gesendet. Betreff: Rückfrage zu deiner Buchung.'
    : 'Für diese Buchung ist keine Kunden-E-Mail hinterlegt.');
  kundenkontaktInfo.className='customer-contact-info';
  const kundenkontaktText=document.createElement('textarea');
  kundenkontaktText.name='nachricht';
  kundenkontaktText.rows=5;
  kundenkontaktText.minLength=3;
  kundenkontaktText.maxLength=3000;
  kundenkontaktText.required=true;
  kundenkontaktText.placeholder='Zum Beispiel: Die Anzahlung ist noch nicht vollständig eingegangen. Bitte melde dich kurz bei uns.';
  kundenkontaktText.setAttribute('aria-label','Nachricht an den Kunden');
  const kundenkontaktSenden=el('button','E-Mail an Kunden senden');
  kundenkontaktSenden.type='submit';
  kundenkontaktSenden.className='btn secondary';
  const kundenkontaktStatus=el('p');
  kundenkontaktStatus.setAttribute('role','status');
  kundenkontaktStatus.setAttribute('aria-live','polite');
  kundenkontaktForm.append(kundenkontaktTitel,kundenkontaktInfo);
  if(b.data.email){
    const kundenkontaktLabel=el('label','Deine Nachricht');
    kundenkontaktLabel.append(kundenkontaktText);
    kundenkontaktForm.append(kundenkontaktLabel,kundenkontaktSenden);
  }
  kundenkontaktForm.append(kundenkontaktStatus);

  const kundenkontaktHistorie=el('section');
  kundenkontaktHistorie.className='customer-contact-history';
  const kundenkontaktHistorieTitel=el('h3','E-Mail-Verlauf');
  const kundenkontaktHistorieListe=el('div');
  kundenkontaktHistorie.append(kundenkontaktHistorieTitel,kundenkontaktHistorieListe);
  function kundenkontaktHistorieRendern(){
    kundenkontaktHistorieListe.replaceChildren();
    const eintraege=Array.isArray(b.data.kundenkontakt)?[...b.data.kundenkontakt].reverse():[];
    if(!eintraege.length){
      kundenkontaktHistorieListe.append(el('p','Noch keine E-Mails aus dieser Buchung versendet.'));
      return;
    }
    const statusText={
      angenommen:'vom Versanddienst angenommen (Zustellung nicht bestätigt)',
      fehlgeschlagen:'Versand fehlgeschlagen',
      wird_versendet:'Versand begonnen; Ergebnis noch offen',
      ungeklaert:'Versand angenommen; Protokollstatus ungeklärt'
    };
    for(const eintrag of eintraege){
      const details=document.createElement('details');
      details.className='customer-contact-entry';
      const zeitpunkt=eintrag.angenommenAm||eintrag.fehlgeschlagenAm||eintrag.versuchtAm;
      const datum=zeitpunkt?new Date(zeitpunkt):null;
      const datumText=datum&&!Number.isNaN(datum.getTime())
        ?datum.toLocaleString('de-DE'):'Zeitpunkt nicht hinterlegt';
      details.append(el('summary',datumText+' · '+(statusText[eintrag.status]||'Status unbekannt')));
      details.append(el('p','Empfänger: '+(eintrag.empfaenger||b.data.email||'unbekannt')));
      details.append(el('p','Betreff: '+(eintrag.betreff||'nicht hinterlegt')));
      const inhalt=el('p',eintrag.inhalt||'Nachrichteninhalt nicht hinterlegt.');
      inhalt.className='customer-contact-content';
      details.append(inhalt);
      kundenkontaktHistorieListe.append(details);
    }
  }
  kundenkontaktHistorieRendern();

  kundenkontaktForm.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!b.data.email||!kundenkontaktForm.reportValidity())return;
    kundenkontaktSenden.disabled=true;
    kundenkontaktStatus.textContent='E-Mail wird protokolliert und gesendet …';
    try{
      const result=await api('/api/admin/buchungen/'+encodeURIComponent(b.id)+'/kontakt',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({nachricht:kundenkontaktText.value})
      });
      kundenkontaktStatus.textContent=result.message+' Empfänger: '+result.empfaenger+'.';
      if(result.eintrag){
        const historie=Array.isArray(b.data.kundenkontakt)?b.data.kundenkontakt:[];
        const index=historie.findIndex(item=>item.id===result.eintrag.id);
        if(index<0)historie.push(result.eintrag);
        else historie[index]=result.eintrag;
        b.data.kundenkontakt=historie;
        kundenkontaktHistorieRendern();
      }
      kundenkontaktText.value='';
    }catch(error){
      kundenkontaktStatus.textContent='E-Mail konnte nicht versendet werden: '+error.message;
      const eintrag=error.data?.eintrag;
      if(eintrag){
        const historie=Array.isArray(b.data.kundenkontakt)?b.data.kundenkontakt:[];
        const index=historie.findIndex(item=>item.id===eintrag.id);
        if(index<0)historie.push(eintrag);
        else historie[index]=eintrag;
        b.data.kundenkontakt=historie;
        kundenkontaktHistorieRendern();
      }
    }finally{
      kundenkontaktSenden.disabled=false;
    }
  });
  c.append(kundenkontaktForm,kundenkontaktHistorie);
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
      speichern.className = 'btn secondary';

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
    const ergebnis = await api('/api/admin/buchungen/' + encodeURIComponent(b.id), {
      method: 'DELETE'
    });
    if (!ergebnis.success) throw Error('Buchungsanfrage wurde nicht gelöscht.');
    c.remove();
    await refresh();
    try {
      await kalenderLaden();
    } catch (kalenderFehler) {
      meldung.textContent = 'Buchungsanfrage gelöscht; Kalender konnte nicht aktualisiert werden.';
    }
  } catch (err) {

    meldung.textContent = 'Fehler beim Löschen: ' + err.message;
    loeschen.disabled = false;
  }
};

     const zahlungSenden = el('button', 'Zahlungsinformationen senden');
zahlungSenden.className = 'btn secondary';
      
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
    const ergebnis = await api('/api/admin/buchungen/' + encodeURIComponent(b.id) + '/zahlung', {
      method: 'POST'
    });

    b.zahlungsinfo_gesendet_am = ergebnis.zahlungsinfoGesendetAm;
    zahlungsButtonAktualisieren();
    meldung.textContent = 'Zahlungsinformationen versendet und Versandzeit gespeichert.';
    await refresh();

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
    const bookingActions=el('div');
    bookingActions.className='booking-actions';
    loeschen.className='btn danger';
    bookingActions.append(speichern,zahlungSenden,exportLink,loeschen);
    c.append(bookingActions,meldung);
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
    if(loginStatus)loginStatus.textContent=e.message;
    status.textContent = e.…10999 tokens truncated…t)return;
  const status=document.getElementById('mitarbeiterbereich-status');
  try{
    const areas=await api('/api/admin/mitarbeiterbereiche');
    const createForm=document.getElementById('mitarbeiterbereich-form');
    const createLocations=createForm?.elements.standorte;
    if(createLocations){await mitarbeiterbereichStandorteFuellen(createLocations);mitarbeiterbereichArtSynchronisieren(createForm);}
    list.replaceChildren();
    if(!areas.length){list.append(el('p','Noch keine Mitarbeiterbereiche angelegt.'));return;}
    for(const area of areas){
      const card=el('article');card.className='booking staff-area-admin-card';
      const locations=(area.standorte||[]).map(place=>place.name).join(', ');
      card.append(el('strong',area.titel),el('p',(mitarbeiterbereichArten[area.art]||area.art)+
        (locations?' · '+locations:'')+' · '+(area.aktiv?'Im Mitarbeiterbereich sichtbar':'Deaktiviert · nur in der Verwaltung sichtbar')));
      const preview=el('p',area.inhalt);preview.className='staff-area-preview';card.append(preview);
      const details=document.createElement('details'),summary=el('summary','Bereich bearbeiten');
      const form=document.createElement('form');form.className='staff-area-edit-form';
      const typeLabel=el('label','Bereichstyp');const type=document.createElement('select');type.name='art';
      for(const [value,labelText] of Object.entries(mitarbeiterbereichArten)){
        const option=el('option',labelText);option.value=value;option.selected=area.art===value;type.append(option);
      }
      typeLabel.append(type);
      const titleLabel=el('label','Bezeichnung');const title=document.createElement('input');title.name='titel';title.maxLength=100;title.required=true;title.value=area.titel;titleLabel.append(title);
      const contentLabel=el('label','Inhalt');const content=document.createElement('textarea');content.name='inhalt';content.maxLength=20000;content.rows=7;content.required=true;content.value=area.inhalt;contentLabel.append(content);
      const locationsLabel=el('label','Standorte (Mehrfachauswahl möglich)');const locationsSelect=document.createElement('select');locationsSelect.name='standorte';locationsSelect.multiple=true;locationsSelect.size=5;locationsSelect.className='staff-area-locations';
      await mitarbeiterbereichStandorteFuellen(locationsSelect,(area.standorte||[]).map(place=>place.id));locationsLabel.append(locationsSelect);
      const activeLabel=el('label');activeLabel.className='check';const active=document.createElement('input');active.type='checkbox';active.name='aktiv';active.checked=area.aktiv;activeLabel.append(active,el('span','Im Mitarbeiterbereich anzeigen'));
      const save=el('button','Änderungen speichern');save.type='submit';save.className='btn';
      const remove=el('button','Bereich löschen');remove.type='button';remove.className='btn danger';
      form.append(typeLabel,titleLabel,contentLabel,locationsLabel,activeLabel,save,remove);
      type.addEventListener('change',()=>mitarbeiterbereichArtSynchronisieren(form));
      mitarbeiterbereichArtSynchronisieren(form);
      form.addEventListener('submit',async event=>{
        event.preventDefault();save.disabled=true;
        try{
          await api('/api/admin/mitarbeiterbereiche/'+encodeURIComponent(area.id),{method:'PATCH',headers:{'Content-Type':'application/json'},
            body:JSON.stringify(mitarbeiterbereichFormDaten(form))});
          status.textContent='Mitarbeiterbereich gespeichert.';await mitarbeiterbereicheLaden();
        }catch(error){status.textContent='Änderung fehlgeschlagen: '+error.message;save.disabled=false;}
      });
      remove.addEventListener('click',async()=>{
        if(!window.confirm('Mitarbeiterbereich „'+area.titel+'“ endgültig löschen?'))return;
        remove.disabled=true;
        try{
          await api('/api/admin/mitarbeiterbereiche/'+encodeURIComponent(area.id),{method:'DELETE'});
          status.textContent='Mitarbeiterbereich gelöscht.';await mitarbeiterbereicheLaden();
        }catch(error){status.textContent='Bereich konnte nicht gelöscht werden: '+error.message;remove.disabled=false;}
      });
      details.append(summary,form);card.append(details);list.append(card);
    }
  }catch(error){status.textContent='Mitarbeiterbereiche konnten nicht geladen werden: '+error.message;}
}

document.getElementById('mitarbeiterbereich-form')?.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]');
  const status=document.getElementById('mitarbeiterbereich-status');button.disabled=true;
  try{
    await api('/api/admin/mitarbeiterbereiche',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(mitarbeiterbereichFormDaten(form))});
    form.reset();status.textContent='Mitarbeiterbereich angelegt.';await mitarbeiterbereicheLaden();
  }catch(error){status.textContent='Mitarbeiterbereich konnte nicht angelegt werden: '+error.message;}
  finally{button.disabled=false;}
});
document.getElementById('mitarbeiterbereich-form')?.elements.art?.addEventListener('change',event=>
  mitarbeiterbereichArtSynchronisieren(event.currentTarget.form));

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
