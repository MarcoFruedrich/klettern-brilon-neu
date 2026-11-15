'use strict';
(() => {
  const query=new URLSearchParams(location.search);
  const token=query.get('token')||'';
  const status=document.getElementById('status');
  const section=document.getElementById('request');
  const buttons=[document.getElementById('confirm'),document.getElementById('decline')];
  const show=(message,type='')=>{status.textContent=message;status.className=type;};
  const dateText=(date,time)=>{
    const d=new Date(String(date).slice(0,10)+'T'+String(time).slice(0,5)+':00');
    return Number.isNaN(d.valueOf())?String(date)+' '+String(time).slice(0,5):new Intl.DateTimeFormat('de-DE',{dateStyle:'long',timeStyle:'short'}).format(d)+' Uhr';
  };
  async function json(url,options){
    const response=await fetch(url,options);
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Die Anfrage konnte nicht verarbeitet werden.');
    return data;
  }
  async function load(){
    if(!/^[a-f0-9]{64}$/i.test(token)){show('Der Rückmeldelink ist ungültig.','error');return;}
    try{
      const item=await json('/api/netzwerkpartner/terminreaktion?token='+encodeURIComponent(token));
      document.getElementById('place').textContent=item.standort_name||'–';
      document.getElementById('partner').textContent=item.unternehmen||item.ansprechpartner||'–';
      document.getElementById('program').textContent=item.programm||'–';
      document.getElementById('date').textContent=dateText(item.datum,item.uhrzeit);
      document.getElementById('people').textContent=String(item.personen);
      section.hidden=false;
      if(!item.offen){
        buttons.forEach(button=>button.disabled=true);
        show(item.status==='bestaetigt'?'Dieser Termin wurde bereits bestätigt.':item.status==='abgelehnt'?'Dieser Termin wurde bereits abgelehnt.':'Der Rückmeldelink ist abgelaufen.','error');
      }else show('Bitte bestätige oder lehne den Terminwunsch ab.');
    }catch(error){show(error.message,'error');}
  }
  async function respond(decision){
    buttons.forEach(button=>button.disabled=true);
    show('Rückmeldung wird gespeichert …');
    try{
      const result=await json('/api/netzwerkpartner/terminreaktion',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({token,entscheidung:decision})
      });
      show(decision==='bestaetigt'?'Termin bestätigt. Der Netzwerkpartner wurde benachrichtigt.':'Termin abgelehnt. Der Netzwerkpartner wurde benachrichtigt.','ok');
    }catch(error){show(error.message,'error');buttons.forEach(button=>button.disabled=false);}
  }
  document.getElementById('confirm').addEventListener('click',()=>respond('bestaetigt'));
  document.getElementById('decline').addEventListener('click',()=>respond('abgelehnt'));
  load();
})();