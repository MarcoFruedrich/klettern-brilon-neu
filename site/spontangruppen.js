'use strict';
(() => {
  const $=id=>document.getElementById(id),place=$('place'),code=$('code'),form=$('poll');
  const status=msg=>{const e=$('status');e.textContent=msg;e.className='';};
  const escapeDate=value=>String(value).slice(0,10);
  const fmt=(date,time)=>{const d=new Date(escapeDate(date)+'T'+String(time).slice(0,5)+':00');return Number.isNaN(d.valueOf())?escapeDate(date)+' · '+String(time).slice(0,5):new Intl.DateTimeFormat('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d)+' Uhr';};
  async function request(url,options){const r=await fetch(url,options);const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Die Anfrage konnte nicht verarbeitet werden.');return data;}
  async function loadPlaces(){
    try{
      const choices=await request('/api/spontangruppen/standorte');
      for(const item of choices){const o=document.createElement('option');o.value=String(item.id);o.textContent=item.name;place.append(o);}
      const id=new URLSearchParams(location.search).get('ortId');
      if(id&&choices.some(x=>String(x.id)===id))place.value=id;
      await loadBoard();
    }catch(e){status(e.message);}
  }
  function renderBoard(board){
    $('interest-count').textContent=board.interessierte?board.interessierte+' Gruppe(n) interessiert':'Noch keine Interessierten';
    $('people-count').textContent=(board.personen||0)+' Personen';
    const results=$('slot-results'),options=$('time-options');
    const checked=new Set([...options.querySelectorAll('input:checked')].map(x=>x.value));
    results.replaceChildren();options.replaceChildren();
    if(!board.zeiten?.length){results.append(Object.assign(document.createElement('p'),{className:'hint',textContent:'Noch keine Zeiten vorgeschlagen. Du kannst unten den Anfang machen.'}));}
    for(const slot of board.zeiten||[]){
      const line=document.createElement('div');line.className='slot';
      const text=document.createElement('span');text.textContent=fmt(slot.datum,slot.uhrzeit)+' · '+slot.stimmen+' Stimme(n)';line.append(text);results.append(line);
      const label=document.createElement('label');label.className='slot';
      const input=document.createElement('input');input.type='checkbox';input.value=slot.id;input.checked=checked.has(slot.id);
      const caption=document.createElement('span');caption.textContent=fmt(slot.datum,slot.uhrzeit)+' · '+slot.stimmen+' Stimme(n)';
      label.append(input,caption);options.append(label);
    }
  }
  async function loadBoard(){
    if(!place.value)return;
    try{
      const board=await request('/api/spontangruppen/board?ortId='+encodeURIComponent(place.value));
      renderBoard(board);
      if(!board.aktiv)status('Noch keine aktuelle Abstimmung. Bitte den Code auf dem Monitor vor Ort eingeben; danach kannst du abstimmen.');
    }catch(e){status(e.message);}
  }
  place.addEventListener('change',()=>{history.replaceState(null,'','?ortId='+encodeURIComponent(place.value));loadBoard();});
  $('interested').addEventListener('change',()=>{$('people').disabled=!$('interested').checked;});
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const ortId=Number(place.value),codeValue=code.value.trim();
    if(!ortId){status('Bitte zuerst einen Standort auswählen.');return;}
    const date=$('new-date').value,time=$('new-time').value;
    if(Boolean(date)!==Boolean(time)){status('Für einen Zeitvorschlag bitte sowohl Datum als auch Uhrzeit eintragen.');return;}
    if(!/^\d{6}$/.test(codeValue)){status('Bitte den sechsstelligen aktuellen Sicherheitscode vom Monitor eingeben.');return;}
    const key='spontan-teilnahme-'+ortId;let teilnahmeId=localStorage.getItem(key);
    if(!teilnahmeId){teilnahmeId=crypto.randomUUID?crypto.randomUUID():([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));localStorage.setItem(key,teilnahmeId);}
    const button=$('submit');button.disabled=true;status('Abstimmung wird gespeichert …');
    try{
      const result=await request('/api/spontangruppen/abstimmung',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ortId,code:codeValue,teilnahmeId,interesse:$('interested').checked,personen:Number($('people').value||1),
          neueZeiten:date&&time?[{datum:date,uhrzeit:time}]:[],
          zeitenIds:[...$('time-options').querySelectorAll('input:checked')].map(x=>x.value)})});
      renderBoard(result);status('Deine Rückmeldung wurde gespeichert. Du kannst später mit demselben Gerät erneut abstimmen.');$('new-date').value='';$('new-time').value='';
    }catch(error){status(error.message);}
    finally{button.disabled=false;}
  });
  const today=new Date(),max=new Date(today.getTime()+90*86400000);
  const dateValue=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  $('new-date').min=dateValue(today);$('new-date').max=dateValue(max);
  loadPlaces();setInterval(loadBoard,20000);
})();