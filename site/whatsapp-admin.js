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
      '\nDas reguläre Buchungsformular auf der Webseite nutzen: '+url+
      '\nPreis, Termin und Verfügbarkeit werden bei der Anfrage geprüft.';
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
          (offer.beschreibung?' · '+offer.beschreibung:''),
          offer.id!=null?'/?programm='+encodeURIComponent(String(offer.id))+'#buchung':'/#buchung');
      }
      for(const action of a){
        if(!action||typeof action.titel!=='string')continue;
        item(action.titel,[action.datum||'Termin auf Anfrage',action.uhrzeit||'',
          action.veranstaltungsort||'',action.beschreibung||''].filter(Boolean).join(' · '),
          action.id!=null?'/?aktion='+encodeURIComponent(String(action.id))+'#buchung':'/#buchung');
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

  // Website-Schalter für WhatsApp und die übrigen öffentlichen Social-Media-Links.
  // Keine Social-Media-API-Zugangsdaten erforderlich; es werden nur öffentliche Profil-Links verwaltet.
  const workspace=document.getElementById('workspace');
  const socialSection=document.getElementById('social-media-section');
  const socialList=document.getElementById('social-link-admin-list');
  const socialStatus=document.getElementById('social-link-admin-status');
  const whatsStatus=document.getElementById('whatsapp-visibility-status');
  const whatsToggle=document.getElementById('whatsapp-visibility-toggle');
  const whatsOpen=section.querySelector('a[href^="https://wa.me/"]');
  let channels=null,loadingSettings=false,savingSettings=false;
  const helpText={
    whatsapp:'Direkter Kundenkontakt über WhatsApp Business',
    instagram:'Öffentlicher Instagram-Profillink',
    facebook:'Öffentliche Facebook-Seite',
    youtube:'Öffentlicher YouTube-Kanal',
    tiktok:'Öffentliches TikTok-Profil',
    x:'Öffentliches X-Profil'
  };

  function showWhatsAppStatus(){
    const whatsapp=channels?.find(item=>item.id==='whatsapp');
    if(!whatsToggle||!whatsStatus)return;
    whatsToggle.disabled=!whatsapp||savingSettings||loadingSettings;
    whatsToggle.textContent=!whatsapp?'Einstellung laden …':whatsapp.aktiv
      ?'WhatsApp-Button deaktivieren':'WhatsApp-Button veröffentlichen';
    whatsToggle.classList.toggle('secondary',Boolean(whatsapp?.aktiv));
    whatsStatus.textContent=!whatsapp?'Noch keine Einstellung geladen.':
      whatsapp.aktiv?'Auf der öffentlichen Webseite sichtbar.':
        'Der WhatsApp-Button und Kontaktlink sind auf der Webseite ausgeblendet.';
    if(whatsOpen&&whatsapp?.url)whatsOpen.href=whatsapp.url;
  }

  async function speichern(id,url,aktiv){
    if(!channels||savingSettings)return;
    savingSettings=true;
    if(socialStatus)socialStatus.textContent='Social-Media-Einstellung wird gespeichert …';
    showWhatsAppStatus();
    try{
      const updated=channels.map(item=>item.id===id?{...item,url,aktiv}:item);
      const result=await api('/api/admin/social-links',{
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({kanäle:updated.map(({id,url,aktiv})=>({id,url,aktiv}))})
      });
      channels=result.kanäle;
      if(socialStatus)socialStatus.textContent='Änderung gespeichert. Die öffentliche Webseite zeigt den neuen Status beim nächsten Laden.';
      socialLinksAnzeigen();
    }catch(error){
      if(socialStatus)socialStatus.textContent='Speichern fehlgeschlagen: '+error.message;
    }finally{savingSettings=false;showWhatsAppStatus();}
  }

  function socialLinksAnzeigen(){
    showWhatsAppStatus();
    if(!socialList||!channels)return;
    socialList.replaceChildren();
    for(const kanal of channels){
      const card=document.createElement('article');
      card.className='social-link-admin-card';
      card.dataset.socialChannel=kanal.id;
      const h=document.createElement('h4');h.textContent=kanal.name;
      const desc=document.createElement('p');
      desc.textContent=helpText[kanal.id]||'Social-Media-Link';
      const state=document.createElement('strong');
      state.className='social-channel-state';
      state.textContent=kanal.aktiv?'Öffentlich sichtbar':'Deaktiviert · auf der Webseite verborgen';
      state.dataset.visible=String(kanal.aktiv);
      const label=document.createElement('label');
      label.textContent='Profil- oder Kontaktlink';
      const input=document.createElement('input');
      input.type='url';input.maxLength=1024;
      input.placeholder='https://…';
      input.value=kanal.url;
      input.autocomplete='url';
      label.append(input);
      const actions=document.createElement('div');actions.className='social-channel-actions';
      const save=document.createElement('button');
      save.type='button';save.className='btn secondary';save.textContent='Link speichern';
      save.addEventListener('click',()=>speichern(kanal.id,input.value.trim(),kanal.aktiv));
      const toggle=document.createElement('button');
      toggle.type='button';toggle.className='btn'+(kanal.aktiv?' secondary':'');
      toggle.textContent=kanal.aktiv?'Deaktivieren':'Veröffentlichen';
      toggle.addEventListener('click',()=>speichern(kanal.id,input.value.trim(),!kanal.aktiv));
      actions.append(save,toggle);
      card.append(h,desc,state,label,actions);
      socialList.append(card);
    }
  }

  async function socialLinksLaden(){
    if(loadingSettings||channels||!workspace||workspace.hidden)return;
    loadingSettings=true;
    showWhatsAppStatus();
    try{
      channels=(await api('/api/admin/social-links')).kanäle;
      if(!Array.isArray(channels))throw Error('Ungültige Social-Media-Einstellungen.');
      socialLinksAnzeigen();
      if(socialStatus)socialStatus.textContent='Kanäle geladen. Änderungen werden dauerhaft gespeichert.';
    }catch(error){
      channels=null;
      if(socialStatus)socialStatus.textContent='Einstellungen konnten nicht geladen werden: '+error.message;
      if(whatsStatus)whatsStatus.textContent='Einstellungen nicht verfügbar. Bitte die Seite später neu laden.';
    }finally{loadingSettings=false;showWhatsAppStatus();}
  }

  whatsToggle?.addEventListener('click',()=>{
    const whatsapp=channels?.find(item=>item.id==='whatsapp');
    if(whatsapp)speichern('whatsapp',whatsapp.url,!whatsapp.aktiv);
  });

  const statusObserver=new MutationObserver(()=>{
    if(!workspace?.hidden && (!section.hidden||!socialSection?.hidden) && !channels){
      socialLinksLaden();
    }
  });
  if(workspace)statusObserver.observe(workspace,{attributes:true,attributeFilter:['hidden']});
  statusObserver.observe(section,{attributes:true,attributeFilter:['hidden']});
  if(socialSection)statusObserver.observe(socialSection,{attributes:true,attributeFilter:['hidden']});
  if(!workspace?.hidden)socialLinksLaden();
})();