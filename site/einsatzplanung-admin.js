'use strict';
(() => {
  const root=document.getElementById('einsatzplanung-admin');
  const personalRoot=document.getElementById('arbeitsvertraege-admin');
  if(!root||!personalRoot)return;
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const euro=v=>(Number(v||0)/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
  const stunden=v=>(Number(v||0)/60).toLocaleString('de-DE',{maximumFractionDigits:2})+' Std.';
  const datum=new Date();let monat=datum.getFullYear()+'-'+String(datum.getMonth()+1).padStart(2,'0');
  let personen=[];
  async function laden(){
    const status=document.getElementById('einsatzplanung-status');
    status.textContent='Einsatzplanung wird geladen …';
    try{
      const [liste,plan,settings]=await Promise.all([
        api('/api/admin/einsatzplanung/personen'),
        api('/api/admin/einsatzplanung/kalender?monat='+encodeURIComponent(monat)),
        api('/api/admin/einsatzplanung/kundenbestaetigung-einstellungen')
      ]);
      personen=liste;personalAnzeigen();termineAnzeigen(plan);
      const settingsForm=document.getElementById('kundenbestaetigung-settings-form');
      if(settingsForm){
        settingsForm.elements.namedItem('verzoegerungMinuten').value=settings?.verzoegerungMinuten??120;
        settingsForm.elements.namedItem('ruhebeginn').value=settings?.ruhebeginn??'18:00';
        settingsForm.elements.namedItem('ruheende').value=settings?.ruheende??'09:00';
      }
      status.textContent='Kalender, Bewerbungen und Mitarbeiterdaten aktualisiert.';
    }catch(err){status.textContent='Einsatzplanung nicht verfügbar: '+err.message;}
  }
  function personalAnzeigen(){
    personalRoot.replaceChildren();
    for(const p of personen){
      const card=el('article');card.className='booking';const h=el('h3',p.name);card.append(h);
      const form=document.createElement('form');form.className='einsatz-vertragsformular';
      const select=document.createElement('select');select.name='art';
      for(const [value,name] of [['nicht_hinterlegt','Bitte auswählen'],['minijob','Minijob'],['teilzeit','Teilzeit'],['vollzeit','Vollzeit'],['honorar','Honorarkraft']]){
        const opt=document.createElement('option');opt.value=value;opt.textContent=name;opt.selected=p.art===value;select.append(opt);
      }
      const field=(label,name,value,step='0.01')=>{
        const box=el('label',label);const input=document.createElement('input');
        input.name=name;input.type='number';input.min='0';input.step=step;input.value=value??'';
        box.append(input);return box;
      };
      const typ=el('label','Beschäftigungsart');typ.append(select);form.append(typ);
      form.append(field('Stundenlohn brutto (€)','stundenlohn',p.stundenlohn_cent==null?'':p.stundenlohn_cent/100));
      form.append(field('Vertragliche Wochenstunden','wochenstunden',p.wochenstunden));
      form.append(field('Vertragliche Monatsstunden','monatsstunden',p.monatsstunden));
      form.append(field('Individuelle Minijob-Grenze (€; leer = 2026 gesetzlich)','minijobGrenze',
        p.minijob_grenze_cent==null?'':p.minijob_grenze_cent/100));
      const save=el('button','Vertragsdaten speichern');save.className='btn secondary';save.type='submit';
      const state=el('p');state.setAttribute('role','status');form.append(save,state);
      form.onsubmit=async event=>{
        event.preventDefault();save.disabled=true;state.textContent='Speichere …';
        try{
          const data=Object.fromEntries(new FormData(form).entries());
          await api('/api/admin/einsatzplanung/vertrag/'+encodeURIComponent(p.id),{
            method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
          state.textContent='Vertragsdaten gespeichert.';await personalAktualisieren();
        }catch(err){state.textContent='Fehler: '+err.message;}finally{save.disabled=false;}
      };
      const stats=el('button','Wochen-/Monatsstunden anzeigen');stats.type='button';stats.className='btn secondary';
      const summary=el('p');stats.onclick=async()=>{
        try{
          const date=monat+'-15',res=await api('/api/admin/einsatzplanung/stunden/'+p.id+'?datum='+date);
          const l=res.load;
          summary.textContent='Kalenderwoche: '+stunden(l.weekWorkedMin)+' geleistet, '+stunden(l.weekMin)+' inklusive Planung. Monat: '+
            stunden(l.monthWorkedMin)+' geleistet, '+stunden(l.monthMin)+' inklusive Planung.'+
            (res.minijobGrenzeEuro!=null?' Geplanter Verdienst: '+res.geplantMonatEuro.toFixed(2)+' € von '+res.minijobGrenzeEuro.toFixed(2)+' €.':'');
        }catch(err){summary.textContent=err.message;}
      };
      card.append(form,stats,summary);personalRoot.append(card);
    }
  }
  async function personalAktualisieren(){personen=await api('/api/admin/einsatzplanung/personen');}
  function termineAnzeigen(plan){
    const list=document.getElementById('einsatzplanung-termine');list.replaceChildren();
    const notificationMap=new Map((plan.kundenMails||[]).map(row=>[row.buchung_id,row]));
    const byBooking=new Map();
    for(const e of plan.einsaetze||[]){
      if(!byBooking.has(e.buchung_id))byBooking.set(e.buchung_id,[]);
      byBooking.get(e.buchung_id).push(e);
    }
    if(!plan.buchungen?.length){list.append(el('p','Keine aktiven Buchungen in diesem Monat.'));return;}
    for(const b of plan.buchungen){
      const card=el('article');card.className='booking';
      card.append(el('h3',b.datum+' · '+(b.uhrzeit||'Uhrzeit offen')+' Uhr – '+(b.angebot||'Programm')));
      card.append(el('p',(b.ort||'Standort offen')+' · '+(b.dauer||'Dauer nicht hinterlegt')+' Minuten · '+b.status));
      const matches=byBooking.get(b.id)||[];
      card.append(el('p','Bewerbungen: '+(matches.filter(x=>x.status==='beworben').map(x=>x.name).join(', ')||'keine')));
      card.append(el('p','Eingeteilt: '+(matches.filter(x=>['eingeteilt','bestaetigt','abgeschlossen'].includes(x.status))
        .map(x=>x.name+' ('+x.status+')').join(', ')||'noch niemand')));
      const pending=notificationMap.get(b.id);
      if(pending){
        card.append(el('p','Kundenbestätigung: '+pending.status+
          (pending.faellig_ab?' · geplant ab '+new Date(pending.faellig_ab).toLocaleString('de-DE'):'') ));
        if(pending.status==='geplant'){
          const cancel=el('button','Kundenbestätigung stoppen');cancel.type='button';cancel.className='btn secondary';
          cancel.onclick=async()=>{
            cancel.disabled=true;
            try{await api('/api/admin/einsatzplanung/kundenmail/'+b.id+'/abbrechen',
              {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
              await laden();
            }catch(err){alert('Konnte Bestätigung nicht stoppen: '+err.message);cancel.disabled=false;}
          };
          card.append(cancel);
        }
      }
      const row=el('div');row.className='einsatz-zuweisung';
      const select=document.createElement('select');select.setAttribute('aria-label','Mitarbeiter auswählen');
      const placeholder=document.createElement('option');placeholder.textContent='Mitarbeiter auswählen';placeholder.value='';select.append(placeholder);
      for(const person of personen.filter(x=>x.aktiv&&x.art)){
        const opt=document.createElement('option');opt.value=person.id;
        opt.textContent=person.name+(matches.some(e=>e.mitarbeiter_id===person.id&&e.status==='beworben')?' · beworben':'');
        select.append(opt);
      }
      const button=el('button','Einteilen');button.type='button';button.className='btn';
      const status=el('p');status.setAttribute('role','status');
      button.onclick=async()=>{
        if(!select.value)return;
        button.disabled=true;status.textContent='Prüfe Vertrag und Stunden …';
        try{
          const r=await api('/api/admin/einsatzplanung/zuweisen/'+encodeURIComponent(b.id)+'/'+encodeURIComponent(select.value),
            {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
          status.textContent='Einteilung gespeichert. E-Mail: '+r.emailVersand+'.';
          await laden();
        }catch(e){status.textContent='Einteilung nicht möglich: '+e.message;}
        finally{button.disabled=false;}
      };
      row.append(select,button);card.append(row,status);
      for(const e of matches.filter(x=>['eingeteilt','bestaetigt'].includes(x.status))){
        const remove=el('button','Einteilung aufheben: '+e.name);remove.type='button';remove.className='btn secondary';
        remove.onclick=async()=>{
          if(!confirm('Einteilung von '+e.name+' wirklich aufheben?'))return;
          remove.disabled=true;
          try{await api('/api/admin/einsatzplanung/zuweisen/'+b.id+'/'+e.mitarbeiter_id,{method:'DELETE'});
            await laden();
          }catch(err){status.textContent=err.message;remove.disabled=false;}
        };
        card.append(remove);
      }
      for(const e of matches.filter(x=>x.status==='bestaetigt'||x.status==='eingeteilt')){
        const actual=el('div');actual.className='einsatz-zuweisung';
        const label=el('label','Ist-Arbeitszeit (Minuten) – '+e.name);
        const input=document.createElement('input');input.type='number';input.min='0';input.max='1440';input.step='1';input.value=e.ist_minuten??e.arbeitsminuten??b.dauer??'';
        label.append(input);
        const done=el('button','Istzeit abschließen');done.type='button';done.className='btn secondary';
        done.onclick=async()=>{done.disabled=true;try{
          await api('/api/admin/einsatzplanung/istzeit/'+b.id+'/'+e.mitarbeiter_id,
            {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({minuten:Number(input.value)})});
          await laden();
        }catch(error){status.textContent=error.message;}finally{done.disabled=false;}};
        actual.append(label,done);card.append(actual);
      }
      list.append(card);
    }
  }
  const filter=document.getElementById('einsatzplanung-monat');
  filter.value=monat;filter.onchange=()=>{if(/^\d{4}-\d\d$/.test(filter.value)){monat=filter.value;laden();}};
  document.getElementById('einsatzplanung-refresh').onclick=laden;
  const settingsForm=document.getElementById('kundenbestaetigung-settings-form');
  settingsForm?.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=settingsForm.querySelector('button[type="submit"]');
    const status=document.getElementById('kundenbestaetigung-settings-status');
    button.disabled=true;status.className='';status.textContent='Speichere und aktualisiere geplante Bestätigungen …';
    try{
      const values=Object.fromEntries(new FormData(settingsForm).entries());
      const saved=await api('/api/admin/einsatzplanung/kundenbestaetigung-einstellungen',{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
      settingsForm.elements.namedItem('verzoegerungMinuten').value=saved.verzoegerungMinuten;
      settingsForm.elements.namedItem('ruhebeginn').value=saved.ruhebeginn;
      settingsForm.elements.namedItem('ruheende').value=saved.ruheende;
      status.className='is-saved';status.textContent=`✓ Einstellungen gespeichert. ${saved.neuGeplant} geplante Kundenbestätigung(en) wurden mit den neuen Zeiten aktualisiert.`;
      await laden();
    }catch(error){status.className='is-error';status.textContent='Einstellungen konnten nicht gespeichert werden: '+error.message;}
    finally{button.disabled=false;}
  });
  // Die Anmeldung in admin.js aktualisiert die Hauptansicht; laden erst nach Login.
  const observer=new MutationObserver(()=>{
    if(!document.getElementById('workspace').hidden){observer.disconnect();laden();}
  });
  observer.observe(document.getElementById('workspace'),{attributes:true,attributeFilter:['hidden']});
  if(!document.getElementById('workspace').hidden)laden();
})();
