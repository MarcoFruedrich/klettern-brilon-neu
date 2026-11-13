
const login = document.getElementById('login');
const loginStatus = document.getElementById('login-status');
const workspace = document.getElementById('workspace');
const status = document.getElementById('status');
let refreshSequenz=0;
let bookingPage=1;
let zahlungsPage=1,zahlungsLadeSequenz=0;
let csrfToken=null;
let demoReadOnly=false;
let adminBuchbareProgramme=[];
let ausgewaehltesAdminProgramm=null;
let zuletztAngelegtesAdminProgramm=null;
function adminProgrammEinzelansicht(id,{focus=false}={}){
  const liste=document.getElementById('angebote-admin-liste');
  const picker=document.getElementById('admin-program-picker');
  if(!liste||!picker)return;
  ausgewaehltesAdminProgramm=id;
  for(const karte of liste.querySelectorAll(':scope > .card')){
    karte.hidden=id!=='alle'&&karte.dataset.programId!==String(id);
  }
  for(const button of picker.querySelectorAll('button[data-program-id]')){
    button.setAttribute('aria-pressed',String(button.dataset.programId===String(id)));
  }
  if(focus){
    const selected=liste.querySelector(':scope > .card:not([hidden])');
    if(selected){
      selected.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
      const heading=selected.querySelector('h3');
      if(heading){
        heading.setAttribute('tabindex','-1');
        heading.focus({preventScroll:true});
      }
    }
  }
}


