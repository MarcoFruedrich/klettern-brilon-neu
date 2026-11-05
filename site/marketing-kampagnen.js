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
  try {
    const stored = localStorage.getItem(key);
    if (stored) { apply(JSON.parse(stored)); status.textContent = 'Lokal gespeicherter Entwurf geladen.'; }
  } catch { status.textContent = 'Lokaler Speicher nicht verfügbar.'; }
  get('campaign-save').addEventListener('click', () => {
    try { localStorage.setItem(key, JSON.stringify(read())); status.textContent = 'Entwurf nur auf diesem Gerät gespeichert – nicht veröffentlicht.'; }
    catch { status.textContent = 'Speichern im Browser fehlgeschlagen.'; }
  });
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
