(() => {
  'use strict';

  const input=document.getElementById('medienpool-datei');
  const upload=document.getElementById('medienpool-hochladen');
  const reload=document.getElementById('medienpool-neuladen');
  const list=document.getElementById('medienpool-bilder');
  const status=document.getElementById('medienpool-status');
  const workspace=document.getElementById('workspace');
  if(!input||!upload||!reload||!list||!status||!workspace)return;

  const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  let loadedImages=[];

  async function fetchImages(){
    const result=await window.api('/api/admin/medien');
    loadedImages=Array.isArray(result.bilder)?result.bilder:[];
    renderImages();
    return loadedImages;
  }

  function renderImages(){
    list.replaceChildren();
    if(!loadedImages.length){
      const empty=el('p','Noch keine Bilder gespeichert. Lade ein Bild hoch oder nutze ein vorhandenes Programmbild.');
      empty.className='hint';
      list.append(empty);
      return;
    }
    for(const image of loadedImages){
      const card=el('article');
      card.className='booking';
      const preview=document.createElement('img');
      preview.src=image.url;
      preview.alt=image.name||'Gespeichertes Bild';
      preview.loading='lazy';
      preview.style.width='100%';
      preview.style.maxWidth='280px';
      preview.style.aspectRatio='4 / 3';
      preview.style.objectFit='cover';
      preview.style.borderRadius='8px';
      const title=el('strong',image.name||'Gespeichertes Bild');
      const open=el('a','Bild in neuem Tab ansehen');
      open.href=image.url;
      open.target='_blank';
      open.rel='noopener noreferrer';
      card.append(preview,title,open);
      list.append(card);
    }
  }

  async function loadPool(){
    if(workspace.hidden)return;
    status.textContent='Bilder werden geladen …';
    try{
      await fetchImages();
      status.textContent=loadedImages.length
        ? loadedImages.length+' gespeicherte Bilder verfügbar.'
        : 'Noch keine Bilder gespeichert.';
    }catch(error){
      status.textContent='Medienbibliothek konnte nicht geladen werden: '+error.message;
    }
  }

  reload.addEventListener('click',loadPool);
  upload.addEventListener('click',async()=>{
    const file=input.files?.[0];
    if(!file){status.textContent='Bitte zuerst eine Bilddatei auswählen.';return;}
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
      status.textContent='Erlaubt sind JPG/JPEG, PNG und WebP.';
      return;
    }
    if(file.size>5*1024*1024){
      status.textContent='Das Bild darf maximal 5 MB groß sein.';
      return;
    }
    upload.disabled=true;
    status.textContent='Bild wird sicher geprüft und dauerhaft gespeichert …';
    try{
      await window.api('/api/admin/medien',{
        method:'POST',
        headers:{'Content-Type':file.type,'X-Original-Filename':file.name},
        body:file
      });
      input.value='';
      await fetchImages();
      status.textContent='Bild gespeichert und steht ab sofort zur Auswahl.';
    }catch(error){
      status.textContent='Bild konnte nicht gespeichert werden: '+error.message;
    }finally{
      upload.disabled=false;
    }
  });

  window.medienpoolBildAuswaehlen=async function(onSelect){
    if(typeof onSelect!=='function')throw new Error('Es wurde keine Bildauswahl hinterlegt.');
    const images=await fetchImages();
    const dialog=document.createElement('dialog');
    dialog.setAttribute('aria-labelledby','medienpool-picker-heading');
    dialog.style.width='min(900px,92vw)';
    dialog.style.maxHeight='85vh';
    dialog.style.overflow='auto';
    dialog.style.border='1px solid #c8ded1';
    dialog.style.borderRadius='14px';
    dialog.style.padding='24px';
    dialog.style.color='#173f34';
    const heading=el('h2','Bild aus der Medienbibliothek wählen');
    heading.id='medienpool-picker-heading';
    const help=el('p','Wähle ein bereits gespeichertes Bild aus. Es wird direkt dem Programm zugeordnet.');
    const pickerStatus=el('p');
    pickerStatus.setAttribute('role','status');
    pickerStatus.setAttribute('aria-live','polite');
    const close=el('button','Schließen');
    close.type='button';
    close.className='btn secondary';
    close.addEventListener('click',()=>dialog.close());
    const cards=el('div');
    cards.className='admin-grid';
    if(!images.length){
      const empty=el('p','In der Medienbibliothek sind noch keine Bilder vorhanden.');
      cards.append(empty);
    }
    for(const image of images){
      const card=el('article');
      card.className='booking';
      const preview=document.createElement('img');
      preview.src=image.url;
      preview.alt=image.name||'Gespeichertes Bild';
      preview.loading='lazy';
      preview.style.width='100%';
      preview.style.maxWidth='260px';
      preview.style.aspectRatio='4 / 3';
      preview.style.objectFit='cover';
      preview.style.borderRadius='8px';
      const title=el('strong',image.name||'Gespeichertes Bild');
      const choose=el('button','Für dieses Programm verwenden');
      choose.type='button';
      choose.className='btn';
      choose.addEventListener('click',async()=>{
        choose.disabled=true;
        pickerStatus.textContent='Bild wird dem Programm zugeordnet …';
        try{
          await onSelect(image.url);
          dialog.close();
        }catch(error){
          pickerStatus.textContent='Zuordnung fehlgeschlagen: '+error.message;
          choose.disabled=false;
        }
      });
      card.append(preview,title,choose);
      cards.append(card);
    }
    dialog.append(heading,help,pickerStatus,cards,close);
    document.body.append(dialog);
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    dialog.showModal();
    return new Promise(resolve=>{
      dialog.addEventListener('close',()=>resolve(true),{once:true});
    });
  };

  const observer=new MutationObserver(()=>{
    if(!workspace.hidden){observer.disconnect();loadPool();}
  });
  observer.observe(workspace,{attributes:true,attributeFilter:['hidden']});
  if(!workspace.hidden)loadPool();
})();