const adminViews=Array.from(document.querySelectorAll('[data-admin-view]'));
const adminViewLinks=Array.from(document.querySelectorAll('[data-admin-view-link]'));
const adminSubnavigation=document.getElementById('admin-subnavigation');
const adminSubnavGroups=Array.from(document.querySelectorAll('[data-subnav-group]'));
const adminSections={
  buchungen:['bookings-section','payment-overview-section','rechnungen-agb-section','admin-guestbook-section'],
  programme:['angebote-verwaltung','besuchergruppen-admin-section','gps-verwaltung','special-offers-view','anschlussrabatt-section'],
  kontakte:['mitarbeiter-einladen-section','mitarbeiter-section','netzwerkpartner-einladen-section',
    'netzwerkpartner-section','mitarbeiterbereiche-admin-section'],
  oeffentlichkeit:['whatsapp-admin-section','feedback-admin-section','social-media-section',
    'marketing-campaign-section','kundenfeedback-section']
};
let bookingTab='alle';
let programTab='liste';
const adminSectionGroup=id=>Object.keys(adminSections).find(group=>adminSections[group].includes(id))||null;
function adminViewFinden(target){
  const element=typeof target==='string'?document.getElementById(target):target;
  return element?.matches?.('[data-admin-view]')?element:element?.closest?.('[data-admin-view]')||null;
}
function adminAnsichtAnzeigen(target,{hash=false,focus=false}={}){
  const view=adminViewFinden(target)||document.getElementById('bookings-section');
  if(!view)return;
  for(const item of adminViews)item.hidden=item!==view;
  const group=adminSectionGroup(view.id);
  if(adminSubnavigation)adminSubnavigation.hidden=!group;
  for(const row of adminSubnavGroups)row.hidden=row.dataset.subnavGroup!==group;
  for(const link of adminViewLinks){
    const groupParent=link.closest('.admin-navigation');
    const active=link.hash==='#'+view.id &&
      (!link.dataset.bookingStatus||link.dataset.bookingStatus===bookingTab) &&
      (!link.dataset.programTab||link.dataset.programTab===programTab);
    const groupActive=groupParent&&link.classList.contains('admin-nav-main-group') &&
      group===adminSectionGroup(link.hash.slice(1));
    if(active||groupActive)link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  const programSwitcher=document.getElementById('admin-program-secondary');
  if(programSwitcher)programSwitcher.hidden=programTab==='neu';
  const programForm=document.getElementById('neues-angebot-form');
  const programList=document.getElementById('angebote-admin-liste');
  const programHeading=programForm?.previousElementSibling;
  if(programForm&&programList){
    programForm.hidden=programTab!=='neu'&&programTab!=='preise';
    if(programHeading?.tagName==='H3')programHeading.hidden=programTab!=='neu'&&programTab!=='preise';
    programList.hidden=programTab==='neu';
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
    const vorherigerBuchungsfilter=bookingTab;
    if(link.dataset.bookingStatus){
      bookingTab=link.dataset.bookingStatus;
      const filter=document.getElementById('bookings-status-filter');
      if(filter)filter.value=bookingTab;
      bookingPage=1;
    } else if(link.hash==='#bookings-section'){
      bookingTab='alle';
      const filter=document.getElementById('bookings-status-filter');
      if(filter)filter.value='alle';
      bookingPage=1;
    }
    if(link.dataset.programTab)programTab=link.dataset.programTab;
    else if(link.hash==='#angebote-verwaltung')programTab='liste';
    adminAnsichtAnzeigen(link.hash.slice(1),{hash:true,focus:true});
    if(link.dataset.bookingStatus||(link.hash==='#bookings-section'&&vorherigerBuchungsfilter!=='alle'))refresh();
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
  if(path==='/api/admin/login'){csrfToken=j.csrfToken||null;demoReadOnly=j.readOnly===true;}
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

async function umbuchungsanfragenLaden(){
  const list=document.getElementById('reschedule-requests-list');
  const status=document.getElementById('reschedule-requests-status');
  if(!list)return;
  try{
    const result=await api('/api/admin/umbuchungsanfragen');
    list.replaceChildren();
    const requests=result.anfragen||[];
    status.textContent=requests.length?`${requests.length} bestätigte Umbuchungsanfrage(n) warten auf Entscheidung.`:'Keine Umbuchungsanfragen zur Freigabe.';
    for(const request of requests){
      const card=el('article');card.className='booking';
      const data=request.data||{};
      card.append(el('h4',`${request.buchungsnummer||data.buchungsnummer||'Buchung'} · ${data.name||'Kunde'}`));
      card.append(el('p',`${data.angebot||'Programm'} · bisher: ${data.datum||'—'} um ${data.uhrzeit||'—'} Uhr`));
      card.append(el('p',`gewünscht: ${request.wunschdatum||'—'} um ${(request.wunschzeit||'').slice(0,5)||'—'} Uhr`));
      card.append(el('p',`Kontakt: ${data.email||'keine E-Mail hinterlegt'} · Anfrage bestätigt: ${request.bestaetigt_am?new Date(request.bestaetigt_am).toLocaleString('de-DE'):'—'}`));
      const feedback=el('p');feedback.setAttribute('role','status');
      const actions=el('div');actions.className='booking-actions';
      for(const [decision,label] of [['freigegeben','Umbuchung freigeben'],['abgelehnt','Umbuchung ablehnen']]){
        const button=el('button',label);button.type='button';button.className=decision==='freigegeben'?'btn':'btn secondary';
        button.addEventListener('click',async()=>{
          if(!confirm(decision==='freigegeben'
            ?`Umbuchung auf ${request.wunschdatum} um ${(request.wunschzeit||'').slice(0,5)} Uhr freigeben?`
            :'Umbuchungsanfrage ablehnen? Die bisherige Buchung bleibt bestehen.'))return;
          button.disabled=true;feedback.textContent='Entscheidung wird gespeichert …';
          try{
            await api('/api/admin/umbuchungsanfragen/'+encodeURIComponent(request.anfrage_id),{
              method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:decision})
            });
            feedback.textContent=decision==='freigegeben'?'Umbuchung freigegeben.':'Umbuchungsanfrage abgelehnt.';
            await refresh();
          }catch(error){feedback.textContent='Entscheidung nicht gespeichert: '+error.message;button.disabled=false;}
        });
        actions.append(button);
      }
      card.append(actions,feedback);list.append(card);
    }
  }catch(error){status.textContent='Umbuchungsanfragen konnten nicht geladen werden: '+error.message;}
}
document.getElementById('reschedule-requests-refresh')?.addEventListener('click',umbuchungsanfragenLaden);

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
    const demoBanner=document.getElementById('demo-readonly-banner');
    if(demoBanner)demoBanner.hidden=!demoReadOnly;
    const ownerCard=document.getElementById('demo-owner-card');
    if(ownerCard)ownerCard.hidden=!demoReadOnly;
    document.body.classList.toggle('admin-demo-readonly',demoReadOnly);
    adminAnsichtAusHash();

    await rechnungsdatenLaden();
    await rechnungenLaden();

    await erlebnisangeboteLaden();
    await teamerbaseProgrammeLaden();
    await window.besuchergruppenAdminLaden?.();
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
      if(b.status==='bestaetigt'&&b.data.datum&&b.data.datum<=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Berlin'})){
        const durchgefuehrt=el('button',b.data.programmStattgefunden?'✓ Programm als stattgefunden dokumentiert':'Programm hat stattgefunden dokumentieren');
        durchgefuehrt.type='button';durchgefuehrt.className='btn secondary';
        durchgefuehrt.disabled=Boolean(b.data.programmStattgefunden);
        const durchfuehrungStatus=el('small',b.data.programmStattgefundenAm?'Dokumentiert am '+new Date(b.data.programmStattgefundenAm).toLocaleString('de-DE'):'');
        durchgefuehrt.addEventListener('click',async()=>{
          durchgefuehrt.disabled=true;
          try{
            await api('/api/admin/buchungen/'+encodeURIComponent(b.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:b.status,bearbeitungsnotiz:b.bearbeitungsnotiz||'',programmStattgefunden:true})});
            await refresh();
          }catch(error){durchfuehrungStatus.textContent='Konnte nicht gespeichert werden: '+error.message;durchgefuehrt.disabled=false;}
        });
        c.append(durchgefuehrt,durchfuehrungStatus);
      }
      if(b.data.wiederkehrenderKundeHinweis===true){
        const returning=el('p','Wiedererkannt: frühere bestätigte Buchung liegt vor.');
        returning.className='booking-customer-returning';c.append(returning);
      }
      if(b.data.empfehlung){
        const referral=b.data.empfehlung;
        c.append(el('p',`Empfehlungsgeber: ${referral.email}`));
        c.append(el('p',`Nachweis der früheren Buchung: ${referral.buchungsnummer||'Buchung'} · ${referral.programm||'Programm'} am ${referral.veranstaltungsdatum||'Datum unbekannt'} (als stattgefunden dokumentiert am ${referral.stattgefundenAm?new Date(referral.stattgefundenAm).toLocaleDateString('de-DE'):'—'})`));
        c.append(el('p',referral.bestaetigtAm?'Empfehlung per E-Mail bestätigt am '+new Date(referral.bestaetigtAm).toLocaleString('de-DE'):'Wartet auf die Bestätigung des Empfehlungsgebers per E-Mail.'));
      }
      if(Number(b.data.rabattCent)>0){
        const grund=b.data.rabattArt==='anschlussbuchung'?'Anschlussbuchung':
          b.data.rabattArt==='empfehlung'?'Freunde werben Freunde':'Rabatt';
        c.append(el('p',`Angewandter Rabatt (${grund}): ${euroCent(Number(b.data.rabattCent)||0)}`));
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
  const lokalesHeute=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  zahlungsformular.innerHTML = '<label>Eingegangener Betrag (€)<input name="betrag" type="number" min="0.01" max="' +
    (restbetragCent / 100).toFixed(2) + '" step="0.01" required></label>' +
    '<label>Buchungsdatum / Zahlungseingang<input name="eingangsdatum" type="date" value="'+lokalesHeute+'" required></label>' +
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
    const eingangsDatum=z.eingangsdatum?new Date(z.eingangsdatum+'T12:00:00').toLocaleDateString('de-DE'):'Datum nicht hinterlegt';
    const zahlungsZeile=el('p',eingangsDatum+' · erfasst '+new Date(z.erhaltenAm).toLocaleString('de-DE') +
      ' · ' + euro(cent) + ' · ' + z.methode + (z.notiz ? ' · ' + z.notiz : ''));
    zahlungsZeile.className='payment-entry-row';
    zahlungsInfo.append(zahlungsZeile);
  }

  c.append(zahlungsInfo, zahlungsformular);
  if(b.data.rechnung?.id){
    const invoice=el('div');invoice.className='invoice-status';
    invoice.append(el('p',`Rechnung ${b.data.rechnung.nummer||''}: ${b.data.rechnung.status||'erstellt'}`));
    const download=el('a','PDF herunterladen');download.href='/api/admin/rechnungen/'+encodeURIComponent(b.data.rechnung.id)+'.pdf';invoice.append(download);
    c.append(invoice);
  }

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
    await umbuchungsanfragenLaden();

    const offers = await api('/api/admin/aktionen');
    const list = document.getElementById('special-list');
    list.replaceChildren();

    for (const a of offers) {
      const c = el('div');
      c.className = 'booking'+(a.status==='vorschlag'?' special-offer-proposal':'');

      c.append(
        el('strong', a.titel),
        el('p', (a.datum || '') + ' ' + (a.beschreibung || '')),
        el('p',a.programm_id?
          'Explizit verknüpft mit Programm-ID: '+a.programm_id+
          ' (Verfügbarkeit wird bei Anfragen neu geprüft)':
          'Unabhängige Aktion – kein Programm automatisch ausgewählt')
      );

      if(a.status==='vorschlag'){
        const direction=a.vorschlagsrichtung==='davor'?'vor dem gebuchten Programm':'nach dem gebuchten Programm';
        const staff=Array.isArray(a.vorschlagsmitarbeiter)?a.vorschlagsmitarbeiter.map(person=>person.name).filter(Boolean).join(', '):'';
        const prominent=el('p',`⚠ VERWALTUNGSVORSCHLAG · ${a.datum||'Datum offen'} · ${a.uhrzeit||'--:--'}–${a.endzeit||'--:--'} Uhr · ${a.veranstaltungsort||'Standort offen'} · ${direction}`);
        prominent.className='special-offer-proposal-badge';c.append(prominent);
        c.append(el('p',`Anschluss an „${a.quellprogramm||'gebuchtes Programm'}“ · ${Number(a.teilnehmer)||'Gruppengröße offen'} Teilnehmende · Mitarbeiter: ${staff||'—'}`));
        const titleInput=document.createElement('input');titleInput.value=a.titel||'';titleInput.maxLength=120;titleInput.required=true;
        const titleLabel=el('label','Angebotstitel');titleLabel.append(titleInput);
        const descriptionInput=document.createElement('textarea');descriptionInput.value=a.beschreibung||'';descriptionInput.maxLength=1000;descriptionInput.rows=3;
        const descriptionLabel=el('label','Kurzbeschreibung');descriptionLabel.append(descriptionInput);
        const priceInput=document.createElement('input');priceInput.type='number';priceInput.min='0';priceInput.step='0.01';priceInput.required=true;priceInput.value=a.preis??'';
        const priceLabel=el('label','Aktionspreis für die Gruppe (€)');priceLabel.append(priceInput);
        c.append(titleLabel,descriptionLabel,priceLabel);
      }

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
          'X-Original-Filename': datei.name,
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

const bildFormatHinweis=el('p','Erlaubt: JPG/JPEG, PNG und WebP · maximal 5 MB pro Bild.');
bildFormatHinweis.className='hint';
bildBereich.append(bildAuswahl,bildButton,bildFormatHinweis);
c.append(bildBereich);
      const btn = el('button', a.status==='vorschlag'?'Vorschlag verwerfen':'Löschen');
      btn.className = 'danger';

      btn.onclick = async () => {
        if (confirm(a.status==='vorschlag'?'Diesen Verwaltungsvorschlag verwerfen?':'Angebot wirklich löschen?')) {
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

      if(a.status==='vorschlag'){
        const publish=el('button','Vorschlag prüfen und veröffentlichen');publish.type='button';publish.className='btn';
        const proposalTitle=c.querySelector('input'),proposalDescription=c.querySelector('textarea'),proposalPrice=c.querySelector('input[type="number"]');
        publish.addEventListener('click',async()=>{
          publish.disabled=true;
          try{
            await api(`/api/admin/aktionen/${encodeURIComponent(a.id)}/freigeben`,{method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({titel:proposalTitle.value,beschreibung:proposalDescription.value,preis:proposalPrice.value,programm_id:offerSelect.value})});
            status.textContent='Tagesangebot veröffentlicht und für die vorgeschlagene Uhrzeit buchbar.';
            await refresh();
          }catch(error){status.textContent='Vorschlag konnte nicht freigegeben werden: '+error.message;publish.disabled=false;}
        });
        c.append(publish);
      }
      c.append(btn);
      list.append(c);
    }
  } catch (e) {
    login.hidden = false;
    workspace.hidden = true;
    if(loginStatus)loginStatus.textContent=e.message;
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
        window.adminNavigateToElement('admin-guestbook-section');
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

function qrAnmeldungDrucken(angebot){
  const printWindow=window.open('','_blank');
  if(!printWindow){alert('Druckansicht wurde blockiert. Bitte Pop-ups für diese Seite erlauben.');return;}
  printWindow.opener=null;
  const doc=printWindow.document;doc.open();doc.write('<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QR-Anmeldung Brilon</title></head><body></body></html>');doc.close();
  const style=doc.createElement('style');style.textContent='*{box-sizing:border-box}body{font:16px/1.45 system-ui,sans-serif;color:#173d34;margin:0;padding:20px}.toolbar{position:sticky;top:0;background:#fff;padding:8px 0 16px}.toolbar button{font:inherit;font-weight:700;padding:12px 18px}.label{max-width:760px;margin:8mm auto;border:2px solid #236148;border-radius:16px;padding:10mm;text-align:center}.label h1{margin:0 0 8px}.label img{display:block;width:min(70vw,300px);height:auto;margin:16px auto}.hint{font-size:14px;color:#40564d}@media print{body{padding:0}.toolbar{display:none}.label{margin:0 auto;border:0}}';doc.head.append(style);
  const toolbar=doc.createElement('div');toolbar.className='toolbar';const button=doc.createElement('button');button.type='button';button.textContent='QR-Code drucken';button.onclick=()=>printWindow.print();toolbar.append(button);doc.body.append(toolbar);
  const card=doc.createElement('main');card.className='label';card.append(Object.assign(doc.createElement('h1'),{textContent:'Klettern & Abenteuer · Jugendherberge Brilon'}),Object.assign(doc.createElement('h2'),{textContent:angebot.name}));
  try{const target=new URL('/',location.origin);target.searchParams.set('zugang','jh-brilon');target.searchParams.set('programm',String(angebot.id));const image=doc.createElement('img');image.alt='QR-Code zur Programmanmeldung';image.src=window.GPSQrEtiketten.dataUri(target.toString());card.append(image);}
  catch(error){printWindow.close();alert('QR-Code konnte nicht erzeugt werden: '+error.message);return;}
  const note=doc.createElement('p');note.className='hint';note.textContent='Scanne den QR-Code mit dem Handy, wähle Termin und Personenzahl und trage deine Zimmernummer ein.';card.append(note);doc.body.append(card);
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
document.getElementById('bookings-status-filter')?.addEventListener('change', () => {bookingTab=document.getElementById('bookings-status-filter').value;bookingPage=1;adminAnsichtAnzeigen('bookings-section');refresh();});
document.getElementById('bookings-prev')?.addEventListener('click',()=>{if(bookingPage>1){bookingPage--;refresh();}});
document.getElementById('bookings-next')?.addEventListener('click',()=>{bookingPage++;refresh();});
document.getElementById('payment-overview-filter')?.addEventListener('change', () => {zahlungsPage=1;zahlungsuebersichtLaden();});
document.getElementById('payment-overview-prev')?.addEventListener('click',()=>{if(zahlungsPage>1){zahlungsPage--;zahlungsuebersichtLaden();}});
document.getElementById('payment-overview-next')?.addEventListener('click',()=>{zahlungsPage++;zahlungsuebersichtLaden();});

login.onsubmit = async e => {
  e.preventDefault();
  if(loginStatus)loginStatus.textContent='';

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
    history.replaceState(null,'','#admin-dashboard');
    refresh();
  } catch (err) {
    if(loginStatus)loginStatus.textContent=err.message;
    else status.textContent=err.message;
  }
};

document.getElementById('demo-feedback-form')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget,field=document.getElementById('demo-feedback-message');
  const output=document.getElementById('demo-feedback-status'),button=form.querySelector('button[type="submit"]');
  if(!field.value.trim()){output.textContent='Bitte zuerst einen Vorschlag eingeben.';return;}
  button.disabled=true;output.textContent='Wird an die Verwaltung weitergeleitet …';
  try{
    const result=await api('/api/demo-vorschlag',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:field.value})});
    output.textContent=result.message||'Vielen Dank. Der Vorschlag wurde weitergeleitet.';
    field.value='';
  }catch(error){output.textContent='Versand nicht möglich: '+error.message;}
  finally{button.disabled=false;}
});

