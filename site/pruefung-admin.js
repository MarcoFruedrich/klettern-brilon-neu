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
      ['/api/admin/pruefung/meldungen','pruef-mail-list','pruef-mail-status',renderMailStatus],
      ['/api/admin/pruefung/tablets','tablet-admin-list','tablet-admin-status',renderTablets]
    ]){
      try{render(find(container),await api(url));}
      catch(err){find(statusId).textContent='Laden fehlgeschlagen: '+err.message;}
    }
  }
  function renderStaff(target,people){
    target.replaceChildren();
    for(const person of people){
      const card=elt('article');card.className='booking';
      card.append(elt('strong',person.name+' · '+person.email),
        elt('p',person.aktiv?'Zugang aktiv':'Zugang deaktiviert'));
      if(person.aktiv){
        const stop=elt('button','Zugang deaktivieren');stop.type='button';stop.className='btn secondary';
        stop.addEventListener('click',async()=>{
          if(!confirm('Zugang deaktivieren und alle laufenden Mitarbeitersitzungen beenden?'))return;
          stop.disabled=true;
          try{
            await api('/api/admin/pruefung/mitarbeitende/'+encodeURIComponent(person.id)+'/deaktivieren',{method:'PATCH'});
            await refresh();
          }catch(err){find('pruef-personal-status').textContent='Fehler: '+err.message;stop.disabled=false;}
        });
        card.append(stop);
      }
      const field=elt('label',person.aktiv?'Neues Passwort (alle Sitzungen beenden)':
        'Neues Startpasswort für die Reaktivierung');
      const password=document.createElement('input');password.type='password';
      password.autocomplete='new-password';password.minLength=12;
      password.placeholder='Mindestens 12 Zeichen';
      field.append(password);card.append(field);
      const action=person.aktiv?'passwort-setzen':'reaktivieren';
      const button=elt('button',person.aktiv?'Passwort zurücksetzen':'Zugang reaktivieren');
      button.type='button';button.className='btn secondary';
      button.addEventListener('click',async()=>{
        if(password.value.length<12){
          find('pruef-personal-status').textContent='Mindestens 12 Zeichen für das neue Passwort erforderlich.';return;
        }
        if(!confirm(person.aktiv?'Passwort zurücksetzen und bisherige Sitzungen sperren?':
          'Mitarbeiterzugang mit neuem Passwort aktivieren?'))return;
        button.disabled=true;
        try{
          await api('/api/admin/pruefung/mitarbeitende/'+encodeURIComponent(person.id)+'/'+action,{
            method:'PATCH',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({passwort:password.value})
          });
          password.value='';await refresh();
        }catch(err){
          password.value='';
          find('pruef-personal-status').textContent='Zugangsänderung fehlgeschlagen: '+err.message;
          button.disabled=false;
        }
      });
      card.append(button);target.append(card);
    }
  }
  function renderStations(target,stations){
    target.replaceChildren();
    for(const station of stations){
      const panel=elt('article');panel.className='booking';
      const blocked=!!station.gesperrt_am;
      panel.append(elt('strong',station.name),
        elt('p',!station.aktiv?'STATION DEAKTIVIERT – NICHT BENUTZEN':
          blocked?'GESPERRT – NICHT BENUTZEN':'Aktiv und nicht gesperrt'));
      if(blocked){
        panel.append(elt('p','Grund: '+(station.sperrgrund||'Nicht angegeben')));
        const button=elt('button','Nach fachlicher Prüfung freigeben');
        button.type='button';button.className='btn secondary';
        button.disabled=!station.aktiv;
        if(!station.aktiv)button.title='Eine inaktive Station kann nicht fachlich freigegeben werden.';
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
      const statusAction=station.aktiv?'deaktivieren':'reaktivieren';
      const statusButton=elt('button',station.aktiv?'Station deaktivieren':'Station reaktivieren');
      statusButton.type='button';statusButton.className='btn secondary';
      statusButton.addEventListener('click',async()=>{
        const begruendung=prompt(station.aktiv?
          'Grund der Stationsstilllegung (mindestens 15 Zeichen):':
          'Grund der Stationsreaktivierung (mindestens 15 Zeichen):');
        if(!begruendung)return;
        if(!confirm(station.aktiv?
          'Station für neue Prüfberichte deaktivieren? Alte Prüfberichte bleiben erhalten.':
          'Station reaktivieren? Eine vorhandene Sicherheitsmängelsperre bleibt bestehen.'))return;
        statusButton.disabled=true;
        try{
          await api('/api/admin/pruefung/stationen/'+encodeURIComponent(station.id)+'/'+statusAction,{
            method:'PATCH',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({begruendung})
          });
          await refresh();
        }catch(error){
          find('pruef-station-status').textContent='Stationsstatus konnte nicht geändert werden: '+error.message;
          statusButton.disabled=false;
        }
      });
      panel.append(statusButton);
      const statusHistory=elt('button','Stilllegungs- und Reaktivierungsverlauf');
      statusHistory.type='button';statusHistory.className='btn secondary';
      const log=elt('div');log.hidden=true;
      statusHistory.addEventListener('click',async()=>{
        if(!log.hidden){log.hidden=true;return;}
        try{
          const entries=await api('/api/admin/pruefung/stationen/'+encodeURIComponent(station.id)+'/statusverlauf');
          log.replaceChildren();
          if(!entries.length)log.append(elt('p','Noch keine Statusänderungen.'));
          for(const entry of entries)log.append(elt('p',
            new Date(entry.erstellt_am).toLocaleString('de-DE')+' · '+entry.art+' · '+
            entry.verantwortlich+' · '+entry.begruendung));
          log.hidden=false;
        }catch(error){
          find('pruef-station-status').textContent='Statusverlauf nicht verfügbar: '+error.message;
        }
      });
      panel.append(statusHistory,log);
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
  function renderTablets(target,devices){
    target.replaceChildren();
    if(!devices.length)target.append(elt('p','Noch kein Werbetablet gekoppelt.'));
    for(const device of devices){
      const block=elt('article');block.className='booking';
      const lastSeen=device.zuletzt_gesehen_am?
        new Date(device.zuletzt_gesehen_am).toLocaleString('de-DE'):'Noch keine Verbindung';
      block.append(elt('strong',device.name),
        elt('p',!device.aktiv?'Zugang gesperrt':
          device.online?'Erreichbar – letztes Lebenszeichen innerhalb von 45 Sekunden':
          'Keine aktuelle Verbindung – Codeanforderung nicht möglich'),
        elt('p',device.pruefdisplay?'Ausgewähltes Prüfdisplay für sechsstellige Codes':
          'Nur Werbeanzeige – keine Prüfcodes'),
        elt('p','Zuletzt gemeldet: '+lastSeen),
        elt('p','Gekoppelt: '+new Date(device.gekoppelt_am).toLocaleString('de-DE')));
      if(device.aktiv&&!device.pruefdisplay){
        const select=elt('button','Als Prüfdisplay auswählen');select.type='button';
        select.className='btn secondary';
        select.addEventListener('click',async()=>{
          if(!confirm('Dieses Tablet als einziges Prüfdisplay festlegen? Noch gültige Prüfcodes werden dadurch ungültig.'))return;
          select.disabled=true;
          try{
            await api('/api/admin/pruefung/tablets/'+encodeURIComponent(device.id)+'/pruefdisplay',{method:'PATCH'});
            find('tablet-admin-status').textContent='Prüfdisplay umgestellt. Bisherige Codes sind ungültig.';
            await refresh();
          }catch(error){
            find('tablet-admin-status').textContent='Prüfdisplay konnte nicht umgestellt werden: '+error.message;
            select.disabled=false;
          }
        });
        block.append(select);
      }
      if(device.aktiv){
        const replace=elt('button','Tablet ersetzen / neu koppeln');
        replace.type='button';replace.className='btn secondary';
        replace.addEventListener('click',async()=>{
          if(!confirm('Der bisherige Tablet-Zugang wird sofort gesperrt und sämtliche noch aktiven Codes dieses Geräts werden ungültig. Neuen einmaligen Kopplungscode erzeugen?'))return;
          replace.disabled=true;
          try{
            const data=await api('/api/admin/pruefung/tablets/'+encodeURIComponent(device.id)+'/ersetzen',{
              method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({wechselBestaetigt:true})
            });
            find('tablet-pair-code').textContent='Ersatzgerät jetzt koppeln: '+data.code+
              ' (zehn Minuten gültig, einmalig). Anschließend das neue Gerät bei Bedarf als Prüfdisplay auswählen.';
            await refresh();
          }catch(error){
            find('tablet-admin-status').textContent='Gerätewechsel fehlgeschlagen: '+error.message;
            replace.disabled=false;
          }
        });
        block.append(replace);
      }
      if(device.aktiv){
        const button=elt('button','Tablet-Zugang sperren');button.type='button';
        button.className='btn secondary';
        button.addEventListener('click',async()=>{
          if(!confirm('Dieses Tablet dauerhaft aus der Codeanzeige aussperren? Eine neue Kopplung wird erforderlich.'))return;
          button.disabled=true;
          try{
            await api('/api/admin/pruefung/tablets/'+encodeURIComponent(device.id)+'/sperren',
              {method:'PATCH'});
            await refresh();
          }catch(error){
            find('tablet-admin-status').textContent='Tablet konnte nicht gesperrt werden: '+error.message;
            button.disabled=false;
          }
        });
        block.append(button);
      }
      target.append(block);
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
  find('tablet-pair-generate')?.addEventListener('click',async()=>{
    const display=find('tablet-pair-code');display.textContent='Kopplungscode wird erzeugt …';
    try{
      const data=await api('/api/admin/pruefung/tablet/kopplung',{method:'POST'});
      display.textContent='Tablet-Kopplungscode: '+data.code+' (zehn Minuten gültig, einmalig)';
    }catch(error){display.textContent='Kopplung fehlgeschlagen: '+error.message;}
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
  find('tablet-admin-refresh')?.addEventListener('click',refresh);
  // The admin workspace is revealed by the existing login flow.
  const observer=new MutationObserver(()=>{
    if(!find('workspace')?.hidden && !initialized){initialized=true;refresh();}
    if(find('workspace')?.hidden)initialized=false;
  });
  if(find('workspace'))observer.observe(find('workspace'),{attributes:true,attributeFilter:['hidden']});
})();
