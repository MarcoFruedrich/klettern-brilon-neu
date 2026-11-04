'use strict';
const $=id=>document.getElementById(id);
const node=(tag,value)=>{const element=document.createElement(tag);if(value!==undefined)element.textContent=value;return element;};
async function request(url,options={}){
  const response=await fetch(url,{credentials:'same-origin',...options});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Anfrage fehlgeschlagen.');
  return data;
}
function showContacts(entry,content){
  const contacts=[...(entry.kontakte||[])].sort((a,b)=>{
    const surname=value=>String(value||'').trim().split(/\s+/).at(-1)||'';
    return surname(a.name).localeCompare(surname(b.name),'de',{sensitivity:'base'})||
      String(a.name||'').localeCompare(String(b.name||''),'de',{sensitivity:'base'});
  });
  const list=node('div');list.className='staff-contact-list';
  if(!contacts.length)list.append(node('p','Noch keine freigegebenen Mitarbeiterkonten.'));
  for(const person of contacts){
    const card=node('article');card.className='booking staff-contact-card';
    card.append(node('strong',person.name));
    const email=node('a',person.email);email.href='mailto:'+person.email;card.append(email);
    if(person.telefon){const phone=node('a',person.telefon);phone.href='tel:'+person.telefon.replace(/[^+\d]/g,'');card.append(phone);}
    list.append(card);
  }
  content.append(list);
}
function showTextArea(area,content){
  const section=node('section');section.className='staff-location-section';
  section.append(node('h3',area.titel));
  const text=node('div',area.inhalt);text.className='staff-area-text';section.append(text);content.append(section);
}
function entryForArea(area,subtitle=''){
  return {key:'area:'+area.id+(subtitle?':'+subtitle:''),title:area.titel,area};
}
function showEntry(entry){
  const content=$('staff-area-content');content.replaceChildren();
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
  const profile=$('staff-profile-form');
  profile.elements.name.value=data.profil?.name||data.mitarbeiter||'';
  profile.elements.email.value=data.profil?.email||'';
  profile.elements.telefon.value=data.profil?.telefon||'';
  const nav=$('staff-areas-nav');nav.replaceChildren();
  const areas=data.bereiche||[],entries=[];
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
  try{render(await request('/api/pruefung/mitarbeiterbereiche'));$('staff-portal-status').textContent='';}
  catch(error){$('staff-login').hidden=false;$('staff-portal-workspace').hidden=true;$('staff-portal-status').textContent=error.message;}
}
$('staff-login').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');
  button.disabled=true;$('staff-portal-status').textContent='Anmeldung wird geprüft …';
  try{await request('/api/pruefung/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.fromEntries(new FormData(form)))});form.reset();await load();}
  catch(error){$('staff-portal-status').textContent='Anmeldung fehlgeschlagen: '+error.message;}
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