document.getElementById('logout').onclick = async () => {
  await api('/api/admin/logout', {
    method: 'POST'
  });
  location.reload();
};

window.addEventListener('klettern:sonderangebot-vorbereiten',event=>{
  const form=document.getElementById('special-form'),data=event.detail||{};
  if(!form)return;
  form.elements.titel.value=`Zusatztermin ${data.site||''} · ${data.title||'Programm'}`.replace(/\s+/g,' ').trim();
  form.elements.datum.value=data.date||'';
  form.elements.beschreibung.value=`Zusätzliche Kapazität laut Mitarbeiterbereitschaft von ${data.staff?.join(', ')||'Mitarbeitern'} rund um den Kundentermin${data.time?' um '+data.time+' Uhr':''}. Bitte den konkreten Zusatztermin, Preis und Programmauswahl prüfen, bevor das Angebot veröffentlicht wird.`;
  window.adminNavigateToElement?.('special-offers-section');
  form.elements.titel.focus();
});
window.addEventListener('klettern:sonderangebote-aktualisieren',()=>refresh());

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

let kalenderMitarbeitende = [];
async function kalenderMitarbeitendeLaden(){
  kalenderMitarbeitende=await api('/api/admin/kalender-mitarbeitende');
}
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
        // Aktuelle Bewerbungen und zugewiesene Mitarbeiter befinden sich
        // im zentralen Einsatzplanungsbereich desselben Verwaltungskalenders.
        kalenderInfo.append(el('p','Mitarbeiterzuweisung und Stundenkontrolle siehe zentrale Einsatzplanung oben.'));
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
    const [buchungen]=await Promise.all([
      api('/api/admin/kalenderbuchungen?monat='+encodeURIComponent(monat)),
      kalenderMitarbeitendeLaden()
    ]);
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
const kalenderAlleStandorte = document.getElementById('calendar-all-sites');
const kalenderStandortListe = document.getElementById('calendar-site-list');

