'use strict';
(() => {
  const root=document.getElementById('staff-planning-list');
  const status=document.getElementById('staff-planning-status');
  if(!root)return;
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const anschlussAuswahl=()=>{
    const label=el('label','Kannst du zusätzliche Termine übernehmen?');
    const select=document.createElement('select');select.required=true;
    for(const [value,text] of [['','Bitte auswählen'],['keine','Nein, keine Anschlusskapazität'],['davor','Ja, einen Termin davor'],['danach','Ja, einen Termin danach'],['beides','Ja, davor und danach']]){
      const option=el('option',text);option.value=value;select.append(option);
    }
    label.append(select);return select;
  };
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
          statusBadge.textContent=t.manueller_termin?'Einsatz verbindlich bestätigt':'Bewerbung verbindlich übernommen – Programm angenommen';
        }else if(t.mein_status==='eingeteilt'){
          statusBadge.classList.add('is-assigned');
          statusBadge.textContent=t.manueller_termin?'Termin zugewiesen – bitte noch bestätigen':'Programm zugewiesen – bitte noch verbindlich bestätigen';
        }else if(t.mein_status==='beworben'){
          statusBadge.classList.add('is-applied');
          statusBadge.textContent='Bewerbung eingegangen – Rückmeldung der Verwaltung steht aus';
        }else{
          statusBadge.textContent='Für diesen Termin hast du noch keine Bewerbung abgegeben';
        }
        card.append(statusBadge);
        if(t.mein_status==='bestaetigt'&&t.anschluss_option){
          const descriptions={keine:'Keine zusätzliche Kapazität',davor:'Zusätzlicher Termin davor möglich',danach:'Zusätzlicher Termin danach möglich',beides:'Zusätzliche Termine davor und danach möglich'};
          card.append(Object.assign(el('p',descriptions[t.anschluss_option]||''),{className:'staff-customer-mail-status'}));
        }
        if(!t.manueller_termin&&t.kundenbestaetigung_status==='geplant'&&t.kundenbestaetigung_faellig_ab)
          card.append(Object.assign(el('p','Kundenbestätigung geplant für '+new Date(t.kundenbestaetigung_faellig_ab).toLocaleString('de-DE')),
            {className:'staff-customer-mail-status'}));
        else if(!t.manueller_termin&&t.kundenbestaetigung_status==='gesendet'&&t.kundenbestaetigung_versendet_am)
          card.append(Object.assign(el('p','Kundenbestätigung wurde am '+new Date(t.kundenbestaetigung_versendet_am).toLocaleString('de-DE')+' vom E-Mail-Anbieter angenommen.'),
            {className:'staff-customer-mail-status'}));
        else if(!t.manueller_termin&&t.kundenbestaetigung_status==='fehler')
          card.append(Object.assign(el('p','Kundenbestätigung konnte nicht versendet werden. Die Verwaltung muss den Versand prüfen.'),
            {className:'staff-customer-mail-status'}));
        if(!t.manueller_termin&&t.zahlungsinfo_gesendet_am)
          card.append(Object.assign(el('p','Zahlungsinformationen zur Anzahlung wurden am '+new Date(t.zahlungsinfo_gesendet_am).toLocaleString('de-DE')+' vom E-Mail-Anbieter angenommen.'),
            {className:'staff-customer-mail-status'}));
        const action=async(url,data={})=>{
          try{
            const result=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
            await loadPlanning();
            if(data.anschlussOption&&data.anschlussOption!=='keine'){
              const proposal=result?.tagesangebotVorschlaege;
              status.textContent=proposal?.ok?proposal.nachricht||'Deine zusätzliche Verfügbarkeit wurde der Verwaltung als Tagesangebot vorgeschlagen.':
                proposal?.error||'Deine zusätzliche Verfügbarkeit wurde gespeichert; die Verwaltung prüft mögliche Anschlussangebote.';
            }
          }catch(error){status.textContent='Aktion nicht möglich: '+error.message;}
        };
        if(!t.manueller_termin&&t.sonderfreigabe&&(!t.mein_status||['beworben','abgelehnt'].includes(t.mein_status))){
          const option=t.manueller_termin?null:anschlussAuswahl();if(option)card.append(option.closest('label'));
          const direct=el('button','Programm verbindlich übernehmen');
          direct.type='button';direct.className='btn';
          direct.onclick=()=>{if(option.reportValidity())action('/api/pruefung/einsatzplanung/direkt-annehmen/'+encodeURIComponent(t.id),{anschlussOption:option.value});};
          card.append(direct,el('small','Deine Zusage ist verbindlich. Die Kundenbestätigung wird gemäß Verwaltungseinstellung zeitversetzt versandt.'));
        }else if((t.manueller_termin||!t.sonderfreigabe)&&(!t.mein_status||['beworben','abgelehnt'].includes(t.mein_status))){
          const button=el('button',t.mein_status==='beworben'?'Bewerbung aktualisieren':'Für Termin bewerben');
          button.type='button';button.className='btn secondary';
          button.onclick=()=>action((t.manueller_termin?'/api/pruefung/einsatzplanung/kalender-bewerben/':'/api/pruefung/einsatzplanung/bewerben/')+encodeURIComponent(t.id));
          card.append(button);
        }
        if(t.mein_status==='eingeteilt'){
          const option=t.manueller_termin?null:anschlussAuswahl();if(option)card.append(option.closest('label'));
          const yes=el('button','Einsatz verbindlich bestätigen');
          yes.type='button';yes.className='btn';yes.onclick=()=>{if(t.manueller_termin)action('/api/pruefung/einsatzplanung/kalender-antwort/'+encodeURIComponent(t.id),{status:'bestaetigt'});else if(option.reportValidity())action('/api/pruefung/einsatzplanung/antwort/'+encodeURIComponent(t.id),{status:'bestaetigt',anschlussOption:option.value});};
          const no=el('button','Einsatz ablehnen');
          no.type='button';no.className='btn secondary';no.onclick=()=>action((t.manueller_termin?'/api/pruefung/einsatzplanung/kalender-antwort/':'/api/pruefung/einsatzplanung/antwort/')+encodeURIComponent(t.id),{status:'abgelehnt'});
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
