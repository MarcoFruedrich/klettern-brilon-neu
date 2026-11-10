'use strict';
(() => {
  const container=document.getElementById('besuchergruppen-admin-liste');
  const status=document.getElementById('besuchergruppen-admin-status');
  if(!container||!status)return;
  let gruppen=[],programme=[],geladen=false;
  const newButton=document.getElementById('besuchergruppen-admin-neue-gruppe');
  const node=(tag,txt='',className='')=>{
    const el=document.createElement(tag);if(txt)el.textContent=txt;if(className)el.className=className;return el;
  };
  const field=(label,control)=>{
    const wrap=node('label');wrap.append(node('span',label),control);return wrap;
  };
  const input=(value,max=120)=>{
    const el=document.createElement('input');el.value=value||'';el.maxLength=max;return el;
  };
  const write=async()=>{
    status.textContent='Änderungen werden gespeichert …';
    try{
      const result=await api('/api/admin/besuchergruppen',{method:'PUT',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({gruppen})});
      gruppen=result.gruppen;status.textContent='Besuchergruppen gespeichert und sofort für die Webseite übernommen.';
      render();document.dispatchEvent(new CustomEvent('besuchergruppenaktualisiert'));
    }catch(e){status.textContent='Speichern fehlgeschlagen: '+e.message;}
  };
  function render(){
    container.replaceChildren();
    gruppen.forEach((g,i)=>{
      const card=node('article','','besuchergruppen-admin-karte');
      const head=node('div','','besuchergruppen-admin-head');
      head.append(node('h3',g.icon+' '+g.titel));
      const controls=node('div','','besuchergruppen-admin-reorder');
      for(const [symbol,delta] of [['↑',-1],['↓',1]]){
        const b=node('button',symbol,'btn secondary');b.type='button';
        b.title=delta<0?'Nach oben verschieben':'Nach unten verschieben';
        b.disabled=i+delta<0||i+delta>=gruppen.length;
        b.addEventListener('click',()=>{const [moved]=gruppen.splice(i,1);gruppen.splice(i+delta,0,moved);render();});
        controls.append(b);
      }
      const remove=node('button','Gruppe entfernen','btn secondary');remove.type='button';
      remove.addEventListener('click',()=>{
        if(!confirm('Diese Gruppe aus der Verwaltung entfernen? Die Änderung wird erst nach dem Speichern übernommen.'))return;
        gruppen=gruppen.filter(item=>item.id!==g.id);render();
      });
      controls.append(remove);
      head.append(controls);card.append(head);
      const textName=input(g.titel,55);
      textName.addEventListener('input',()=>g.titel=textName.value);
      card.append(field('Titel',textName));
      const iconInput=input(g.icon,16);
      iconInput.addEventListener('input',()=>{g.icon=iconInput.value;head.querySelector('h3').textContent=(g.icon||'✨')+' '+g.titel;});
      card.append(field('Kleines Symbol (Emoji)',iconInput));
      const iconPreview=node('img','','besuchergruppen-admin-icon-vorschau');
      iconPreview.alt='GIF-Icon für '+g.titel;
      iconPreview.src=g.iconBild||'';
      iconPreview.hidden=!g.iconBild;
      const iconChoose=node('button','GIF oder Bild aus Medienbibliothek wählen','btn secondary');iconChoose.type='button';
      iconChoose.addEventListener('click',async()=>{
        if(typeof window.medienpoolBildAuswaehlen!=='function'){status.textContent='Die Medienbibliothek wird noch geladen.';return;}
        try{
          await window.medienpoolBildAuswaehlen(async url=>{
            g.iconBild=url;iconPreview.src=url;iconPreview.hidden=false;
          });
        }catch(error){status.textContent='Icon-Auswahl fehlgeschlagen: '+error.message;}
      });
      const iconClear=node('button','GIF-Icon entfernen','btn secondary');iconClear.type='button';
      iconClear.addEventListener('click',()=>{g.iconBild='';iconPreview.removeAttribute('src');iconPreview.hidden=true;});
      const iconTools=node('div','','besuchergruppen-admin-icon-tools');iconTools.append(iconChoose,iconClear);
      card.append(field('Zentrales GIF-/Bild-Icon',iconTools),iconPreview);
      const description=node('textarea');description.value=g.beschreibung;description.rows=3;description.maxLength=350;
      description.addEventListener('input',()=>g.beschreibung=description.value);
      card.append(field('Kurzbeschreibung',description));
      const benefits=node('textarea');benefits.value=(g.punkte||[]).join('\n');benefits.rows=3;
      benefits.addEventListener('input',()=>g.punkte=benefits.value.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,3));
      card.append(field('Vorteile (max. 3 Zeilen)',benefits));

      const bildSelect=node('select');
      const defaults=node('option','Aktuelles Bild beibehalten');defaults.value='';
      bildSelect.append(defaults);
      for(const p of programme.filter(item=>item.bild_url)){
        const o=node('option','Bild aus Programm: '+p.name);o.value=p.bild_url;
        bildSelect.append(o);
      }
      const bildField=input(g.bild,900);
      bildField.placeholder='Foto aus Programm oder vorhandene Bildadresse';
      const preview=node('img','','besuchergruppen-admin-vorschau');
      preview.src=g.bild;preview.alt='Vorschau für '+g.titel;preview.loading='lazy';
      bildSelect.addEventListener('change',()=>{
        if(!bildSelect.value)return;
        bildField.value=bildSelect.value;g.bild=bildSelect.value;preview.src=g.bild;
      });
      bildField.addEventListener('change',()=>{g.bild=bildField.value;preview.src=g.bild;});
      card.append(field('Bild aus bereits hochgeladenem Programm auswählen',bildSelect),field('Bildadresse',bildField),preview);

      const checkGroup=node('fieldset','','besuchergruppen-admin-zuordnung');
      checkGroup.append(node('legend','Passende Programme auswählen (Mehrfachauswahl)'));
      const list=node('div','','besuchergruppen-admin-checkboxen');
      const available=programme.filter(p=>!p.archiviert);
      if(!available.length)list.append(node('p','Noch keine Programme in der Verwaltung vorhanden.'));
      available.forEach(p=>{
        const checkbox=document.createElement('input');checkbox.type='checkbox';
        checkbox.checked=g.programmIds.includes(Number(p.id));
        checkbox.addEventListener('change',()=>{
          const id=Number(p.id);
          g.programmIds=checkbox.checked?[...new Set([...g.programmIds,id])]:g.programmIds.filter(n=>n!==id);
        });
        const label=node('label');label.append(checkbox,node('span',p.name+(p.aktiv&&p.buchbar&&p.veroeffentlicht?'':' (aktuell nicht öffentlich)')));
        list.append(label);
      });
      checkGroup.append(list);
      checkGroup.append(node('small','Ohne manuelle Zuordnung werden passende Programme anhand von Name und Zielgruppentext gesucht.'));
      card.append(checkGroup);
      const visible=document.createElement('input');visible.type='checkbox';visible.checked=g.aktiv;
      visible.addEventListener('change',()=>g.aktiv=visible.checked);
      const visibleLabel=node('label','','besuchergruppen-admin-sichtbar');
      visibleLabel.append(visible,node('span','Auf der Webseite anzeigen'));
      card.append(visibleLabel);
      container.append(card);
    });
  }
  window.besuchergruppenAdminLaden=async()=>{
    if(geladen)return;
    try{
      const [g,p]=await Promise.all([api('/api/admin/besuchergruppen'),api('/api/admin/angebote')]);
      gruppen=g;programme=p;geladen=true;status.textContent='Änderungen an Texten, Bildern oder Programmen unten speichern.';
      render();
    }catch(e){status.textContent='Besuchergruppen konnten nicht geladen werden: '+e.message;}
  };
  newButton?.addEventListener('click',()=>{
    if(gruppen.length>=30){status.textContent='Es können höchstens 30 Gruppen angelegt werden.';return;}
    const id='gruppe-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
    gruppen.push({id,titel:'Neue Gruppe',icon:'✨',iconBild:'',farbe:'#258451',beschreibung:'',
      punkte:[],bild:'/fotos/halle.jpg',programmIds:[],aktiv:true});
    render();
    container.lastElementChild?.scrollIntoView({behavior:'smooth',block:'center'});
  });
    document.getElementById('besuchergruppen-admin-speichern')?.addEventListener('click',write);
  document.getElementById('besuchergruppen-admin-neuladen')?.addEventListener('click',()=>{
    geladen=false;window.besuchergruppenAdminLaden();
  });
})();