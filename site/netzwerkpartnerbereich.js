'use strict';
const form=document.getElementById('partner-login-form'),status=document.getElementById('partner-login-status');
const workspace=document.getElementById('partner-workspace');
const calendarContent=document.getElementById('partner-calendar-content');
let currentProfile=null,displayedMonth=new Date();
displayedMonth=new Date(displayedMonth.getFullYear(),displayedMonth.getMonth(),1);
async function request(url,options={}){
  const response=await fetch(url,{credentials:'same-origin',...options});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Anfrage fehlgeschlagen.');return data;
}
function addProfile(label,value){
  if(!value)return;
  const item=document.createElement('p');item.append(document.createTextNode(label+': '+value));
  document.getElementById('partner-profile').append(item);
}
function pad(value){return String(value).padStart(2,'0');}
function iso(date){return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());}
function calendarBounds(){
  const first=new Date(displayedMonth.getFullYear(),displayedMonth.getMonth(),1);
  const start=new Date(first);start.setDate(1-((first.getDay()+6)%7));
  const last=new Date(displayedMonth.getFullYear(),displayedMonth.getMonth()+1,0);
  const end=new Date(last);end.setDate(last.getDate()+(6-((last.getDay()+6)%7)));
  return{start:iso(start),end:iso(end)};
}
function displayTime(start,end){
  if(!start)return '';
  return end?start+'–'+end+' Uhr':start+' Uhr';
}
function eventTime(event){
  if(event.endzeit)return displayTime(event.uhrzeit,event.endzeit);
  if(event.uhrzeit)return displayTime(event.uhrzeit,null);
  return '';
}
function renderCalendar(data){
  document.getElementById('partner-calendar-heading').textContent='Kalender '+data.standort;
  document.getElementById('partner-calendar-month').textContent=displayedMonth.toLocaleDateString('de-DE',{month:'long',year:'numeric'});
  const grid=document.getElementById('partner-calendar-grid');grid.replaceChildren();
  const bounds=calendarBounds(),days=[];
  for(let date=new Date(bounds.start+'T12:00:00');iso(date)<=bounds.end;date.setDate(date.getDate()+1))days.push(new Date(date));
  const events=data.events||[];
  for(const date of days){
    const key=iso(date),outside=date.getMonth()!==displayedMonth.getMonth();
    const day=document.createElement('article');day.className='partner-calendar-day'+(outside?' is-outside':'');
    const head=document.createElement('div');head.className='partner-calendar-day-head';
    const number=document.createElement('strong');number.textContent=String(date.getDate());head.append(number);
    if(!outside&&key===iso(new Date())){const today=document.createElement('span');today.className='partner-calendar-today';today.textContent='Heute';head.append(today);}
    day.append(head);
    const items=[];
    for(const event of events){
      const end=event.enddatum||event.datum;
      if(key<event.datum||key>end)continue;
      const kind=event.typ==='sperrzeit'?'blocked':event.typ==='buchungsfenster'?'window':
        event.typ==='buchung'?(event.art==='Belegt'?'booked':'request'):'event';
      items.push({kind,title:event.titel||event.art||'Termin',time:eventTime(event)});
    }
    if(!items.length){
      const free=document.createElement('span');free.className='partner-calendar-free';free.textContent='Frei';day.append(free);
    }else{
      const list=document.createElement('ul');list.className='partner-calendar-items';
      for(const item of items){
        const li=document.createElement('li');li.className='partner-calendar-item is-'+item.kind;
        const title=document.createElement('span');title.textContent=item.title;li.append(title);
        if(item.time){const time=document.createElement('small');time.textContent=item.time;li.append(time);}
        list.append(li);
      }
      day.append(list);
    }
    grid.append(day);
  }
  calendarContent.hidden=false;
  document.getElementById('partner-calendar-status').textContent='Kalender für '+data.standort+' aktualisiert.';
}
async function loadCalendar(){
  const message=document.getElementById('partner-calendar-status');
  if(!currentProfile?.standort_id){
    calendarContent.hidden=true;message.textContent='Für deinen Zugang ist noch kein Standort freigegeben. Bitte wende dich an die Verwaltung.';return;
  }
  if(currentProfile.standort_aktiv===false){
    calendarContent.hidden=true;message.textContent='Der freigegebene Standort ist derzeit nicht aktiv.';return;
  }
  const bounds=calendarBounds();message.textContent='Kalender wird geladen …';
  try{
    const data=await request('/api/netzwerkpartner/brilon-kalender?von='+encodeURIComponent(bounds.start)+'&bis='+encodeURIComponent(bounds.end));
    renderCalendar(data);
  }catch(error){calendarContent.hidden=true;message.textContent=error.message;}
}
async function loadProfile(){
  const profile=await request('/api/netzwerkpartner/me');currentProfile=profile;form.hidden=true;workspace.hidden=false;
  document.getElementById('partner-title').textContent=profile.unternehmen;
  const list=document.getElementById('partner-profile');list.replaceChildren();
  addProfile('Ansprechperson',profile.ansprechpartner);addProfile('E-Mail',profile.email);
  addProfile('Telefon',profile.telefon);addProfile('Anschrift',[profile.strasse,[profile.plz,profile.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '));
  addProfile('Weitere Kontakthinweise',profile.weitere_angaben);
  await loadCalendar();
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
  currentProfile=null;workspace.hidden=true;form.hidden=false;form.reset();status.textContent='Du wurdest abgemeldet.';
});
document.getElementById('partner-calendar-refresh').addEventListener('click',loadCalendar);
document.getElementById('partner-calendar-prev').addEventListener('click',()=>{displayedMonth=new Date(displayedMonth.getFullYear(),displayedMonth.getMonth()-1,1);loadCalendar();});
document.getElementById('partner-calendar-next').addEventListener('click',()=>{displayedMonth=new Date(displayedMonth.getFullYear(),displayedMonth.getMonth()+1,1);loadCalendar();});
document.getElementById('partner-appointment-form').addEventListener('submit',async event=>{
  event.preventDefault();const requestForm=event.currentTarget,button=requestForm.querySelector('button[type="submit"]'),requestStatus=document.getElementById('partner-request-status');
  button.disabled=true;requestStatus.textContent='Terminwunsch wird übermittelt …';
  try{
    const data=await request('/api/netzwerkpartner/terminanfrage',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.fromEntries(new FormData(requestForm)))});
    requestStatus.textContent=data.message;requestForm.reset();
  }catch(error){requestStatus.textContent='Terminwunsch konnte nicht gesendet werden: '+error.message;}
  finally{button.disabled=false;}
});
loadProfile().then(()=>{status.textContent='Du bist bereits angemeldet.';}).catch(()=>{});