function kalenderStandortAuswahlAnzeigen(orte, selectedNames=null) {
  if (!kalenderStandortListe || !kalenderAlleStandorte) return;
  const selected = selectedNames===null
    ? new Set([...kalenderStandortListe.querySelectorAll('input:checked')].map(input=>input.value))
    : new Set(selectedNames);
  kalenderStandortListe.replaceChildren();
  for (const ort of orte.filter(item=>item.aktiv)) {
    const label=document.createElement('label');label.className='check';
    const input=document.createElement('input');input.type='checkbox';input.name='kalender-standort';input.value=ort.name;input.checked=selected.has(ort.name);
    input.addEventListener('change',()=>{
      if(input.checked)kalenderAlleStandorte.checked=false;
      kalenderStandortListe.hidden=kalenderAlleStandorte.checked;
    });
    label.append(input,el('span',ort.name));kalenderStandortListe.append(label);
  }
  kalenderStandortListe.hidden=kalenderAlleStandorte.checked;
}

kalenderAlleStandorte?.addEventListener('change',()=>{
  if(kalenderAlleStandorte.checked){
    kalenderStandortListe?.querySelectorAll('input[type="checkbox"]').forEach(input=>input.checked=false);
  }
  if(kalenderStandortListe)kalenderStandortListe.hidden=kalenderAlleStandorte.checked;
});

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
          (eintrag.typ === 'sperrzeit' ? 'Gesperrt: ' : eintrag.typ==='buchungsfenster'?'QR-Zeitfenster: ':'Termin: ') +
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
      karte.append(el('p', 'Standort(e): ' + (eintrag.standorte?.length ? eintrag.standorte.join(', ') : 'Alle Standorte')));

      const bearbeitenButton = document.createElement('button');
