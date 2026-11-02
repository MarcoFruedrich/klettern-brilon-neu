'use strict';
const $=id=>document.getElementById(id);
let active=true,expiry=0,selected=-1,offers=[];
const safeText=value=>typeof value==='string'?value:'';
async function api(url,options={}){
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
  const data=await response.json();
  if(!response.ok)throw Object.assign(Error(data.error||'Nicht verfügbar'),{status:response.status});
  return data;
}
function showPairing(message){
  $('tablet-pairing').hidden=false;$('tablet-screen').hidden=true;
  $('tablet-digits').textContent='';expiry=0;
  if(message)$('tablet-pair-message').textContent=message;
}
function showScreen(){
  $('tablet-pairing').hidden=true;$('tablet-screen').hidden=false;
}
async function loadOffers(){
  try{
    const data=await api('/api/angebote');
    offers=Array.isArray(data)?data.filter(x=>x&&typeof x.name==='string').slice(0,16):[];
    cycle();
  }catch{offers=[];cycle();}
}
function cycle(){
  if(!active)return;
  if(!offers.length){
    $('tablet-offer-title').textContent='Klettern, Bouldern & Abenteuer';
    $('tablet-offer-description').textContent=
      'Programme für Gruppen, Schulklassen und Familien – fragt an der Rezeption nach!';
    return;
  }
  selected=(selected+1)%offers.length;
  const offer=offers[selected];
  $('tablet-offer-title').textContent=safeText(offer.name).slice(0,120);
  $('tablet-offer-description').textContent=
    safeText(offer.beschreibung||offer.hinweise||'Jetzt Programm anfragen!').slice(0,420);
}
async function checkTablet(){
  try{
    const display=await api('/api/pruefung/tablet/anzeige');
    showScreen();
    $('tablet-connection').textContent='Gekoppeltes Tablet: '+safeText(display.name);
    if(display.code&&/^\d{6}$/.test(display.code)){
      $('tablet-digits').textContent=display.code;
      expiry=Date.now()+Math.max(0,display.gueltigSekunden)*1000;
      $('tablet-code').hidden=false;
      $('tablet-marketing').hidden=true;
    }else{
      $('tablet-digits').textContent='';expiry=0;
      $('tablet-code').hidden=true;$('tablet-marketing').hidden=false;
    }
  }catch(error){
    if(error.status===401){showPairing('Tablet nicht gekoppelt oder wurde gesperrt. Bitte neu koppeln.');}
    else{
      // Never keep displaying a code after network loss.
      $('tablet-digits').textContent='';expiry=0;
      $('tablet-code').hidden=true;$('tablet-marketing').hidden=false;
      $('tablet-connection').textContent='Verbindung unterbrochen – keine Codeanzeige.';
    }
  }
}
$('tablet-pair-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;
  const button=form.querySelector('button');button.disabled=true;
  $('tablet-pair-message').textContent='Kopplung wird geprüft …';
  try{
    await api('/api/pruefung/tablet/koppeln',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    form.elements.code.value='';
    $('tablet-pair-message').textContent='';
    await checkTablet();
  }catch(error){$('tablet-pair-message').textContent='Kopplung fehlgeschlagen: '+error.message;}
  finally{button.disabled=false;}
});
setInterval(()=>{
  if(expiry){
    const seconds=Math.ceil((expiry-Date.now())/1000);
    if(seconds<=0){
      $('tablet-digits').textContent='';$('tablet-code').hidden=true;
      $('tablet-marketing').hidden=false;expiry=0;
    }else $('tablet-countdown').textContent='Gültig noch '+seconds+' Sekunden';
  }
},500);
setInterval(checkTablet,3000);
setInterval(cycle,11000);
loadOffers();
checkTablet();
