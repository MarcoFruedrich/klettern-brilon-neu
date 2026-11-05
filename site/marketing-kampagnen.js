(() => {
'use strict';
const root=document.getElementById('marketing-campaign-section');
if(!root)return;
const el=id=>document.getElementById(id),status=el('campaign-status'),select=el('campaign-select');
const fields=['campaign-title','campaign-audience','campaign-body','campaign-link','campaign-date','campaign-image','campaign-video'];
const defaults=Object.fromEntries(fields.map(id=>[id,el(id).value]));
const channels=()=>[...root.querySelectorAll('input[name="campaign-channel"]:checked')].map(e=>e.value);
const read=()=>({...Object.fromEntries(fields.map(id=>[id,el(id).value])),'campaign-status':el('campaign-status-select').value,channels:channels()});
const apply=d=>{
  fields.forEach(id=>{el(id).value=typeof d?.[id]==='string'?d[id]:defaults[id];});
  el('campaign-status-select').value=d?.['campaign-status']||'entwurf';
  root.querySelectorAll('input[name="campaign-channel"]').forEach(e=>{e.checked=(d?.channels||[]).includes(e.value);});
};
const request=async(path,options={})=>{
  const headers={'Content-Type':'application/json'};
  if(options.method&&options.method!=='GET'){
    const c=await fetch('/api/admin/csrf',{credentials:'same-origin'});
    if(!c.ok)throw Error('Bitte als Verwaltung anmelden.');
    headers['X-CSRF-Token']=(await c.json()).csrfToken;
  }
  const r=await fetch(path,{credentials:'same-origin',...options,headers});
  const data=await r.json();
  if(!r.ok)throw Error(data.error||'Anfrage fehlgeschlagen ('+r.status+').');
  return data;
};
const base='/api/admin/marketing/kampagnen';
const id=()=>select.value;
async function refresh(preferred){
  const result=await request(base);
  select.replaceChildren();
  for(const row of result.campaigns){
    const opt=document.createElement('option');opt.value=row.id;opt.textContent=row.data['campaign-title']||row.id;select.append(opt);
  }
  if(!result.campaigns.length){
    const opt=document.createElement('option');opt.value='startkampagne';opt.textContent='Startkampagne (neu)';select.append(opt);
  }
  if(preferred&&[...select.options].some(x=>x.value===preferred))select.value=preferred;
  await load();
}
async function load(){
  const result=await request(base+'/'+encodeURIComponent(id()));
  apply(result.data||{});
  status.textContent=result.data?'Kampagne geladen – nicht veröffentlicht.':'Neue Kampagne – noch nicht gespeichert.';
}
select.addEventListener('change',()=>load().catch(e=>status.textContent=e.message));
el('campaign-new').addEventListener('click',()=>{
  const name=prompt('Interne Kampagnenkennung (Buchstaben, Zahlen, Bindestriche):');
  if(name===null)return;
  const key=name.toLowerCase().trim();
  if(!/^[a-z0-9-]{1,64}$/.test(key)){status.textContent='Bitte eine gültige Kennung eingeben.';return;}
  if([...select.options].some(o=>o.value===key)){select.value=key;load().catch(e=>status.textContent=e.message);return;}
  const opt=document.createElement('option');opt.value=key;opt.textContent=key;select.append(opt);select.value=key;
  apply({});status.textContent='Neue Kampagne vorbereitet. Bitte speichern.';
});
el('campaign-save').addEventListener('click',async()=>{
  const button=el('campaign-save');button.disabled=true;
  try{
    await request(base+'/'+encodeURIComponent(id()),{method:'PUT',body:JSON.stringify(read())});
    await refresh(id());
    status.textContent='Kampagne zentral gespeichert – nicht veröffentlicht.';
  }catch(e){status.textContent='Nicht gespeichert: '+e.message;}
  finally{button.disabled=false;}
});
el('campaign-delete').addEventListener('click',async()=>{
  if(!confirm('Diese Kampagne wirklich dauerhaft löschen?'))return;
  try{await request(base+'/'+encodeURIComponent(id()),{method:'DELETE'});await refresh();status.textContent='Kampagne gelöscht.';}
  catch(e){status.textContent=e.message;}
});
el('campaign-reset').addEventListener('click',()=>{apply({});status.textContent='Eingaben zurückgesetzt; Serverdaten unverändert.';});
el('campaign-copy').addEventListener('click',async()=>{
  const d=read(),message=[d['campaign-title'],d['campaign-body'],d['campaign-link']].filter(Boolean).join('\n\n');
  try{await navigator.clipboard.writeText(message);status.textContent='Beitrag kopiert, nicht veröffentlicht.';}
  catch{status.textContent='Kopieren nicht möglich.';}
});
const init=()=>refresh('startkampagne').catch(e=>status.textContent='Kampagnen nicht geladen: '+e.message);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
