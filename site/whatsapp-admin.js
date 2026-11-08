(() => {
  'use strict';
  const root=document.getElementById('whatsapp-angebote-liste');
  const status=document.getElementById('whatsapp-angebote-status');
  const button=document.getElementById('whatsapp-angebote-aktualisieren');
  const section=document.getElementById('whatsapp-admin-section');
  if(!root||!status||!button||!section)return;
  let loaded=false,busy=false;
  function offerLink(title,information,anchor){
    const url=new URL(anchor,location.origin).href;
    const message='Klettern & Abenteuer: '+title+'\n'+information+
      '\nDetails und unverbindliche Terminanfrage: '+url;
    const link=document.createElement('a');
    link.className='whatsapp-share-link';
    link.href='https://api.whatsapp.com/send?text='+encodeURIComponent(message);
    link.target='_blank';
    link.rel='noopener noreferrer';
    link.textContent='Über WhatsApp teilen';
    return link;
  }
  function item(title,information,anchor){
    const card=document.createElement('article');
    const heading=document.createElement('strong');heading.textContent=title;
    const desc=document.createElement('p');desc.textContent=information;
    card.append(heading,desc,offerLink(title,information,anchor));
    root.append(card);
  }
  async function load(){
    if(busy)return;
    busy=true;button.disabled=true;status.textContent='Veröffentlichte Angebote werden geladen …';
    try{
      const [programs,actions]=await Promise.all([
        fetch('/api/angebote',{credentials:'same-origin',cache:'no-store'}),
        fetch('/api/aktionen',{credentials:'same-origin',cache:'no-store'})
      ]);
      if(!programs.ok||!actions.ok)throw Error('Angebotsdaten derzeit nicht verfügbar.');
      const [p,a]=await Promise.all([programs.json(),actions.json()]);
      if(!Array.isArray(p)||!Array.isArray(a))throw Error('Ungültige Angebotsdaten.');
      root.replaceChildren();
      for(const offer of p){
        if(!offer||typeof offer.name!=='string')continue;
        const places=Array.isArray(offer.veranstaltungsorte)?
          offer.veranstaltungsorte.filter(x=>typeof x==='string'):
          [offer.veranstaltungsort].filter(x=>typeof x==='string');
        item(offer.name,(places.length?'Standorte: '+places.join(', '):'Termin auf Anfrage')+
          (offer.beschreibung?' · '+offer.beschreibung:''),'/#angebote');
      }
      for(const action of a){
        if(!action||typeof action.titel!=='string')continue;
        item(action.titel,[action.datum||'Termin auf Anfrage',action.uhrzeit||'',
          action.veranstaltungsort||'',action.beschreibung||''].filter(Boolean).join(' · '),' /#aktionen'.trim());
      }
      if(!root.childElementCount){
        const p=document.createElement('p');p.textContent='Aktuell keine veröffentlichten Angebote vorhanden.';
        root.append(p);
      }
      loaded=true;status.textContent='Angebote geladen. Das Teilen erfolgt erst nach deiner Auswahl in WhatsApp.';
    }catch(error){status.textContent=error.message||'Angebote konnten nicht geladen werden.';}
    finally{busy=false;button.disabled=false;}
  }
  button.addEventListener('click',load);
  const observer=new MutationObserver(()=>{if(!section.hidden&&!loaded)load();});
  observer.observe(section,{attributes:true,attributeFilter:['hidden']});
  if(!section.hidden)load();
})();