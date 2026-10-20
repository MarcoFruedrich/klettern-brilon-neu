document.getElementById('year').textContent=new Date().getFullYear();const date=document.querySelector('input[name=datum]');date.min=new Date().toLocaleDateString('en-CA');

const verfuegbarkeit = document.getElementById('datum-verfuegbarkeit');
let sperrzeiten = [];
let sperrzeitenGeladen = false;

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

date.addEventListener('change', datumPruefen);

fetch('/api/sperrzeiten')
  .then(antwort => {
    if (!antwort.ok) throw new Error('Nicht erreichbar');
    return antwort.json();
  })
  .then(daten => {
    sperrzeiten = daten;
    sperrzeitenGeladen = true;
    datumPruefen();
  })
  .catch(() => {
    sperrzeitenGeladen = false;
    datumPruefen();
  });

const form=document.getElementById('booking');form.addEventListener('submit',async e=>{e.preventDefault();const status=document.getElementById('booking-status');const btn=form.querySelector('button[type=submit]');const data=Object.fromEntries(new FormData(form).entries());status.textContent='Anfrage wird gesendet …';btn.disabled=true;try{const res=await fetch('/api/buchungen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const json=await res.json();if(!res.ok)throw new Error(json.error||'Übertragung fehlgeschlagen');status.textContent='Vielen Dank! Deine Anfrage wurde gespeichert. Wir melden uns persönlich.';form.reset()}catch(err){status.textContent='Anfrage konnte nicht gespeichert werden: '+err.message}finally{btn.disabled=false}});async function specials(){const root=document.getElementById('specials');try{const r=await fetch('/api/aktionen');if(!r.ok)throw Error();const items=await r.json();root.replaceChildren();if(!items.length){const p=document.createElement('p');p.textContent='Neue Sonderangebote werden hier veröffentlicht. Frage gerne nach freien Terminen!';root.append(p)}for(const item of items){const a=document.createElement('article');const h=document.createElement('h3');h.textContent=item.titel;const d=document.createElement('p');d.textContent=item.datum||'Termin nach Vereinbarung';const t=document.createElement('p');t.textContent=item.beschreibung||'';a.append(h,d,t);root.append(a)}}catch{root.textContent='Sonderangebote derzeit nicht abrufbar.'}}specials();
