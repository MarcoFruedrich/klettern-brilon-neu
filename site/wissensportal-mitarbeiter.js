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
  let articles=[],active=null,run=0;
  const isSafety=e=>e.kategorie==='sicherheit'||e.kategorie==='notfall';
  const confirmed=e=>Number(e.bestaetigte_version)===Number(e.version);
  const readText=(value)=>{
    const div=n('div');div.className='wiki-readable-text';
    for(const part of String(value||'').split(/\n{2,}/)){
      const p=n('p',part.trim());if(part.trim())div.append(p);
    }
    return div;
  };
  function select(article){
    active=article.id;content.replaceChildren();
    const heading=n('h3',article.titel),meta=n('p',categories[article.kategorie]||article.kategorie);
    meta.className='wiki-meta';meta.textContent+=' · Version '+article.version+
      ' · '+(article.standorte.length?'Standortbezogen':'Alle Standorte');
    content.append(heading,meta);
    if(article.kurztext)content.append(n('p',article.kurztext));
    content.append(readText(article.inhalt));
    if(article.dokumentUrl){
      const link=n('a','Zugehöriges Dokument öffnen');
      link.href=article.dokumentUrl;link.rel='noopener noreferrer';link.target='_blank';
      content.append(link);
    }
    if(isSafety(article)){
      const box=n('div');box.className='wiki-confirm-panel';
      const message=n('p',confirmed(article)
        ?'✓ Das Lesen dieser Version wurde dokumentiert.'
        :'Bitte die aktuelle Fassung vollständig lesen und anschließend bestätigen.');
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
            select(article);showList();
          }catch(error){state.textContent='Bestätigung fehlgeschlagen: '+error.message;button.disabled=false;}
        });
        box.append(button);
      }
      box.append(n('small','Eine Lesebestätigung ersetzt keine erforderliche praktische Einweisung oder Befähigungsprüfung.'));
      content.append(box);
    }
    showList();
  }
  function visible(){
    const q=search.value.trim().toLocaleLowerCase('de');
    return articles.filter(a=>(!category.value||a.kategorie===category.value)&&
      (!site.value||!a.standorte.length||a.standorte.some(id=>String(id)===site.value))&&
      [a.titel,a.kurztext,a.inhalt,categories[a.kategorie]].join(' ').toLocaleLowerCase('de').includes(q));
  }
  function showList(){
    list.replaceChildren();
    const filtered=visible();
    if(!filtered.length){list.append(n('p','Keine passenden Wissensartikel vorhanden.'));return;}
    for(const article of filtered){
      const button=n('button');button.type='button';
      button.className='wiki-entry'+(active===article.id?' active':'');
      button.append(n('strong',article.titel));
      button.append(n('small',categories[article.kategorie]||article.kategorie));
      if(article.kurztext)button.append(n('span',article.kurztext));
      if(isSafety(article)){
        const label=n('em',confirmed(article)?'✓ Gelesen':'Lesebestätigung offen');button.append(label);
      }
      button.addEventListener('click',()=>select(article));list.append(button);
    }
  }
  function show(){
    showList();
    const selected=articles.find(x=>x.id===active);
    if(!selected){const first=visible()[0];if(first)select(first);
      else content.replaceChildren(n('h3','Keine veröffentlichten Artikel'),n('p','Bitte die Verwaltung um Freigabe der benötigten Informationen.'));
    }
  }
  function filters(){
    const values=Array.from(new Set(articles.flatMap(a=>a.standorte))).sort((a,b)=>a-b);
    const old=site.value;site.replaceChildren();
    const all=n('option','Alle Standorte');all.value='';site.append(all);
    for(const id of values){
      const option=n('option','Standort '+id);option.value=String(id);site.append(option);
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
  document.getElementById('wiki-staff-refresh').addEventListener('click',load);
  const observer=new MutationObserver(()=>{
    if(!workspace.hidden)load();
    else {articles=[];active=null;list.replaceChildren();content.replaceChildren();}
  });
  observer.observe(workspace,{attributes:true,attributeFilter:['hidden']});
  if(!workspace.hidden)load();
})();