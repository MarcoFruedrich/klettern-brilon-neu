'use strict';
(()=>{
  const list=document.getElementById('netzwerkpartner-list');
  const inviteForm=document.getElementById('netzwerkpartner-invite-form');
  const status=document.getElementById('netzwerkpartner-status');
  const inviteStatus=document.getElementById('netzwerkpartner-invite-status');
  const workspace=document.getElementById('workspace');
  const el=(tag,text='')=>{const node=document.createElement(tag);node.textContent=text;return node;};
  async function load(){
    if(!list||!workspace||workspace.hidden)return;
    status.textContent='Netzwerkpartner werden geladen …';
    try{
      const [partners,places]=await Promise.all([api('/api/admin/netzwerkpartner/liste'),api('/api/admin/orte')]);
      list.replaceChildren();
      if(!partners.length){list.append(el('p','Noch keine Netzwerkpartner oder offenen Einladungen.'));status.textContent='';return;}
      for(const partner of partners){
        const card=el('article');card.className='booking';
        const title=partner.unternehmen||partner.ansprechpartner||partner.email;
        card.append(el('h3',title));
        card.append(el('p',(partner.status==='aktiv'?'Zugang aktiv':partner.status==='freigabe_ausstehend'?'Freigabe ausstehend':'Einladung offen')+' · '+partner.email));
        if(partner.art==='konto'){
          const contact=[partner.ansprechpartner,partner.telefon,[partner.strasse,[partner.plz,partner.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
          if(contact)card.append(el('p',contact));
          if(partner.weitere_angaben)card.append(el('p',partner.weitere_angaben));
          const label=el('label','Standortzugang');
          const select=document.createElement('select');select.dataset.partnerLocation=partner.id;
          const none=el('option','Kein Standort freigegeben');none.value='';select.append(none);
          const selectedId=partner.standort_id===null||partner.standort_id===undefined?'':String(partner.standort_id);
          for(const place of places){
            if(!place.aktiv&&String(place.id)!==selectedId)continue;
            const option=el('option',place.name+(place.aktiv?'':' · inaktiv'));option.value=String(place.id);option.selected=option.value===selectedId;select.append(option);
          }
          label.append(select);card.append(label);
          const actions=el('div');actions.className='button-row';
          const save=el('button','Standortfreigabe speichern');save.type='button';save.className='btn';save.dataset.partnerAction='save-location';save.dataset.partnerId=partner.id;actions.append(save);
          if(partner.status==='freigabe_ausstehend'){
            const approve=el('button','Zugang freigeben');approve.type='button';approve.className='btn secondary';approve.dataset.partnerAction='approve';approve.dataset.partnerId=partner.id;actions.append(approve);
          }
          card.append(actions);
          card.append(el('small',partner.standort_name?'Freigegeben: '+partner.standort_name:'Vor der Zugangsfreigabe bitte einen aktiven Standort auswählen und speichern.'));
        }else{
          const revoke=el('button','Einladung widerrufen');revoke.type='button';revoke.className='btn secondary';revoke.dataset.partnerAction='revoke-invite';revoke.dataset.partnerId=partner.id;card.append(revoke);
        }
        list.append(card);
      }
      status.textContent=partners.length+' Netzwerkpartner/Einladung(en).';
    }catch(error){list.replaceChildren();status.textContent='Netzwerkpartner konnten nicht geladen werden: '+error.message;}
  }
  inviteForm?.addEventListener('submit',async event=>{
    event.preventDefault();const button=inviteForm.querySelector('button[type="submit"]');button.disabled=true;
    inviteStatus.textContent='Einladung wird vorbereitet …';
    try{
      const result=await api('/api/admin/netzwerkpartner/einladungen',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:inviteForm.elements.name.value,email:inviteForm.elements.email.value})});
      inviteForm.reset();
      inviteStatus.textContent=result.emailVersand==='gesendet'?'Einladung an '+result.email+' gesendet.':
        'Einladung gespeichert, E-Mail-Versand: '+result.emailVersand+'. Link: '+(result.registrierungsLink||'');
      await load();
    }catch(error){inviteStatus.textContent='Einladung konnte nicht erstellt werden: '+error.message;}
    finally{button.disabled=false;}
  });
  list?.addEventListener('click',async event=>{
    const button=event.target.closest('button[data-partner-action]');if(!button)return;
    button.disabled=true;
    try{
      if(button.dataset.partnerAction==='save-location'){
        const select=list.querySelector('select[data-partner-location="'+CSS.escape(button.dataset.partnerId)+'"]');
        await api('/api/admin/netzwerkpartner/'+encodeURIComponent(button.dataset.partnerId)+'/standort',{
          method:'PATCH',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({standortId:select?.value||null})
        });
        status.textContent='Standortfreigabe gespeichert.';await load();
      }else if(button.dataset.partnerAction==='approve'){
        await api('/api/admin/netzwerkpartner/'+encodeURIComponent(button.dataset.partnerId)+'/freigeben',{method:'PATCH'});
        status.textContent='Netzwerkpartnerzugang freigegeben. Bestätigung wurde versendet.';await load();
      }else if(button.dataset.partnerAction==='revoke-invite'){
        await api('/api/admin/netzwerkpartner/einladungen/'+encodeURIComponent(button.dataset.partnerId),{method:'DELETE'});
        status.textContent='Einladung widerrufen.';await load();
      }
    }catch(error){status.textContent='Änderung konnte nicht gespeichert werden: '+error.message;button.disabled=false;}
  });
  if(workspace){
    new MutationObserver(()=>{if(!workspace.hidden)load();}).observe(workspace,{attributes:true,attributeFilter:['hidden']});
    if(!workspace.hidden)load();
  }
})();
