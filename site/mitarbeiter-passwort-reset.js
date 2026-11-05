'use strict';
const form=document.getElementById('password-reset-form');
const status=document.getElementById('password-reset-status');
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const passwort=form.elements.passwort.value,wiederholung=form.elements.wiederholung.value;
  if(passwort.length<6){status.textContent='Das Passwort muss mindestens 6 Zeichen enthalten.';return;}
  if(passwort!==wiederholung){status.textContent='Die Passwörter stimmen nicht überein.';return;}
  const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
  try{
    const response=await fetch('/api/pruefung/passwort-zuruecksetzen',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({token:new URLSearchParams(location.search).get('token')||'',passwort})});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'Passwort konnte nicht geändert werden.');
    status.textContent=data.message;form.hidden=true;
    document.getElementById('password-reset-login').hidden=false;
  }catch(error){status.textContent='Passwort konnte nicht geändert werden: '+error.message;}
  finally{submit.disabled=false;}
});
