'use strict';
// Uses the authenticated admin API helper from admin.js; does not persist secrets locally.
(function(){
  const find=id=>document.getElementById(id);
  const elt=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  let initialized=false;
  async function refresh(){
    if(!initialized||find('workspace')?.hidden)return;
    for(const [url,container,statusId,render] of [
      ['/api/admin/pruefung/mitarbeitende','pruef-personal-list','pruef-personal-status',renderStaff],
      ['/api/admin/pruefung/stationen','pruef-station-list','pruef-station-status',renderStations],
      ['/api/admin/pruefung/berichte','pruef-report-list','pruef-report-status',renderReports]
    ]){
      try{render(find(container),await api(url));}
      catch(err){find(statusId).textContent='Laden fehlgeschlagen: '+err.message;}
    }
  }
  function renderStaff(target,people){
    target.replaceChildren();
    for(const person of people){
      const card=elt('p',person.name+' · '+person.email+' · '+(person.aktiv?'Aktiv':'Deaktiviert'));
      if(person.aktiv){
        const button=elt('button','Zugang deaktivieren');button.type='button';button.className='btn secondary';
        button.addEventListener('click',async()=>{
          if(!confirm('Mitarbeiterzugang dauerhaft deaktivieren?'))return;
          try{await api('/api/admin/pruefung/mitarbeitende/'+encodeURIComponent(person.id)+'/deaktivieren',
            {method:'PATCH'});await refresh();}
          catch(err){find('pruef-personal-status').textContent='Fehler: '+err.message;}
        });
        card.append(button);
      }
      target.append(card);
    }
  }
  function renderStations(target,stations){
    target.replaceChildren();
    for(const station of stations){
      const panel=elt('article');panel.className='booking';
      const blocked=!!station.gesperrt_am;
      panel.append(elt('strong',station.name),
        elt('p',blocked?'GESPERRT – NICHT BENUTZEN':
          station.aktiv?'Nicht gesperrt':'Inaktiv'));
      if(blocked){
        panel.append(elt('p','Grund: '+(station.sperrgrund||'Nicht angegeben')));
        const button=elt('button','Nach fachlicher Prüfung freigeben');
        button.type='button';button.className='btn secondary';
        button.addEventListener('click',async()=>{
          const freigabeDurch=prompt('Name der Person, die die Station fachlich nachgeprüft hat:');
          if(!freigabeDurch)return;
          const begruendung=prompt('Nachkontrolle: Welche Mängel wurden behoben? Prüfverfahren und Ergebnis dokumentieren (mindestens 20 Zeichen):');
          if(!begruendung)return;
          if(!confirm('Bestätigst du, dass die Station vor Ort fachlich nachgeprüft wurde und für den Betrieb wieder sicher ist?'))return;
          button.disabled=true;
          try{
            await api('/api/admin/pruefung/stationen/'+encodeURIComponent(station.id)+'/freigeben',{
              method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({freigabeDurch,begruendung,nachkontrolleBestaetigt:true})
            });
            find('pruef-station-status').textContent='Fachliche Freigabe für '+station.name+' protokolliert. Eine Vorabprüfung vor dem nächsten Programm bleibt erforderlich.';
            await refresh();
          }catch(error){
            find('pruef-station-status').textContent='Freigabe fehlgeschlagen: '+error.message;
            button.disabled=false;
          }
        });
        panel.append(button);
      }
      const audit=elt('button','Prüf- und Freigabeverlauf anzeigen');
      audit.type='button';audit.className='btn secondary';
      const details=elt('div');details.hidden=true;
      audit.addEventListener('click',async()=>{
        if(!details.hidden){details.hidden=true;return;}
        try{
          const events=await api('/api/admin/pruefung/stationen/'+encodeURIComponent(station.id)+'/ereignisse');
          details.replaceChildren();
          if(!events.length)details.append(elt('p','Noch keine Mängel-/Freigabeereignisse.'));
          for(const ev of events)details.append(elt('p',
            new Date(ev.erstellt_am).toLocaleString('de-DE')+' · '+
            (ev.art==='mangel'?'Mangel':'Freigabe')+' · '+ev.verantwortlich+' · '+ev.notiz));
          details.hidden=false;
        }catch(error){find('pruef-station-status').textContent='Verlauf nicht verfügbar: '+error.message;}
      });
      panel.append(audit,details);target.append(panel);
    }
  }
  function renderReports(target,reports){
    target.replaceChildren();
    for(const report of reports){
      const article=elt('article');article.className='booking';
      article.append(elt('strong',report.programm+' · '+report.beginn),
        elt('p','Prüfer: '+report.pruefer+' · Ergebnis: '+(report.hat_mangel?'MANGEL – nicht freigegeben':'Kein Mangel gemeldet')));
      for(const p of report.pruefungen){
        article.append(elt('p',
          (p.station||'Station')+': '+(p.zustand==='ok'?'In Ordnung':'Mangel – '+p.beschreibung)));
        if(p.hatFoto){
          const link=elt('a','Fotobeleg herunterladen – '+(p.station||'Station'));
          link.href='/api/admin/pruefung/berichte/'+encodeURIComponent(report.id)+
            '/foto/'+encodeURIComponent(p.stationId);
          link.download='stationsfoto.jpg';
          article.append(link);
        }
      }
      target.append(article);
    }
  }
  find('pruef-personal-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;
    const status=find('pruef-personal-status');
    try{
      await api('/api/admin/pruefung/mitarbeitende',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(Object.fromEntries(new FormData(form)))});
      form.reset();status.textContent='Mitarbeiter angelegt. Passwort sicher übermitteln.';
      await refresh();
    }catch(err){status.textContent='Fehler: '+err.message;}
  });
  find('pruef-station-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;
    try{
      await api('/api/admin/pruefung/stationen',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(Object.fromEntries(new FormData(form)))});
      form.reset();find('pruef-station-status').textContent='Station gespeichert.';
      await refresh();
    }catch(err){find('pruef-station-status').textContent='Fehler: '+err.message;}
  });
  find('pruef-code-generate')?.addEventListener('click',async()=>{
    const target=find('pruef-code-display');target.textContent='Code wird erzeugt …';
    try{
      const response=await api('/api/admin/pruefung/code',{method:'POST'});
      target.textContent=response.code+' (120 Sekunden gültig, einmalig)';
    }catch(err){target.textContent='Fehler: '+err.message;}
  });
  find('pruef-report-refresh')?.addEventListener('click',refresh);
  // The admin workspace is revealed by the existing login flow.
  const observer=new MutationObserver(()=>{
    if(!find('workspace')?.hidden && !initialized){initialized=true;refresh();}
    if(find('workspace')?.hidden)initialized=false;
  });
  if(find('workspace'))observer.observe(find('workspace'),{attributes:true,attributeFilter:['hidden']});
})();
