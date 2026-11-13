'use strict';
const form=document.getElementById('partner-login-form'),status=document.getElementById('partner-login-status');
const workspace=document.getElementById('partner-workspace');
async function request(url,options={}){
  const response=await fetch(url,{credentials:'same-origin',...options});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Anfrage fehlgeschlagen.');return data;
}
function addProfile(label,value){
  if(!value)return;
  const item=document.createElement('p');item.append(document.createTextNode(label+': '+value));
  document.getElementById('partner-profile').append(item);
}
async function loadProfile(){
  const profile=await request('/api/netzwerkpartner/me');form.hidden=true;workspace.hidden=false;
  document.getElementById('partner-title').textContent=profile.unternehmen;
  const list=document.getElementById('partner-profile');list.replaceChildren();
  addProfile('Ansprechperson',profile.ansprechpartner);addProfile('E-Mail',profile.email);
  addProfile('Telefon',profile.telefon);addProfile('Anschrift',[profile.strasse,[profile.plz,profile.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '));
  addProfile('Weitere Kontakthinweise',profile.weitere_angaben);
  const events=document.getElementById('partner-calendar-events');events.replaceChildren();
  try{
    const brilon=await request('/api/netzwerkpartner/brilon-kalender');
    if(!brilon.events.length)events.append(Object.assign(document.createElement('p'),{textContent:'Für diesen Zeitraum sind keine Kalendereinträge vorhanden.'}));
    for(const event of brilon.events){
      const card=document.createElement('article');card.className='card';
      const title=document.createElement('h4');title.textContent=event.titel||event.art;card.append(title);
      const when=document.createElement('p');when.textContent=`${new Date(`${event.datum}T12:00:00`).toLocaleDateString('de-DE')} · ${event.uhrzeit?String(event.uhrzeit).slice(0,5)+' Uhr':''}${event.endzeit?' bis '+String(event.endzeit).slice(0,5)+' Uhr':''}`;card.append(when);
      const kind=document.createElement('p');kind.textContent=event.art;card.append(kind);events.append(card);
    }
    document.getElementById('partner-calendar-status').textContent=`Zeitraum ${new Date(`${brilon.von}T12:00:00`).toLocaleDateString('de-DE')} bis ${new Date(`${brilon.bis}T12:00:00`).toLocaleDateString('de-DE')}`;
  }catch(error){document.getElementById('partner-calendar-status').textContent=error.message;}
}
form.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('button');button.disabled=true;status.textContent='Anmeldung läuft …';
  try{await request('/api/netzwerkpartner/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:form.elements.email.value,passwort:form.elements.passwort.value})});await loadProfile();status.textContent='';}
  catch(error){status.textContent=error.message;}
  finally{button.disabled=false;}
});
document.getElementById('partner-logout').addEventListener('click',async()=>{
  try{await request('/api/netzwerkpartner/logout',{method:'POST'});}catch{}
  workspace.hidden=true;form.hidden=false;form.reset();status.textContent='Du wurdest abgemeldet.';
});
document.getElementById('partner-calendar-refresh').addEventListener('click',async()=>{
  const status=document.getElementById('partner-calendar-status');status.textContent='Kalender wird aktualisiert …';
  try{await loadProfile();status.textContent='Kalender aktualisiert.';}catch(error){status.textContent=error.message;}
});
document.getElementById('partner-appointment-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),status=document.getElementById('partner-request-status');
  button.disabled=true;status.textContent='Terminwunsch wird übermittelt …';
  try{const data=await request('/api/netzwerkpartner/terminanfrage',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.fromEntries(new FormData(form)))});status.textContent=data.message;form.reset();}
  catch(error){status.textContent='Terminwunsch konnte nicht gesendet werden: '+error.message;}
  finally{button.disabled=false;}
});
loadProfile().then(()=>{status.textContent='Du bist bereits angemeldet.';}).catch(()=>{});
