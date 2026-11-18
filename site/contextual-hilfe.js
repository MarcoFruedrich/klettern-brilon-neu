(()=>{
  const css=document.createElement('link');css.rel='stylesheet';css.href='/contextual-hilfe.css?v=20261117-fields2';document.head.append(css);
  const admin=document.body.classList.contains('admin-page');
  const rules=[
    [/veröffentlichte standorte|veroeffentlichte standorte|veranstaltungsorte|standortzuordnung/, 'Hier bestimmst du, an welchen Standorten das Programm öffentlich erscheint. Mehrere Orte auswählen und „Standortzuordnung speichern“ anklicken. Nach erneutem Öffnen müssen die Häkchen erhalten bleiben.'],
    [/gruppenpreis|preis je gruppe|gruppenstufen|teilnehmerstufe/, 'Jede Staffel kombiniert Teilnehmerzahl, Programmdauer und einen Preis für die gesamte Gruppe. Derselbe Teilnehmerbereich darf bei unterschiedlichen Dauern vorkommen.'],
    [/dauerberechnung|basisdauer|feste dauer/, 'Bei fester Dauer gilt ein Wert für alle Gruppen. Bei Dauer je Teilnehmerstufe darf dieselbe Gruppengröße mehrere Buchungsvarianten erhalten, etwa 180 oder 240 Minuten.'],
    [/mindestanmeldungen|buchungsart|einzelpl[aä]tze/, 'Gruppenanfrage und Einzelplatzbuchung haben unterschiedliche Abläufe. Mindestzahl, Höchstzahl, Dauer und Preis je Person vor der Veröffentlichung prüfen.'],
    [/verfügbare termine|verfuegbare termine/, 'Leere Liste bedeutet keine Datumsvorgabe im Programm. Wenn du konkrete Termine einträgst, sind nur diese Tage für das Programm vorgesehen. Sperrzeiten und Belegungen gelten zusätzlich.'],
    [/programm?beschreibung für mitarbeit|mitarbeiterbeschreibung/, 'Hier steht die interne Durchführung: Material, Vorbereitung, Sicherheitsregeln, Einleitung, Hauptteil und Abschlussreflexion. Die öffentliche Kurzbeschreibung wird separat gepflegt.'],
    [/bilder? aus medien|medienbibliothek|medienpool/, 'Wähle ein Bild aus dem vorhandenen Medienpool. Nach der Auswahl die Bildzuordnung beziehungsweise das Programm ausdrücklich speichern und anschließend neu öffnen.'],
    [/preis pro person|preis je person|preis pro teilnehmer/, 'Diese Angabe gilt pro angemeldeter Person. Sie ist nicht mit dem Gruppenpreis einer Teilnehmerstaffel identisch.'],
    [/partnerabzug|abzugshöhe|abzugstyp/, 'Lege den vertraglich vereinbarten Anteil des Netzwerkpartners fest: entweder ein Prozentsatz oder ein fester Betrag. Vor der Abrechnung nochmals mit der Vereinbarung abgleichen.'],
    [/verzögerung nach mitarbeiterzusage|ruhezeit beginnt|ruhezeit endet/, 'Diese Einstellung steuert den geplanten Versand von Zusagen und Benachrichtigungen. Ruhezeiten und Zeitverschiebungen vor dem Einsatz mit einer Testanfrage kontrollieren.'],
    [/im mitarbeiterbereich anzeigen|jetzt im mitarbeiter-wissensportal veröffentlichen/, 'Nur ausdrücklich freigegebene Inhalte werden im jeweiligen Mitarbeiterbereich sichtbar. Standort- und Rollenzuordnung sowie vertrauliche Daten vor dem Veröffentlichen prüfen.'],
    [/standorte zuordnen|für diese standorte freigeben/, 'Mit der Mehrfachauswahl wird festgelegt, an welchen Standorten Mitarbeitende den Artikel oder Inhalt sehen dürfen. Nicht ausgewählte Standorte erhalten keine Freigabe.'],
    [/sicherheits|prüfung|pruefung|prüf|pruef|mangel|station|anlage/, 'Diese Angabe ordnet die Prüfung einer konkreten Anlage zu und hilft, Ergebnis, Zuständigkeit und notwendige Maßnahmen sicher zu dokumentieren.'],
    [/standort|ort|herberge|venue/, 'Die Angabe grenzt Programm, Verfügbarkeit, Zuständigkeit und Zugriffsrechte auf den passenden Standort ein.'],
    [/programm|angebot|aktivität|aktivitaet|tour/, 'Die Auswahl verbindet den Vorgang mit Beschreibung, Dauer, Preis und den passenden Durchführungsbedingungen.'],
    [/datum|termin|startzeit|uhrzeit|zeitfenster/, 'Die Angabe wird mit Kalender und Verfügbarkeit abgeglichen. Ein gewünschter Termin ist erst nach Bestätigung verbindlich.'],
    [/teilnehmer|personen|gruppe|anzahl|plätze|plaetze|kapazität|kapazitaet/, 'Die Zahl wird für Gruppengröße, freie Plätze, Preisberechnung und sichere Einsatzplanung benötigt.'],
    [/zimmernummer|zimmer/, 'Diese Angabe unterstützt bei Bedarf die Zuordnung von Hausgästen vor Ort. Sie wird nur für den vorgesehenen Ablauf gebraucht und soll nicht öffentlich geteilt werden.'],
    [/e-mail|email/, 'An diese Adresse gehen Rückfragen und die für den Vorgang nötigen Bestätigungen. Bitte auf korrekte Schreibweise achten.'],
    [/telefon|mobilnummer|handy/, 'Über diese Nummer kann die zuständige Stelle kurzfristige Rückfragen oder Änderungen zum Termin klären.'],
    [/name|kontaktperson|ansprechpartner/, 'Der Name hilft, die Anfrage bzw. Zuständigkeit eindeutig zuzuordnen und Rückfragen gezielt zu stellen.'],
    [/preis|kosten|betrag|zahlung|anzahlung/, 'Der Betrag macht die Kostenregel für diesen Vorgang nachvollziehbar. Vor dem Speichern prüfen, ob er pro Person oder für die ganze Gruppe gilt.'],
    [/dauer|stunden|minuten/, 'Die Dauer wird für die Zeitplanung, Kalenderbelegung und Information der Teilnehmenden verwendet.'],
    [/qualifikation|nachweis|zertifikat|erfahrung/, 'Die Angabe hilft der Verwaltung zu prüfen, ob die Person für den jeweiligen Standort und die Aktivität freigegeben werden kann.'],
    [/passwort|kennwort|code|prüfcode|pruefcode/, 'Diese Angabe schützt den Zugang bzw. ordnet den Vorgang zu. Codes und Passwörter nicht weitergeben oder in Notizen speichern.'],
    [/adresse|straße|strasse|plz|postleitzahl/, 'Die Adresse wird für Standortzuordnung, Kontakt und gegebenenfalls die Abrechnung benötigt.'],
    [/alter|geburtsdatum|mindestalter/, 'Die Angabe unterstützt die Prüfung der Teilnahmevoraussetzungen und der passenden Betreuung. Nur erforderliche Angaben eintragen.'],
    [/bild|foto|datei|upload/, 'Das Bild ergänzt die Beschreibung oder dokumentiert einen konkreten Sachverhalt. Bitte nur notwendige und freigegebene Dateien hochladen.'],
    [/notiz|bemerkung|nachricht|hinweis|beschreibung|begründung|begruendung/, 'Hier können relevante Informationen zur Anfrage oder Bearbeitung ergänzt werden. Keine Passwörter oder unnötigen sensiblen Daten eintragen.'],
    [/status|aktiv|freigabe|veröffentlicht|veroeffentlicht|buchbar/, 'Der Status steuert, ob der Datensatz intern, öffentlich oder für neue Anfragen verfügbar ist. Vor Änderungen Auswirkungen auf bestehende Vorgänge prüfen.'],
    [/rechnung|buchungsnummer|beleg|storno|gutschrift/, 'Die Angabe verbindet den Vorgang mit dem richtigen Abrechnungs- und Buchungsnachweis. Vor Änderungen Buchung und Zahlungseingang abgleichen.'],
    [/partner|netzwerk/, 'Die Auswahl bestimmt, welcher Partner für Standort, Angebot oder Anlageninformation zuständig ist und welche Ansicht freigegeben wird.'],
    [/kategorie|zielgruppe/, 'Die Auswahl ordnet das Angebot in die passende Übersicht ein und hilft Gästen, geeignete Programme zu finden.']
  ];
  const sectionHelp={
    'admin-dashboard':'Die Übersicht zeigt Zugänge zu den Verwaltungsbereichen. Beginne hier und wähle Buchungen, Programme, Kalender, Kontakte, Zahlung oder Sicherheit aus.',
    'bookings-section':'Anfragen, Buchungsstatus und Kontaktangaben bearbeiten. Vor Bestätigungen Kalender, Standort, Zahlungsstand und zuständiges Personal prüfen.',
    'payment-overview-section':'Zeigt Einnahmen, offene Beträge und Zahlungen. Gutschriften und tatsächlich erstattete Beträge getrennt behandeln; Filter beeinflussen die Darstellung.',
    'rechnungen-agb-section':'Rechnungssteller, Bankverbindung, Nummernvergabe und AGB hier pflegen. Änderungen vor dem Versand testen und bestehende Belege nicht still überschreiben.',
    'calendar-view':'Termine, Sperrzeiten und Einsatzplanung verwalten. Nur die tatsächlich belegten Zeitfenster am ausgewählten Standort sperren, nicht automatisch den ganzen Tag.',
    'special-offers-view':'Tages- und Sonderangebote mit Datum, Preis und passenden Standorten erfassen. Eine Programmverknüpfung nur bei inhaltlich geeignetem und buchbarem Programm setzen.',
    'anschlussrabatt-section':'Anschlussangebote sind ergänzende Programme zu einer bestehenden Buchung. Voraussetzungen, Uhrzeit, Verfügbarkeit und Rabatt vor der Freigabe prüfen.',
    'angebote-verwaltung':'Programme erstellen und bearbeiten. Standorte mit eigenem Speichern-Button sichern; Teilnehmerstaffeln, Dauern, Preise, Website-Freigabe und Buchbarkeit getrennt kontrollieren.',
    'spontangruppen-preis-section':'Preise pro Person für spontane Gruppenangebote, einen zuständigen Partner und dessen vereinbarten Abzug hinterlegen. Abrechnung anschließend prüfen.',
    'besuchergruppen-admin-section':'Besuchergruppen wie Familien, Schulen oder Firmen gestalten und Programme zuordnen. Zielgruppen-Freigaben ersetzen nicht die Standortauswahl im Programm.',
    'standorte-section':'Standorte und Partnerhaus-Kontakte verwalten. Ein neu angelegter Ort wird nicht automatisch für alle Programme und Trainer freigegeben.',
    'mitarbeiter-section':'Mitarbeiterstatus, Qualifikationen, Standorte, Stunden und Versandregeln prüfen. Eine Registrierung ist noch keine fachliche Einsatzfreigabe.',
    'mitarbeiter-einladen-section':'Mitarbeiter persönlich einladen und die Registrierung prüfen. Danach Qualifikation, Standortberechtigung und Einsatzstatus freigeben.',
    'netzwerkpartner-section':'Netzwerkpartner betreuen und deren Zugriff begrenzen. Freigaben gelten nur für vereinbarte Daten, Standorte und Aufgaben.',
    'netzwerkpartner-einladen-section':'Organisationen beziehungsweise Ansprechpartner einladen. Partnerzugänge vor dem ersten Einsatz kontrollieren und auf die eigenen Informationen beschränken.',
    'mitarbeiterbereiche-admin-section':'Interne Inhalte für den Mitarbeiterbereich verwalten. Veröffentlichungsstatus, Vertraulichkeit und eventuelle Standortfreigabe beachten.',
    'wissensportal-admin-section':'Artikel, Programmanleitungen, Kategorien, Bilder und Dokumente im internen Wissensportal pflegen. Entwürfe bleiben unsichtbar bis zur Freigabe.',
    'gps-verwaltung':'GPS-Touren und Kontrollstationen erstellen, Codes sicher verwahren und Zugänge nur für passende bestätigte Buchungen ausgeben.',
    'stationspruefung':'Anlagen, Prüfpunkte und qualifizierte Prüfpersonen verwalten. Ein offener sicherheitsrelevanter Mangel bleibt bis zur dokumentierten Freigabe gesperrt.',
    'website-effekte-section':'Dekorative Animationen und Website-Effekte einstellen. Die Darstellung auf Mobilgeräten und bei reduzierter Bewegung mitprüfen.',
    'whatsapp-admin-section':'Allgemeine Kundenkommunikation über WhatsApp steuern. Buchungen und personenbezogene Informationen gehören in die vorgesehenen sicheren Abläufe.',
    'social-media-section':'Beiträge vorbereiten; automatische Veröffentlichungen setzen eine tatsächlich konfigurierte Verbindung mit dem jeweiligen Kanal voraus.',
    'marketing-campaign-section':'Kampagnen, Zielgruppen, Medienlinks und Freigabestatus pflegen. Ein gespeicherter Entwurf wurde nicht automatisch extern veröffentlicht.',
    'feedback-admin-section':'Internes Kundenfeedback auswerten. Personenbezogene Rückmeldungen nicht ungewollt öffentlich anzeigen.',
    'kundenfeedback-section':'Rückmeldungen zu Programmen, Durchführung und Sicherheit verwalten. Nur freigegebene Kennzahlen beziehungsweise Ansichten veröffentlichen.',
    'admin-guestbook-section':'Einwilligungsbezogene GPS-Gästelisten prüfen. Ohne dokumentierte Einwilligung keine öffentliche Namensanzeige.',
    'admin-faq-section':'Antworten zu Verwaltung, Programmen, Buchungen und Sicherheit. Die Fragezeichen direkt an Eingabefeldern erklären die einzelne Eingabe.',
    'marketing-campaign-section':'Kampagnen, Zielgruppen, Medienlinks und Freigabestatus pflegen. Ein gespeicherter Entwurf wurde nicht automatisch extern veröffentlicht.'
  };
  const norm=s=>(s||'').replace(/\s+/g,' ').trim().toLocaleLowerCase('de-DE');
  function helpText(label){const text=norm(label);for(const [re,msg] of rules)if(re.test(text))return msg;return '';}
  let seq=0;
  function attach(target,label,overrideMessage=''){
    if(!target||target.dataset.contextHelp==='1')return;
    const mapped=overrideMessage||helpText(label);
    const formTitle=target.closest('form')?.querySelector('h2,h3,legend')?.textContent?.trim();
    const context=formTitle?` „${formTitle}“`:'';
    const message=mapped||(admin?`Diese Angabe hilft,${context} den Datensatz eindeutig zuzuordnen und die Bearbeitung korrekt auszuführen. Bitte nur erforderliche Informationen eintragen.`:`Diese Angabe wird benötigt, damit${context} deine Anfrage vollständig zugeordnet und bearbeitet werden kann. Bitte nur erforderliche Informationen eintragen.`);
    target.dataset.contextHelp='1';
    const wrap=document.createElement('span');wrap.className='context-help';
    const button=document.createElement('button');button.type='button';button.className='context-help-button';button.textContent='?';button.setAttribute('aria-label','Hinweis zu '+label);button.setAttribute('aria-expanded','false');
    const tip=document.createElement('span');tip.className='context-help-tip';tip.id='context-help-'+(++seq);tip.setAttribute('role','tooltip');tip.hidden=true;tip.textContent=message;button.setAttribute('aria-describedby',tip.id);
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const open=button.getAttribute('aria-expanded')==='true';document.querySelectorAll('.context-help-button[aria-expanded="true"]').forEach(b=>{b.setAttribute('aria-expanded','false');const t=b.parentElement?.querySelector('.context-help-tip');if(t)t.hidden=true;});if(!open){button.setAttribute('aria-expanded','true');tip.hidden=false;}});
    button.addEventListener('keydown',event=>{if(event.key==='Escape'){button.setAttribute('aria-expanded','false');tip.hidden=true;button.focus();}});
    wrap.append(button,tip);
    if(target.matches('h2,h3')){
      target.append(document.createTextNode(' '),wrap);
      return;
    }
    const control=target.querySelector('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]),select,textarea');
    if(control){
      const field=document.createElement('span');field.className='context-help-control';
      control.insertAdjacentElement('beforebegin',field);field.append(control,wrap);
    }else if(target.querySelector('input[type="checkbox"],input[type="radio"]')){
      const choice=document.createElement('span');choice.className='context-help-choice';
      target.insertAdjacentElement('beforebegin',choice);choice.append(target,wrap);
    }else target.insertAdjacentElement('afterend',wrap);
  }
  function scan(root=document){
    root.querySelectorAll?.('label').forEach(label=>{
      // Die Anmeldung braucht keine zusätzlichen Schaltflächen; diese stören
      // sonst Passwortmanager und eindeutige Login-Button-Navigation.
      if(label.closest('#login'))return;
      const txt=label.textContent||'';
      attach(label,txt.replace(/[＊*]/g,'').trim());
    });
    root.querySelectorAll?.('[data-help]').forEach(node=>attach(node,node.getAttribute('data-help')||'Hinweis'));
    if(admin){
      root.querySelectorAll?.('.admin-view[id]').forEach(section=>{
        const heading=section.querySelector(':scope > h2');
        if(heading&&sectionHelp[section.id])
          attach(heading,'Bereich '+heading.textContent.trim(),sectionHelp[section.id]);
      });
    }
  }
  document.addEventListener('click',event=>{if(!event.target.closest('.context-help'))document.querySelectorAll('.context-help-button[aria-expanded="true"]').forEach(b=>{b.setAttribute('aria-expanded','false');const t=b.parentElement?.querySelector('.context-help-tip');if(t)t.hidden=true;});});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>scan());else scan();
  new MutationObserver(records=>records.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1)scan(n);}))).observe(document.documentElement,{childList:true,subtree:true});
})();
