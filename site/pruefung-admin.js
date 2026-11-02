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
      ['/api/admin/pruefung/berichte','pruef-report-list','pruef-report-status',renderReports],
      ['/api/admin/pruefung/hinweise','pruef-hinweis-list','pruef-hinweis-status',renderHints],
      ['/api/admin/pruefung/meldungen','pruef-mail-list','pruef-mail-status',renderMailStatus]
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
  function renderMailStatus(target,notifications){
    target.replaceChildren();
    const outstanding=notifications.filter(x=>x.status!=='angenommen');
    find('pruef-mail-status').textContent=outstanding.length+
      ' nicht als angenommen bestätigte Sicherheitsmängelmeldungen von '+
      notifications.length+' angezeigten Einträgen.';
    for(const item of notifications){
      const card=elt('article');card.className='booking';
      const statuses={ausstehend:'Ausstehend',sendet:'Versand unklar – Anbieter prüfen',
        angenommen:'Vom Anbieter angenommen (Zustellung nicht bestätigt)',
        fehlgeschlagen:'Versand fehlgeschlagen',nicht_konfiguriert:'E-Mail nicht konfiguriert'};
      card.append(elt('strong',item.programm+' · '+(item.stationen||[]).join(', ')),
        elt('p','Prüfbericht: '+item.bericht_id),
        elt('p','Status: '+(statuses[item.status]||'Unbekannt')),
        elt('p','Versuche: '+item.versuche+
          ' · Letzter Versuch: '+(item.letzter_versuch?
          new Date(item.letzter_versuch).toLocaleString('de-DE'):'–')));
      if(item.letzter_fehler)card.append(elt('p',item.letzter_fehler));
      if(['fehlgeschlagen','nicht_konfiguriert','ausstehend'].includes(item.status)){
        const resend=elt('button','Mängelmeldung erneut senden');
        resend.type='button';resend.className='btn secondary';
        resend.addEventListener('click',async()=>{
          if(!confirm('Vor erneutem Versand prüfen, ob die Nachricht bereits beim Empfänger oder E-Mail-Anbieter eingegangen ist. Trotzdem erneut versuchen?'))return;
          resend.disabled=true;
          try{
            const result=await api('/api/admin/pruefung/meldungen/'+encodeURIComponent(item.bericht_id)+'/erneut-senden',{
              method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({doppelversandGeprueft:true})
            });
            find('pruef-mail-status').textContent=result.status==='gesendet'?
              'Mail-Anbieter hat den Versand angenommen; Zustellung nicht bestätigt.':
              'Neuer Versand nicht bestätigt: '+result.status+'. Verantwortliche direkt informieren.';
            await refresh();
          }catch(error){
            find('pruef-mail-status').textContent='Erneuter Versand fehlgeschlagen: '+error.message;
            resend.disabled=false;
          }
        });
        card.append(resend);
      }else if(item.status==='sendet'){
        card.append(elt('p','Kein automatischer Neuversand: Versandstatus zuerst beim Anbieter klären.'));
      }
      target.append(card);
    }
  }
  function renderHints(target,hints){
    target.replaceChildren();
    const offene=hints.filter(x=>!x.erledigt_am);
    find('pruef-hinweis-status').textContent=offene.length+
      ' offene Hinweise zur Nachprüfung'+(hints.length>=200?' (maximal 200 angezeigt)':'')+'.';
    for(const item of hints){
      const article=elt('article');article.className='booking';
      const erledigt=!!item.erledigt_am;
      article.append(elt('strong',(erledigt?'Geprüfter Hinweis: ':'Offener Hinweis: ')+item.station),
        elt('p',item.beschreibung),
        elt('p','Gemeldet von: '+item.erstellt_von+' · '+
          new Date(item.erstellt_am).toLocaleString('de-DE')));
      if(item.gesperrt_am)article.append(elt('p','ACHTUNG: Station ist bereits gesperrt.'));
      if(erledigt){
        article.append(elt('p','Geprüft von: '+item.erledigt_von+' · '+item.erledigt_notiz));
      }else{
        const button=elt('button','Nach Prüfung als erledigt markieren');
        button.type='button';button.className='btn secondary';
        button.addEventListener('click',async()=>{
          const pruefer=prompt('Wer hat den Hinweis geprüft?');
          if(!pruefer)return;
          const ergebnis=prompt('Prüfergebnis und ggf. durchgeführte Maßnahmen (mindestens 20 Zeichen):');
          if(!ergebnis)return;
          if(!confirm('Ist der Hinweis tatsächlich geprüft und darf als erledigt gekennzeichnet werden?'))return;
          button.disabled=true;
          try{
            await api('/api/admin/pruefung/hinweise/'+encodeURIComponent(item.id)+'/erledigen',{
              method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({pruefer,ergebnis,geprueft:true})
            });
            await refresh();
          }catch(error){
            find('pruef-hinweis-status').textContent='Prüfvermerk konnte nicht gespeichert werden: '+error.message;
            button.disabled=false;
          }
        });
        article.append(button);
      }
      target.append(article);
    }
  }
  function renderReports(target,reports){
    target.replaceChildren();
    for(const report of reports){
      const article=elt('article');article.className='booking';
      article.append(elt('strong',report.programm+' · '+report.beginn),
        elt('p','Prüfer: '+report.pruefer+' · Ergebnis: '+(report.hat_mangel?'Sicherheitsmangel – gesperrte Station prüfen':
          report.hat_hinweis?'Hinweis(e) zur Prüfung vorgemerkt':'Kein Mangel gemeldet')));
      for(const p of report.pruefungen){
        article.append(elt('p',(p.station||'Station')+': '+
          (p.zustand==='ok'?'In Ordnung':p.zustand==='hinweis'?
          'Hinweis – zur Prüfung vorgemerkt: '+p.beschreibung:'Sicherheitsmangel – '+p.beschreibung)));
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
  find('pruef-hinweis-refresh')?.addEventListener('click',refresh);
  find('pruef-mail-refresh')?.addEventListener('click',refresh);
  // The admin workspace is revealed by the existing login flow.
  const observer=new MutationObserver(()=>{
    if(!find('workspace')?.hidden && !initialized){initialized=true;refresh();}
    if(find('workspace')?.hidden)initialized=false;
  });
  if(find('workspace'))observer.observe(find('workspace'),{attributes:true,attributeFilter:['hidden']});
})();
