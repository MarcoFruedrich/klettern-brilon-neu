'use strict';
(() => {
  const workspace=document.getElementById('staff-portal-workspace');
  const root=document.getElementById('wiki-staff');
  if(!workspace||!root)return;
  const search=document.getElementById('wiki-staff-search'),category=document.getElementById('wiki-staff-category'),
    site=document.getElementById('wiki-staff-site'),list=document.getElementById('wiki-staff-list'),
    content=document.getElementById('wiki-staff-content'),state=document.getElementById('wiki-staff-status');
  const categories={allgemein:'Allgemeines',programm:'Programme',standort:'Standorte',
    sicherheit:'Sicherheitseinweisung',notfall:'Notfall & Erste Hilfe',ablauf:'Arbeitsabläufe'};
  const n=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  let articles=[],sites=[],active=null,run=0;
  const isSafety=e=>e.kategorie==='sicherheit'||e.kategorie==='notfall';
  const confirmed=e=>Number(e.bestaetigte_version)===Number(e.version);
  const readText=(value)=>{
    const div=n('div');div.className='wiki-readable-text';
    for(const part of String(value||'').split(/\n{2,}/)){
      const p=n('p',part.trim());if(part.trim())div.append(p);
    }
    return div;
  };
  const info=document.getElementById('wiki-staff-side'),tabs=document.getElementById('wiki-topic-tabs');
  function links(article){
    const attached=[...(Array.isArray(article.anhaenge)?article.anhaenge:[])];
    if(article.dokumentUrl)attached.unshift({titel:'Zugehöriges Dokument',url:article.dokumentUrl});
    return attached.filter(a=>a&&/^https:\/\//i.test(a.url||''));
  }
  function linkItem(item) {
    const a=n('a','📄 '+item.titel+' ↗');
    a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';
    return a;
  }
  function renderInfo(article){
    if(!info)return;
    info.replaceChildren();
    const meta=n('section');meta.className='wiki-info-card';
    meta.append(n('h4','▤ Artikel-Informationen'));
    const pairs=[
      ['Kategorie',categories[article.kategorie]],
      ['Standort',article.standorte.length?sites.filter(site=>article.standorte.some(id=>String(id)===String(site.id))).map(site=>site.name).join(', ')||'Standortbezogen':'Alle Standorte'],
      ['Version','V'+article.version],
      ['Aktualisiert',article.aktualisiert_am?new Date(article.aktualisiert_am).toLocaleDateString('de-DE'):'–'],
      ['Lesestatus',isSafety(article)?(confirmed(article)?'✓ Aktuell gelesen':'○ Noch offen'):'Nur Information']
    ];
    for(const [key,value] of pairs){
      const row=n('div');row.className='wiki-info-row';
      row.append(n('strong',key),n('span',value));meta.append(row);
    }
    info.append(meta);
    const docs=n('section');docs.className='wiki-info-card';
    docs.append(n('h4','♧ Dokumente & Anhänge'));
    const attachments=links(article);
    if(attachments.length)attachments.forEach(item=>docs.append(linkItem(item)));
    else docs.append(n('p','Für diesen Artikel sind keine Dokumentlinks hinterlegt.'));
    info.append(docs);
    const quick=n('section');quick.className='wiki-info-card';
    quick.append(n('h4','Schnellzugriff'));
    for(const other of articles.filter(x=>x.id!==article.id).slice(0,5)){
      const b=n('button',other.titel);b.type='button';b.className='wiki-quick-link';
      b.addEventListener('click',()=>{search.value='';category.value='';site.value='';select(other);});
      quick.append(b);
    }
    if(articles.length>1)info.append(quick);
  }
  function select(article){
    active=article.id;content.replaceChildren();
    const attachments=links(article);
    const hero=n('div');hero.className='wiki-article-hero'+(!article.bildUrl?' wiki-hero-plain':'');
    if(/^https:\/\//i.test(article.bildUrl||'')){
      const img=n('img');img.src=article.bildUrl;img.alt='Titelbild zum Artikel '+article.titel;
      img.loading='lazy';img.referrerPolicy='no-referrer';hero.append(img);
    }
    const label=n('span',categories[article.kategorie]||article.kategorie);
    label.className='wiki-hero-label';hero.append(label);
    hero.append(n('h3',article.titel));content.append(hero);
    const articleTabs=n('div');articleTabs.className='wiki-article-tabs';
    const textButton=n('button','▤ Artikel'),docsButton=n('button','▣ Anhänge ('+attachments.length+')');
    const versionButton=n('button','◷ Versionsstand');textButton.className='active';
    for(const b of [textButton,docsButton,versionButton]){b.type='button';articleTabs.append(b);}
    content.append(articleTabs);
    const bodyArea=n('div');bodyArea.className='wiki-article-body';
    content.append(bodyArea);
    function activate(which){
      for(const b of [textButton,docsButton,versionButton])b.classList.toggle('active',b===which);
      bodyArea.replaceChildren();
      if(which===textButton){
        if(article.kurztext) {
          bodyArea.append(n('h4','Ziel & Überblick'));
          bodyArea.append(n('p',article.kurztext));
        }
        bodyArea.append(n('h4','Inhalte & Hinweise'));
        bodyArea.append(readText(article.inhalt));
        if(isSafety(article)){
          const box=n('div');box.className='wiki-confirm-panel';
          const message=n('p',confirmed(article)
            ?'✓ Die aktuelle Fassung wurde von dir als gelesen bestätigt.'
            :'Bitte lies die aktuelle Fassung vollständig und bestätige anschließend, dass du sie gelesen hast.');
          box.append(message);
          if(!confirmed(article)){
            const button=n('button','Ich habe die aktuelle Fassung gelesen');
            button.type='button';button.className='btn';
            button.addEventListener('click',async()=>{
              button.disabled=true;state.textContent='Lesebestätigung wird gespeichert …';
              try{
                const saved=await request('/api/wissensportal/'+article.id+'/bestaetigen',{method:'POST'});
                article.bestaetigte_version=saved.version;
                state.textContent='Lesebestätigung für Version '+saved.version+' gespeichert.';
                select(article);
              }catch(error){state.textContent='Bestätigung fehlgeschlagen: '+error.message;button.disabled=false;}
            });
            box.append(button);
          }
          box.append(n('small','Lesebestätigungen ersetzen keine praktische Sicherheitseinweisung oder Befähigungsprüfung.'));
          bodyArea.append(box);
        }
      }else if(which===docsButton){
        bodyArea.append(n('h4','Zugeordnete Dokumente'));
        if(attachments.length)attachments.forEach(item=>bodyArea.append(linkItem(item)));
        else bodyArea.append(n('p','Keine Anhänge hinterlegt.'));
      }else{
        bodyArea.append(n('h4','Änderungsstand'));
        bodyArea.append(n('p','Aktuelle Version: '+article.version));
        if(article.aktualisiert_am)bodyArea.append(n('p','Zuletzt aktualisiert: '+new Date(article.aktualisiert_am).toLocaleString('de-DE')));
        bodyArea.append(n('p','Ältere Fassungen werden durch die Verwaltung archiviert.'));
      }
    }
    textButton.addEventListener('click',()=>activate(textButton));
    docsButton.addEventListener('click',()=>activate(docsButton));
    versionButton.addEventListener('click',()=>activate(versionButton));
    activate(textButton);renderInfo(article);showList();
  }
  function visible(){
    const q=search.value.trim().toLocaleLowerCase('de');
    return articles.filter(a=>(!category.value||a.kategorie===category.value)&&
      (!site.value||!a.standorte.length||a.standorte.some(id=>String(id)===site.value))&&
      [a.titel,a.kurztext,a.inhalt,categories[a.kategorie]].join(' ').toLocaleLowerCase('de').includes(q));
  }
  function showList(){
    list.replaceChildren();
    const title=n('h4','📁 Kategorien');title.className='wiki-nav-title';list.append(title);
    for(const [key,label] of [['','Alle Artikel'],...Object.entries(categories)]){
      const count=articles.filter(a=>!key||a.kategorie===key).length;
      const b=n('button',label+' ('+count+')');
      b.type='button';b.className='wiki-category-entry'+(category.value===key?' active':'');
      b.addEventListener('click',()=>{category.value=key;show();});
      list.append(b);
    }
    list.append(n('h4','📖 Wissensartikel'));
    const filtered=visible();
    if(!filtered.length){list.append(n('p','Keine passenden Wissensartikel vorhanden.'));return;}
    for(const article of filtered){
      const button=n('button');button.type='button';
      button.className='wiki-entry'+(active===article.id?' active':'');
      button.append(n('strong',article.titel));
      button.append(n('small',categories[article.kategorie]||article.kategorie));
      if(article.kurztext)button.append(n('span',article.kurztext));
      if(isSafety(article))button.append(n('em',confirmed(article)?'✓ Gelesen':'Lesebestätigung offen'));
      button.addEventListener('click',()=>select(article));list.append(button);
    }
    if(tabs)for(const b of tabs.querySelectorAll('[data-category]'))b.classList.toggle('active',b.dataset.category===category.value);
  }
  function show(){
    showList();
    const selected=visible().find(x=>x.id===active);
    if(!selected){active=null;const first=visible()[0];if(first)select(first);
      else content.replaceChildren(n('h3','Keine passenden Artikel'),n('p','Bitte Suche oder Filter ändern beziehungsweise die Verwaltung um Freigabe bitten.'));
    }
  }
  function filters(){
    const values=sites.filter(place=>articles.some(a=>a.standorte.some(id=>String(id)===String(place.id))));
    const old=site.value;site.replaceChildren();
    const all=n('option','Alle Standorte');all.value='';site.append(all);
    for(const place of values){
      const option=n('option',place.name);option.value=String(place.id);site.append(option);
    }
    if([...site.options].some(x=>x.value===old))site.value=old;
  }
  async function load(){
    if(workspace.hidden)return;
    const seq=++run;
    state.textContent='Wissensartikel werden geladen …';
    try{
      const data=await request('/api/wissensportal');
      if(seq!==run||workspace.hidden)return;
      articles=Array.isArray(data.artikel)?data.artikel:[];
      sites=Array.isArray(data.standorte)?data.standorte:[];
      const previous=active;active=articles.some(x=>x.id===previous)?previous:null;
      filters();show();
      if(active)select(articles.find(x=>x.id===active));
      state.textContent=articles.length?articles.length+' veröffentlichte Artikel verfügbar.':'Noch keine Wissensartikel freigegeben.';
    }catch(error){
      if(seq!==run)return;
      state.textContent='Wissensportal derzeit nicht verfügbar: '+error.message;
    }
  }
  for(const input of [search,category,site])input.addEventListener(input===search?'input':'change',show);
  if(tabs)for(const b of tabs.querySelectorAll('[data-category]')){
    b.addEventListener('click',()=>{category.value=b.dataset.category;show();});
  }
  document.getElementById('wiki-staff-refresh').addEventListener('click',load);
  const observer=new MutationObserver(()=>{
    if(!workspace.hidden)load();
    else {articles=[];active=null;list.replaceChildren();content.replaceChildren();}
  });
  observer.observe(workspace,{attributes:true,attributeFilter:['hidden']});
  if(!workspace.hidden)load();
})();