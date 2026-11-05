'use strict';
const $=id=>document.getElementById(id);
const safeText=value=>typeof value==='string'?value:'';
const POLL_MS=3000,OFFER_REFRESH_MS=5*60*1000,API_TIMEOUT_MS=7000;
let expiry=0,selected=-1,offers=[],activeOffer='',polling=false,loadingOffers=false;
let displayCode='',wakeLock=null,displayGeneration=0;

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
  $('tablet-pairing').hidden=false;$('tablet-screen').hidden=true;
  if(message)$('tablet-pair-message').textContent=message;
}
function showScreen(){
  $('tablet-pairing').hidden=true;$('tablet-screen').hidden=false;
}
function renderOffer(){
  if(!offers.length){
    $('tablet-offer-title').textContent='Klettern, Bouldern & Abenteuer';
    $('tablet-offer-description').textContent=
      'Programme für Gruppen, Schulklassen und Familien – fragt an der Rezeption nach!';
    return;
  }
  const offer=offers[selected>=0?selected:0];
  $('tablet-offer-title').textContent=safeText(offer.name).slice(0,120);
  $('tablet-offer-description').textContent=
    safeText(offer.beschreibung||offer.hinweise||'Jetzt Programm anfragen!').slice(0,420);
}
async function loadOffers(){
  if(loadingOffers)return;
  loadingOffers=true;
  try{
    const data=await api('/api/angebote');
    if(!Array.isArray(data))throw Error('Angebotsformat ungültig.');
    const updated=data.filter(x=>x&&typeof x.name==='string'&&x.name.trim())
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
setInterval(cycle,11000);
setInterval(loadOffers,OFFER_REFRESH_MS);
loadOffers();
checkTablet();
keepAwake();
