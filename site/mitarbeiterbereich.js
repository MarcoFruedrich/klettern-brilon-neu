'use strict';
const $=id=>document.getElementById(id);
const node=(tag,value)=>{const element=document.createElement(tag);if(value!==undefined)element.textContent=value;return element;};
async function request(url,options={}){
  const response=await fetch(url,{credentials:'same-origin',...options});
  const data=await response.json();
  if(!response.ok)throw Object.assign(Error(data.error||'Anfrage fehlgeschlagen.'),data);
  return data;
}
function showContacts(entry,content){
  const contacts=[...(entry.kontakte||[])].sort((a,b)=>{
    const surname=value=>String(value||'').trim().split(/\s+/).at(-1)||'';
    return surname(a.name).localeCompare(surname(b.name),'de',{sensitivity:'base'})||
      String(a.name||'').localeCompare(String(b.name||''),'de',{sensitivity:'base'});
  });
  const table=node('div');table.className='staff-contact-table';table.setAttribute('role','table');
  const header=node('div');header.className='staff-contact-header';header.setAttribute('role','row');
  for(const label of ['Name','E-Mail','Telefon','Wohnort']){
    const cell=node('strong',label);cell.setAttribute('role','columnheader');header.append(cell);
  }
  table.append(header);
  if(!contacts.length)table.append(node('p','Noch keine freigegebenen Mitarbeiterkonten.'));
  for(const person of contacts){
    const row=node('div');row.className='staff-contact-row';row.setAttribute('role','row');
    const name=node('strong',person.name||'—');name.dataset.label='Name';name.setAttribute('role','cell');row.append(name);
    const emailCell=node('div');emailCell.dataset.label='E-Mail';emailCell.setAttribute('role','cell');
    if(person.email){const email=node('a',person.email);email.href='mailto:'+person.email;emailCell.append(email);}
    else emailCell.append(node('span','—'));
    row.append(emailCell);
    const phoneCell=node('div');phoneCell.dataset.label='Telefon';phoneCell.setAttribute('role','cell');
    if(person.telefon){const phone=node('a',person.telefon);phone.href='tel:'+person.telefon.replace(/[^+\d]/g,'');phoneCell.append(phone);}
    else phoneCell.append(node('span','—'));
    row.append(phoneCell);
    const town=node('span',person.wohnort||'—');town.dataset.label='Wohnort';town.setAttribute('role','cell');row.append(town);
    table.append(row);
  }
  content.append(table);
}
function showTextArea(area,content){
  const section=node('section');section.className='staff-location-section';
  section.append(node('h3',area.titel));
  const text=node('div',area.inhalt);text.className='staff-area-text';section.append(text);content.append(section);
}
function attendanceCard(event,content){
  const card=node('article');card.className='staff-attendance-event';
  const date=new Date(`${event.datum}T${event.uhrzeit||'09:00'}:00`);
  card.append(node('h3',event.programm||event.titel||'Programm'),
    node('p',`${date.toLocaleDateString('de-DE',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'})} · ${event.uhrzeit||'Uhrzeit offen'} Uhr`),
    node('p',`${event.standort||'Standort offen'} · ${event.buchungsnummer?'Buchungsnummer '+event.buchungsnummer:'Teilnehmerprüfung vor Ort'}`));
  if(event.teilnehmerCheckErledigt){card.append(node('p','Teilnehmerprüfung bereits bestätigt.'));content.append(card);return;}
  const form=node('form');form.className='staff-attendance-form';
  const details=node('p','Teilnehmende und Zimmernummer werden beim Öffnen sicher geladen.');
  const open=node('button','Teilnehmende prüfen');open.type='button';open.className='btn secondary';
  open.addEventListener('click',async()=>{
    open.disabled=true;details.textContent='Buchungsdaten werden geladen …';
    try{
      const info=await request(`/api/pruefung/kalender/buchungen/${encodeURIComponent(event.bookingId)}/teilnehmer-check`);
      form.replaceChildren(node('h4',`${info.name} · Zimmer ${info.zimmernummer}`));
      form.append(node('p',`Gebucht: ${info.teilnehmerGebucht} Person${info.teilnehmerGebucht===1?'':'en'}`));
      const booked=node('label','Gebuchte Personenzahl vor Ort bestätigt');
      const bookedInput=document.createElement('input');bookedInput.type='number';bookedInput.min='1';bookedInput.max='150';bookedInput.required=true;bookedInput.value=String(info.teilnehmerGebucht);booked.append(bookedInput);form.append(booked);
      const extra=node('label','Spontan hinzugekommene Personen');
      const extraInput=document.createElement('input');extraInput.type='number';extraInput.min='0';extraInput.max='150';extraInput.value=String(info.teilnehmerSpontan||0);extraInput.inputMode='numeric';extra.append(extraInput);form.append(extra);
      const names=node('label','Namen der spontanen Personen (kommagetrennt, optional)');
      const namesInput=document.createElement('textarea');namesInput.rows=2;namesInput.value=(info.spontaneNamen||[]).join(', ');names.append(namesInput);form.append(names);
      const submit=node('button',info.bestaetigtAm?'Fehlende Meldung erneut senden':'Teilnehmerzahl bestätigen und melden');submit.type='submit';submit.className='staff-attendance-confirm';form.append(submit);
      form.onsubmit=async submitEvent=>{
        submitEvent.preventDefault();submit.disabled=true;
        try{
          const spontaneous=Number(extraInput.value||0),spontaneNamen=namesInput.value.split(',').map(value=>value.trim()).filter(Boolean);
          const result=await request(`/api/pruefung/kalender/buchungen/${encodeURIComponent(event.bookingId)}/teilnehmer-check`,{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({teilnehmerGebucht:Number(bookedInput.value),teilnehmerSpontan:spontaneous,spontaneNamen})});
          if(result.error)throw Error(result.error);
          form.replaceChildren(node('div',`Bestätigt: ${Number(bookedInput.value)+spontaneous} Personen. ${result.message||'Die Information wurde verarbeitet.'}`));
          form.className='staff-attendance-summary';card.dataset.completed='true';
        }catch(error){details.textContent='Meldung fehlgeschlagen: '+error.message;submit.disabled=false;}
      };
      details.remove();form.append(details);
    }catch(error){details.textContent='Buchungsdaten konnten nicht geladen werden: '+error.message;open.disabled=false;}
  });
  form.append(details);card.append(open,form);content.append(card);
}
function showAttendanceCalendar(entry,content){
  content.append(node('h2',entry.title),node('p','Brilon-Termine mit QR-Anmeldung. Vor Programmbeginn die gebuchten Teilnehmenden prüfen, spontane Personen ergänzen und die Meldung bestätigen.'));
  const events=(entry.data?.events||[]).filter(event=>event.qrAnmeldung&&event.standort==='Jugendherberge Brilon'&&event.freigegeben);
  if(!events.length){content.append(node('p','Aktuell sind keine prüfbaren QR-Anmeldungen für Brilon vorhanden.'));return;}
  const list=node('div');list.className='staff-attendance-agenda';
  for(const event of events)attendanceCard(event,list);
  content.append(list);
}
function entryForArea(area,subtitle=''){
  return {key:'area:'+area.id+(subtitle?':'+subtitle:''),title:area.titel,area};
}
function showEntry(entry){
  const content=$('staff-area-content'),planning=$('staff-planning-page'),wiki=$('wiki-staff');
  const primary=entry.kind==='planning'||entry.kind==='wiki';
  planning.hidden=entry.kind!=='planning';
  wiki.hidden=entry.kind!=='wiki';
  content.hidden=primary;
  if(primary){
    for(const button of $('staff-areas-nav').querySelectorAll('button[data-entry-key]')){
      const selected=button.dataset.entryKey===entry.key;
      button.classList.toggle('active',selected);
      if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    }
    return;
  }
  content.replaceChildren();
  if(entry.kind==='contacts'){
    content.append(node('h2',entry.title));showContacts(entry,content);
  }else if(entry.kind==='location'){
    content.append(node('h2',entry.place.name));
    const info=entry.areas.filter(area=>area.art==='standort');
    const partners=entry.areas.filter(area=>area.art==='partner');
    if(info.length){content.append(node('h3','Standortinformationen'));for(const area of info)showTextArea(area,content);}
    else content.append(node('p','Für diesen Standort sind noch keine zusätzlichen Informationen hinterlegt.'));
    if(partners.length){content.append(node('h3','Netzwerk- und Kooperationspartner'));for(const area of partners)showTextArea(area,content);}
    const programs=entry.areas.filter(area=>area.art==='programm');
    if(programs.length){
      const section=node('section');section.className='staff-location-section';section.append(node('h3','Zugeordnete Programme'));
      const list=node('ul');for(const area of programs)list.append(node('li',area.titel));section.append(list);content.append(section);
    }
  }else if(entry.kind==='calendar'){
    showAttendanceCalendar(entry,content);
  }else{
    content.append(node('h2',entry.title));
    const text=node('div',entry.area.inhalt);text.className='staff-area-text';content.append(text);
  }
  for(const button of $('staff-areas-nav').querySelectorAll('button[data-entry-key]')){
    const selected=button.dataset.entryKey===entry.key;
    button.classList.toggle('active',selected);
    if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  }
}
function addNavButton(nav,entry,child=false){
  const button=node('button',entry.title);button.type='button';
  button.className='employee-area-link'+(child?' staff-subarea-link':'');
  button.dataset.entryKey=entry.key;
  button.addEventListener('click',()=>showEntry(entry));nav.append(button);
}
function render(data){
  $('staff-login').hidden=true;$('staff-portal-workspace').hidden=false;
  $('staff-portal-name').textContent=data.mitarbeiter;
  $('staff-admin-link').hidden=!data.verwaltungszugang;
  const profile=$('staff-profile-form');
  profile.elements.name.value=data.profil?.name||data.mitarbeiter||'';
  profile.elements.email.value=data.profil?.email||'';
  profile.elements.telefon.value=data.profil?.telefon||'';
  const nav=$('staff-areas-nav');nav.replaceChildren();
  const areas=data.bereiche||[],entries=[
    {key:'planning',title:'Termine und meine Buchungen',kind:'planning'},
    {key:'calendar',title:'Brilon-Teilnehmerprüfung',kind:'calendar',data:data.kalender},
    {key:'wiki',title:'Wissenspool',kind:'wiki'}
  ];
  if(Array.isArray(data.kontakte))entries.push({key:'contacts',title:'Mitarbeiterkontakte',kind:'contacts',kontakte:data.kontakte});
  for(const area of areas.filter(item=>item.art==='allgemein'))entries.push(entryForArea(area));
  const locations=[...(data.orte||[])].sort((a,b)=>a.name.localeCompare(b.name,'de',{sensitivity:'base'}));
  for(const place of locations){
    const attached=areas.filter(area=>(area.standorte||[]).some(location=>String(location.id)===String(place.id)));
    const locationAreas=attached.filter(area=>['standort','partner','programm'].includes(area.art));
    const programs=locationAreas.filter(area=>area.art==='programm');
    if(!locationAreas.some(area=>area.art==='standort'||area.art==='partner'||area.art==='programm'))continue;
    entries.push({key:'location:'+place.id,title:place.name,kind:'location',place,areas:locationAreas});
    for(const area of programs)entries.push({...entryForArea(area,'location:'+place.id),title:area.titel+' · '+place.name,child:true});
  }
  for(const area of areas.filter(item=>item.art==='partner'&&!(item.standorte||[]).length))entries.push(entryForArea(area));
  if(!entries.length){
    $('staff-area-content').replaceChildren(node('h2','Noch keine Bereiche freigegeben'),
      node('p','Die Verwaltung hat noch keine Informationen für den Mitarbeiterbereich veröffentlicht.'));
    return;
  }
  for(const entry of entries){
    if(entry.kind==='location'){
      const group=node('div');group.className='staff-location-nav-group';
      group.append(node('span',entry.title));addNavButton(group,entry);
      for(const program of entries.filter(item=>item.key.startsWith('area:')&&item.key.endsWith(':location:'+entry.place.id)))addNavButton(group,program,true);
      nav.append(group);
    }else if(entry.child){
      continue;
    }else addNavButton(nav,entry);
  }
  showEntry(entries[0]);
}
async function load(){
  $('staff-portal-status').textContent='Mitarbeiterbereiche werden geladen …';
  try{
    const profile=await request('/api/pruefung/mitarbeiterbereiche');
    try{profile.kalender=await request('/api/pruefung/qr-kalender');}catch{profile.kalender={events:[]};}
    render(profile);$('staff-portal-status').textContent='';
  }
  catch(error){$('staff-login').hidden=false;$('staff-portal-workspace').hidden=true;$('staff-portal-status').textContent=error.message;}
}
$('staff-login').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]');
  $('staff-reset-request').hidden=true;
  button.disabled=true;$('staff-portal-status').textContent='Anmeldung wird geprüft …';
  try{await request('/api/pruefung/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.fromEntries(new FormData(form)))});form.reset();await load();}
  catch(error){$('staff-portal-status').textContent='Anmeldung fehlgeschlagen: '+error.message;
    if(error.passwortResetMoeglich)$('staff-reset-request').hidden=false;}
  finally{button.disabled=false;}
});
$('staff-reset-request').addEventListener('click',async event=>{
  const button=event.currentTarget,email=$('staff-login').elements.email.value.trim();
  if(!email){$('staff-portal-status').textContent='Bitte zuerst die hinterlegte E-Mail-Adresse eintragen.';return;}
  button.disabled=true;
  try{
    const result=await request('/api/pruefung/passwort-reset-anfordern',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
    $('staff-portal-status').textContent=result.message;
  }catch(error){$('staff-portal-status').textContent='Anfrage fehlgeschlagen: '+error.message;}
  finally{button.disabled=false;}
});
$('staff-profile-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]');
  const status=$('staff-profile-status');button.disabled=true;status.textContent='Kontaktdaten werden gespeichert …';
  try{
    await request('/api/pruefung/profil',{method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:form.elements.name.value,telefon:form.elements.telefon.value})});
    await load();status.textContent='Kontaktdaten gespeichert. Die Mitarbeiterkontaktliste wurde aktualisiert.';
  }catch(error){status.textContent='Kontaktdaten konnten nicht gespeichert werden: '+error.message;}
  finally{button.disabled=false;}
});
$('staff-portal-logout').addEventListener('click',async()=>{
  try{await request('/api/pruefung/abmelden',{method:'POST'});}
  finally{$('staff-portal-workspace').hidden=true;$('staff-login').hidden=false;$('staff-portal-status').textContent='Du wurdest abgemeldet.';}
});
load();