bearbeitenButton.type = 'button';
bearbeitenButton.className = 'btn secondary';
bearbeitenButton.textContent = 'Termin bearbeiten';

bearbeitenButton.onclick = () => {
  kalenderBearbeitenId = eintrag.id;

  const eintragStandorte=Array.isArray(eintrag.standorte)?eintrag.standorte:[];
  kalenderAlleStandorte.checked=eintragStandorte.length===0;
  kalenderStandortListe?.querySelectorAll('input[type="checkbox"]').forEach(input=>{
    input.checked=eintragStandorte.includes(input.value);
  });
  if(kalenderStandortListe)kalenderStandortListe.hidden=kalenderAlleStandorte.checked;

  for (const name of [
    'typ', 'titel', 'datum', 'enddatum',
    'uhrzeit', 'endzeit', 'beschreibung', 'programm_id', 'gruppen_kapazitaet'
  ]) {
    const feld = kalenderFormular.elements.namedItem(name);
    if (feld) feld.value = eintrag[name] || '';
  }
  qrCalendarFields();

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
const calendarType=kalenderFormular.elements.namedItem('typ');
const calendarQrProgram=kalenderFormular.elements.namedItem('programm_id');
const calendarCentralToggle=kalenderFormular.elements.namedItem('zwei_startzeiten');
function qrCalendarFields(){
  const qr=calendarType?.value==='buchungsfenster',editing=Boolean(kalenderBearbeitenId);
  document.getElementById('calendar-qr-program-field').hidden=!qr;
  document.getElementById('calendar-qr-capacity-field').hidden=!qr;
  document.getElementById('calendar-central-times-toggle-label').hidden=!qr||editing;
  document.getElementById('calendar-central-times').hidden=!qr||editing||!calendarCentralToggle?.checked;
  document.getElementById('calendar-location-picker').hidden=qr;
}
calendarType?.addEventListener('change',qrCalendarFields);
calendarCentralToggle?.addEventListener('change',qrCalendarFields);
qrCalendarFields();
api('/api/angebote').then(offers=>{
  const active=(Array.isArray(offers)?offers:[]).filter(item=>item.aktiv!==false&&
    (item.veranstaltungsort==='Jugendherberge Brilon'||(item.veranstaltungsorte||[]).includes('Jugendherberge Brilon')));
  for(const item of active){const option=document.createElement('option');option.value=String(item.id);option.textContent=item.name;calendarQrProgram.append(option);}
}).catch(()=>{});
kalenderFormular.onsubmit = async event => {
  event.preventDefault();

  const knopf = kalenderFormular.querySelector('button[type="submit"]');
  knopf.disabled = true;
  kalenderFormStatus.textContent = 'Termin wird gespeichert ...';

  try {
    const daten = Object.fromEntries(
      new FormData(kalenderFormular).entries()
    );
    const einzelneStandorte=[...kalenderStandortListe.querySelectorAll('input[type="checkbox"]:checked')].map(input=>input.value);
    if(daten.typ!=='buchungsfenster'&&!kalenderAlleStandorte.checked&&!einzelneStandorte.length){
      kalenderFormStatus.textContent='Bitte wähle „Alle Standorte“ oder mindestens einen einzelnen Standort aus.';
      kalenderStandortListe.hidden=false;
      return;
    }
    daten.standorte=kalenderAlleStandorte.checked?[]:einzelneStandorte;
    const pair=daten.typ==='buchungsfenster'&&daten.zwei_startzeiten==='ja'&&!kalenderBearbeitenId;
    if(daten.typ==='buchungsfenster'){
      if(!daten.programm_id)daten.programm_id='';
      daten.gruppen_kapazitaet=Number(daten.gruppen_kapazitaet||10);
      daten.standorte=['Jugendherberge Brilon'];
    }
    if(pair){
      const windows=[{start:daten.startzeit_1,ende:daten.endzeit_1},{start:daten.startzeit_2,ende:daten.endzeit_2}];
      if(windows.some(window=>!window.start||!window.ende||window.start>=window.ende))
        throw new Error('Bitte für beide Startzeiten ein gültiges Ende nach dem Beginn eintragen.');
      for(const window of windows){
        const payload={...daten,titel:`${daten.titel} (${window.start} Uhr)`,uhrzeit:window.start,endzeit:window.ende};
        await api('/api/admin/kalender',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      }
    }else await api(
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
    kalenderAlleStandorte.checked=true;
    kalenderStandortListe.querySelectorAll('input[type="checkbox"]').forEach(input=>input.checked=false);
    kalenderStandortListe.hidden=true;
    kalenderBearbeitenId = null;
    qrCalendarFields();
knopf.textContent = 'Termin oder Sperrzeit speichern';
    kalenderFormStatus.textContent = pair?'Beide zentralen QR-Zeitfenster wurden angelegt.':'Termin erfolgreich gespeichert.';

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

function programmStufenEditor(container, initial=[], presets=[[1,5,"",60],[6,10,"",90],[11,15,"",120],[16,20,"",150]]){
  if(!container)return;
  const rows=Array.isArray(initial)&&initial.length?initial:presets.map(([min,max,preis,dauer])=>({min,max,preis,dauer}));
  container.replaceChildren();
  const addRow=(data={min:'',max:'',preis:'',dauer:''})=>{
    const row=document.createElement('div');row.className='angebot-stufen-zeile';
    const field=(labelText,name,value,type='number')=>{
      const label=document.createElement('label');label.textContent=labelText;label.dataset.tierField=name;
      const input=document.createElement('input');input.type=type;input.name=name;input.value=value??'';
      input.min=name==='min'||name==='max'?'1':name==='preis'?'0':'15';
      input.max=name==='min'||name==='max'?'1000':'1440';input.step=name==='preis'?'0.01':'1';input.required=true;
      label.append(input);row.append(label);return input;
    };
    field('Von Teilnehmenden','min',data.min);
    field('Bis Teilnehmende','max',data.max);
    field('Gruppenpreis (€)','preis',data.preis??data.price??'');
    field('Dauer (Minuten)','dauer',data.dauer??'');
    const remove=document.createElement('button');remove.type='button';remove.className='btn danger';remove.textContent='Stufe entfernen';remove.addEventListener('click',()=>row.remove());row.append(remove);
    container.append(row);
  };
  for(const row of rows)addRow(row);
  container.onaddprogramtier=()=>addRow();
}

function programmStufenAuslesen(container){
  return [...(container?.querySelectorAll('.angebot-stufen-zeile')||[])].map(row=>({
    min:Number(row.querySelector('[name="min"]').value),
    max:Number(row.querySelector('[name="max"]').value),
    preis:row.querySelector('[name="preis"]').value===''?null:Number(row.querySelector('[name="preis"]').value),
    dauer:Number(row.querySelector('[name="dauer"]').value)
  }));
}

const neuesAngebotForm =
  document.getElementById('neues-angebot-form');

if (neuesAngebotForm) {
  const createTierEditor=document.getElementById('neues-angebot-stufen');
  programmStufenEditor(createTierEditor);
  document.getElementById('neues-angebot-stufe-hinzufuegen')?.addEventListener('click',()=>{createTierEditor?.onaddprogramtier?.();createTierDurationMode();});
  const angebotsModus = neuesAngebotForm.elements.buchungsmodus;
  const createTierFieldset=createTierEditor?.closest('fieldset');
  const einzelplatzFelder=neuesAngebotForm.querySelector('.two');
  const angebotsKapazitaet = neuesAngebotForm.elements.kapazitaet;
  const angebotsKapazitaetLabel = angebotsKapazitaet.closest('label');
  function angebotsKapazitaetPruefen() {
    const einzelplaetze = angebotsModus.value === 'einzelplatz';
    if(einzelplatzFelder)einzelplatzFelder.hidden=!einzelplaetze;
    angebotsKapazitaet.min = einzelplaetze ? '5' : '1';
    angebotsKapazitaet.max = einzelplaetze ? '12' : '1000';
    angebotsKapazitaetLabel.querySelector('.field-hint')?.remove();
    if(createTierFieldset){createTierFieldset.hidden=einzelplaetze;createTierEditor?.querySelectorAll('input').forEach(input=>input.required=!einzelplaetze&&neuesAngebotForm.elements.dauer_modus.value!=='fest');}
    if (einzelplaetze) {
      const hinweis = document.createElement('span');
      hinweis.className = 'field-hint';
      hinweis.textContent = 'Bei Einzelplätzen sind 5 bis 12 Teilnehmende möglich.';
      angebotsKapazitaetLabel.append(hinweis);
    }
  }
  function createTierDurationMode(){
    const fixed=neuesAngebotForm.elements.dauer_modus.value==='fest'||angebotsModus.value==='einzelplatz';
    createTierEditor?.querySelectorAll('[data-tier-field="dauer"]').forEach(label=>{
      label.hidden=fixed;const input=label.querySelector('input');if(input)input.required=!fixed;
    });
  }
  angebotsModus.addEventListener('change', angebotsKapazitaetPruefen);
  neuesAngebotForm.elements.dauer_modus.addEventListener('change',createTierDurationMode);
  angebotsKapazitaetPruefen();
  createTierDurationMode();

  neuesAngebotForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const daten = Object.fromEntries(
      new FormData(neuesAngebotForm).entries()
    );
    daten.veranstaltungsorte=[...document.querySelectorAll('#angebot-orte-auswahl input[name="veranstaltungsorte"]:checked')].map(input=>input.value);
    daten.besuchergruppen=[...document.querySelectorAll('#neues-angebot-gruppen input:checked')].map(input=>input.value);
    daten.veranstaltungsort=daten.veranstaltungsorte[0]||'';
    daten.verfuegbare_termine=(daten.verfuegbare_termine||'').split('\n').map(x=>x.trim()).filter(Boolean);
    daten.buchbar=neuesAngebotForm.elements.buchbar.checked;
    daten.veroeffentlicht=neuesAngebotForm.elements.veroeffentlicht.checked;
    daten.mindestteilnehmer=Number(daten.mindestteilnehmer||5);
    daten.preis_pro_person=Number(daten.preis_pro_person||0);
    daten.gruppenstufen=angebotsModus.value==='einzelplatz'?[]:programmStufenAuslesen(createTierEditor);
    if(daten.dauer_modus==='fest')daten.gruppenstufen.forEach(stufe=>stufe.dauer=Number(daten.dauer));

    try {
      const erstellt=await api('/api/admin/angebote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(daten)
      });
      zuletztAngelegtesAdminProgramm={id:erstellt?.id??erstellt?.angebot?.id??null,name:daten.name};

      neuesAngebotForm.reset();
      programmStufenEditor(createTierEditor);
      angebotsKapazitaetPruefen();
      createTierDurationMode();
      await refresh();
      programTab='liste';
      adminAnsichtAnzeigen('angebote-verwaltung');
      status.textContent='Neues Erlebnisangebot wurde gespeichert.';
    } catch (fehler) {
      alert('Speichern fehlgeschlagen: ' + fehler.message);
    }
  });
}

async function orteLaden(){
  const sitePicker=document.getElementById('angebot-orte-auswahl');
  const liste=document.getElementById('admin-place-list');
  if(!sitePicker&&!liste&&!kalenderStandortListe)return;
  try{
    const orte=await api('/api/admin/orte');
    kalenderStandortAuswahlAnzeigen(orte);
    if(sitePicker){
      const selected=new Set([...sitePicker.querySelectorAll('input:checked')].map(input=>input.value));
      sitePicker.replaceChildren();
      for(const ort of orte.filter(item=>item.aktiv)){
        const label=document.createElement('label');label.className='check';
        const input=document.createElement('input');input.type='checkbox';input.name='veranstaltungsorte';input.value=ort.name;input.checked=selected.has(ort.name);
        label.append(input,el('span',ort.name));sitePicker.append(label);
      }
      if(!sitePicker.children.length)sitePicker.append(el('p','Bitte zuerst einen aktiven Standort anlegen.'));
    }
    if(liste){
      liste.replaceChildren();
      if(!orte.length)liste.append(el('p','Noch keine Standorte angelegt.'));
      for(const ort of orte){
        const card=el('article');card.className='booking';
        const details=el('div');details.append(el('strong',ort.name),el('p',ort.aktiv?'Aktiv · für neue Programme auswählbar':'Inaktiv · bestehende Programme und Buchungen bleiben erhalten'));
        const actions=el('div');actions.className='button-row';
        const edit=el('button','Bearbeiten');edit.type='button';edit.className='btn secondary';edit.dataset.placeAction='edit';edit.dataset.placeId=ort.id;
        const toggle=el('button',ort.aktiv?'Deaktivieren':'Aktivieren');toggle.type='button';toggle.className='btn secondary';toggle.dataset.placeAction='toggle';toggle.dataset.placeId=ort.id;toggle.dataset.active=String(ort.aktiv);
        const remove=el('button','Löschen');remove.type='button';remove.className='btn danger';remove.dataset.placeAction='delete';remove.dataset.placeId=ort.id;
        actions.append(edit,toggle,remove);card.append(details,actions);liste.append(card);
      }
    }
  }catch(error){const message=document.getElementById('admin-place-status');if(message)message.textContent='Standorte konnten nicht geladen werden: '+error.message;}
}

document.getElementById('admin-place-form')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget,message=document.getElementById('admin-place-status');
  const button=form.querySelector('button[type="submit"]');button.disabled=true;
  try{
    const result=await api('/api/admin/orte',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:form.elements.name.value})});
    await orteLaden();
    await erlebnisangeboteLaden();
    const picker=document.getElementById('angebot-orte-auswahl');
    if(picker){const input=[...picker.querySelectorAll('input')].find(item=>item.value===result.name);if(input)input.checked=true;}
    form.reset();message.textContent=`Standort „${result.name}“ ist jetzt auswählbar.`;
  }catch(error){message.textContent='Standort konnte nicht gespeichert werden: '+error.message;}
  finally{button.disabled=false;}
});

