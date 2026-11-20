(() => {
  'use strict';
  const contacts=document.getElementById('social-contact-links');
  if(!contacts)return;
  const allowed=new Set(['whatsapp','instagram','facebook','youtube','tiktok','x']);
  const display={whatsapp:'WhatsApp für Fragen',instagram:'Instagram',facebook:'Facebook',youtube:'YouTube',tiktok:'TikTok',x:'X / Twitter'};
  const freigegebeneKanaele=new Set();
  window.kletternSocialKanalAktiv=id=>freigegebeneKanaele.has(id);
  function teilenButtonsAktualisieren(){
    for(const button of document.querySelectorAll('[data-social-channel-action]')){
      button.hidden=!freigegebeneKanaele.has(button.dataset.socialChannelAction);
    }
  }
  let letzteAnfrage=0;
  function ausblenden(){
    freigegebeneKanaele.clear();
    contacts.replaceChildren();
    document.querySelector('#social-whatsapp-button')?.remove();
    teilenButtonsAktualisieren();
  }
  async function aktualisieren(){
    // Nichts anzeigen, solange eine neue Freigabe geprüft wird.
    // Gleichzeitige Antworten dürfen niemals eine ältere Aktivierung zurückholen.
    const anfrage=++letzteAnfrage;
    ausblenden();
    try{
      const response=await fetch('/api/social-links',{cache:'no-store'});
      if(!response.ok)throw Error('Einstellungen nicht abrufbar');
      const data=await response.json();
      if(anfrage!==letzteAnfrage||!data||!Array.isArray(data.kanäle))return;
      const freigegeben=data.kanäle.filter(item=>item&&item.aktiv===true&&
        allowed.has(item.id)&&typeof item.url==='string'&&item.url.startsWith('https://'));
      for(const channel of freigegeben)freigegebeneKanaele.add(channel.id);
      teilenButtonsAktualisieren();
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
      if(anfrage===letzteAnfrage)ausblenden();
      console.warn('Social-Media-Kontaktbuttons konnten nicht geladen werden:',error.message);
    }
  }
  aktualisieren();
  window.addEventListener('pageshow',event=>{if(event.persisted)aktualisieren();});
  // Wird die Website nach einer Änderung im Verwaltungs-Tab wieder aktiv,
  // sollen deaktivierte Kontaktbuttons auch ohne manuelles Neuladen verschwinden.
  window.addEventListener('focus',aktualisieren);
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)aktualisieren();
  });
})();