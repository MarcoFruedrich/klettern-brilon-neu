'use strict';
(() => {
  const workspace=document.getElementById('workspace'),form=document.getElementById('wiki-article-form');
  if(!workspace||!form)return;
  const status=document.getElementById('wiki-admin-status'),list=document.getElementById('wiki-admin-list');
  const sites=document.getElementById('wiki-standorte'),search=document.getElementById('wiki-admin-search');
  const categorySelect=form.elements.kategorie,categoryTree=document.getElementById('wiki-category-tree'),
    categoryRootTitle=document.getElementById('wiki-category-root-title'),
    categoryAddRoot=document.getElementById('wiki-category-add-root'),
    categorySave=document.getElementById('wiki-category-save'),
    categoryStatus=document.getElementById('wiki-category-status');
  const refresh=document.getElementById('wiki-admin-refresh');
  const add=document.getElementById('wiki-new'),heading=document.getElementById('wiki-form-heading');
  const mk=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const initialCategories=[
    {id:'allgemein',titel:'Allgemeines',parentId:null},
    {id:'programm',titel:'Programminformationen',parentId:null},
    {id:'standort',titel:'Standortinformationen',parentId:null},
    {id:'sicherheit',titel:'Sicherheitseinweisungen',parentId:null},
    {id:'ablauf',titel:'Arbeitsabläufe',parentId:null},
    {id:'notfall',titel:'Notfall & Erste Hilfe',parentId:null}
  ];
  let articles=[],locations=[],categories=initialCategories.map(x=>({...x})),editing=null,sequence=0;
  const names=()=>Object.fromEntries(categories.map(item=>[item.id,item.titel]));
  const flatten=(parentId=null,depth=0)=>categories.filter(item=>item.parentId===parentId)
    .flatMap(item=>[{...item,depth},...flatten(item.id,depth+1)]);
  function categoryId(){return 'custom-'+(crypto.randomUUID?crypto.randomUUID():(Date.now().toString(16)+'-'+Math.random().toString(16).slice(2)));}
  function renderCategorySelect(){
    const current=categorySelect.value;
    categorySelect.replaceChildren();
    for(const item of flatten()){
      const option=mk('option','　'.repeat(item.depth)+item.titel);option.value=item.id;categorySelect.append(option);
    }
    if(categories.some(item=>item.id===current))categorySelect.value=current;
  }
  function renderCategoryTree(){
    categoryTree.replaceChildren();
    const renderBranch=(item)=>{
      const details=mk('details');details.className='wiki-category-node';
      const summary=mk('summary');summary.textContent=item.titel;details.append(summary);
      const edit=mk('label','Kategoriename');const input=mk('input');input.value=item.titel;input.maxLength=80;input.setAttribute('aria-label','Name der Kategorie '+item.titel);
      input.addEventListener('input',()=>{item.titel=input.value;summary.textContent=input.value||'Neue Kategorie';renderCategorySelect();});
      edit.append(input);details.append(edit);
      const children=categories.filter(child=>child.parentId===item.id);
      for(const child of children)details.append(renderBranch(child));
      const addRow=mk('div');addRow.className='wiki-category-add-child';
      const childInput=mk('input');childInput.maxLength=80;childInput.placeholder='Neuer Unterpunkt';childInput.setAttribute('aria-label','Unterkategorie für '+item.titel);
      const childButton=mk('button','Unterpunkt hinzufügen');childButton.type='button';childButton.className='btn secondary';
      childButton.addEventListener('click',()=>{const titel=childInput.value.trim();if(!titel)return;categories.push({id:categoryId(),titel,parentId:item.id});renderCategoryTree();renderCategorySelect();});
      addRow.append(childInput,childButton);details.append(addRow);
      return details;
    };
    for(const item of categories.filter(category=>!category.parentId))categoryTree.append(renderBranch(item));
  }
  function showCategoryStatus(message,ok=false){categoryStatus.textContent=message;categoryStatus.classList.toggle('success',ok);}
  categoryAddRoot.addEventListener('click',()=>{const titel=categoryRootTitle.value.trim();if(!titel)return;categories.push({id:categoryId(),titel,parentId:null});categoryRootTitle.value='';renderCategoryTree();renderCategorySelect();});
  categorySave.addEventListener('click',async()=>{
    categorySave.disabled=true;showCategoryStatus('Kategorien werden gespeichert …');
    try{
      const data=await api('/api/admin/wissensportal/kategorien',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({kategorien:categories})});
      categories=data.kategorien||categories;renderCategoryTree();renderCategorySelect();
      showCategoryStatus('✓ Kategorien gespeichert. Sie stehen ab sofort im Wissenspool zur Verfügung.',true);
      show();
    }catch(error){showCategoryStatus('Speichern fehlgeschlagen: '+error.message);}
    finally{categorySave.disabled=false;}
  });
  const selected=()=>Array.from(sites.selectedOptions).map(o=>Number(o.value));
  const clear=()=>{editing=null;form.reset();heading.textContent='Neuer Wissensartikel';status.textContent='';};
  add.addEventListener('click',clear);
  function show(){
    const q=search.value.trim().toLocaleLowerCase('de');
    list.replaceChildren();
    const filtered=articles.filter(a=>[a.titel,a.kurztext,a.inhalt,names()[a.kategorie]]
      .join(' ').toLocaleLowerCase('de').includes(q));
    if(!filtered.length)list.append(mk('p','Keine passenden Artikel vorhanden.'));
    for(const a of filtered){
      const card=mk('article');card.className='wiki-admin-item';
      card.append(mk('h4',a.titel));
      card.append(mk('small',(names()[a.kategorie]||a.kategorie)+' · Version '+a.version+
        ' · '+(a.veroeffentlicht?'Veröffentlicht':'Entwurf')+
        ' · '+(a.standorte.length?a.standorte.map(id=>locations.find(x=>String(x.id)===String(id))?.name||id).join(', '):'Alle Standorte')+
        ' · '+(a.anhaenge?.length||0)+' Anhänge'));
      if(a.kurztext)card.append(mk('p',a.kurztext));
      const actions=mk('div');actions.className='wiki-admin-actions';
      const edit=mk('button','Bearbeiten');edit.type='button';edit.className='btn secondary';
      edit.addEventListener('click',()=>{
        editing=a.id;heading.textContent='Artikel bearbeiten: '+a.titel;
        for(const key of ['titel','kategorie','kurztext','inhalt','dokumentUrl','bildUrl'])form.elements[key].value=a[key]||'';
        form.elements.anhaengeText.value=(a.anhaenge||[]).map(link=>link.titel+' | '+link.url).join('\n');
        form.elements.veroeffentlicht.checked=a.veroeffentlicht;
        for(const opt of sites.options)opt.selected=a.standorte.some(id=>String(id)===opt.value);
        form.scrollIntoView({behavior:'smooth',block:'start'});
      });
      const publish=mk('button',a.veroeffentlicht?'Als Entwurf zurückziehen':'Veröffentlichen');
      publish.type='button';publish.className='btn secondary';
      publish.addEventListener('click',async()=>{
        publish.disabled=true;
        try{
          await api('/api/admin/wissensportal/'+a.id,{method:'PUT',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({...a,veroeffentlicht:!a.veroeffentlicht})});
          await load();
        }catch(error){status.textContent='Freigabe fehlgeschlagen: '+error.message;publish.disabled=false;}
      });
      const remove=mk('button','Löschen');remove.type='button';remove.className='btn secondary';
      remove.addEventListener('click',async()=>{
        if(!window.confirm('Artikel „'+a.titel+'“ dauerhaft löschen? Auch bisherige Lesebestätigungen werden entfernt.'))return;
        remove.disabled=true;
        try{
          await api('/api/admin/wissensportal/'+a.id,{method:'DELETE'});
          if(editing===a.id)clear();
          await load();
        }catch(error){status.textContent='Löschen fehlgeschlagen: '+error.message;remove.disabled=false;}
      });
      if(a.kategorie==='sicherheit'||a.kategorie==='notfall'){
        const reports=mk('button','Lesebestätigungen ansehen');reports.type='button';reports.className='btn secondary';
        reports.addEventListener('click',async()=>{
          reports.disabled=true;
          const view=mk('div');view.className='wiki-reading-report';view.textContent='Bestätigungen werden geladen …';
          card.append(view);
          try{
            const data=await api('/api/admin/wissensportal/'+a.id+'/bestaetigungen');
            const persons=data.personen||[];
            view.replaceChildren(mk('strong','Lesestatus (aktuelle Version '+a.version+')'));
            if(!persons.length)view.append(mk('p','Keine zugeordneten aktiven Mitarbeiter vorhanden.'));
            for(const person of persons){
              const ok=Number(person.bestaetigte_version)===Number(a.version);
              view.append(mk('p',(ok?'✓ ':'○ ')+person.name+' – '+(ok?'Aktuelle Version gelesen':'Lesebestätigung offen')));
            }
          }catch(error){view.textContent='Lesestatus konnte nicht geladen werden: '+error.message;}
          finally{reports.disabled=false;}
        });
        actions.append(reports);
      }
      const history=mk('button','Änderungshistorie');history.type='button';history.className='btn secondary';
      history.addEventListener('click',async()=>{
        history.disabled=true;
        const view=mk('div');view.className='wiki-reading-report';view.textContent='Versionsverlauf wird geladen …';card.append(view);
        try{
          const data=await api('/api/admin/wissensportal/'+a.id+'/versionen');
          view.replaceChildren(mk('strong','Aktuelle Fassung: Version '+data.aktuell.version));
          for(const version of data.vorherige||[]){
            const date=new Date(version.erstellt_am).toLocaleString('de-DE');
            view.append(mk('p','Vorherige Fassung '+version.version+' · gespeichert '+date));
          }
        }catch(error){view.textContent='Verlauf konnte nicht geladen werden: '+error.message;}
        finally{history.disabled=false;}
      });
      actions.append(history,edit,publish,remove);card.append(actions);list.append(card);
    }
  }
  search.addEventListener('input',show);
  refresh.addEventListener('click',()=>load());
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=document.getElementById('wiki-save');button.disabled=true;
    status.textContent='Artikel wird gespeichert …';
    const anhaenge=[];
    for(const line of form.elements.anhaengeText.value.split('\n').map(v=>v.trim()).filter(Boolean)){
      const pos=line.indexOf('|');
      if(pos<1||!/^https:\/\//i.test(line.slice(pos+1).trim())){
        status.textContent='Anhänge benötigen je Zeile Titel | https://...';
        button.disabled=false;return;
      }
      anhaenge.push({titel:line.slice(0,pos).trim(),url:line.slice(pos+1).trim()});
    }
    const data={
      titel:form.elements.titel.value,kurztext:form.elements.kurztext.value,
      kategorie:form.elements.kategorie.value,inhalt:form.elements.inhalt.value,
      dokumentUrl:form.elements.dokumentUrl.value,bildUrl:form.elements.bildUrl.value,
      anhaenge,veroeffentlicht:form.elements.veroeffentlicht.checked,standorte:selected()
    };
    try{
      await api('/api/admin/wissensportal'+(editing?'/'+editing:''),{
        method:editing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)
      });
      clear();await load();status.textContent='Artikel gespeichert. Veröffentlichte Inhalte sind im Mitarbeiterbereich sichtbar.';
    }catch(error){status.textContent='Speichern fehlgeschlagen: '+error.message;}
    finally{button.disabled=false;}
  });
  async function load(){
    if(workspace.hidden)return;
    const run=++sequence;
    status.textContent='Wissensartikel werden geladen …';
    try{
      const [items,places]=await Promise.all([
        api('/api/admin/wissensportal'),api('/api/admin/orte')
      ]);
      if(run!==sequence)return;
      categories=Array.isArray(items.kategorien)&&items.kategorien.length?items.kategorien:initialCategories.map(x=>({...x}));
      renderCategoryTree();renderCategorySelect();
      articles=items.artikel||[];
      locations=Array.isArray(places)?places:(places.orte||places.standorte||[]);
      sites.replaceChildren();
      for(const place of locations.filter(x=>x.aktiv!==false)){
        const option=mk('option',place.name);option.value=String(place.id);sites.append(option);
      }
      show();status.textContent='';
    }catch(error){
      if(run!==sequence)return;
      status.textContent='Wissensportal derzeit nicht verfügbar: '+error.message+
        ' (Prüfe die separate Wissensportal-Datenbankmigration.)';
    }
  }
  const observer=new MutationObserver(()=>{if(!workspace.hidden)load();else{articles=[];list.replaceChildren();}});
  observer.observe(workspace,{attributes:true,attributeFilter:['hidden']});
  if(!workspace.hidden)load();
})();