(() => {
  'use strict';
  const root=document.getElementById('website-effekte-form');
  const list=document.getElementById('website-effekte-liste');
  const selection=document.getElementById('website-effekte-auswahl');
  const enabled=document.getElementById('website-effekte-aktiv');
  const notice=document.getElementById('website-effekte-status');
  const workspace=document.getElementById('workspace');
  if(!root||!list||!selection||!enabled||!notice||!workspace)return;
  let loaded=false,entries=[];
  const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const field=(name,label,value,type='text')=>{
    const container=el('label',label),input=document.createElement('input');
    input.type=type;input.dataset.name=name;input.value=value;
    if(type==='number'){input.min=name==='anzahl'?'1':'8';input.max=name==='anzahl'?'20':'90';input.step='1';}
    input.required=true;container.append(input);return container;
  };
  function collect(){
    entries=Array.from(list.querySelectorAll('[data-effekt-id]')).map(article=>{
      const val=name=>article.querySelector('[data-name="'+name+'"]')?.value||'';
      return {id:article.dataset.effektId,name:val('name'),symbol:val('symbol'),
        anzahl:Number(val('anzahl')),dauerSekunden:Number(val('dauerSekunden'))};
    });
  }
  function render(){
    const prev=selection.value;
    list.replaceChildren();selection.replaceChildren();
    const none=el('option','Kein Effekt');none.value='';selection.append(none);
    for(const effect of entries){
      const option=el('option',effect.name||effect.id);option.value=effect.id;selection.append(option);
      const card=el('article');card.className='booking';card.dataset.effektId=effect.id;
      const title=el('strong',effect.name||'Neuer Effekt');card.append(title);
      card.append(field('name','Name des Effekts',effect.name));
      card.append(field('symbol','Symbol oder Emoji',effect.symbol));
      card.append(field('anzahl','Anzahl gleichzeitig (1 bis 20)',effect.anzahl,'number'));
      card.append(field('dauerSekunden','Fallzeit in Sekunden (8 bis 90)',effect.dauerSekunden,'number'));
      const del=el('button','Effekt entfernen');del.type='button';del.className='btn secondary';
      del.onclick=()=>{collect();entries=entries.filter(x=>x.id!==effect.id);render();};
      card.append(del);list.append(card);
    }
    selection.value=entries.some(x=>x.id===prev)?prev:'';
  }
  async function load(){
    if(loaded||workspace.hidden)return;
    notice.textContent='Effekte werden geladen …';
    try{
      const response=await api('/api/admin/website-effekte');
      entries=Array.isArray(response.eintraege)?response.eintraege:[];
      render();selection.value=response.aktiveId||'';enabled.checked=response.aktiv===true;
      loaded=true;notice.textContent='Aktuelle Einstellungen geladen.';
    }catch(error){notice.textContent='Effekt-Einstellungen nicht verfügbar: '+error.message;}
  }
  root.addEventListener('submit',async event=>{
    event.preventDefault();collect();
    const button=document.getElementById('website-effekte-speichern');
    button.disabled=true;notice.textContent='Speichere Einstellungen …';
    try{
      await api('/api/admin/website-effekte',{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({aktiv:enabled.checked,aktiveId:selection.value||null,eintraege:entries})});
      notice.textContent='Effekte gespeichert. Auf der Startseite werden sie nach dem Neuladen angezeigt.';
      render();
    }catch(error){notice.textContent='Speichern fehlgeschlagen: '+error.message;}
    finally{button.disabled=false;}
  });
  document.getElementById('website-effekte-neu')?.addEventListener('click',()=>{
    collect();
    if(entries.length>=30){notice.textContent='Es können höchstens 30 Effekte gespeichert werden.';return;}
    const id='neu-'+Date.now().toString(36)+'-'+Math.floor(Math.random()*1e6).toString(36);
    entries.push({id,name:'Neuer Effekt',symbol:'🍁',anzahl:5,dauerSekunden:22});
    const active=selection.value;render();selection.value=active;
  });
  const observer=new MutationObserver(()=>{if(!workspace.hidden){observer.disconnect();load();}});
  observer.observe(workspace,{attributes:true,attributeFilter:['hidden']});
  if(!workspace.hidden)load();
})();