(() => {
  'use strict';
  const contacts=document.getElementById('social-contact-links');
  if(!contacts)return;
  const allowed=new Set(['whatsapp','instagram','facebook','youtube','tiktok','x']);
  const display={whatsapp:'WhatsApp für Fragen',instagram:'Instagram',facebook:'Facebook',youtube:'YouTube',tiktok:'TikTok',x:'X / Twitter'};
  async function aktualisieren(){
    // Die Seite enthält keine festen Social-Media-Links: nichts erscheint bis zur
    // erfolgreichen Freigabe aus der serverseitigen Website-Konfiguration.
    try{
      const response=await fetch('/api/social-links',{cache:'no-store'});
      if(!response.ok)throw Error('Einstellungen nicht abrufbar');
      const data=await response.json();
      if(!data||!Array.isArray(data.kanäle))return;
      const freigegeben=data.kanäle.filter(item=>allowed.has(item.id)&&
        typeof item.url==='string'&&item.url.startsWith('https://'));
      contacts.replaceChildren();
      document.querySelector('#social-whatsapp-button')?.remove();
      for(const channel of freigegeben){
        const link=document.createElement('a');
        link.href=channel.url;
        link.rel='noopener noreferrer';
        link.target='_blank';
        link.textContent=display[channel.id]||channel.name;
        link.dataset.socialChannel=channel.id;
        contacts.append(document.createTextNode(' · '),link);
        if(channel.id==='whatsapp'){
          const float=document.createElement('a');
          float.id='social-whatsapp-button';
          float.className='whatsapp-float';
          float.href=channel.url;
          float.target='_blank';
          float.rel='noopener noreferrer';
          float.setAttribute('aria-label','Klettern und Abenteuer über WhatsApp kontaktieren');
          float.textContent='✉ WhatsApp-Fragen';
          document.body.append(float);
        }
      }
    }catch(error){
      // Ohne gültige Antwort dürfen deaktivierte Kanäle nicht versehentlich sichtbar werden.
      contacts.replaceChildren();
      document.querySelector('#social-whatsapp-button')?.remove();
      console.warn('Social-Media-Kontaktbuttons konnten nicht geladen werden:',error.message);
    }
  }
  aktualisieren();
  window.addEventListener('pageshow',event=>{if(event.persisted)aktualisieren();});
})();