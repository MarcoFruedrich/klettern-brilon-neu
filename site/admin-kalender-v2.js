
'use strict';
/* Eigenständige Kalenderansicht. Nur echte Daten aus bestehenden Admin-APIs.
   Parallele Termine an unterschiedlichen Standorten bleiben erlaubt. */
(() => {
  const section = document.getElementById('calendar-view');
  const workspace = document.getElementById('workspace');
  if (!section || !workspace) return;
  const mk = (tag, className, content) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (content !== undefined) n.textContent = content;
    return n;
  };
  const btn = (content, className, action) => {
    const b = mk('button', className, content);
    b.type = 'button';
    if (action) b.addEventListener('click', action);
    return b;
  };
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const midday = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  const addDays = (d, amount) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + amount, 12);
  const startWeek = d => addDays(midday(d), -((d.getDay() + 6) % 7));
  const minutes = val => {
    if (typeof val !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d/.test(val)) return null;
    return Number(val.slice(0, 2)) * 60 + Number(val.slice(3, 5));
  };
  const prettyTime = v => v == null ? 'Uhrzeit offen' : String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
  const dateLabel = (d, options) => d.toLocaleDateString('de-DE', options);
  const fromIso = key => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)), 12);
  const overlap = (a, b) => a.start != null && a.end != null && b.start != null && b.end != null && a.start < b.end && b.start < a.end;
  const colors = [
    {name:'Brilon',strong:'#1976b7',line:'#79bbe9',pale:'#e5f3ff'},
    {name:'Haltern',strong:'#753fb9',line:'#c49ced',pale:'#f3e7ff'},
    {name:'',strong:'#b17013',line:'#edc782',pale:'#fff5dc'},
    {name:'',strong:'#0c8372',line:'#8bcebf',pale:'#e5f8f2'},
    {name:'',strong:'#b24e63',line:'#e9acb8',pale:'#ffecf0'},
    {name:'',strong:'#5364a2',line:'#b1bce8',pale:'#eef1ff'}
  ];
  const siteColor = site => {
    const s = String(site || '').trim();
    if (/brilon/i.test(s)) return colors[0];
    if (/haltern/i.test(s)) return colors[1];
    if (!s) return {strong:'#6b7a76',line:'#cdd9d2',pale:'#f1f5f2'};
    let code = 0;
    for (const c of s) code = (code * 31 + c.charCodeAt(0)) >>> 0;
    return colors[2 + code % (colors.length - 2)];
  };
  const paint = (node, entry) => {
    const c = entry.type === 'sperrzeit' ? {strong:'#c53e4c',line:'#eea1a9',pale:'#fff0f1'}
      : entry.type === 'termin' ? {strong:'#217fa5',line:'#9dceeb',pale:'#e7f6ff'}
      : entry.status === 'bestaetigt' ? {strong:'#218047',line:'#91cba4',pale:'#e8fadf'}
      : {strong:'#9b6500',line:'#e6bd68',pale:'#ffe7ad'};
    node.style.setProperty('--ck-strong', c.strong);
    node.style.setProperty('--ck-line', c.line);
    node.style.setProperty('--ck-pale', c.pale);
    if(entry.type==='buchung')node.style.setProperty('--ck-site-strong',siteColor(entry.site).strong);
  };
  const root = mk('div', 'ck-root');
  root.id = 'calendar-v2';
  const toolbar = mk('div', 'ck-toolbar');
  const switcher = mk('div', 'ck-switch');
  const nav = mk('div', 'ck-nav');
  const actions = mk('div', 'ck-actions');
  const stateText = mk('p', 'ck-state');
  stateText.setAttribute('role', 'status');
  stateText.setAttribute('aria-live', 'polite');
  const body = mk('div', 'ck-body');
  const board = mk('div', 'ck-panel ck-board-scroll');
  const detail = mk('aside', 'ck-panel ck-detail');
  detail.setAttribute('aria-label', 'Buchungsdetails');
  const legend = mk('div', 'ck-legend');
  const chosen = {mode:'week',cursor:midday(new Date()),date:iso(new Date()),entryId:null,sites:[],siteOptions:[],siteFilterInitialized:false,events:[],staffComplete:false,newEntrySlot:null};
  let loadSequence = 0;
  let knownSites = [];
  const tabs = {};
  for (const [key,label] of [['week','Woche'],['month','Monat'],['agenda','Agenda']]) {
    tabs[key] = btn(label, '', () => {
      chosen.cursor = fromIso(chosen.date);
      chosen.mode = key; chosen.entryId = null; chosen.newEntrySlot=null; load();
    });
    tabs[key].setAttribute('aria-pressed', key === chosen.mode ? 'true' : 'false');
    switcher.append(tabs[key]);
  }
  const prev = btn('‹', '', () => move(-1)); prev.setAttribute('aria-label','Vorheriger Zeitraum');
  const period = mk('strong', 'ck-period');
  const next = btn('›', '', () => move(1)); next.setAttribute('aria-label','Nächster Zeitraum');
  nav.append(prev,period,next);
  const today = btn('Heute','', () => {
    chosen.cursor = midday(new Date()); chosen.date = iso(chosen.cursor); chosen.entryId=null; chosen.newEntrySlot=null; load();
  });
  const newEntry = btn('+ Neuer Eintrag','ck-new',() => openNewEntry(chosen.date));
  actions.append(today,newEntry);
  toolbar.append(switcher,nav,actions);
  body.append(board,detail);
  root.append(toolbar,stateText,body,legend);
  section.insertBefore(root, section.querySelector('.booking'));
  document.body.classList.add('ck-enabled');

  function clock(value) {
    return value==null||value<0||value>=1440?'':String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  }
  function openNewEntry(date=chosen.date,startMinute=null,type='termin') {
    const selectedDate=/^\d{4}-\d{2}-\d{2}$/.test(date||'')?date:iso(new Date());
    const start=startMinute==null?'':clock(Math.max(0,Math.min(1439,Math.round(startMinute/15)*15)));
    const numericStart=minutes(start);
    const end=numericStart==null?'':clock(numericStart+60);
    chosen.date=selectedDate;chosen.entryId=null;
    chosen.newEntrySlot={date:selectedDate,start,end,type};
    renderDetail();
    detail.querySelector('[name="titel"]')?.focus();
  }
  function renderNewEntryForm() {
    const slot=chosen.newEntrySlot;
    detail.append(mk('h3','','Neuen Kalendereintrag anlegen'));
    detail.append(mk('p','ck-entry-intro','Datum und Uhrzeit sind vorausgefüllt. Du kannst Termin, Sperrzeit, Zeitraum und interne Hinweise ergänzen.'));
    const form=mk('form','ck-inline-entry');
    const fields=mk('div','ck-entry-grid');
    const status=mk('p','ck-entry-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const addField=(labelText,name,type,value='',options={})=>{
      const label=mk('label','ck-entry-field');
      label.append(mk('span','',labelText));
      let control;
      if(type==='select'){
        control=mk('select');
        for(const [optionValue,optionText] of [['termin','Eigener Klettertermin'],['sperrzeit','Sperrzeit / Nicht verfügbar']]){
          const option=mk('option','',optionText);option.value=optionValue;control.append(option);
        }
      }else if(type==='textarea')control=mk('textarea');
      else {control=mk('input');control.type=type;}
      control.name=name;
      if(value)control.value=value;
      if(options.required)control.required=true;
      if(options.maxlength)control.maxLength=options.maxlength;
      if(options.rows)control.rows=options.rows;
      label.append(control);fields.append(label);
      return control;
    };
    const kind=addField('Art des Eintrags','typ','select',slot.type);kind.value=slot.type;
    const title=addField('Titel','titel','text','',{required:true,maxlength:120});
    title.placeholder='z. B. Schulklasse, Geburtstag oder Urlaub';
    const date=addField('Beginn (Datum)','datum','date',slot.date,{required:true});
    const endDate=addField('Ende (Datum, optional)','enddatum','date');
    endDate.min=slot.date;
    date.addEventListener('change',()=>{endDate.min=date.value;if(endDate.value&&endDate.value<date.value)endDate.value='';});
    addField('Beginn (Uhrzeit, optional)','uhrzeit','time',slot.start);
    addField('Ende (Uhrzeit, optional)','endzeit','time',slot.end);
    const description=addField('Beschreibung / Interne Hinweise','beschreibung','textarea','',{maxlength:1000,rows:3});
    description.placeholder='Weitere Informationen zum Termin';
    description.closest('label').classList.add('ck-entry-wide');
    const actions=mk('div','ck-entry-actions');
    const cancel=btn('Abbrechen','ck-entry-cancel',()=>{chosen.newEntrySlot=null;renderDetail();});
    const save=btn('Eintrag speichern','ck-entry-save');save.type='submit';
    actions.append(cancel,save);
    form.append(fields,actions,status);
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const data=Object.fromEntries(new FormData(form).entries());
      if(data.enddatum&&data.enddatum<data.datum){status.textContent='Das Enddatum darf nicht vor dem Beginn liegen.';endDate.focus();return;}
      if((!data.enddatum||data.enddatum===data.datum)&&data.uhrzeit&&data.endzeit&&data.endzeit<=data.uhrzeit){
        status.textContent='Die Endzeit muss nach der Beginnzeit liegen.';form.elements.endzeit.focus();return;
      }
      save.disabled=true;cancel.disabled=true;status.textContent='Eintrag wird gespeichert …';
      try{
        const created=await api('/api/admin/kalender',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
        showManualEntries([{...data,id:created.id}]);
        stateText.textContent='Kalendereintrag gespeichert.';
        await load();stateText.textContent='Kalendereintrag gespeichert.';
      }catch(error){status.textContent='Eintrag konnte nicht gespeichert werden: '+(error.message||'Fehler');save.disabled=false;cancel.disabled=false;}
    });
    detail.append(form);
  }
  function move(dir) {
    const d = chosen.cursor;
    chosen.cursor = chosen.mode === 'month'
      ? new Date(d.getFullYear(),d.getMonth()+dir,1,12)
      : addDays(d,dir*7);
    chosen.date = iso(chosen.mode === 'month' ? chosen.cursor : startWeek(chosen.cursor));
    chosen.entryId=null;chosen.newEntrySlot=null;
    load();
  }
  function range() {
    const c=chosen.cursor;
    if (chosen.mode === 'month') {
      const first=new Date(c.getFullYear(),c.getMonth(),1,12);
      return [first,new Date(c.getFullYear(),c.getMonth()+1,0,12)];
    }
    const first=startWeek(c);
    return [first,addDays(first,6)];
  }
  function visibleEntries(day) {
    const allSitesVisible=!chosen.siteOptions.length ||
      (chosen.sites.length===chosen.siteOptions.length&&chosen.siteOptions.every(site=>chosen.sites.includes(site)));
    return chosen.events.filter(e => e.date <= day && day <= e.last &&
      (e.type !== 'buchung' || chosen.sites.includes(e.site) || (allSitesVisible&&!e.site)));
  }
  function bookingStaff(plan) {
    const map=new Map();
    for (const a of plan.einsaetze || []) {
      if (!map.has(a.buchung_id)) map.set(a.buchung_id,[]);
      map.get(a.buchung_id).push(a);
    }
    return map;
  }
  function normalize(bookings, own) {
    const normalized = [];
    const used = new Set();
    for (const b of bookings) {
      if (!b || used.has(String(b.id))) continue;
      used.add(String(b.id));
      const start=minutes(b.uhrzeit);
      const length=Number(b.dauer);
      const reliable=Number.isFinite(length)&&length>0&&length<=1440;
      const end=start == null ? null : Math.min(1440,start+(reliable?length:60));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.datum||'')) continue;
      normalized.push({
        id:String(b.id),type:'buchung',date:b.datum,last:b.datum,start,end,reliable,
        title:b.angebot||'Programm',site:b.ort||b.veranstaltungsort||b.standort||'',status:b.status||'offen',
        staff:Array.isArray(b.staff)?b.staff:[],name:b.name||'',email:b.email||'',telefon:b.telefon||'',
        buchungsnummer:b.buchungsnummer||'',teilnehmer:b.teilnehmer||'',nachricht:b.nachricht||'',
        duration:reliable?length:null
      });
    }
    for (const e of own) {
      if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.datum||'')) continue;
      const start=minutes(e.uhrzeit);
      const till=minutes(e.endzeit);
      const end=start==null?null:(till!=null&&till>start?till:Math.min(1440,start+60));
      normalized.push({
        id:'manual-'+e.id,type:e.typ==='sperrzeit'?'sperrzeit':'termin',
        date:e.datum,last:e.enddatum&&e.enddatum>=e.datum?e.enddatum:e.datum,
        start,end,reliable:start!=null&&till!=null&&till>start,
        title:e.titel||'Eigener Termin',description:e.beschreibung||'',
        site:'',status:'',staff:[],name:''
      });
    }
    return normalized;
  }
  function showManualEntries(rawEntries) {
    const entries=rawEntries.flatMap(entry=>normalize([], [entry]));
    if(!entries.length)return;
    const ids=new Set(entries.map(entry=>entry.id));
    chosen.events=[...chosen.events.filter(entry=>!ids.has(entry.id)),...entries];
    chosen.date=entries[0].date;
    chosen.cursor=fromIso(entries[0].date);
    chosen.entryId=entries[0].id;
    chosen.newEntrySlot=null;
    render();
  }
  async function load() {
    if (workspace.hidden) return;
    const seq=++loadSequence;
    stateText.textContent='Kalender wird geladen …';
    const [from,to] = range();
    const months = new Set();
    for (let d=from;d<=to;d=addDays(d,1)) months.add(iso(d).slice(0,7));
    try {
      const monthList=Array.from(months);
      const [plans,bookingLists,own,places] = await Promise.all([
        Promise.all(monthList.map(month=>api('/api/admin/einsatzplanung/kalender?monat='+encodeURIComponent(month)))),
        Promise.all(monthList.map(month=>api('/api/admin/kalenderbuchungen?monat='+encodeURIComponent(month)))),
        api('/api/admin/kalender'),
        api('/api/admin/orte').catch(()=>[])
      ]);
      if (seq!==loadSequence || workspace.hidden) return;
      const bookings = [];
      for (let i=0;i<plans.length;i++) {
        const plan=plans[i];
        const staffing=bookingStaff(plan);
        const planBookings=new Map((plan.buchungen||[]).map(b=>[String(b.id),b]));
        const details=new Map((bookingLists[i]||[]).map(row=>[String(row.id),row]));
        // Die Buchungsliste ist die maßgebliche Quelle für alle offenen Anfragen.
        // Die Einsatzplanungs-API kann ältere Einträge mit NULL-Status auslassen.
        const ids=new Set([...planBookings.keys(),...details.keys()]);
        for(const id of ids){
          const b=planBookings.get(id)||{};
          const row=details.get(id);
          const source=row?.data||{};
          // Die Buchungsliste ist die maßgebliche Quelle für Kundendaten und
          // Terminzeit. Der Einsatzplan ergänzt nur Felder, die dort fehlen.
          bookings.push({
            ...b,...source,
            id:row?.id||b.id||source.id,
            datum:source.datum||b.datum,
            uhrzeit:source.uhrzeit||b.uhrzeit,
            dauer:source.dauer??b.dauer,
            angebot:source.angebot||b.angebot,
            ort:source.veranstaltungsort||source.ort||b.ort||b.veranstaltungsort,
            status:row?.status||b.status||'offen',
            staff:staffing.get(id)||staffing.get(b.id)||[]
          });
        }
      }
      knownSites=Array.isArray(places)?places.filter(place=>place.aktiv!==false).map(place=>place.name).filter(Boolean):[];
      chosen.events=normalize(bookings,Array.isArray(own)?own:[]);
      chosen.staffComplete=true;
      stateText.textContent='';
      refreshFilter();
      render();
    } catch (e) {
      if (seq!==loadSequence) return;
      stateText.textContent='Kalender konnte nicht geladen werden: '+(e.message||'Unbekannter Fehler');
      chosen.staffComplete=false;
      render();
    }
  }
  function refreshFilter() {
    const sites=Array.from(new Set([...knownSites,...chosen.events.map(e=>e.site)].filter(Boolean)))
      .sort((a,b)=>a.localeCompare(b,'de'));
    const previous=chosen.siteOptions;
    const allWereSelected=!previous.length ||
      (chosen.sites.length===previous.length&&previous.every(site=>chosen.sites.includes(site)));
    chosen.sites=!chosen.siteFilterInitialized||allWereSelected?[...sites]:chosen.sites.filter(site=>sites.includes(site));
    chosen.siteOptions=sites;
    chosen.siteFilterInitialized=true;
  }
  function toggleSite(site) {
    const selected=new Set(chosen.sites);
    if(selected.has(site))selected.delete(site);else selected.add(site);
    chosen.sites=[...selected];
    chosen.entryId=null;chosen.newEntrySlot=null;
    render();
  }
  function renderSiteFilters() {
    const selector=mk('div','ck-site-filter');
    selector.setAttribute('role','group');
    selector.setAttribute('aria-label','Standorte filtern, Mehrfachauswahl möglich');
    const week=chosen.mode==='week';
    if(!week)selector.append(mk('strong','ck-site-filter-heading','Standorte · Mehrfachauswahl'));
    if(!chosen.siteOptions.length)selector.append(mk('span','ck-site-filter-empty','Keine Standorte eingetragen.'));
    for(let start=0;start<chosen.siteOptions.length;start+=7){
      const row=mk('div','ck-site-filter-row '+(week?'is-week':'is-seven'));
      if(week)row.append(mk('span','ck-site-filter-label',start===0?'Standorte':''));
      for(const site of chosen.siteOptions.slice(start,start+7)){
        const selected=chosen.sites.includes(site);
        const choice=btn(site,'ck-site-filter-button',()=>toggleSite(site));
        choice.setAttribute('aria-pressed',String(selected));
        choice.title='Standort '+site+(selected?' abwählen':' auswählen');
        row.append(choice);
      }
      selector.append(row);
    }
    board.append(selector);
  }
  function render() {
    for (const [key,tab] of Object.entries(tabs)) tab.setAttribute('aria-pressed',String(chosen.mode===key));
    const [from,to]=range();
    period.textContent=chosen.mode==='month'?
      dateLabel(from,{month:'long',year:'numeric'}):
      dateLabel(from,{day:'2-digit',month:'short'})+' – '+dateLabel(to,{day:'2-digit',month:'short',year:'numeric'});
    board.replaceChildren();
    renderSiteFilters();
    if (chosen.mode==='week') renderWeek(from);
    if (chosen.mode==='month') renderMonth(from,to);
    if (chosen.mode==='agenda') renderAgenda(from);
    renderDetail();
    legend.replaceChildren();
    const items=[
      ['#e8fadf','Buchung bestätigt · Rand zeigt Standort'],['#ffe7ad','Buchungsanfrage · Rand zeigt Standort'],
      ['#ffb9c0','Sperrzeit'],['#e8f5ff','Eigener Termin']
    ];
    for (const [color,label] of items) {
      const entry=mk('span');const swatch=mk('i');swatch.style.background=color;
      entry.append(swatch,mk('span','',label));legend.append(entry);
    }
  }
  function renderWeek(first) {
    const days=Array.from({length:7},(_,i)=>addDays(first,i));
    const events=days.flatMap(d=>visibleEntries(iso(d)));
    const timed=events.filter(e=>e.start!=null&&e.end!=null);
    const earliest=timed.length?Math.min(...timed.map(e=>e.start)):8*60;
    const latest=timed.length?Math.max(...timed.map(e=>e.end)):18*60;
    const hourStart=Math.max(0,Math.min(8,Math.floor(earliest/60)));
    const hourEnd=Math.min(24,Math.max(18,Math.ceil(latest/60)));
    const hourHeight=64, laneHeight=(hourEnd-hourStart)*hourHeight;
    const grid=mk('div','ck-week-grid');
    grid.append(mk('div','ck-head-space'));
    for (const date of days) {
      const key=iso(date);
      const h=btn(dateLabel(date,{weekday:'short'})+' '+date.getDate()+'.', 'ck-dayhead'+(key===iso(new Date())?' is-today':''),()=>{
        chosen.date=key;chosen.entryId=null;chosen.newEntrySlot=null;renderDetail();
      });
      h.append(mk('span','',dateLabel(date,{month:'short'})));
      grid.append(h);
    }
    grid.append(mk('div','ck-allday-label','Ganztägig'));
    for (const date of days) {
      const cell=mk('div','ck-allday');
      const dayEntries=visibleEntries(iso(date)).filter(e=>e.start==null);
      for(const e of dayEntries) {
        const b=btn(e.title,'ck-allday-item'+(e.type==='sperrzeit'?' is-block':''),()=>selectEntry(e));
        paint(b,e);cell.append(b);
      }
      grid.append(cell);
    }
    const ticks=mk('div','ck-ticks');ticks.style.height=laneHeight+'px';
    for(let h=hourStart;h<=hourEnd;h++){
      const t=mk('span','ck-hour',String(h).padStart(2,'0')+':00');
      t.style.top=((h-hourStart)*hourHeight)+'px';ticks.append(t);
    }
    grid.append(ticks);
    for(const day of days) {
      const key=iso(day);
      const lane=mk('div','ck-daylane'+(key===iso(new Date())?' is-today':''));
      lane.style.height=laneHeight+'px';
      lane.title='In einen freien Zeitabschnitt klicken, um hier einen Eintrag anzulegen';
      lane.addEventListener('click',event=>{
        if(event.target.closest('button'))return;
        const rect=lane.getBoundingClientRect();
        const offset=Math.max(0,Math.min(laneHeight-1,event.clientY-rect.top));
        const minute=Math.max(0,Math.min(23*60,Math.round((hourStart*60+offset/hourHeight*60)/15)*15));
        openNewEntry(key,minute);
      });
      const entries=visibleEntries(key).filter(e=>e.start!=null&&e.end!=null).sort((a,b)=>a.start-b.start||b.end-a.end);
      // Intervalle in zusammenhängenden Überschneidungsgruppen verteilen.
      let groups=[],current=[],finish=-1;
      for (const e of entries) {
        if(current.length&&e.start>=finish){groups.push(current);current=[];finish=-1;}
        current.push(e);finish=Math.max(finish,e.end);
      }
      if(current.length)groups.push(current);
      for (const group of groups) {
        const columns=[];
        for (const e of group) {
          let col=columns.findIndex(end=>end<=e.start);
          if(col<0){col=columns.length;columns.push(e.end);}
          else columns[col]=e.end;
          e._column=col;
        }
        const width=100/Math.max(1,columns.length);
        for (const e of group) {
          const b=btn('', 'ck-event'+(e.type==='sperrzeit'?' is-block':e.type==='termin'?' is-manual':'')+
            (e.id===chosen.entryId?' is-selected':''),()=>selectEntry(e));
          b.style.left='calc('+width*e._column+'% + 2px)';
          b.style.width='calc('+width+'% - 4px)';
          b.style.top=(((e.start-hourStart)/60)*hourHeight+2)+'px';
          b.style.height=Math.max(25,((e.end-e.start)/60)*hourHeight-4)+'px';
          paint(b,e);
          b.append(mk('span','ck-time',prettyTime(e.start)+' – '+prettyTime(e.end)));
          b.append(mk('span','ck-title',e.title));
          if(e.site)b.append(mk('span','ck-site','⌖ '+e.site));
          b.title=e.title+' · '+(e.site||'Standort offen')+' · '+prettyTime(e.start);
          lane.append(b);
        }
      }
      grid.append(lane);
    }
    board.append(grid);
  }
  function renderMonth(from,to) {
    const grid=mk('div','ck-month-grid');
    for (const name of ['Mo','Di','Mi','Do','Fr','Sa','So']) grid.append(mk('div','ck-month-label',name));
    const offset=(from.getDay()+6)%7;
    for(let i=0;i<offset;i++)grid.append(mk('div'));
    for(let d=from;d<=to;d=addDays(d,1)) {
      const key=iso(d),entries=visibleEntries(key);
      const cell=mk('div', 'ck-month-cell'+(key===iso(new Date())?' is-today':'')+(key===chosen.date?' is-selected':''));
      cell.title='Freie Fläche anklicken, um an diesem Tag einen Eintrag anzulegen';
      cell.addEventListener('click',event=>{if(event.target.closest('button'))return;openNewEntry(key);});
      const dayButton=btn(String(d.getDate()),'ck-month-day',()=>{chosen.date=key;chosen.entryId=null;chosen.newEntrySlot=null;render();});
      dayButton.setAttribute('aria-label',dateLabel(d,{day:'numeric',month:'long'}));
      cell.append(dayButton);
      for(const e of entries.slice(0,3)){
        const badge=btn((e.start==null?'':prettyTime(e.start)+' ')+e.title,'ck-mini-event',event=>{
          event.stopPropagation();chosen.date=key;selectEntry(e);
        });
        paint(badge,e);cell.append(badge);
      }
      if(entries.length>3)cell.append(mk('span','', '+'+(entries.length-3)+' weitere'));
      grid.append(cell);
    }
    board.append(grid);
  }
  function renderAgenda(first) {
    const container=mk('div','ck-agenda');
    for(let i=0;i<7;i++){
      const d=addDays(first,i),day=iso(d);
      const wrapper=mk('section','ck-agenda-day');
      wrapper.append(mk('h4','',dateLabel(d,{weekday:'long',day:'numeric',month:'long'})));
      const entries=visibleEntries(day).sort((a,b)=>(a.start??-1)-(b.start??-1));
      if (!entries.length) wrapper.append(mk('p','ck-empty','Keine Termine'));
      for (const e of entries) {
        const item=btn('', '',()=>{chosen.date=day;selectEntry(e);});
        paint(item,e);
        item.append(mk('span','',(e.start==null?'Ganztägig':prettyTime(e.start)+'–'+prettyTime(e.end))+' · '+e.title),
          mk('strong','',e.site|| (e.type==='sperrzeit'?'Sperrzeit':'') ));
        wrapper.append(item);
      }
      container.append(wrapper);
    }
    board.append(container);
  }
  function selectEntry(entry) {
    chosen.date=chosen.date>=entry.date&&chosen.date<=entry.last?chosen.date:entry.date;
    chosen.entryId=entry.id;chosen.newEntrySlot=null;
    render();
  }
  function staffNames(e,statusList) {
    return e.staff.filter(s=>statusList.includes(s.status)).map(s=>s.name).filter(Boolean);
  }
  function renderDetail() {
    detail.replaceChildren();
    const picked=/^\d{4}-\d{2}-\d{2}$/.test(chosen.date)?chosen.date:iso(chosen.cursor);
    const date=fromIso(picked);
    const editing=Boolean(chosen.newEntrySlot);
    body.classList.toggle('ck-has-entry-editor',editing);
    detail.classList.toggle('ck-entry-open',editing);
    if(editing){renderNewEntryForm();return;}
    detail.append(mk('h3','',dateLabel(date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})));
    const all=visibleEntries(picked).sort((a,b)=>(a.start??-1)-(b.start??-1));
    const selected=chosen.entryId?all.filter(e=>e.id===chosen.entryId):all;
    detail.append(mk('div','ck-detail-head',
      all.filter(e=>e.type==='buchung').length+' Buchung(en) · '+all.length+' Einträge insgesamt'));
    if(!selected.length)detail.append(mk('p','ck-detail-empty','Keine Einträge für diesen Tag.'));
    for(const e of selected) {
      const card=mk('article','ck-detail-card');
      paint(card,e);
      card.append(mk('h4','',(e.site?'⌖ '+e.site+' – ':'')+e.title));
      card.append(mk('p','',e.start==null?'Ganztägig':prettyTime(e.start)+' – '+prettyTime(e.end)+' Uhr'+(e.reliable?'':' (Dauer ggf. offen)')));
      if(e.type==='buchung') {
        card.append(mk('p','',e.status==='bestaetigt'?'Status: Bestätigt':'Status: Anfrage'));
        const details=[
          ['Buchungsnummer',e.buchungsnummer],['Kunde',e.name],['E-Mail',e.email],['Telefon',e.telefon],
          ['Teilnehmende',e.teilnehmer],['Nachricht',e.nachricht]
        ];
        for(const [label,value] of details)if(value!==undefined&&value!==null&&String(value).trim())
          card.append(mk('p','',label+': '+value));
        const assigned=staffNames(e,['eingeteilt','bestaetigt','abgeschlossen']);
        const applicants=staffNames(e,['beworben']);
        card.append(mk('p','','Eingeteilt: '+(assigned.join(', ')||'noch niemand')));
        card.append(mk('p','','Bewerbungen: '+(applicants.join(', ')||'keine')));
        const connectionLabels={davor:'Termin davor',danach:'Termin danach',beides:'Termin davor und danach'};
        const connectionStaff=(e.staff||[]).filter(person=>person.status==='bestaetigt'&&connectionLabels[person.anschluss_option]);
        if(connectionStaff.length){
          const info=mk('p','ck-followup-availability','Mitarbeiterbereitschaft für Zusatzangebote: '+
            connectionStaff.map(person=>person.name+' ('+connectionLabels[person.anschluss_option]+')').join(', '));
          card.append(info);
          card.append(btn('Zusatzangebote automatisch vorschlagen','ck-plan-followup',async event=>{
            const button=event.currentTarget;button.disabled=true;stateText.textContent='Zeitfenster werden berechnet und der Verwaltung vorgelegt …';
            try{
              const result=await api('/api/admin/aktionen/vorschlaege',{method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({buchung_id:e.id})});
              stateText.textContent=result.nachricht||'Automatische Vorschläge wurden der Verwaltung vorgelegt.';
              window.dispatchEvent(new CustomEvent('klettern:sonderangebote-aktualisieren'));
              window.adminNavigateToElement?.('special-offers-section');
            }catch(error){stateText.textContent=error.message||'Zusatzangebote konnten nicht vorgeschlagen werden.';button.disabled=false;}
          }));
        }
        const applicantsList=(e.staff||[]).filter(s=>s.status==='beworben');
        if(applicantsList.length){
          const assignment=mk('div','ck-booking-actions');
          const select=mk('select');select.setAttribute('aria-label','Beworbenen Mitarbeiter zuweisen');
          const placeholder=mk('option','','Beworbenen Mitarbeiter auswählen');placeholder.value='';select.append(placeholder);
          for(const person of applicantsList){
            const option=mk('option','',person.name+(person.email?' · '+person.email:''));
            option.value=person.mitarbeiter_id;select.append(option);
          }
          const assign=btn('Mitarbeiter zuweisen','',async()=>{
            if(!select.value)return;
            assign.disabled=true;feedback.textContent='Prüfe Verfügbarkeit und Arbeitszeit …';
            try{
              await api('/api/admin/einsatzplanung/zuweisen/'+encodeURIComponent(e.id)+'/'+encodeURIComponent(select.value),
                {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
              feedback.textContent='Mitarbeiter wurde zugewiesen.';await load();
            }catch(error){feedback.textContent='Zuweisung nicht möglich: '+(error.message||'Fehler');assign.disabled=false;}
          });
          assignment.append(select,assign);card.append(assignment);
        }
        const feedback=mk('p','ck-action-status');feedback.setAttribute('role','status');card.append(feedback);
        const editor=mk('form','ck-booking-editor');
        editor.append(mk('strong','','Anfrage bearbeiten'));
        const editGrid=mk('div','ck-booking-edit-grid');
        const editField=(labelText,name,type,value)=>{
          const label=mk('label','','');
          label.append(mk('span','',labelText));
          const input=mk('input');input.type=type;input.name=name;input.value=value||'';input.required=true;
          label.append(input);editGrid.append(label);return input;
        };
        const editDate=editField('Termin','datum','date',e.date);
        const editTime=editField('Uhrzeit','uhrzeit','time',e.start==null?'':prettyTime(e.start));
        const editDuration=editField('Dauer (Minuten)','dauer','number',e.duration||60);
        editDuration.min='15';editDuration.max='720';editDuration.step='15';
        editor.append(editGrid);
        const editStatus=mk('p','ck-action-status');editStatus.setAttribute('role','status');editor.append(editStatus);
        const saveEdit=btn('Änderungen speichern','',async()=>{
          if(!editor.reportValidity())return;
          saveEdit.disabled=true;editStatus.textContent='Änderungen werden gespeichert …';
          try{
            await api('/api/admin/buchungen/'+encodeURIComponent(e.id),{
              method:'PATCH',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({status:e.status==='bestaetigt'?'bestaetigt':'offen',bearbeitungsnotiz:'',aenderungen:{
                datum:editDate.value,uhrzeit:editTime.value,dauer:Number(editDuration.value)
              }})
            });
            chosen.date=editDate.value;
            chosen.cursor=fromIso(editDate.value);
            if(chosen.mode==='week')chosen.date=iso(startWeek(chosen.cursor));
            editStatus.textContent='Anfrage aktualisiert.';await load();
          }catch(error){editStatus.textContent='Änderungen konnten nicht gespeichert werden: '+(error.message||'Fehler');saveEdit.disabled=false;}
        });
        saveEdit.type='button';editor.append(saveEdit);card.append(editor);
        if(e.status!=='bestaetigt')card.append(btn('Buchung bestätigen','ck-confirm',async()=>{
          if(!window.confirm('Buchung '+(e.buchungsnummer||'')+' für „'+e.title+'“ bestätigen?'))return;
          const confirmButton=card.querySelector('.ck-confirm');confirmButton.disabled=true;feedback.textContent='Buchung wird bestätigt …';
          try{
            await api('/api/admin/buchungen/'+encodeURIComponent(e.id),{
              method:'PATCH',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({status:'bestaetigt',bearbeitungsnotiz:''})
            });
            feedback.textContent='Buchung bestätigt; die bestehende Kundenbenachrichtigung wurde ausgelöst.';await load();
          }catch(error){feedback.textContent='Buchung konnte nicht bestätigt werden: '+(error.message||'Fehler');confirmButton.disabled=false;}
        }));
      } else {
        card.append(mk('p','',e.type==='sperrzeit'?'Sperrzeit':'Eigener Termin'));
        if(e.description)card.append(mk('p','',e.description));
        const repeatBox=mk('div','ck-repeat-box');
        repeatBox.append(mk('strong','',e.type==='sperrzeit'?'Sperrzeit kopieren / wiederholen':'Termin kopieren / wiederholen'));
        const dateLabel=mk('label','','Erster Kopietermin');
        const targetDate=mk('input');targetDate.type='date';targetDate.min=iso(new Date());
        targetDate.value=iso(addDays(fromIso(e.date),1));targetDate.required=true;dateLabel.append(targetDate);
        const ruleLabel=mk('label','','Wiederholung');
        const rule=mk('select');rule.setAttribute('aria-label','Wiederholungsintervall');
        for(const [value,label] of [['einmalig','Einmalig duplizieren'],['woechentlich','Wöchentlich'],['14tage','Alle 14 Tage'],['3wochen','Alle 3 Wochen'],['monatlich','Monatlich'],['2monate','Alle 2 Monate']]){
          const option=mk('option','',label);option.value=value;rule.append(option);
        }
        const countLabel=mk('label','','Anzahl der Kopien');
        const count=mk('input');count.type='number';count.min='2';count.max='52';count.step='1';count.value='4';countLabel.append(count);
        const updateRepeat=()=>{countLabel.hidden=rule.value==='einmalig';count.required=rule.value!=='einmalig';};
        rule.addEventListener('change',updateRepeat);updateRepeat();
        const status=mk('p','ck-action-status');status.setAttribute('role','status');
        const duplicate=btn('Kopie(n) erstellen','',async()=>{
          const total=rule.value==='einmalig'?1:Number(count.value);
          if(!targetDate.value||!/^\d{4}-\d{2}-\d{2}$/.test(targetDate.value)||
             (rule.value!=='einmalig'&&(!Number.isInteger(total)||total<2||total>52))){
            status.textContent='Bitte ein gültiges Startdatum und eine Anzahl zwischen 2 und 52 eingeben.';return;
          }
          const daysBetween=Math.max(0,Math.round((fromIso(e.last)-fromIso(e.date))/86400000));
          const copies=[];let cursor=fromIso(targetDate.value);
          for(let i=0;i<total;i++){
            if(i>0){
              if(rule.value==='woechentlich')cursor=addDays(cursor,7);
              else if(rule.value==='14tage')cursor=addDays(cursor,14);
              else if(rule.value==='3wochen')cursor=addDays(cursor,21);
              else if(rule.value==='monatlich'||rule.value==='2monate'){
                const addMonths=rule.value==='monatlich'?1:2;
                const monthFirst=new Date(cursor.getFullYear(),cursor.getMonth()+addMonths,1,12);
                const lastDay=new Date(monthFirst.getFullYear(),monthFirst.getMonth()+1,0,12).getDate();
                cursor=new Date(monthFirst.getFullYear(),monthFirst.getMonth(),Math.min(cursor.getDate(),lastDay),12);
              }
            }
            const start=iso(cursor);
            copies.push({typ:e.type==='sperrzeit'?'sperrzeit':'termin',titel:e.title,datum:start,
              enddatum:daysBetween?iso(addDays(cursor,daysBetween)):'',
              uhrzeit:e.start==null?'':prettyTime(e.start),endzeit:e.end==null?'':prettyTime(e.end),
              beschreibung:e.description||''});
          }
          duplicate.disabled=true;status.textContent=`Erstelle ${copies.length} Kalendereintrag(e) …`;
          let created=0;const savedEntries=[];
          try{
            for(const copy of copies){const saved=await api('/api/admin/kalender',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(copy)});savedEntries.push({...copy,id:saved.id});created++;}
            showManualEntries(savedEntries);
            status.textContent=created===1?'Kalendereintrag wurde dupliziert.':`${created} wiederkehrende Kalendereinträge wurden erstellt.`;
            await load();
          }catch(error){if(savedEntries.length)showManualEntries(savedEntries);status.textContent=`${created} von ${copies.length} Einträgen gespeichert. Weitere Kopien fehlgeschlagen: ${error.message}`;await load();}
          finally{duplicate.disabled=false;}
        });
        repeatBox.append(dateLabel,ruleLabel,countLabel,duplicate,status);card.append(repeatBox);
      }
      detail.append(card);
    }
    // Ohne tatsächliche Doppelzuweisung ist zeitliche Parallelität kein Konflikt.
    const bookings=all.filter(e=>e.type==='buchung');
    let sharedStaff=[];
    for(let i=0;i<bookings.length;i++)for(let j=i+1;j<bookings.length;j++) {
      const a=bookings[i],b=bookings[j];
      if(!a.reliable||!b.reliable||!overlap(a,b))continue;
      const sa=new Set(a.staff.filter(s=>['eingeteilt','bestaetigt','abgeschlossen'].includes(s.status)).map(s=>s.mitarbeiter_id));
      for (const person of b.staff) if(sa.has(person.mitarbeiter_id)&&['eingeteilt','bestaetigt','abgeschlossen'].includes(person.status))
        sharedStaff.push(person.name);
    }
    sharedStaff=Array.from(new Set(sharedStaff.filter(Boolean)));
    let pairCount=0,sameSiteCount=0,unknownSiteCount=0;
    for(let i=0;i<bookings.length;i++)for(let j=i+1;j<bookings.length;j++){
      if(!overlap(bookings[i],bookings[j]))continue;
      pairCount++;
      if(!bookings[i].site || !bookings[j].site)unknownSiteCount++;
      else if(bookings[i].site===bookings[j].site)sameSiteCount++;
    }
    const note=mk('div','ck-detail-note');
    if(sharedStaff.length){
      note.classList.add('is-warning');
      note.textContent='⚠ Zeitgleiche Mitarbeitereinsätze prüfen: '+sharedStaff.join(', ');
    } else if(sameSiteCount || unknownSiteCount){
      note.classList.add('is-warning');
      note.textContent='⚠ '+pairCount+' parallele Buchungspaar(e). '+
        (sameSiteCount?'Termine am selben Standort: Kapazität prüfen. ':'')+
        (unknownSiteCount?'Bei einigen Buchungen fehlt die Standortzuordnung.':'');
    } else if(pairCount){
      note.textContent='✓ '+pairCount+' zeitgleiche Buchungspaar(e) an verschiedenen Standorten. '+(
        bookings.some(b=>!b.staff.length)?'Personaleinteilung teilweise noch offen.':'Keine doppelt zugewiesenen Mitarbeiter erkannt.');
    } else {
      note.textContent=bookings.length?'Keine zeitlichen Buchungsüberschneidungen erkannt.':'';
    }
    if(note.textContent)detail.append(note);
    const controls=mk('div','ck-actions-bottom');
    controls.append(btn('Mitarbeiter einteilen','',()=>document.getElementById('einsatzplanung-termine')?.scrollIntoView({behavior:'smooth',block:'start'})),
      btn('Sperrzeit eintragen','',()=>openNewEntry(chosen.date,null,'sperrzeit')));
    detail.append(controls);
  }
  // Neu gespeicherte Sperrzeiten zeitnah aktualisieren.
  const ownStatus=document.getElementById('calendar-form-status');
  if(ownStatus){
    const observer=new MutationObserver(()=>{
      if(ownStatus.textContent.includes('erfolgreich gespeichert')&&!workspace.hidden)load();
    });
    observer.observe(ownStatus,{subtree:true,childList:true,characterData:true});
  }
  const observer=new MutationObserver(()=>{
    if(!workspace.hidden){load();} else {chosen.events=[];board.replaceChildren();detail.replaceChildren();}
  });
  observer.observe(workspace,{attributes:true,attributeFilter:['hidden']});
  if(!workspace.hidden)load();
})();
