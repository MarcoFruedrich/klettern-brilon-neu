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
        const statusBadge=el('p');
        statusBadge.className='staff-assignment-status';
        if(t.mein_status==='bestaetigt'){
          statusBadge.classList.add('is-confirmed');
          statusBadge.textContent='Bewerbung verbindlich übernommen – Programm angenommen';
        }else if(t.mein_status==='eingeteilt'){
          statusBadge.classList.add('is-assigned');
          statusBadge.textContent='Programm zugewiesen – bitte noch verbindlich bestätigen';
        }else if(t.mein_status==='beworben'){
          statusBadge.classList.add('is-applied');
          statusBadge.textContent='Bewerbung eingegangen – Rückmeldung der Verwaltung steht aus';
        }else{
          statusBadge.textContent='Für diesen Termin hast du noch keine Bewerbung abgegeben';
        }
        card.append(statusBadge);
        if(t.kundenbestaetigung_status==='geplant'&&t.kundenbestaetigung_faellig_ab)
          card.append(Object.assign(el('p','Kundenbestätigung geplant für '+new Date(t.kundenbestaetigung_faellig_ab).toLocaleString('de-DE')),
            {className:'staff-customer-mail-status'}));
        else if(t.kundenbestaetigung_status==='gesendet'&&t.kundenbestaetigung_versendet_am)
          card.append(Object.assign(el('p','Kundenbestätigung wurde am '+new Date(t.kundenbestaetigung_versendet_am).toLocaleString('de-DE')+' vom E-Mail-Anbieter angenommen.'),
            {className:'staff-customer-mail-status'}));
        else if(t.kundenbestaetigung_status==='fehler')
          card.append(Object.assign(el('p','Kundenbestätigung konnte nicht versendet werden. Die Verwaltung muss den Versand prüfen.'),
            {className:'staff-customer-mail-status'}));
        if(t.zahlungsinfo_gesendet_am)
          card.append(Object.assign(el('p','Zahlungsinformationen zur Anzahlung wurden am '+new Date(t.zahlungsinfo_gesendet_am).toLocaleString('de-DE')+' vom E-Mail-Anbieter angenommen.'),
            {className:'staff-customer-mail-status'}));
        const action=async(url,data={})=>{
          try{
            await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
            await loadPlanning();
          }catch(error){status.textContent='Aktion nicht möglich: '+error.message;}
        };
        if(t.sonderfreigabe&&(!t.mein_status||['beworben','abgelehnt'].includes(t.mein_status))){
          const direct=el('button','Programm verbindlich übernehmen');
          direct.type='button';direct.className='btn';
          direct.onclick=()=>action('/api/pruefung/einsatzplanung/direkt-annehmen/'+encodeURIComponent(t.id));
          card.append(direct,el('small','Deine Zusage ist verbindlich. Die Kundenbestätigung wird gemäß Verwaltungseinstellung zeitversetzt versandt.'));
        }else if(!t.sonderfreigabe&&(!t.mein_status||['beworben','abgelehnt'].includes(t.mein_status))){
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
