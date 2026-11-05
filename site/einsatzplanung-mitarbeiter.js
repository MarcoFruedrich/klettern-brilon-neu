'use strict';
(() => {
  const root=document.getElementById('staff-planning-list');
  const status=document.getElementById('staff-planning-status');
  if(!root)return;
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  async function loadPlanning(){
    status.textContent='Termine werden geladen …';
    try{
      const list=await request('/api/pruefung/einsatzplanung/termine');
      root.replaceChildren();
      if(!list.length)root.append(el('p','Aktuell sind keine neuen Termine vorhanden.'));
      for(const t of list){
        const card=el('article');card.className='booking';
        card.append(el('h3',t.datum+' · '+(t.uhrzeit||'Uhrzeit offen')+' Uhr'));
        card.append(el('p',(t.angebot||'Programm')+' · '+(t.ort||'Standort offen')+
          ' · '+(t.dauer||'Dauer nicht angegeben')+' Minuten'));
        card.append(el('p','Dein Status: '+(t.mein_status||'noch nicht beworben')));
        const action=async(url,data={})=>{
          try{
            await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
            await loadPlanning();
          }catch(error){status.textContent='Aktion nicht möglich: '+error.message;}
        };
        if(!t.mein_status||['beworben','abgelehnt'].includes(t.mein_status)){
          const button=el('button',t.mein_status==='beworben'?'Bewerbung aktualisieren':'Für Termin bewerben');
          button.type='button';button.className='btn secondary';
          button.onclick=()=>action('/api/pruefung/einsatzplanung/bewerben/'+encodeURIComponent(t.id));
          card.append(button);
        }
        if(t.mein_status==='eingeteilt'){
          const yes=el('button','Einsatz verbindlich bestätigen');
          yes.type='button';yes.className='btn';yes.onclick=()=>action('/api/pruefung/einsatzplanung/antwort/'+encodeURIComponent(t.id),{status:'bestaetigt'});
          const no=el('button','Einsatz ablehnen');
          no.type='button';no.className='btn secondary';no.onclick=()=>action('/api/pruefung/einsatzplanung/antwort/'+encodeURIComponent(t.id),{status:'abgelehnt'});
          card.append(yes,no);
        }
        root.append(card);
      }
      status.textContent='';
    }catch(error){status.textContent='Termine nicht verfügbar: '+error.message;}
  }
  document.getElementById('staff-planning-refresh').onclick=loadPlanning;
  const workspace=document.getElementById('staff-portal-workspace');
  const observer=new MutationObserver(()=>{if(!workspace.hidden)loadPlanning();});
  observer.observe(workspace,{attributes:true,attributeFilter:['hidden']});
  if(!workspace.hidden)loadPlanning();
})();
