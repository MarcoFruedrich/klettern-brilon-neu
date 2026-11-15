(()=>{
  const css=document.createElement('link');css.rel='stylesheet';css.href='/contextual-hilfe.css?v=20261115';document.head.append(css);
  const admin=document.body.classList.contains('admin-page');
  const rules=[
    [/sicherheits|prüfung|pruefung|prüf|pruef|mangel|station|anlage/, 'Diese Angabe ordnet die Prüfung einer konkreten Anlage zu und hilft, Ergebnis, Zuständigkeit und notwendige Maßnahmen sicher zu dokumentieren.'],
    [/standort|ort|herberge|venue/, 'Die Angabe grenzt Programm, Verfügbarkeit, Zuständigkeit und Zugriffsrechte auf den passenden Standort ein.'],
    [/programm|angebot|aktivität|aktivitaet|tour/, 'Die Auswahl verbindet deine Anfrage mit Beschreibung, Dauer, Preis und den passenden Durchführungsbedingungen.'],
    [/datum|termin|startzeit|uhrzeit|zeitfenster/, 'Die Angabe wird mit Kalender und Verfügbarkeit abgeglichen. Ein gewünschter Termin ist erst nach Bestätigung verbindlich.'],
    [/teilnehmer|personen|gruppe|anzahl|plätze|plaetze|kapazität|kapazitaet/, 'Die Zahl wird für Gruppengröße, freie Plätze, Preisberechnung und sichere Einsatzplanung benötigt.'],
    [/zimmernummer|zimmer/, 'Diese Angabe unterstützt bei Bedarf die Zuordnung von Hausgästen vor Ort. Sie wird nur für den vorgesehenen Ablauf gebraucht und soll nicht öffentlich geteilt werden.'],
    [/e-mail|email/, 'An diese Adresse gehen Rückfragen und die für deine Anfrage nötigen Bestätigungen. Bitte auf korrekte Schreibweise achten.'],
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
  const norm=s=>(s||'').replace(/\\s+/g,' ').trim().toLocaleLowerCase('de-DE');
  function helpText(label){const text=norm(label);for(const [re,msg] of rules)if(re.test(text))return msg;return '';}
  let seq=0;
  function attach(target,label){
    if(!target||target.dataset.contextHelp==='1')return;
    const message=helpText(label);if(!message)return;
    target.dataset.contextHelp='1';
    const wrap=document.createElement('span');wrap.className='context-help';
    const button=document.createElement('button');button.type='button';button.className='context-help-button';button.textContent='?';button.setAttribute('aria-label','Hinweis zu '+label);button.setAttribute('aria-expanded','false');
    const tip=document.createElement('span');tip.className='context-help-tip';tip.id='context-help-'+(++seq);tip.setAttribute('role','tooltip');tip.hidden=true;tip.textContent=message;button.setAttribute('aria-describedby',tip.id);
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const open=button.getAttribute('aria-expanded')==='true';document.querySelectorAll('.context-help-button[aria-expanded="true"]').forEach(b=>{b.setAttribute('aria-expanded','false');const t=b.parentElement?.querySelector('.context-help-tip');if(t)t.hidden=true;});if(!open){button.setAttribute('aria-expanded','true');tip.hidden=false;}});
    button.addEventListener('keydown',event=>{if(event.key==='Escape'){button.setAttribute('aria-expanded','false');tip.hidden=true;button.focus();}});
    wrap.append(button,tip);target.insertAdjacentElement('afterend',wrap);
  }
  function scan(root=document){
    root.querySelectorAll?.('label').forEach(label=>{const txt=label.textContent||'';attach(label,txt.replace(/[＊*]/g,'').trim());});
    root.querySelectorAll?.('h1,h2,h3,legend').forEach(heading=>{const text=heading.textContent||'';if(helpText(text))attach(heading,text.trim());});
    root.querySelectorAll?.('[data-help]').forEach(node=>attach(node,node.getAttribute('data-help')||'Hinweis'));
  }
  document.addEventListener('click',event=>{if(!event.target.closest('.context-help'))document.querySelectorAll('.context-help-button[aria-expanded="true"]').forEach(b=>{b.setAttribute('aria-expanded','false');const t=b.parentElement?.querySelector('.context-help-tip');if(t)t.hidden=true;});});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>scan());else scan();
  new MutationObserver(records=>records.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1)scan(n);}))).observe(document.documentElement,{childList:true,subtree:true});
})();
