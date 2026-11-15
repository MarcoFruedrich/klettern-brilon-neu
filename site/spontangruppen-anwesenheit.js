'use strict';
(() => {
  const $=id=>document.getElementById(id),place=$('place'),eventSelect=$('event'),roster=$('roster'),status=$('status'),save=$('save'),createInvoice=$('create-invoice');
  let savedForInvoice=false;
  const setStatus=(msg,type='')=>{status.textContent=msg;status.className=type;};
  async function api(url,options){const r=await fetch(url,options);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Anfrage fehlgeschlagen.');return d;}
  const fmt=(date,time)=>{const d=new Date(String(date).slice(0,10)+'T'+String(time).slice(0,5)+':00');return Number.isNaN(d.valueOf())?String(date)+' '+String(time).slice(0,5):new Intl.DateTimeFormat('de-DE',{weekday:'long',day:'2-digit',month:'long',hour:'2-digit',minute:'2-digit'}).format(d)+' Uhr';};
  async function loadPlaces(){
    try{
      const places=await api('/api/spontangruppen/anwesenheit/standorte');
      place.replaceChildren(new Option('Standort auswählen …',''));
      for(const p of places)place.append(new Option(p.name,String(p.id)));
      setStatus(places.length?'Bitte Standort und bestätigten Termin auswählen.':'Für dich sind keine aktiven Standorte freigegeben.');
    }catch(error){setStatus(error.message,'error');}
  }
  async function loadEvents(){
    roster.replaceChildren();$('group-summary').textContent='';save.disabled=true;
    eventSelect.disabled=true;eventSelect.replaceChildren(new Option('Termine werden geladen …',''));
    if(!place.value)return;
    try{
      const events=await api('/api/spontangruppen/anwesenheit/termine?ortId='+encodeURIComponent(place.value));
      eventSelect.replaceChildren(new Option(events.length?'Termin auswählen …':'Keine bestätigten Gruppen für diesen Standort',''));
      for(const item of events)eventSelect.append(new Option(fmt(item.datum,item.uhrzeit)+' · '+item.angemeldet+' angemeldet',item.id));
      eventSelect.disabled=!events.length;
      setStatus(events.length?'Bitte den Termin auswählen, für den du die Anwesenheit prüfen möchtest.':'Derzeit liegen keine bestätigten Gruppen vor.');
    }catch(error){setStatus(error.message,'error');}
  }
  async function loadGroup(){
    roster.replaceChildren();save.disabled=true;createInvoice.hidden=true;createInvoice.disabled=true;savedForInvoice=false;
    if(!eventSelect.value)return;
    try{
      const data=await api('/api/spontangruppen/anwesenheit/gruppe?zeitId='+encodeURIComponent(eventSelect.value));
      const total=data.gaeste.reduce((n,g)=>n+Number(g.personen||0),0);
      $('group-summary').textContent=data.gruppe.standort+' · '+fmt(data.gruppe.datum,data.gruppe.uhrzeit)+' · '+total+' angemeldet';
      if(data.gruppe.rechnungsnummer){createInvoice.hidden=false;createInvoice.disabled=true;createInvoice.textContent='Rechnung '+data.gruppe.rechnungsnummer+' erstellt · E-Mail '+data.gruppe.rechnungs_email_status;setStatus('Dieser Termin wurde bereits abgeschlossen und abgerechnet.','ok');return;}
      for(const guest of data.gaeste){
        const row=document.createElement('article');row.className='guest';row.dataset.participantId=guest.teilnahme_id;
        const name=document.createElement('div');const strong=document.createElement('strong');strong.textContent=guest.gast_name||'Gast';const email=document.createElement('span');email.className='muted';email.textContent=guest.gast_email||'';name.append(strong,email);
        const party=document.createElement('div');const partyLabel=document.createElement('span');partyLabel.className='muted';partyLabel.textContent='Angemeldet';const partyCount=document.createElement('strong');partyCount.textContent=guest.personen+' Person(en)';party.append(partyLabel,partyCount);
        const checkLabel=document.createElement('label');checkLabel.className='check';const check=document.createElement('input');check.type='checkbox';check.checked=Boolean(guest.anwesend);const checkText=document.createElement('span');checkText.textContent='Anwesend';checkLabel.append(check,checkText);
        const actualLabel=document.createElement('label');actualLabel.className='person';actualLabel.textContent='Tatsächlich da';const actual=document.createElement('input');actual.type='number';actual.min='0';actual.max='15';actual.step='1';actual.value=String(guest.anwesend?guest.anwesend_personen:guest.personen);actual.disabled=!check.checked;actual.setAttribute('aria-label','Tatsächlich anwesende Personenzahl für '+(guest.gast_name||'Gast'));
        check.addEventListener('change',()=>{actual.disabled=!check.checked;if(check.checked&&Number(actual.value)===0)actual.value=String(guest.personen);if(!check.checked)actual.value='0';});
        actualLabel.append(actual);
        row.append(name,party,checkLabel,actualLabel);roster.append(row);
      }
      if(!data.gaeste.length)roster.append(Object.assign(document.createElement('p'),{textContent:'Für diesen Termin sind keine Anmeldungen vorhanden.'}));
      save.disabled=!data.gaeste.length;
      savedForInvoice=data.gaeste.length>0&&data.gaeste.every(g=>Boolean(g.geprueft_am));
      createInvoice.hidden=false;createInvoice.disabled=!savedForInvoice;
      if(savedForInvoice)createInvoice.textContent='Programm abgeschlossen · Partnerrechnung erstellen';
      roster.addEventListener('change',()=>{savedForInvoice=false;createInvoice.disabled=true;});
      setStatus(savedForInvoice?'Anwesenheit ist gespeichert. Du kannst das Programm jetzt abschließen.':'Anwesenheit und tatsächliche Personenzahl prüfen. Nicht erschienene Gruppen abwählen.');
    }catch(error){setStatus(error.message,'error');}
  }
  place.addEventListener('change',loadEvents);eventSelect.addEventListener('change',loadGroup);
  save.addEventListener('click',async()=>{
    const entries=[...roster.querySelectorAll('.guest')].map(row=>({
      teilnahmeId:row.dataset.participantId,
      anwesend:row.querySelector('input[type=checkbox]').checked,
      personen:Number(row.querySelector('input[type=number]').value||0)
    }));
    save.disabled=true;setStatus('Anwesenheit wird gespeichert …');
    try{
      const result=await api('/api/spontangruppen/anwesenheit/speichern',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({zeitId:eventSelect.value,eintraege:entries})});
      $('group-summary').textContent+=' · Tatsächlich anwesend: '+result.anwesend+' Personen';
      savedForInvoice=true;createInvoice.hidden=false;createInvoice.disabled=false;
      createInvoice.textContent='Programm abgeschlossen · Partnerrechnung erstellen';
      setStatus('Anwesenheit und tatsächliche Personenzahl gespeichert.','ok');
    }catch(error){setStatus(error.message,'error');}
    finally{save.disabled=false;}
  });
  createInvoice.addEventListener('click',async()=>{
    if(!savedForInvoice||!eventSelect.value)return;
    if(!confirm('Termin abschließen und Partnerrechnung mit den geprüften Anwesenheitszahlen erstellen?'))return;
    createInvoice.disabled=true;setStatus('Partnerrechnung wird erstellt und in der Buchhaltung erfasst …');
    try{
      const result=await api('/api/spontangruppen/abrechnung',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({zeitId:eventSelect.value})});
      createInvoice.textContent='Rechnung '+result.rechnungsnummer+' · E-Mail '+result.emailStatus;
      setStatus('Rechnung '+result.rechnungsnummer+' wurde dauerhaft in der Buchhaltung erfasst. Versandstatus: '+result.emailStatus+'.','ok');
      savedForInvoice=false;
    }catch(error){setStatus(error.message,'error');createInvoice.disabled=false;}
  });
  loadPlaces();
})();