'use strict';
// Uses the authenticated admin API helper from admin.js; does not persist secrets locally.
(function(){
  const find=id=>document.getElementById(id);
  const elt=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  let initialized=false;
  let activePlaces=[];
  async function refresh(){
    if(!initialized||find('workspace')?.hidden)return;
    try{activePlaces=(await api('/api/admin/orte')).filter(place=>place.aktiv);}
    catch{activePlaces=[];}
    const stationPlace=find('pruef-station-ort');
    if(stationPlace){
      const current=stationPlace.value;stationPlace.replaceChildren();
      const empty=elt('option','Standort auswählen');empty.value='';stationPlace.append(empty);
      for(const place of activePlaces){const option=elt('option',place.name);option.value=String(place.id);stationPlace.append(option);}
      if(activePlaces.some(place=>String(place.id)===current))stationPlace.value=current;
    }
    for(const [url,container,statusId,render] of [
      ['/api/admin/pruefung/uebersicht','pruef-uebersicht-inhalt','pruef-uebersicht-status',renderSafetyOverview],
      ['/api/admin/pruefung/mitarbeitende','pruef-personal-list','pruef-personal-status',renderStaff],
      ['/api/admin/pruefung/stationen','pruef-station-list','pruef-station-status',renderStations],
      ['/api/admin/pruefung/berichte','pruef-report-list','pruef-report-status',renderReports],
      ['/api/admin/pruefung/hinweise','pruef-hinweis-list','pruef-hinweis-status',renderHints],
      ['/api/admin/pruefung/meldungen','pruef-mail-list','pruef-mail-status',renderMailStatus],
      ['/api/admin/pruefung/tablets','tablet-admin-list','tablet-admin-status',renderTablets]
    ]){
      try{render(find(container),await api(url),activePlaces);}
      catch(err){find(statusId).textContent='Laden fehlgeschlagen: '+err.message;}
    }
    if(!find('netzwerkpartner-section')?.hidden){
      try{renderNetworkPartners(await api('/api/admin/netzwerkpartner/liste'));}
      catch(error){find('netzwerkpartner-status').textContent='Laden fehlgeschlagen: '+error.message;}
    }
    if(!find('kundenfeedback-section')?.hidden){
      try{renderCustomerFeedback(await api('/api/admin/kundenfeedback'));}
      catch(error){find('kundenfeedback-status').textContent='Laden fehlgeschlagen: '+error.message;}
    }
  }
  function renderSafetyOverview(target,data){
    target.replaceChildren();
    const counts=find('pruef-uebersicht-zaehler');
    counts.replaceChildren();
    const c=data.zaehler||{};
    for(const [label,key] of [
      ['Sicherheitsgesperrte Stationen','gesperrt'],
      ['Stillgelegte Stationen','stillgelegt'],
      ['Offene kleine Hinweise','hinweise_offen'],
      ['Nicht bestätigte Mängel-E-Mails','meldungen_ungeklaert']
    ]){
      const card=elt('p',label+': '+Number(c[key]||0));
      card.className='booking';
      counts.append(card);
    }
    find('pruef-uebersicht-status').textContent='Stand: '+
      new Date(data.stand).toLocaleString('de-DE')+
      '. Angezeigte Einträge sind offene Prüfaufgaben, keine Freigabe zur Nutzung.';
    const stationen=Array.isArray(data.stationen)?data.stationen:[];
    const hinweise=Array.isArray(data.hinweise)?data.hinweise:[];
    const meldungen=Array.isArray(data.meldungen)?data.meldungen:[];
    const heading=(title,items,total)=>{
      const h=elt('h4',title);target.append(h);
      if(!items.length){target.append(elt('p','Keine offenen Einträge.'));return;}
      if(total>items.length)target.append(elt('p',
        'Es werden '+items.length+' von '+total+' Einträgen angezeigt. Weitere im jeweiligen Verwaltungsbereich prüfen.'));
    };
    const jump=(panel,id,label)=>{
      const button=elt('button',label);
      button.type='button';button.className='btn secondary';
      button.addEventListener('click',()=>{
        const section=find(id);
        window.adminNavigateToElement?.(id);
        section?.scrollIntoView({behavior:'smooth',block:'start'});
        if(section)section.setAttribute('tabindex','-1');
        section?.focus({preventScroll:true});
      });
      panel.append(button);
    };
    heading('Sicherheitsgesperrt oder stillgelegt',stationen,
      Number(c.nicht_nutzbar||0));
    for(const station of stationen){
      const box=elt('article');box.className='booking';
      const blocked=!!station.gesperrt_am;
      box.append(elt('strong',station.name),
        elt('p',blocked?'NICHT BENUTZEN – SICHERHEITSMANGEL':
          'NICHT BENUTZEN – STATION STILLGELEGT'));
      if(blocked&&station.sperrgrund)box.append(elt('p','Sperrgrund: '+station.sperrgrund));
      if(!station.aktiv&&blocked)box.append(elt('p','Zusätzlich administrativ stillgelegt.'));
      if(Number(station.offene_hinweise)>0)
        box.append(elt('p','Zusätzlich '+station.offene_hinweise+' offene Hinweise.'));
      jump(box,'pruef-station-list','Station in der Verwaltung prüfen');
      target.append(box);
    }
    heading('Kleinere Hinweise zur Nachkontrolle',hinweise,Number(c.hinweise_offen||0));
    for(const note of hinweise){
      const box=elt('article');box.className='booking';
      box.append(elt('strong',note.station),elt('p',note.beschreibung),
        elt('p',note.gesperrt_am?'Station ist bereits sicherheitsgesperrt.':
          note.aktiv?'Hinweis offen – keine automatische Stationssperre.':
          'Station ist stillgelegt – keine Nutzung.'));
      jump(box,'pruef-hinweis-list','Hinweis und Nachprüfung öffnen');
      target.append(box);
    }
    heading('Nicht bestätigte Mängelbenachrichtigungen',meldungen,
      Number(c.meldungen_ungeklaert||0));
    for(const mail of meldungen){
      const box=elt('article');box.className='booking';
      box.append(elt('strong',mail.programm||'Sicherheitsmangel'),
        elt('p','Mailstatus: '+mail.status+' · Versuche: '+Number(mail.versuche||0)));
      jump(box,'pruef-mail-list','Benachrichtigung prüfen');
      target.append(box);
    }
  }
  function zeigeEinladungslink(status,result){
    if(result.emailVersand==='gesendet'){
      status.textContent='Neue Einladung an '+result.email+' versandt. Der Mailanbieter hat die Nachricht angenommen; eine Zustellung ist damit nicht bestätigt.';
      return;
    }
    const diagnosis={
      MAIL_NOT_CONFIGURED:'Brevo-API-Schlüssel oder Absenderadresse fehlt in der Serverkonfiguration.',
      MAIL_UNAVAILABLE:'Der E-Mail-Dienst ist auf dem Server nicht verfügbar.',
      BREVO_HTTP_400:'Brevo lehnt die Anfrage ab (HTTP 400). Absenderadresse und Empfängerdaten prüfen.',
      BREVO_HTTP_401:'Brevo lehnt den API-Schlüssel ab (HTTP 401). API-Schlüssel in Render erneuern.',
      BREVO_HTTP_403:'Brevo verweigert den Versand (HTTP 403). Konto- und Absenderfreigabe prüfen.',
      BREVO_HTTP_429:'Das Brevo-Versandlimit ist erreicht (HTTP 429). Später erneut versuchen.',
      BREVO_CONNECTION_UNCERTAIN:'Die Verbindung wurde unterbrochen; zuerst Brevo auf eine bereits angenommene Nachricht prüfen.',
      MAIL_UNEXPECTED_ERROR:'Unerwarteter Fehler beim E-Mail-Versand. Render-Logs prüfen.'
    };
    const match=/^BREVO_HTTP_(408|5\d\d)$/.exec(result.emailFehler||'');
    const detail=diagnosis[result.emailFehler]||(match?'Brevo ist vorübergehend nicht erreichbar (HTTP '+match[1]+').':'');
    status.textContent=result.emailVersand==='versand_ungeklaert'?
      'Versandstatus unklar. Bitte zuerst den Postausgang prüfen. '+(detail?detail+' ':'')+'Der neue Link ist sieben Tage gültig:':
      'E-Mail konnte nicht versandt werden. '+(detail?detail+' ':'')+'Den neuen Link sicher an '+result.email+' weitergeben:';
    const link=elt('a',result.registrierungsLink);link.href=result.registrierungsLink;
    link.className='invite-link';link.style.display='block';link.style.overflowWrap='anywhere';
    const copy=elt('button','Registrierungslink kopieren');copy.type='button';copy.className='btn secondary';
    copy.addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(result.registrierungsLink);copy.textContent='Link kopiert';}
      catch{status.append(elt('p','Kopieren nicht verfügbar. Den Link über den Linktext öffnen und aus der Adresszeile kopieren.'));}
    });
    status.append(link,copy);
  }
  async function einladungSenden(name,email){
    const status=find('pruef-einladung-status')||find('pruef-personal-status');status.replaceChildren();
    try{
      const result=await api('/api/admin/pruefung/mitarbeitende',{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email})});
      zeigeEinladungslink(status,result);
      await refresh();
      return true;
    }catch(error){status.textContent='Einladung fehlgeschlagen: '+error.message;return false;}
  }
  function renderStaff(target,people,places=activePlaces){
    target.replaceChildren();
    for(const person of people){
      const card=elt('article');card.className='booking';
      card.append(elt('strong',person.name+' · '+person.email));
      const statusText=person.status==='eingeladen'?'Einladung offen – Registrierung noch ausstehend':
        person.status==='geloescht'?'Konto gelöscht – Prüfprotokolle anonymisiert erhalten':
        person.status==='freigabe_ausstehend'?'Registrierung abgeschlossen – Freigabe erforderlich':
        person.aktiv?'Zugang aktiv':person.freigegeben?'Zugang pausiert':'Zugang deaktiviert';
      const accessStatus=elt('p',statusText);
      accessStatus.className='staff-access-status '+(person.aktiv?'is-active':
        person.status==='freigabe_ausstehend'?'is-pending':'is-inactive');
      card.append(accessStatus);
      if(person.status==='geloescht'){target.append(card);continue;}
      if(person.ablauf){
        const expiry=new Date(person.ablauf);
        card.append(elt('p','Einladung gültig bis '+expiry.toLocaleString('de-DE')));
      }
      if(person.telefon)card.append(elt('p','Telefon: '+person.telefon));
      if(person.strasse||person.plz||person.wohnort)
        card.append(elt('p','Anschrift: '+[person.strasse,[person.plz,person.wohnort].filter(Boolean).join(' ')].filter(Boolean).join(', ')));
      if(person.qualifikationen)card.append(elt('p','Qualifikationen / Erfahrung: '+person.qualifikationen));
      if(person.status==='freigabe_ausstehend'){
        const subject='Nachweis zu deinen Qualifikationen';
        const message='Hallo '+person.name+',\n\nbitte sende uns einen Nachweis zu den angegebenen Qualifikationen, sofern vorhanden.\n\nViele Grüße\nKlettern & Abenteuer Brilon';
        const requestProof=elt('a','Nachweis per E-Mail anfragen');
        requestProof.className='btn secondary';
        requestProof.href='mailto:'+encodeURIComponent(person.email)+'?'+new URLSearchParams({subject,body:message});
        card.append(requestProof);
      }
      for(const certificate of person.bescheinigungen||[]){
        const item=elt('div');item.className='certificate-review';
        const image=document.createElement('img');
        image.src='/api/admin/pruefung/mitarbeitende/'+encodeURIComponent(person.id)+
          '/bescheinigungen/'+encodeURIComponent(certificate.id);
        image.alt='Foto der Bescheinigung: '+certificate.bezeichnung;image.loading='lazy';
        image.className='certificate-preview';item.append(image);
        const link=elt('a',certificate.bezeichnung+' · '+certificate.dateiname);
        link.href=image.src;link.download=certificate.dateiname;item.append(link);card.append(item);
      }
      if((person.freigaben||[]).length)
        card.append(elt('p','Zugewiesene Freigaben: '+person.freigaben.map(item=>item.ort+' · '+item.qualifikation+
          (item.ortAktiv===false?' (Standort inaktiv)':'')).join('; ')));
      if(person.status==='freigabe_ausstehend'||person.freigegeben){
        const pending=person.status==='freigabe_ausstehend';
        const grantPanel=elt('div');grantPanel.className='staff-grants';
        grantPanel.append(elt('h4',pending?'Standorte und geprüfte Qualifikationen freigeben':'Standort- und Qualifikationsfreigaben verwalten'));
        const trustPanel=elt('div');trustPanel.className='staff-special-approval';
        const trustLabel=elt('label','Besondere Freigabe erteilt');
        const trustSelect=document.createElement('select');
        trustSelect.setAttribute('aria-label','Besondere Freigabe erteilt');
        for(const [value,label] of [['nein','Nein'],['ja','Ja']]){
          const option=document.createElement('option');option.value=value;option.textContent=label;
          trustSelect.append(option);
        }
        trustSelect.value=person.sonderfreigabe?'ja':'nein';
        trustLabel.append(trustSelect);
        const trustHelp=elt('p','Bei „Ja“ kann der Mitarbeiter nach aktiver Standortfreigabe passende Buchungen verbindlich übernehmen. Die Kundenbestätigung wird nach den eingestellten Zeiten ausgelöst.');
        const trustStatus=elt('p');trustStatus.className='staff-special-approval-status';trustStatus.setAttribute('role','status');
        const trustSave=elt('button','Sonderfreigabe speichern');trustSave.type='button';trustSave.className='btn secondary';
        trustSave.addEventListener('click',async()=>{
          const granted=trustSelect.value==='ja';
          if(granted&&!person.sonderfreigabe&&!confirm('Besondere Freigabe für '+person.name+' erteilen? Der Mitarbeiter kann nach aktiver Standortfreigabe Buchungen verbindlich übernehmen.'))return;
          trustSave.disabled=true;trustStatus.textContent='Sonderfreigabe wird gespeichert …';
          try{
            const result=await api('/api/admin/einsatzplanung/sonderfreigabe/'+encodeURIComponent(person.id),{
              method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({erteilt:granted})
            });
            person.sonderfreigabe=granted;
            trustStatus.textContent=result.erteilt?'Besondere Freigabe erteilt.':'Besondere Freigabe entzogen.';
            // Lokales Update lässt noch nicht gespeicherte Standort-/Qualifikationshäkchen stehen.
          }catch(error){trustStatus.textContent='Sonderfreigabe konnte nicht gespeichert werden: '+error.message;trustSave.disabled=false;}
        });
        trustPanel.append(trustLabel,trustHelp,trustSave,trustStatus);grantPanel.append(trustPanel);
        const placeField=elt('fieldset');placeField.append(elt('legend','Standorte (mehrere auswählbar)'));
        const assignedPlaces=(person.freigaben||[]).filter(grant=>!places.some(place=>Number(place.id)===Number(grant.ortId)))
          .map(grant=>({id:grant.ortId,name:grant.ort,aktiv:grant.ortAktiv}));
        const availablePlaces=[...places,...assignedPlaces];
        for(const place of availablePlaces){
          const label=elt('label');label.className='check';
          const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=String(place.id);
          checkbox.checked=(person.freigaben||[]).some(grant=>Number(grant.ortId)===Number(place.id));
          checkbox.className='staff-grant-place';label.append(checkbox,elt('span',place.name));placeField.append(label);
        }
        if(!availablePlaces.length)placeField.append(elt('p','Keine aktiven Standorte vorhanden.'));
        grantPanel.append(placeField);
        const qualifications=[...(person.qualifikationen||'').split(/[\r\n,;]+/),
          ...(person.bescheinigungen||[]).map(item=>item.bezeichnung),
          ...(person.freigaben||[]).map(item=>item.qualifikation)]
          .map(value=>value.trim()).filter(Boolean);
        const uniqueQualifications=[...new Set(qualifications)];
        const qualificationField=elt('fieldset');qualificationField.append(elt('legend','Geprüfte Qualifikationen'));
        for(const qualification of uniqueQualifications){
          const label=elt('label');label.className='check';
          const checkbox=document.createElement('input');checkbox.type='checkbox';
          checkbox.value=qualification;checkbox.className='staff-grant-qualification';
          checkbox.checked=(person.freigaben||[]).some(grant=>grant.qualifikation===qualification);
          label.append(checkbox,elt('span',qualification));qualificationField.append(label);
        }
        if(!uniqueQualifications.length)qualificationField.append(elt('p','Keine Qualifikationen oder Bescheinigungen eingetragen.'));
        grantPanel.append(qualificationField);
        const approve=elt('button',pending?'Auswahl freigeben und Zugang aktivieren':'Freigaben speichern');
        approve.type='button';approve.className='btn';approve.disabled=!availablePlaces.length||!uniqueQualifications.length;
        approve.addEventListener('click',async()=>{
          const standorte=[...grantPanel.querySelectorAll('.staff-grant-place:checked')].map(input=>Number(input.value));
          const qualifikationen=[...grantPanel.querySelectorAll('.staff-grant-qualification:checked')].map(input=>input.value);
          if(pending&&(!standorte.length||!qualifikationen.length)){
            find('pruef-personal-status').textContent='Mindestens einen Standort und eine geprüfte Qualifikation auswählen.';return;
          }
          const confirmation=pending?'Ausgewählte Standorte und Qualifikationen freigeben und Mitarbeiterzugang aktivieren?':
            standorte.length&&qualifikationen.length?'Freigaben durch die ausgewählten Standorte und Qualifikationen ersetzen?':
            'Alle Standort- und Qualifikationsfreigaben entziehen? Laufende Sitzungen werden beendet.';
          if(!confirm(confirmation))return;
          approve.disabled=true;
          try{
            const result=await api('/api/admin/pruefung/mitarbeitende/'+encodeURIComponent(person.id)+
              (pending?'/freigeben':'/freigaben'),{
              method:pending?'PATCH':'PUT',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({standorte,qualifikationen})
            });
            find('pruef-personal-status').textContent=pending?result.emailVersand==='gesendet'?
              'Ausgewählte Freigaben erstellt und Mitarbeiterzugang aktiviert. Der Mailanbieter hat die Nachricht angenommen; eine Zustellung ist damit nicht bestätigt.':
              'Ausgewählte Freigaben erstellt und Mitarbeiterzugang aktiviert. Die Benachrichtigung konnte nicht bestätigt werden; bitte die Person direkt informieren.':
              standorte.length?'Freigaben aktualisiert. Alle laufenden Mitarbeitersitzungen wurden beendet.':'Alle Freigaben entzogen. Alle laufenden Mitarbeitersitzungen wurden beendet.';
            await refresh();
          }catch(err){find('pruef-personal-status').textContent='Freigabe fehlgeschlagen: '+err.message;approve.disabled=false;}
        });
        grantPanel.append(approve);
        if(!pending)grantPanel.append(elt('p','Änderungen beenden alle laufenden Mitarbeitersitzungen. Inaktive Standorte bleiben sichtbar, gewähren aber keinen Zugriff.'));
        card.append(grantPanel);
      }
      if(person.art!=='einladung'&&person.freigegeben){
        const access=elt('p',person.verwaltungszugang?
          'Verwaltungsbereich: freigegeben. Zugriff umfasst die vollständige Verwaltung.':
          'Verwaltungsbereich: nicht freigegeben.');
        access.className='staff-admin-access '+(person.verwaltungszugang?'is-active':'is-inactive');
        card.append(access);
        const toggle=elt('button',person.verwaltungszugang?'Verwaltungszugang widerrufen':'Verwaltungszugang freigeben');
        toggle.type='button';toggle.className='btn '+(person.verwaltungszugang?'secondary':'');
        toggle.disabled=!person.aktiv&&!person.verwaltungszugang;
        if(!person.aktiv&&!person.verwaltungszugang)access.append(elt('span',' Freigabe erst nach Reaktivierung möglich.'));
        toggle.addEventListener('click',async()=>{
          const grant=!person.verwaltungszugang;
          const message=grant?'Verwaltungszugang für '+person.name+' freigeben? Damit erhält die Person Zugriff auf die vollständige Verwaltung einschließlich Buchungen und Kundendaten.':
            'Verwaltungszugang von '+person.name+' widerrufen? Die bestehenden Verwaltungs-Sitzungen werden beendet.';
          if(!confirm(message))return;
          toggle.disabled=true;
          try{
            await api('/api/admin/pruefung/mitarbeitende/'+encodeURIComponent(person.id)+'/verwaltungszugang',{
              method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({freigegeben:grant})});
            find('pruef-personal-status').textContent=grant?'Verwaltungszugang freigegeben. Der Mitarbeiter muss sich erneut anmelden.':'Verwaltungszugang widerrufen; Sitzungen wurden beendet.';
            await refresh();
          }catch(error){find('pruef-personal-status').textContent='Verwaltungszugang konnte nicht geändert werden: '+error.message;toggle.disabled=false;}
        });
        card.append(toggle);
      }
      if(person.aktiv){
        const stop=elt('button','Zugang pausieren');stop.type='button';stop.className='btn secondary';
        stop.addEventListener('click',async()=>{
          if(!confirm('Mitarbeiterzugang pausieren und alle laufenden Sitzungen beenden?'))return;
          stop.disabled=true;
          try{
            await api('/api/admin/pruefung/mitarbeitende/'+encodeURIComponent(person.id)+'/deaktivieren',{method:'PATCH'});
            find('pruef-personal-status').textContent='Mitarbeiterzugang pausiert; Freigaben bleiben erhalten.';
            await refresh();
          }catch(err){find('pruef-personal-status').textContent='Fehler: '+err.message;stop.disabled=false;}
        });
        card.append(stop);
      }else if(person.freigegeben){
        const resume=elt('button','Zugang wieder aktivieren');resume.type='button';resume.className='btn';
        resume.addEventListener('click',async()=>{
          if(!confirm('Zugang für '+person.name+' wieder aktivieren?'))return;
          resume.disabled=true;
          try{
            const result=await api('/api/admin/pruefung/mitarbeitende/'+encodeURIComponent(person.id)+'/reaktivieren',{method:'PATCH'});
            find('pruef-personal-status').textContent=result.emailVersand==='gesendet'
              ?'Mitarbeiterzugang reaktiviert; Freigaben bleiben erhalten und eine Information wurde versandt.'
              :'Mitarbeiterzugang reaktiviert; die Benachrichtigungs-E-Mail konnte nicht bestätigt werden.';
            await refresh();
          }catch(error){find('pruef-personal-status').textContent='Zugang konnte nicht reaktiviert werden: '+error.message;resume.disabled=false;}
        });
        card.append(resume);
      }
      if(person.art==='konto'){
        const remove=elt('button','Mitarbeiterkonto löschen');remove.type='button';remove.className='btn danger';
        remove.addEventListener('click',async()=>{
          if(!confirm('Mitarbeiterkonto von '+person.name+' endgültig löschen? Persönliche Daten, Bescheinigungen, Freigaben und Sitzungen werden entfernt. Sicherheits-Prüfprotokolle bleiben anonymisiert erhalten.'))return;
          remove.disabled=true;
          try{
            await api('/api/admin/pruefung/mitarbeitende/'+encodeURIComponent(person.id),{method:'DELETE'});
            find('pruef-personal-status').textContent='Mitarbeiterkonto gelöscht; Prüfprotokolle anonymisiert erhalten.';
            await refresh();
          }catch(error){find('pruef-personal-status').textContent='Mitarbeiterkonto konnte nicht gelöscht werden: '+error.message;remove.disabled=false;}
        });
        card.append(remove);
      }
      if(person.art==='einladung'){
        const resend=elt('button','Neue Einladung senden');resend.type='button';resend.className='btn secondary';
        resend.addEventListener('click',async()=>{
          if(!confirm('Eine neue Einladung an '+person.email+' senden? Der bisherige Link wird ungültig.'))return;
          resend.disabled=true;
          if(!await einladungSenden(person.name,person.email))resend.disabled=false;
        });
        const revoke=elt('button','Einladung widerrufen');revoke.type='button';revoke.className='btn secondary';
        revoke.addEventListener('click',async()=>{
          if(!confirm('Einladung für '+person.email+' widerrufen? Der Link kann danach nicht mehr verwendet werden.'))return;
          revoke.disabled=true;
          try{
            await api('/api/admin/pruefung/mitarbeitende/'+encodeURIComponent(person.id)+'/einladung',{method:'DELETE'});
            find('pruef-personal-status').textContent='Einladung für '+person.email+' wurde widerrufen.';
            await refresh();
          }catch(error){
            find('pruef-personal-status').textContent='Einladung konnte nicht widerrufen werden: '+error.message;
            revoke.disabled=false;
          }
        });
        card.append(resend,revoke);
        target.append(card);continue;
      }
      if(person.status==='freigabe_ausstehend'){
        target.append(card);continue;
      }
      const field=elt('label',person.aktiv?'Neues Passwort (alle Sitzungen beenden)':
        'Neues Startpasswort für die Reaktivierung');
      const password=document.createElement('input');password.type='password';
      password.autocomplete='new-password';password.minLength=6;
      password.placeholder='Mindestens 6 Zeichen';
      field.append(password);card.append(field);
      const action=person.aktiv?'passwort-setzen':'reaktivieren';
      const button=elt('button',person.aktiv?'Passwort zurücksetzen':'Zugang reaktivieren');
      button.type='button';button.className='btn secondary';
      button.addEventListener('click',async()=>{
        if(password.value.length<6){
          find('pruef-personal-status').textContent='Mindestens 6 Zeichen für das neue Passwort erforderlich.';return;
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
  function renderNetworkPartners(partners){
    const target=find('netzwerkpartner-list');if(!target)return;
    target.replaceChildren();
    for(const partner of partners){
      const card=elt('article');card.className='booking';
      const title=partner.unternehmen||partner.ansprechpartner;
      card.append(elt('strong',title+' · '+partner.email));
      const status=elt('p',partner.status==='eingeladen'?'Einladung offen – Registrierung ausstehend':
        partner.aktiv?'Partnerzugang freigeschaltet':'Registrierung abgeschlossen – Freigabe erforderlich');
      status.className='staff-access-status '+(partner.aktiv?'is-active':
        partner.status==='freigabe_ausstehend'?'is-pending':'is-inactive');
      card.append(status);
      if(partner.unternehmen)card.append(elt('p','Ansprechperson: '+partner.ansprechpartner));
      if(partner.telefon)card.append(elt('p','Telefon: '+partner.telefon));
      const address=[partner.strasse,[partner.plz,partner.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      if(address)card.append(elt('p','Anschrift: '+address));
      if(partner.weitere_angaben)card.append(elt('p','Weitere Kontakthinweise: '+partner.weitere_angaben));
      if(partner.art==='einladung'){
        const revoke=elt('button','Einladung widerrufen');revoke.type='button';revoke.className='btn secondary';
        revoke.addEventListener('click',async()=>{
          if(!confirm('Einladung für '+partner.email+' widerrufen?'))return;
          revoke.disabled=true;
          try{await api('/api/admin/netzwerkpartner/einladungen/'+encodeURIComponent(partner.id),{method:'DELETE'});
            find('netzwerkpartner-status').textContent='Einladung widerrufen.';await refresh();}
          catch(error){find('netzwerkpartner-status').textContent='Widerruf fehlgeschlagen: '+error.message;revoke.disabled=false;}
        });
        card.append(revoke);
      }else if(!partner.aktiv){
        const approve=elt('button','Netzwerkpartnerzugang freigeben');approve.type='button';approve.className='btn';
        approve.addEventListener('click',async()=>{
          if(!confirm('Partnerzugang für '+title+' freigeben und die Freigabe per E-Mail mitteilen?'))return;
          approve.disabled=true;
          try{
            const result=await api('/api/admin/netzwerkpartner/'+encodeURIComponent(partner.id)+'/freigeben',
              {method:'PATCH'});
            find('netzwerkpartner-status').textContent=result.emailVersand==='gesendet'?
              'Zugang freigegeben. Brevo hat die E-Mail angenommen; eine Zustellung ist damit nicht bestätigt.':
              'Zugang freigegeben, aber die E-Mail konnte nicht als zugestellt bestätigt werden.';
            await refresh();
          }catch(error){find('netzwerkpartner-status').textContent='Freigabe fehlgeschlagen: '+error.message;approve.disabled=false;}
        });
        card.append(approve);
      }
      target.append(card);
    }
    if(!partners.length)target.append(elt('p','Noch keine Netzwerkpartner oder Einladungen vorhanden.'));
  }
  function renderCustomerFeedback(data){
    const summary=find('kundenfeedback-summary'),target=find('kundenfeedback-list');
    if(!summary||!target)return;
    const stats=data.statistik||{};summary.replaceChildren();target.replaceChildren();
    for(const [label,value] of [
      ['Rückmeldungen',Number(stats.anzahl||0)],
      ['Programm (Ø von 5)',stats.programm??'—'],
      ['Mitarbeiter (Ø von 5)',stats.mitarbeiter??'—'],
      ['Sicherheitsgefühl (Ø von 5)',stats.sicherheit??'—']
    ]){const card=elt('article');card.className='booking payment-summary-card';card.append(elt('strong',String(value)),elt('p',label));summary.append(card);}
    const entries=Array.isArray(data.eintraege)?data.eintraege:[];
    if(!entries.length){target.append(elt('p','Noch keine Kundenrückmeldungen vorhanden.'));return;}
    for(const item of entries){
      const card=elt('article');card.className='booking';
      const date=item.erstellt_am?new Date(item.erstellt_am).toLocaleString('de-DE'):'Zeitpunkt unbekannt';
      card.append(elt('strong',(item.kunde||'Kunde')+' · '+(item.programm||'Programm')),
        elt('p','Kundennummer: '+item.buchungsnummer+' · Termin: '+(item.datum||'nicht hinterlegt')),
        elt('p','Programm: '+item.programm_bewertung+'/5 · Mitarbeiter: '+item.mitarbeiter_bewertung+'/5 · Sicherheitsgefühl: '+item.sicherheits_bewertung+'/5'),
        elt('p','Eingegangen: '+date));
      if(item.veraenderungen)card.append(elt('p','Veränderungsvorschläge: '+item.veraenderungen));
      if(item.ideen)card.append(elt('p','Weitere Angebotsideen: '+item.ideen));
      target.append(card);
    }
  }
  function standortAuswahl(selectedId){
    const select=document.createElement('select');
    const empty=elt('option','Standort auswählen');empty.value='';select.append(empty);
    for(const place of activePlaces){const option=elt('option',place.name);option.value=String(place.id);select.append(option);}
    select.value=selectedId?String(selectedId):'';return select;
  }
  function renderStations(target,stations){
    target.replaceChildren();
    for(const station of stations){
      const panel=elt('article');panel.className='booking';
      const blocked=!!station.gesperrt_am;
      panel.append(elt('strong',station.name),
        elt('p',!station.aktiv?'STATION DEAKTIVIERT – NICHT BENUTZEN':
          blocked?'GESPERRT – NICHT BENUTZEN':'Nicht gesperrt – Station aktiv'));
      panel.append(elt('p',station.ort&&station.qualifikation?
        'Standort: '+station.ort+' · Erforderliche Qualifikation: '+station.qualifikation:
        'Noch keinem Standort und keiner Qualifikation zugeordnet. Mitarbeitende können diese Station bis zur Zuordnung nicht prüfen.'));
      const assignment=document.createElement('form');assignment.className='station-assignment-form';
      const placeLabel=elt('label','Standort');
      const placeSelect=standortAuswahl(station.ort_id);placeSelect.required=true;placeLabel.append(placeSelect);
      const qualificationLabel=elt('label','Erforderliche Qualifikation');
      const qualificationInput=document.createElement('input');qualificationInput.type='text';
      qualificationInput.maxLength=100;qualificationInput.required=true;
      qualificationInput.value=station.qualifikation||'';qualificationInput.placeholder='z. B. Kletterprüfung';
      qualificationLabel.append(qualificationInput);
      const save=elt('button','Zuordnung speichern');save.type='submit';save.className='btn secondary';
      assignment.append(placeLabel,qualificationLabel,save);
      assignment.addEventListener('submit',async event=>{
        event.preventDefault();save.disabled=true;
        try{
          await api('/api/admin/pruefung/stationen/'+encodeURIComponent(station.id)+'/zuordnung',{
            method:'PATCH',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ortId:placeSelect.value,qualifikation:qualificationInput.value})
          });
          find('pruef-station-status').textContent='Standort- und Qualifikationszuordnung für '+station.name+' gespeichert.';
          await refresh();
        }catch(error){find('pruef-station-status').textContent='Zuordnung fehlgeschlagen: '+error.message;save.disabled=false;}
      });
      panel.append(assignment);
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
        article.append(elt('p',(p.station||'Station')+
          (p.ort?' · '+p.ort:'')+(p.qualifikation?' · '+p.qualifikation:'')+': '+
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
    const status=find('pruef-einladung-status')||find('pruef-personal-status');
    const submit=form.querySelector('button[type="submit"]');
    status.replaceChildren();submit.disabled=true;
    const values=Object.fromEntries(new FormData(form));
    try{if(await einladungSenden(values.name,values.email))form.reset();}
    finally{submit.disabled=false;}
  });
  find('netzwerkpartner-invite-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]');
    const status=find('netzwerkpartner-invite-status');button.disabled=true;status.replaceChildren();
    try{
      const result=await api('/api/admin/netzwerkpartner/einladungen',{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({name:form.elements.name.value,email:form.elements.email.value})});
      status.textContent=result.emailVersand==='gesendet'?
        'Einladung an '+result.email+' versandt. Der Mailanbieter hat sie angenommen; eine Zustellung ist damit nicht bestätigt.':
        'Einladung gespeichert, E-Mailversand fehlgeschlagen. Registrierungslink sicher weitergeben:';
      if(result.registrierungsLink){const link=elt('a',result.registrierungsLink);link.href=result.registrierungsLink;
        link.className='invite-link';link.style.display='block';link.style.overflowWrap='anywhere';status.append(link);}
      form.reset();await refresh();
    }catch(error){status.textContent='Einladung fehlgeschlagen: '+error.message;}
    finally{button.disabled=false;}
  });
  find('pruef-station-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;
    try{
      await api('/api/admin/pruefung/stationen',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...Object.fromEntries(new FormData(form)),ortId:form.elements.ortId.value,
          qualifikation:form.elements.qualifikation.value})});
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
  find('pruef-uebersicht-refresh')?.addEventListener('click',refresh);
  find('pruef-report-refresh')?.addEventListener('click',refresh);
  find('pruef-hinweis-refresh')?.addEventListener('click',refresh);
  find('pruef-mail-refresh')?.addEventListener('click',refresh);
  find('tablet-admin-refresh')?.addEventListener('click',refresh);
  document.querySelectorAll('[data-admin-view-link]').forEach(link=>link.addEventListener('click',()=>{
    if(['#netzwerkpartner-section','#kundenfeedback-section'].includes(link.hash))setTimeout(refresh,0);
  }));
  // The admin workspace is revealed by the existing login flow.
  const observer=new MutationObserver(()=>{
    if(!find('workspace')?.hidden && !initialized){initialized=true;refresh();}
    if(find('workspace')?.hidden)initialized=false;
  });
  if(find('workspace'))observer.observe(find('workspace'),{attributes:true,attributeFilter:['hidden']});
})();