document.getElementById('admin-place-list')?.addEventListener('click',async event=>{
  const button=event.target.closest('button[data-place-action]');
  if(!button)return;
  const message=document.getElementById('admin-place-status');
  button.disabled=true;
  try{
    if(button.dataset.placeAction==='edit'){
      const card=button.closest('article'),current=card?.querySelector('strong')?.textContent||'';
      const form=document.createElement('form');form.className='place-edit-form';
      const label=el('label','Standortbezeichnung');const input=document.createElement('input');
      input.name='name';input.maxLength=80;input.required=true;input.value=current;label.append(input);
      const save=el('button','Änderung speichern');save.type='submit';save.className='btn';
      const cancel=el('button','Abbrechen');cancel.type='button';cancel.className='btn secondary';
      cancel.onclick=orteLaden;form.append(label,save,cancel);
      form.onsubmit=async submitEvent=>{
        submitEvent.preventDefault();save.disabled=true;message.textContent='Standort wird gespeichert …';
        try{
          const result=await api(`/api/admin/orte/${encodeURIComponent(button.dataset.placeId)}`,{
            method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:input.value.trim()})
          });
          await orteLaden();await erlebnisangeboteLaden();message.textContent=`Standort „${current}“ wurde in „${result.name}“ umbenannt. Programme und zukünftige aktive Buchungen wurden aktualisiert.`;
        }catch(error){message.textContent='Standort konnte nicht umbenannt werden: '+error.message;save.disabled=false;}
      };
      card.replaceChildren(form);input.focus();input.select();return;
    }
    if(button.dataset.placeAction==='toggle'){
      const aktiv=button.dataset.active!=='true';
      const result=await api(`/api/admin/orte/${encodeURIComponent(button.dataset.placeId)}`,{
        method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({aktiv})
      });
      await orteLaden();await erlebnisangeboteLaden();
      message.textContent=`Standort „${result.name}“ wurde ${aktiv?'aktiviert':'deaktiviert'}.`;
    }else if(button.dataset.placeAction==='delete'){
      const card=button.closest('article');
      const name=card?.querySelector('strong')?.textContent||'diesen Standort';
      if(!window.confirm(`Standort „${name}“ endgültig löschen? Das ist nur möglich, wenn kein Programm ihn verwendet.`))return;
      await api(`/api/admin/orte/${encodeURIComponent(button.dataset.placeId)}`,{method:'DELETE'});
      await orteLaden();await erlebnisangeboteLaden();
      message.textContent=`Standort „${name}“ wurde gelöscht.`;
    }
  }catch(error){message.textContent='Standort konnte nicht geändert werden: '+error.message;}
  finally{button.disabled=false;}
});

