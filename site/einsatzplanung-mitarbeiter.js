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
        if(t.manueller_termin&&t.beschreibung)card.append(el('p',t.beschreibung));
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
        const mailStatus=t.kundenbestaetigung_status;
        const faellig=t.kundenbestaetigung_faellig_ab?new Date(t.kundenbestaetigung_faellig_ab):null;
        const ueberfaellig=mailStatus==='geplant'&&faellig&&Date.now()>faellig.getTime()+60_000;
        if(!t.manueller_termin&&mailStatus==='geplant'&&faellig)
          card.append(Object.assign(el('p',ueberfaellig
            ?'Kunden-/Zahlungsinformation ist überfällig. Bitte die Verwaltung kontaktieren.'
            :'Kunden-/Zahlungsinformation geplant für '+faellig.toLocaleString('de-DE')),
            {className:'staff-customer-mail-status'}));
        else if(!t.manueller_termin&&mailStatus==='gesendet'&&t.kundenbestaetigung_versendet_am)
          card.append(Object.assign(el('p','Kunden-/Zahlungsinformation wurde am '+
            new Date(t.kundenbestaetigung_versendet_am).toLocaleString('de-DE')+
            ' vom E-Mail-Anbieter angenommen. Zustellung noch nicht bestätigt.'),
            {className:'staff-customer-mail-status'}));
        else if(!t.manueller_termin&&mailStatus==='versand_laeuft')
          card.append(Object.assign(el('p','Kunden-/Zahlungsinformation wird gerade versendet.'),
            {className:'staff-customer-mail-status'}));
        else if(!t.manueller_termin&&['fehler','abgebrochen'].includes(mailStatus))
          card.append(Object.assign(el('p','Kunden-/Zahlungsinformation nicht gesendet. Die Verwaltung muss den Versandstatus prüfen.'),
            {className:'staff-customer-mail-status'}));
        if(!t.manueller_termin&&t.zahlungsinfo_gesendet_am)
          card.append(Object.assign(el('p','Zahlungsinformationen zur Anzahlung wurden am '+new Date(t.zahlungsinfo_gesendet_am).toLocaleString('de-DE')+' vom E-Mail-Anbieter angenommen.'),
            {className:'staff-customer-mail-status'}));
        const action=async(url,data={})=>{
          try{
            const result=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
            await loadPlanning();
            if(result?.anschlussangebot){status.textContent=result.message||'Das Anschlussprogramm wurde veröffentlicht.';}
            else if(result?.message&&url.includes('/kalender-antwort/')){status.textContent=result.message;}
            else if(data.anschlussOption&&data.anschlussOption!=='keine'){
              const proposal=result?.tagesangebotVorschlaege;
              status.textContent=proposal?.ok?proposal.nachricht||'Deine zusätzliche Verfügbarkeit wurde der Verwaltung als Tagesangebot vorgeschlagen.':
                proposal?.error||'Deine zusätzliche Verfügbarkeit wurde gespeichert; die Verwaltung prüft mögliche Anschlussangebote.';
            }
          }catch(error){status.textContent='Aktion nicht möglich: '+error.message;}
        };
        const finalStatuses=['eingeteilt','bestaetigt','abgeschlossen'];
        const kannAntworten=!finalStatuses.includes(t.mein_status);
        if(kannAntworten&&!t.manueller_termin&&t.sonderfreigabe){
          card.append(el('p','Du kannst diesen Termin mit deiner besonderen Freigabe direkt verbindlich übernehmen. Wähle außerdem aus, ob du davor oder danach einen weiteren Termin ermöglichen kannst.'));
          const option=anschlussAuswahl();card.append(option.closest('label'));
          const actions=el('div');actions.className='staff-assignment-actions';
          const direct=el('button','Programm verbindlich übernehmen');
          direct.type='button';direct.className='btn';
          direct.onclick=()=>{if(option.reportValidity())action('/api/pruefung/einsatzplanung/direkt-annehmen/'+encodeURIComponent(t.id),{anschlussOption:option.value});};
          actions.append(direct);card.append(actions,el('small','Mit der Zusage übernimmst du diesen Einsatz verbindlich. Die Kundenbestätigung wird gemäß Verwaltungseinstellung zeitversetzt versandt.'));
        }else if(kannAntworten){
          const explanation=el('p',t.mein_status==='beworben'
            ?'Deine Bewerbung liegt der Verwaltung vor. Du kannst sie hier aktualisieren.'
            :'Mit deiner Bewerbung bekundest du Interesse. Verbindlich wird der Termin erst nach Zuweisung durch die Verwaltung und deiner anschließenden Bestätigung.');
          card.append(explanation);
          const actions=el('div');actions.className='staff-assignment-actions';
          const button=el('button',t.mein_status==='beworben'?'Bewerbung aktualisieren':'Für Termin bewerben');
          button.type='button';button.className='btn secondary';
          button.onclick=()=>action((t.manueller_termin?'/api/pruefung/einsatzplanung/kalender-bewerben/':'/api/pruefung/einsatzplanung/bewerben/')+encodeURIComponent(t.id));
          actions.append(button);card.append(actions);
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
  async function loadArchive(){
    const listRoot=document.getElementById('staff-archive-list'),archiveStatus=document.getElementById('staff-archive-status');
    if(!listRoot||!archiveStatus)return;
    archiveStatus.textContent='Vergangene Einsätze werden geladen …';
    try{
      const list=await request('/api/pruefung/einsatzplanung/archiv');
      listRoot.replaceChildren();
      if(!list.length){listRoot.append(el('p','Im Programmarchiv sind noch keine vergangenen, zugewiesenen Termine vorhanden.'));archiveStatus.textContent='';return;}
      for(const item of list){
        const card=el('article');card.className='booking staff-archive-card';
        const date=item.datum?new Date(item.datum+'T12:00:00').toLocaleDateString('de-DE',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}):'Datum nicht hinterlegt';
        card.append(el('h3',date+(item.uhrzeit?' · '+String(item.uhrzeit).slice(0,5)+' Uhr':'')));
        card.append(el('p',(item.angebot||'Programm')+' · '+(item.ort||'Standort nicht hinterlegt')+
          (item.dauer?' · '+item.dauer+' Minuten':'')));
        const state=item.mein_status==='abgeschlossen'?'Leistung als abgeschlossen dokumentiert':
          item.mein_status==='eingeteilt'?'Termin war dir zugewiesen':'Termin wurde von dir verbindlich bestätigt';
        card.append(Object.assign(el('p',state),{className:'staff-archive-status'}));
        if(item.beschreibung)card.append(el('p',item.beschreibung));
        listRoot.append(card);
      }
      archiveStatus.textContent=list.length+' vergangene(r) Einsatz/Einsätze';
    }catch(error){archiveStatus.textContent='Programmarchiv konnte nicht geladen werden: '+error.message;}
  }
  window.staffArchiveLoad=loadArchive;
  document.getElementById('staff-archive-refresh')?.addEventListener('click',loadArchive);
  document.getElementById('staff-planning-refresh').onclick=loadPlanning;
  const workspace=document.getElementById('staff-portal-workspace');
  const observer=new MutationObserver(()=>{if(!workspace.hidden)loadPlanning();});
  observer.observe(workspace,{attributes:true,attributeFilter:['hidden']});
  if(!workspace.hidden)loadPlanning();
  // Mitarbeiter sehen nach Ablauf des Versandfensters auch ohne manuellen
  // Reload, ob die Benachrichtigung tatsächlich vom Anbieter angenommen wurde.
  const autoRefresh=setInterval(()=>{
    if(!workspace.hidden&&!document.hidden)loadPlanning();
  },30_000);
  autoRefresh.unref?.();
})();
