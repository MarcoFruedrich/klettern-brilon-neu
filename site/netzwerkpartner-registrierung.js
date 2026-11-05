'use strict';
const form=document.getElementById('partner-registration-form');
const intro=document.getElementById('partner-registration-intro');
const status=document.getElementById('partner-registration-status');
const token=new URLSearchParams(location.search).get('token')||'';
async function request(url,options={}){
  const response=await fetch(url,{credentials:'same-origin',...options});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Die Anfrage konnte nicht verarbeitet werden.');
  return data;
}
async function loadInvitation(){
  if(!/^[a-f0-9]{64}$/i.test(token))throw Error('Der Registrierungslink ist ungültig. Bitte die Verwaltung um eine neue Einladung bitten.');
  const invite=await request('/api/netzwerkpartner/einladung?token='+encodeURIComponent(token));
  form.elements.ansprechpartner.value=invite.name;
  document.getElementById('partner-registration-email').value=invite.email;
  intro.textContent='Bitte ergänze deine Kontaktdaten. Dein Zugang wird nach der Prüfung durch die Verwaltung freigeschaltet.';
  form.hidden=false;
}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(form.elements.passwort.value!==form.elements.passwort_bestaetigung.value){status.textContent='Die beiden Passwörter stimmen nicht überein.';return;}
  const button=form.querySelector('button[type="submit"]');button.disabled=true;status.textContent='Registrierung wird gespeichert …';
  try{
    await request('/api/netzwerkpartner/registrieren',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token,unternehmen:form.elements.unternehmen.value,ansprechpartner:form.elements.ansprechpartner.value,
        telefon:form.elements.telefon.value,strasse:form.elements.strasse.value,plz:form.elements.plz.value,
        ort:form.elements.ort.value,weitereAngaben:form.elements.weitereAngaben.value,passwort:form.elements.passwort.value})});
    form.hidden=true;intro.textContent='Vielen Dank. Deine Angaben wurden an die Verwaltung übermittelt.';
    status.textContent='Der Partnerzugang bleibt bis zur Freigabe gesperrt. Nach der Freigabe erhältst du eine E-Mail mit dem Link zu deinem eigenen Netzwerkpartnerbereich.';
  }catch(error){status.textContent='Registrierung fehlgeschlagen: '+error.message;}
  finally{button.disabled=false;}
});
loadInvitation().catch(error=>{intro.textContent='Registrierung nicht möglich.';status.textContent=error.message;form.hidden=true;});