const mitarbeiterbereichArten={allgemein:'Allgemeine Information',standort:'Standortinformation',partner:'Netzwerk-/Kooperationspartner',programm:'Programm'};
async function mitarbeiterbereichStandorteFuellen(select,selected=[]){
  const places=await api('/api/admin/orte');
  const chosen=new Set(selected.map(Number));
  select.replaceChildren();
  for(const place of places){
    if(!place.aktiv&&!chosen.has(Number(place.id)))continue;
    const option=el('option',place.name+(place.aktiv?'':' · inaktiv'));
    option.value=String(place.id);option.selected=chosen.has(Number(place.id));select.append(option);
  }
}
function mitarbeiterbereichArtSynchronisieren(form){
  const art=form.elements.art.value,locations=form.elements.standorte;
  locations.disabled=art==='allgemein';
  locations.required=art==='standort'||art==='programm';
  if(art==='allgemein')for(const option of locations.options)option.selected=false;
}
function mitarbeiterbereichFormDaten(form){
  return {titel:form.elements.titel.value,inhalt:form.elements.inhalt.value,
    art:form.elements.art.value,
    standorte:[...form.elements.standorte.selectedOptions].map(option=>Number(option.value)),
    aktiv:form.elements.aktiv.checked};
}

async function mitarbeiterbereicheLaden(){
  const list=document.getElementById('mitarbeiterbereiche-list');
  if(!list)return;
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

function programmDauerhaftLoeschenButton(angebot){
  const button=document.createElement('button');
  button.type='button';
  button.textContent='Dauerhaft löschen';
  button.className='btn secondary';
  button.style.borderColor='#b42318';
  button.style.color='#b42318';
  button.addEventListener('click',async()=>{
    const bestaetigung=prompt(`Programm „${angebot.name}“ endgültig löschen? Dieser Vorgang kann nicht rückgängig gemacht werden. Bestehende Buchungen und verknüpfte GPS-Touren verhindern das Löschen. Bitte LÖSCHEN eingeben:`);
    if(bestaetigung!=='LÖSCHEN')return;
    button.disabled=true;
    try{
      await api(`/api/admin/angebote/${angebot.id}`,{method:'DELETE'});
      ausgewaehltesAdminProgramm='alle';
      await erlebnisangeboteLaden();
    }catch(error){
      button.disabled=false;
      alert('Dauerhaftes Löschen nicht möglich: '+error.message);
    }
  });
  return button;
}

/* Gespeicherte Erlebnisangebote anzeigen */

document.addEventListener('besuchergruppenaktualisiert',()=>{erlebnisangeboteLaden();});

async function erlebnisangeboteLaden() {
  const liste = document.getElementById('angebote-admin-liste');
  if (!liste) return;

  try {
    const [angebote,verwaltungsOrte,besuchergruppen] = await Promise.all([
      api('/api/admin/angebote'),api('/api/admin/orte'),api('/api/admin/besuchergruppen')
    ]);
    const gruppenAuswahlErstellen=(selected=[])=>{
      const fieldset=document.createElement('fieldset');
      fieldset.className='angebot-standort-auswahl programm-besuchergruppen-auswahl';
      const legend=document.createElement('legend');legend.textContent='Besuchergruppen (Mehrfachauswahl)';
      const list=document.createElement('div');list.className='check-grid';
      const selectedIds=new Set(selected);
      const available=besuchergruppen.filter(group=>group.aktiv||selectedIds.has(group.id));
      for(const group of available){
        const label=document.createElement('label');label.className='check';
        const input=document.createElement('input');input.type='checkbox';input.value=group.id;
        input.checked=selectedIds.has(group.id);
        const text=document.createElement('span');
        if(group.iconBild){const image=document.createElement('img');image.src=group.iconBild;image.alt='';image.className='programm-gruppen-icon';text.append(image);}
        else text.append(document.createTextNode((group.icon||'✨')+' '));
        text.append(document.createTextNode(group.titel));
        label.append(input,text);list.append(label);
      }
      if(!available.length)list.append(el('p','Noch keine aktiven Besuchergruppen angelegt.'));
      fieldset.append(legend,list);
      return fieldset;
    };
    const createGroups=document.getElementById('neues-angebot-gruppen');
    if(createGroups){
      const picker=gruppenAuswahlErstellen();
      createGroups.replaceWith(picker);
      picker.id='neues-angebot-gruppen';
    }
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

    liste.replaceChildren();
    const picker=document.getElementById('admin-program-picker');
    const band=document.getElementById('admin-program-secondary');
    if(picker){
      picker.replaceChildren();
      const filterButton=(id,label)=>{
        const button=document.createElement('button');
        button.type='button';
        button.dataset.programId=String(id);
        button.textContent=label;
        button.setAttribute('aria-pressed','false');
        button.addEventListener('click',()=>adminProgrammEinzelansicht(id,{focus:true}));
        picker.append(button);
      };
      filterButton('alle','Alle anzeigen');
      for(const angebot of angebote){
        filterButton(angebot.id,(angebot.archiviert?'Archiviert · ':'')+angebot.name);
      }
    }
    if(band)band.hidden=programTab==='neu';
    if (!angebote.length) {
      liste.textContent = 'Noch keine Angebote gespeichert.';
      return;
    }

    if(zuletztAngelegtesAdminProgramm){
      const match=angebote.find(item=>(
        (zuletztAngelegtesAdminProgramm.id!=null&&String(item.id)===String(zuletztAngelegtesAdminProgramm.id))||
        item.name===zuletztAngelegtesAdminProgramm.name));
      if(match)ausgewaehltesAdminProgramm=String(match.id);
      zuletztAngelegtesAdminProgramm=null;
    }
    if(ausgewaehltesAdminProgramm!=='alle'&&!angebote.some(item=>String(item.id)===String(ausgewaehltesAdminProgramm))){
      ausgewaehltesAdminProgramm=String((angebote.find(item=>!item.archiviert)||angebote[0]).id);
    }

    const aktiveAngebote=angebote.filter(a=>!a.archiviert);
    for (const angebot of angebote) {
      const eintrag = document.createElement('div');
      eintrag.className = 'card';
      eintrag.dataset.programId=String(angebot.id);

      const titel = document.createElement('h3');
      titel.textContent = angebot.name;
      const angebotOrte=Arra