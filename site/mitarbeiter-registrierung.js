'use strict';
const form=document.getElementById('registration-form');
const intro=document.getElementById('registration-intro');
const status=document.getElementById('registration-status');
const token=new URLSearchParams(location.search).get('token')||'';
async function request(url,options={}){
  const response=await fetch(url,{credentials:'same-origin',...options});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Die Anfrage konnte nicht verarbeitet werden.');
  return data;
}
async function loadInvitation(){
  if(!/^[a-f0-9]{64}$/i.test(token))throw Error('Der Registrierungslink ist ungültig. Bitte die Verwaltung um eine neue Einladung bitten.');
  const invitation=await request('/api/pruefung/einladung?token='+encodeURIComponent(token));
  form.elements.name.value=invitation.name;
  document.getElementById('registration-email').value=invitation.email;
  intro.textContent='Bitte ergänze deine Angaben. Der Zugang wird nach der Prüfung durch die Verwaltung freigeschaltet.';
  form.hidden=false;
}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const password=form.elements.passwort.value;
  if(password!==form.elements.passwort_bestaetigung.value){
    status.textContent='Die beiden Passwörter stimmen nicht überein.';return;
  }
  const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
  status.textContent='Registrierung wird gespeichert …';
  try{
    await request('/api/pruefung/registrieren',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token,name:form.elements.name.value,
        telefon:form.elements.telefon.value,qualifikationen:form.elements.qualifikationen.value,
        strasse:form.elements.strasse.value,plz:form.elements.plz.value,
        wohnort:form.elements.wohnort.value,passwort:password})});
    form.hidden=true;
    intro.textContent='Vielen Dank. Deine Registrierung wurde übermittelt.';
    status.textContent='Dein Zugang bleibt bis zur Freigabe durch die Verwaltung gesperrt. Du erhältst nach der Freigabe eine Benachrichtigung.';
  }catch(error){status.textContent='Registrierung fehlgeschlagen: '+error.message;}
  finally{submit.disabled=false;}
});
loadInvitation().catch(error=>{intro.textContent='Registrierung nicht möglich.';status.textContent=error.message;form.hidden=true;});
