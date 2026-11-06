
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
      : siteColor(entry.site);
    node.style.setProperty('--ck-strong', c.strong);
    node.style.setProperty('--ck-line', c.line);
    node.style.setProperty('--ck-pale', c.pale);
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
  const chosen = {mode:'week',cursor:midday(new Date()),date:iso(new Date()),entryId:null,site:'',events:[],staffComplete:false};
  let loadSequence = 0;
  const tabs = {};
  for (const [key,label] of [['week','Woche'],['month','Monat'],['agenda','Agenda']]) {
    tabs[key] = btn(label, '', () => {
      chosen.cursor = fromIso(chosen.date);
      chosen.mode = key; chosen.entryId = null; load();
    });
    tabs[key].setAttribute('aria-pressed', key === chosen.mode ? 'true' : 'false');
    switcher.append(tabs[key]);
  }
  const prev = btn('‹', '', () => move(-1)); prev.setAttribute('aria-label','Vorheriger Zeitraum');
  const period = mk('strong', 'ck-period');
  const next = btn('›', '', () => move(1)); next.setAttribute('aria-label','Nächster Zeitraum');
  nav.append(prev,period,next);
  const today = btn('Heute','', () => {
    chosen.cursor = midday(new Date()); chosen.date = iso(chosen.cursor); chosen.entryId=null; load();
  });
  const filterLabel = mk('label','ck-filter');
  filterLabel.append(mk('span','Standort'));
  const filter = mk('select');
  filter.setAttribute('aria-label','Standort filtern');
  filter.addEventListener('change', () => {chosen.site=filter.value;chosen.entryId=null;render();});
  filterLabel.append(filter);
  const newEntry = btn('+ Neuer Eintrag','ck-new',() => jumpToForm());
  actions.append(filterLabel,today,newEntry);
  toolbar.append(switcher,nav,actions);
  body.append(board,detail);
  root.append(toolbar,stateText,body,legend);
  section.insertBefore(root, section.querySelector('.booking'));
  document.body.classList.add('ck-enabled');

  function jumpToForm(type) {
    if (typeof window.adminNavigateToElement === 'function') window.adminNavigateToElement('calendar-form');
    const form = document.getElementById('calendar-form');
    if (!form) return;
    if (type) form.elements.typ.value = type;
    form.scrollIntoView({block:'center',behavior:'smooth'});
    const title = form.elements.titel;
    if (title) title.focus({preventScroll:true});
  }
  function move(dir) {
    const d = chosen.cursor;
    chosen.cursor = chosen.mode === 'month'
      ? new Date(d.getFullYear(),d.getMonth()+dir,1,12)
      : addDays(d,dir*7);
    chosen.date = iso(chosen.mode === 'month' ? chosen.cursor : startWeek(chosen.cursor));
    chosen.entryId=null;
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
    return chosen.events.filter(e => e.date <= day && day <= e.last &&
      (!chosen.site || e.site === chosen.site || e.type !== 'buchung'));
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
        title:b.angebot||'Programm',site:b.ort||'',status:b.status||'offen',
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
  async function load() {
    if (workspace.hidden) return;
    const seq=++loadSequence;
    stateText.textContent='Kalender wird geladen …';
    const [from,to] = range();
    const months = new Set();
    for (let d=from;d<=to;d=addDays(d,1)) months.add(iso(d).slice(0,7));
    try {
      const monthList=Array.from(months);
      const [plans,bookingLists,own] = await Promise.all([
        Promise.all(monthList.map(month=>api('/api/admin/einsatzplanung/kalender?monat='+encodeURIComponent(month)))),
        Promise.all(monthList.map(month=>api('/api/admin/kalenderbuchungen?monat='+encodeURIComponent(month)))),
        api('/api/admin/kalender')
      ]);
      if (seq!==loadSequence || workspace.hidden) return;
      const bookings = [];
      for (let i=0;i<plans.length;i++) {
        const plan=plans[i];
        const staffing=bookingStaff(plan);
        const details=new Map((bookingLists[i]||[]).map(row=>[String(row.id),row]));
        for (const b of plan.buchungen || []) {
          const row=details.get(String(b.id));
          bookings.push({...b,...(row?.data||{}),id:b.id,status:row?.status||b.status,
            staff:staffing.get(b.id)||[]});
        }
      }
      chosen.events=normalize(bookings,Array.isArray(own)?own:[]);
      chosen.staffComplete=true;
      stateText.textContent='';
      refreshFilter();
      render();
    } catch (e) {
      if (seq!==loadSequence) return;
      stateText.textContent='Kalender konnte nicht geladen werden: '+(e.message||'Unbekannter Fehler');
      chosen.events=[];
      chosen.staffComplete=false;
      render();
    }
  }
  function refreshFilter() {
    const sites=Array.from(new Set(chosen.events.map(e=>e.site).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'de'));
    if (chosen.site&&!sites.includes(chosen.site)) chosen.site='';
    filter.replaceChildren();
    const all=mk('option','', 'Alle Standorte');all.value='';filter.append(all);
    for (const site of sites) {
      const opt=mk('option','',site);opt.value=site;filter.append(opt);
    }
    filter.value=chosen.site;
  }
  function render() {
    for (const [key,tab] of Object.entries(tabs)) tab.setAttribute('aria-pressed',String(chosen.mode===key));
    const [from,to]=range();
    period.textContent=chosen.mode==='month'?
      dateLabel(from,{month:'long',year:'numeric'}):
      dateLabel(from,{day:'2-digit',month:'short'})+' – '+dateLabel(to,{day:'2-digit',month:'short',year:'numeric'});
    board.replaceChildren();
    if (chosen.mode==='week') renderWeek(from);
    if (chosen.mode==='month') renderMonth(from,to);
    if (chosen.mode==='agenda') renderAgenda(from);
    renderDetail();
    legend.replaceChildren();
    const items=[
      ['#b9e1ff','Buchung (Standortfarbe)'],['#e8fadf','Bestätigt (Status im Detail)'],
      ['#ffe0a6','Anfrage (Status im Detail)'],['#ffb9c0','Sperrzeit'],
      ['#e8f5ff','Eigener Termin']
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
        chosen.date=key;chosen.entryId=null;renderDetail();
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
      const dayButton=btn(String(d.getDate()),'ck-month-day',()=>{chosen.date=key;chosen.entryId=null;render();});
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
    chosen.entryId=entry.id;
    render();
  }
  function staffNames(e,statusList) {
    return e.staff.filter(s=>statusList.includes(s.status)).map(s=>s.name).filter(Boolean);
  }
  function renderDetail() {
    detail.replaceChildren();
    const picked=/^\d{4}-\d{2}-\d{2}$/.test(chosen.date)?chosen.date:iso(chosen.cursor);
    const date=fromIso(picked);
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
          let created=0;
          try{
            for(const copy of copies){await api('/api/admin/kalender',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(copy)});created++;}
            status.textContent=created===1?'Kalendereintrag wurde dupliziert.':`${created} wiederkehrende Kalendereinträge wurden erstellt.`;
            await load();
          }catch(error){status.textContent=`${created} von ${copies.length} Einträgen gespeichert. Weitere Kopien fehlgeschlagen: ${error.message}`;await load();}
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
      btn('Sperrzeit eintragen','',()=>jumpToForm('sperrzeit')));
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
