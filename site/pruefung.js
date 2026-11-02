'use strict';
const $=id=>document.getElementById(id);
const text=(tag,content)=>{const node=document.createElement(tag);node.textContent=content;return node;};
async function request(url,options={}){
  const r=await fetch(url,{credentials:'same-origin',...options});
  const data=await r.json();
  if(!r.ok)throw Error(data.error||'Die Anfrage konnte nicht verarbeitet werden.');
  return data;
}
function notice(message){$('pruefung-status').textContent=message;}
function hideForm(){ $('station-inspection').hidden=true; }
function stationControl(station){
  const fieldset=text('fieldset');
  fieldset.className='booking pruefung-station';fieldset.dataset.id=station.id;
  const legend=text('legend',station.name);fieldset.append(legend);
  const label=text('label');label.className='check';
  const check=document.createElement('input');check.type='checkbox';check.className='pruefung-aktiv';
  label.append(check,text('span','Station wird verwendet'));fieldset.append(label);
  const group=text('div');group.hidden=true;
  const resultLabel=text('label','Prüfergebnis');
  const state=document.createElement('select');state.className='pruefung-zustand';
  state.append(Object.assign(text('option','In Ordnung'),{value:'ok'}),
    Object.assign(text('option','Mangel festgestellt – Station nicht benutzen'),{value:'mangel'}));
  resultLabel.append(state);group.append(resultLabel);
  const defectLabel=text('label','Mangelbeschreibung (mindestens zehn Zeichen)');
  const description=document.createElement('textarea');
  description.className='pruefung-beschreibung';
  description.maxLength=2000;description.rows=3;description.hidden=true;
  defectLabel.append(description);group.append(defectLabel);
  fieldset.append(group);
  check.addEventListener('change',()=>{group.hidden=!check.checked;});
  state.addEventListener('change',()=>{
    const defect=state.value==='mangel';
    description.hidden=!defect;description.required=defect;
    if(!defect)description.value='';
  });
  return fieldset;
}
async function loadStations(){
  const data=await request('/api/pruefung/stationen');
  $('pruefung-person').textContent=data.mitarbeiter;
  const target=$('pruefung-stationen');target.replaceChildren();
  data.stationen.forEach(s=>target.append(stationControl(s)));
  if(!data.stationen.length)notice('Noch keine Stationen eingerichtet. Bitte die Verwaltung informieren.');
  if(data.entsperrtBis&&new Date(data.entsperrtBis)>new Date()){
    $('onsite-unlock').hidden=true;$('station-inspection').hidden=false;
  }
}
async function signedIn(){
  $('staff-login').hidden=true;$('pruefung-workspace').hidden=false;
  await loadStations();
}
$('staff-login').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;
  const submit=form.querySelector('button');submit.disabled=true;
  try{
    await request('/api/pruefung/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    form.reset();await signedIn();notice('Angemeldet. Bitte Vor-Ort-Code vom Tablet eingeben.');
  }catch(e){notice('Anmeldung fehlgeschlagen: '+e.message);}finally{submit.disabled=false;}
});
$('onsite-unlock').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;
  try{
    await request('/api/pruefung/freischalten',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    form.reset();form.hidden=true;$('station-inspection').hidden=false;
    notice('Prüfformular für diese Programmkontrolle freigeschaltet.');
  }catch(e){notice('Freigabe fehlgeschlagen: '+e.message);}
});
$('station-inspection').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;
  const pruefungen=Array.from(form.querySelectorAll('.pruefung-station')).filter(e=>
    e.querySelector('.pruefung-aktiv').checked).map(e=>({
      stationId:e.dataset.id,zustand:e.querySelector('.pruefung-zustand').value,
      beschreibung:e.querySelector('.pruefung-beschreibung').value
    }));
  if(!pruefungen.length){notice('Bitte mindestens eine verwendete Station auswählen.');return;}
  const submit=form.querySelector('button[type=submit]');submit.disabled=true;
  try{
    const data=await request('/api/pruefung/berichte',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({programm:form.elements.programm.value,
        beginn:form.elements.beginn.value,pruefungen})});
    form.reset();hideForm();$('onsite-unlock').hidden=false;
    const status=data.hatMangel?'MANGEL ERFASST – betroffene Station nicht benutzen.':'Prüfung ohne gemeldeten Mangel gespeichert.';
    const mail=data.benachrichtigung==='gesendet'?' Mängelmeldung versendet.':
      data.benachrichtigung==='fehlgeschlagen'?' ACHTUNG: Mängel-E-Mail fehlgeschlagen! Verantwortliche direkt informieren.':
      data.benachrichtigung==='nicht_konfiguriert'?' ACHTUNG: Mängelpostfach nicht eingerichtet! Verantwortliche direkt informieren.':'';
    notice(status+' Prüfnummer: '+data.id+'.'+mail);
  }catch(e){notice('Bericht nicht gespeichert: '+e.message);}
  finally{submit.disabled=false;}
});
$('staff-logout').addEventListener('click',async()=>{
  try{await request('/api/pruefung/abmelden',{method:'POST'});}
  catch(e){notice('Abmeldung fehlgeschlagen: '+e.message);return;}
  $('pruefung-workspace').hidden=true;$('staff-login').hidden=false;
  hideForm();$('onsite-unlock').hidden=false;notice('Abgemeldet.');
});
request('/api/pruefung/stationen').then(async data=>{
  $('staff-login').hidden=true;$('pruefung-workspace').hidden=false;
  $('pruefung-person').textContent=data.mitarbeiter;
  const target=$('pruefung-stationen');target.replaceChildren();
  data.stationen.forEach(s=>target.append(stationControl(s)));
  if(data.entsperrtBis&&new Date(data.entsperrtBis)>new Date()){
    $('onsite-unlock').hidden=true;$('station-inspection').hidden=false;
  }
}).catch(()=>{});
