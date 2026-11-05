(() => {
  'use strict';
  const root = document.getElementById('marketing-campaign-section');
  if (!root) return;
  const get = id => document.getElementById(id);
  const fields = ['campaign-title', 'campaign-audience', 'campaign-body', 'campaign-link', 'campaign-date'];
  const key = 'brilon-marketing-campaign-draft-v1';
  const status = get('campaign-status');
  const initial = Object.fromEntries(fields.map(id => [id, get(id).value]));
  const channels = () => [...root.querySelectorAll('input[name="campaign-channel"]:checked')].map(e => e.value);
  const read = () => ({ ...Object.fromEntries(fields.map(id => [id, get(id).value])), channels: channels() });
  const apply = data => {
    fields.forEach(id => { if (typeof data[id] === 'string') get(id).value = data[id]; });
    root.querySelectorAll('input[name="campaign-channel"]').forEach(e => { e.checked = (data.channels || []).includes(e.value); });
  };
  async function loadServer() {
    const response=await fetch('/api/admin/marketing/kampagne',{credentials:'same-origin'});
    if(!response.ok)throw Error('Serverentwurf nicht verfügbar ('+response.status+').');
    const result=await response.json();
    if(result.data){apply(result.data);status.textContent='Zentral gespeicherter Entwurf geladen.';}
    else status.textContent='Noch kein zentraler Entwurf gespeichert.';
  }
  try {
    const stored = localStorage.getItem(key);
    if (stored) { apply(JSON.parse(stored)); status.textContent = 'Lokal gespeicherter Entwurf geladen.'; }
  } catch { status.textContent = 'Lokaler Speicher nicht verfügbar.'; }
  get('campaign-save').addEventListener('click', async () => {
    const button=get('campaign-save');button.disabled=true;
    try {
      const csrfResponse=await fetch('/api/admin/csrf',{credentials:'same-origin'});
      if(!csrfResponse.ok)throw Error('Bitte erneut als Administrator anmelden.');
      const csrf=await csrfResponse.json();
      const response=await fetch('/api/admin/marketing/kampagne',{
        method:'PUT',credentials:'same-origin',
        headers:{'Content-Type':'application/json','X-CSRF-Token':csrf.csrfToken},
        body:JSON.stringify(read())
      });
      const result=await response.json();
      if(!response.ok)throw Error(result.error||'Speichern fehlgeschlagen.');
      try{localStorage.removeItem(key);}catch{}
      status.textContent='Zentral in der Datenbank gespeichert – nicht veröffentlicht.';
    }catch(error){status.textContent='Nicht zentral gespeichert: '+error.message;}
    finally{button.disabled=false;}
  });
  document.addEventListener('DOMContentLoaded',()=>loadServer().catch(error=>{status.textContent=error.message+' Bitte Anmeldung und Datenbankmigration prüfen.';}));
  if(document.readyState!=='loading')loadServer().catch(error=>{status.textContent=error.message+' Bitte Anmeldung und Datenbankmigration prüfen.';});
  get('campaign-reset').addEventListener('click', () => {
    apply({...initial, channels: []});
    try { localStorage.removeItem(key); } catch {}
    status.textContent = 'Lokaler Entwurf zurückgesetzt.';
  });
  get('campaign-copy').addEventListener('click', async () => {
    const d = read();
    const message = [d['campaign-title'], d['campaign-body'], d['campaign-link']].filter(Boolean).join('\n\n');
    try { await navigator.clipboard.writeText(message); status.textContent = 'Beitrag kopiert; es wurde nichts veröffentlicht.'; }
    catch { status.textContent = 'Kopieren nicht möglich. Bitte Text manuell auswählen.'; }
  });
})();
