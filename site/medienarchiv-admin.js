'use strict';
(() => {
  const grid=document.getElementById('medienarchiv-grid');
  const status=document.getElementById('medienarchiv-status');
  const form=document.getElementById('medienarchiv-upload-form');
  const input=document.getElementById('medienarchiv-upload-input');
  const filter=document.getElementById('medienarchiv-filter');
  let images=[];
  const apiRoot='/api/admin/medienarchiv';
  async function request(method='GET',body=null,type='application/json'){
    const headers={};
    if(method!=='GET'){
      const csrf=await fetch('/api/admin/csrf',{credentials:'same-origin'});
      const token=await csrf.json();
      if(!csrf.ok)throw Error(token.error||'Bitte erneut anmelden.');
      headers['X-CSRF-Token']=token.csrfToken;
      headers['Content-Type']=type;
    }
    const response=await fetch(apiRoot,{method,credentials:'same-origin',headers,body});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'Aktion fehlgeschlagen.');
    return data;
  }
  function node(tag,text,className){
    const element=document.createElement(tag);
    if(text!==undefined)element.textContent=text;
    if(className)element.className=className;
    return element;
  }
  function draw(){
    if(!grid)return;
    grid.replaceChildren();
    const search=(filter?.value||'').toLocaleLowerCase('de');
    const visible=images.filter(i=>(i.name+' '+i.path+' '+i.verwendung.programme.map(p=>p.name).join(' ')).toLocaleLowerCase('de').includes(search));
    if(!visible.length){grid.append(node('p','Keine passenden Bilder gefunden.'));return;}
    for(const img of visible){
      const card=node('article',undefined,'medienarchiv-card');
      const preview=node('img');preview.src=img.url;preview.alt='Vorschau: '+img.name;preview.loading='lazy';
      const title=node('strong',img.name);
      const usages=img.verwendung.programme.map(x=>x.name);
      if(img.verwendung.aktionen.length)usages.push(img.verwendung.aktionen.length+' Sonderaktion(en)');
      card.append(preview,title,node('p',usages.length?'Verwendet in: '+usages.join(', '):'Noch nicht zugeordnet','hint'));
      const actions=node('div',undefined,'medienarchiv-actions');
      const copy=node('button','Bildadresse kopieren','btn secondary');copy.type='button';
      copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(img.url);status.textContent='Bildadresse kopiert.';}catch{status.textContent='Kopieren nicht möglich.';}});
      const rename=node('button','Umbenennen','btn secondary');rename.type='button';
      rename.addEventListener('click',async()=>{
        const current=img.name.replace(/\.(jpe?g|png|webp)$/i,'');
        const next=prompt('Neuer Dateiname (ohne Endung):',current);
        if(next===null)return;
        try{await request('PATCH',JSON.stringify({path:img.path,name:next}));status.textContent='Datei umbenannt. Zugeordnete Programmbilder wurden aktualisiert.';await refresh();}
        catch(error){status.textContent=error.message;}
      });
      const del=node('button','Dauerhaft löschen','btn secondary');del.type='button';
      del.disabled=usages.length>0;
      del.title=del.disabled?'Zuerst alle Programmzuordnungen entfernen.':'Unwiderruflich aus der Bibliothek entfernen';
      del.addEventListener('click',async()=>{
        if(!confirm('Das Bild „'+img.name+'“ dauerhaft aus dem Bildarchiv löschen? Diese Aktion kann nicht rückgängig gemacht werden.'))return;
        try{await request('DELETE',JSON.stringify({path:img.path,confirm:img.path}));status.textContent='Datei dauerhaft gelöscht.';await refresh();}
        catch(error){status.textContent=error.message;}
      });
      actions.append(copy,rename,del);card.append(actions);grid.append(card);
    }
  }
  async function refresh(){
    try{status.textContent='Bildarchiv wird geladen …';images=await request();draw();status.textContent=images.length+' Bilder geladen.';}
    catch(error){status.textContent='Bildarchiv nicht verfügbar: '+error.message;}
  }
  form?.addEventListener('submit',async event=>{
    event.preventDefault();
    const file=input.files?.[0];
    if(!file)return;
    if(file.size>5*1024*1024){status.textContent='Bild zu groß (maximal 5 MB).';return;}
    const button=form.querySelector('button[type=submit]');button.disabled=true;
    try{await request('POST',file,file.type);input.value='';await refresh();status.textContent='Bild hochgeladen und im zentralen Archiv gespeichert.';}
    catch(error){status.textContent='Upload fehlgeschlagen: '+error.message;}
    finally{button.disabled=false;}
  });
  document.getElementById('medienarchiv-refresh')?.addEventListener('click',refresh);
  filter?.addEventListener('input',draw);
  document.querySelector('a[href="#medienarchiv-section"]')?.addEventListener('click',refresh);
  if(location.hash==='#medienarchiv-section')refresh();
})();
