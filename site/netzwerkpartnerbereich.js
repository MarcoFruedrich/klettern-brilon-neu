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
loadProfile().then(()=>{status.textContent='Du bist bereits angemeldet.';}).catch(()=>{});
