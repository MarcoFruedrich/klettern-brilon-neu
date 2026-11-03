'use strict';
const form=document.getElementById('registration-form');
const intro=document.getElementById('registration-intro');
const status=document.getElementById('registration-status');
const certificateFiles=document.getElementById('certificate-files');
const certificateList=document.getElementById('certificate-list');
const certificateStatus=document.getElementById('certificate-status');
const token=new URLSearchParams(location.search).get('token')||'';
const bescheinigungen=[];
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
async function dateiAlsFoto(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))
    throw Error('Nur JPG-, PNG- und WebP-Fotos sind erlaubt.');
  if(file.size>12*1024*1024)throw Error('Eine Fotodatei darf vor der Komprimierung höchstens 12 MB groß sein.');
  let bitmap;
  try{bitmap=await createImageBitmap(file);}catch{throw Error('Die Fotodatei konnte nicht gelesen werden.');}
  try{
    if(bitmap.width*bitmap.height>40_000_000)throw Error('Das Foto hat zu viele Bildpunkte.');
    const scale=Math.min(1,2200/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d');
    if(!context)throw Error('Fotoverarbeitung ist nicht verfügbar.');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    let blob=null;
    for(const quality of [.86,.8,.74,.68,.62]){
      blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if(blob&&blob.size<=450*1024)break;
    }
    if(!blob||blob.size>450*1024)throw Error('Foto bleibt zu groß. Bitte ein kleineres oder schärferes Foto verwenden.');
    return await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(Error('Foto konnte nicht vorbereitet werden.'));
      reader.readAsDataURL(blob);
    });
  }finally{bitmap.close?.();}
}
function renderCertificates(){
  certificateList.replaceChildren();
  bescheinigungen.forEach((item,index)=>{
    const row=document.createElement('article');row.className='booking certificate-row';
    row.appendChild(Object.assign(document.createElement('p'),{textContent:item.file.name+' · '+
      Math.round(item.file.size/1024)+' KB'}));
    const label=document.createElement('label');label.textContent='Bezeichnung der Bescheinigung';
    const input=document.createElement('input');input.type='text';input.maxLength=100;input.required=true;
    input.value=item.bezeichnung;input.setAttribute('aria-label','Bezeichnung für '+item.file.name);
    input.addEventListener('input',()=>{item.bezeichnung=input.value;});
    label.appendChild(input);row.appendChild(label);
    const remove=document.createElement('button');remove.type='button';remove.className='btn secondary';
    remove.textContent='Foto entfernen';remove.addEventListener('click',()=>{
      bescheinigungen.splice(index,1);renderCertificates();
      certificateStatus.textContent='Foto entfernt.';
    });
    row.appendChild(remove);certificateList.appendChild(row);
  });
}
certificateFiles.addEventListener('change',async()=>{
  const files=Array.from(certificateFiles.files||[]);
  certificateFiles.value='';
  if(bescheinigungen.length+files.length>5){
    certificateStatus.textContent='Es sind höchstens fünf Bescheinigungsfotos möglich.';return;
  }
  certificateFiles.disabled=true;certificateStatus.textContent='Fotos werden vorbereitet …';
  const errors=[];
  for(const file of files){
    try{
      const daten=await dateiAlsFoto(file);
      const label=file.name.replace(/\.[^.]*$/,'').replace(/[\\/\u0000-\u001f\u007f]/g,' ').trim().slice(0,100)||'Bescheinigung';
      bescheinigungen.push({file,daten,bezeichnung:label});
    }catch(error){errors.push(file.name+': '+error.message);}
  }
  renderCertificates();
  certificateStatus.textContent=errors.length?errors.join(' '):
    bescheinigungen.length+' von höchstens fünf Fotos bereit.';
  certificateFiles.disabled=false;
});
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
        wohnort:form.elements.wohnort.value,
        bescheinigungen:bescheinigungen.map(({file,daten,bezeichnung})=>({
          dateiname:file.name,bezeichnung,daten
        })),passwort})});
    form.hidden=true;
    bescheinigungen.length=0;renderCertificates();
    intro.textContent='Vielen Dank. Deine Registrierung wurde übermittelt.';
    status.textContent='Dein Zugang bleibt bis zur Freigabe durch die Verwaltung gesperrt. Du erhältst nach der Freigabe eine Benachrichtigung.';
  }catch(error){status.textContent='Registrierung fehlgeschlagen: '+error.message;}
  finally{submit.disabled=false;}
});
loadInvitation().catch(error=>{intro.textContent='Registrierung nicht möglich.';status.textContent=error.message;form.hidden=true;});
