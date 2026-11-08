'use strict';
const $=id=>document.getElementById(id);
const safeText=value=>typeof value==='string'?value:'';
const POLL_MS=3000,OFFER_REFRESH_MS=60000,API_TIMEOUT_MS=7000;
const STANDARD_WERBEZEIT_MS=11000;
let werbezeitMs=STANDARD_WERBEZEIT_MS,cycleTimeout=null;
let expiry=0,selected=-1,offers=[],activeOffer='',polling=false,loadingOffers=false;
let displayCode='',wakeLock=null,displayGeneration=0;
let currentSiteId=null,paired=false;

async function api(url,options={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),API_TIMEOUT_MS);
  try{
    const response=await fetch(url,{
      credentials:'same-origin',cache:'no-store',signal:controller.signal,...options
    });
    const data=await response.json();
    if(!response.ok)throw Object.assign(
      Error(data.error||'Nicht verfügbar'),{status:response.status}
    );
    return data;
  }finally{clearTimeout(timeout);}
}
function hideCode(){
  $('tablet-digits').textContent='';
  $('tablet-countdown').textContent='';
  $('tablet-code').hidden=true;
  $('tablet-marketing').hidden=false;
  displayCode='';expiry=0;
}
function showPairing(message){
  hideCode();
  paired=false;currentSiteId=null;offers=[];selected=-1;activeOffer='';
  $('tablet-site').textContent='Standort wird geladen …';
  renderOffer();
  $('tablet-pairing').hidden=false;$('tablet-screen').hidden=true;
  if(message)$('tablet-pair-message').textContent=message;
}
function showScreen(){
  $('tablet-pairing').hidden=true;$('tablet-screen').hidden=false;
}
function renderOffer(){
  if(!offers.length){
    $('tablet-offer-title').textContent='Klettern, Bouldern & Abenteuer';
    const image=$('tablet-offer-image');
    if(image){image.hidden=true;image.removeAttribute('src');}
    $('tablet-offer-description').textContent=currentSiteId===null
      ?'Dieses Tablet muss in der Verwaltung noch einem Veranstaltungsstandort zugeordnet werden.'
      :'Für diesen Standort sind aktuell keine freigegebenen Programme verfügbar.';
    return;
  }
  const offer=offers[selected>=0?selected:0];
  const image=$('tablet-offer-image');
  if(image){
    const url=typeof offer.bild_url==='string'?offer.bild_url.trim():'';
    if(/^https:\/\//i.test(url)){
      image.src=url;image.alt='Programmbild: '+safeText(offer.name).slice(0,120);
      image.hidden=false;
    }else{
      image.hidden=true;image.removeAttribute('src');
    }
  }
  $('tablet-offer-title').textContent=safeText(offer.name).slice(0,120);
  $('tablet-offer-description').textContent=
    safeText(offer.beschreibung||offer.hinweise||'Jetzt Programm anfragen!').slice(0,420);
}
async function loadOffers(){
  if(loadingOffers||!paired||currentSiteId===null)return;
  loadingOffers=true;
  const requestedSite=currentSiteId;
  try{
    const data=await api('/api/pruefung/tablet/angebote');
    if(!Array.isArray(data.angebote))throw Error('Angebotsformat ungültig.');
    if(currentSiteId!==requestedSite||String(data.ortId??'')!==requestedSite)return;
    const seconds=Number(data.anzeigedauerSekunden);
    if(Number.isSafeInteger(seconds)&&seconds>=5&&seconds<=120){
      if(werbezeitMs!==seconds*1000){
        werbezeitMs=seconds*1000;
        scheduleCycle();
      }
    }
    const updated=data.angebote.filter(x=>x&&typeof x.name==='string'&&x.name.trim())
      .slice(0,16);
    const former=offers[selected]?.id||activeOffer;
    offers=updated;
    const stillShown=updated.findIndex(x=>x.id===former);
    selected=stillShown>=0?stillShown:updated.length?0:-1;
    activeOffer=offers[selected]?.id||'';
    renderOffer();
  }catch{
    // Show the most recently received public offers instead of a blank screen.
    // After a fresh page load, the neutral local fallback is used.
    if(!offers.length)renderOffer();
  }finally{loadingOffers=false;}
}
function cycle(){
  if(!offers.length){renderOffer();return;}
  selected=(selected+1)%offers.length;
  activeOffer=offers[selected]?.id||'';
  renderOffer();
}
// Uhrzeit und Sonnenstand für die Tablet-Anzeige: lokale Zeit in Deutschland.
// Die Sonnenuhr orientiert sich näherungsweise an den astronomischen Auf- und
// Untergangszeiten im Raum Brilon; die Standortauswahl bleibt davon unabhängig.
const berlinClock=new Intl.DateTimeFormat('de-DE',{
  timeZone:'Europe/Berlin',day:'2-digit',month:'long',year:'numeric',
  hour:'2-digit',minute:'2-digit',second:'2-digit'
});
const berlinParts=new Intl.DateTimeFormat('en-GB',{
  timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
});
function sonnenZeitInBerlin(year,month,day,rising){
  const N=Math.floor((Date.UTC(year,month-1,day)-Date.UTC(year,0,0))/86400000);
  const lat=51.40*Math.PI/180,lon=8.57;
  const t=N+((rising?6:18)-lon/15)/24;
  const M=(0.9856*t-3.289)*Math.PI/180;
  let L=((0.9856*t-3.289)+1.916*Math.sin(M)+0.020*Math.sin(2*M)+282.634+720)%360;
  let RA=(Math.atan(0.91764*Math.tan(L*Math.PI/180))*180/Math.PI+360)%360;
  RA+=Math.floor(L/90)*90-Math.floor(RA/90)*90;
  RA/=15;
  const sinD=0.39782*Math.sin(L*Math.PI/180);
  const cosD=Math.cos(Math.asin(sinD));
  const cosH=(Math.cos(90.833*Math.PI/180)-sinD*Math.sin(lat))/(cosD*Math.cos(lat));
  if(cosH>1||cosH< -1)return rising?6:20;
  const H=((rising?360-Math.acos(cosH)*180/Math.PI:Math.acos(cosH)*180/Math.PI)/15);
  const utc=(H+RA-0.06571*t-6.622-lon/15+48)%24;
  const midnight=new Date(Date.UTC(year,month-1,day));
  const localMidnightParts=berlinParts.formatToParts(midnight);
  const tzHour=Number(localMidnightParts.find(p=>p.type==='hour')?.value)||0;
  // UTC-Mitternacht wird in Deutschland als 01:00 oder 02:00 dargestellt.
  return (utc+tzHour)%24;
}
function tabletClockAktualisieren(){
  const time=$('tablet-datetime'),orb=$('tablet-celestial');
  if(!time||!orb)return;
  const now=new Date();
  time.textContent=berlinClock.format(now)+' Uhr';
  const part=Object.fromEntries(berlinParts.formatToParts(now).map(p=>[p.type,p.value]));
  const year=Number(part.year),month=Number(part.month),day=Number(part.day);
  const hour=Number(part.hour)+Number(part.minute)/60;
  const rise=sonnenZeitInBerlin(year,month,day,true);
  const set=sonnenZeitInBerlin(year,month,day,false);
  const daytime=hour>=rise&&hour<=set;
  const progress=daytime?(hour-rise)/Math.max(1,set-rise):
    (hour>set?hour-set:hour+24-set)/Math.max(1,24-set+rise);
  orb.textContent=daytime?'☀':'☾';
  orb.classList.toggle('tablet-moon',!daytime);
  orb.style.left=(35+Math.max(0,Math.min(1,progress))*34)+'%';
  orb.style.top=(daytime?22-12*Math.sin(progress*Math.PI):22-7*Math.sin(progress*Math.PI))+'%';
}
tabletClockAktualisieren();
setInterval(tabletClockAktualisieren,30000);
function scheduleCycle(){
  if(cycleTimeout!==null)clearTimeout(cycleTimeout);
  cycleTimeout=setTimeout(()=>{
    if(!document.hidden)cycle();
    scheduleCycle();
  },werbezeitMs);
}
async function checkTablet(){
  // Hidden browser tabs must not keep reporting the physically visible display as online.
  if(document.hidden||!navigator.onLine)return;
  // Only one server poll may update the code at a time.
  if(polling)return;
  polling=true;
  const checkGeneration=displayGeneration;
  const requestedAt=Date.now();
  try{
    const display=await api('/api/pruefung/tablet/anzeige');
    // Ignore late responses from a previous visibility / connectivity state.
    if(document.hidden||checkGeneration!==displayGeneration)return;
    showScreen();
    $('tablet-connection').textContent='Gekoppeltes Tablet: '+safeText(display.name);
    const site=display.ortId==null?null:String(display.ortId);
    paired=true;
    $('tablet-site').textContent=display.standort||'Noch kein Standort zugewiesen';
    if(site!==currentSiteId){
      currentSiteId=site;
      offers=[];selected=-1;activeOffer='';
      renderOffer();
      if(site!==null)loadOffers();
    }
    const seconds=Number(display.gueltigSekunden);
    if(typeof display.code==='string'&&/^\d{6}$/.test(display.code)&&
      Number.isFinite(seconds)&&seconds>0&&seconds<=120){
      // The remaining lifetime came from the server; include the request latency
      // conservatively so a slow response never prolongs the onsite code.
      const deadline=requestedAt+seconds*1000;
      if(deadline<=Date.now()){hideCode();return;}
      // Repeated polls may shorten, but must not prolong an existing code.
      expiry=display.code===displayCode&&expiry?Math.min(expiry,deadline):deadline;
      displayCode=display.code;
      $('tablet-digits').textContent=display.code;
      $('tablet-code').hidden=false;$('tablet-marketing').hidden=true;
      countdown();
    }else hideCode();
  }catch(error){
    if(checkGeneration!==displayGeneration)return;
    hideCode();
    if(error.status===401){
      showPairing('Tablet nicht gekoppelt oder wurde gesperrt. Bitte Verwaltung kontaktieren.');
    }else{
      $('tablet-connection').textContent='Verbindung unterbrochen – Werbung läuft weiter, kein Prüfcode.';
    }
  }finally{polling=false;}
}
function countdown(){
  if(!expiry)return;
  const seconds=Math.ceil((expiry-Date.now())/1000);
  if(seconds<=0){hideCode();return;}
  $('tablet-countdown').textContent='Gültig noch '+seconds+' Sekunden';
}
async function keepAwake(){
  // Optional browser capability; an Android system lock is not controlled by a website.
  if(wakeLock||document.hidden||!('wakeLock' in navigator))return;
  try{
    const sentinel=await navigator.wakeLock.request('screen');
    wakeLock=sentinel;
    sentinel.addEventListener('release',()=>{
      if(wakeLock===sentinel)wakeLock=null;
    });
  }catch{
    wakeLock=null;
    // Some browsers / policies do not permit wake locks: display still works.
  }
}
async function refreshAfterWake(){
  displayGeneration++;
  hideCode(); // Do not show a code before the current server state is verified.
  await Promise.all([checkTablet(),loadOffers()]);
  keepAwake();
}
$('tablet-pair-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget,button=form.querySelector('button');
  button.disabled=true;
  $('tablet-pair-message').textContent='Kopplung wird geprüft …';
  try{
    await api('/api/pruefung/tablet/koppeln',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    form.elements.code.value='';
    $('tablet-pair-message').textContent='';
    await checkTablet();
  }catch(error){
    $('tablet-pair-message').textContent='Kopplung fehlgeschlagen: '+error.message;
  }finally{button.disabled=false;}
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){displayGeneration++;hideCode();}
  else refreshAfterWake();
});
window.addEventListener('pageshow',event=>{if(event.persisted)refreshAfterWake();});
window.addEventListener('online',refreshAfterWake);
window.addEventListener('offline',()=>{
  displayGeneration++;
  hideCode();$('tablet-connection').textContent='Offline – Werbung läuft weiter, kein Prüfcode.';
});
setInterval(countdown,500);
setInterval(checkTablet,POLL_MS);
scheduleCycle();
setInterval(loadOffers,OFFER_REFRESH_MS);
loadOffers();
checkTablet();
keepAwake();
