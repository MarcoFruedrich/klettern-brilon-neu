'use strict';
(() => {
  const $=id=>document.getElementById(id),select=$('place');
  async function json(url){const r=await fetch(url);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Daten konnten nicht geladen werden.');return d;}
  function fmt(date,time){const d=new Date(String(date).slice(0,10)+'T'+String(time).slice(0,5)+':00');return Number.isNaN(d.valueOf())?String(date)+' '+String(time).slice(0,5):new Intl.DateTimeFormat('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d)+' Uhr';}
  async function refresh(){
    if(!select.value)return;
    try{
      const d=await json('/api/spontangruppen/monitor?ortId='+encodeURIComponent(select.value));
      $('code').textContent=d.code;$('place-name').textContent='Sicherheitscode · '+d.standort;
      $('groups').textContent=d.interessierte+' interessierte Gruppe(n)';
      $('people').textContent=d.personen+' Personen';
      const link=location.origin+d.link,anchor=$('guest-link');anchor.href=d.link;anchor.textContent=link;
      const expiry=new Date(d.codeGueltigBis);
      const seconds=Math.max(0,Math.floor((expiry-Date.now())/1000));
      $('expires').textContent='Code gültig noch '+Math.floor(seconds/60)+' Min. '+(seconds%60)+' Sek.';
      const wrap=$('times');wrap.replaceChildren();
      if(!d.zeiten?.length){wrap.append(Object.assign(document.createElement('p'),{textContent:'Noch keine Zeiten vorgeschlagen.'}));}
      for(const slot of d.zeiten||[]){
        const row=document.createElement('div');row.className='time';
        const name=document.createElement('span');name.textContent=fmt(slot.datum,slot.uhrzeit);
        const votes=document.createElement('strong');votes.textContent=slot.stimmen+' Stimme(n)';
        row.append(name,votes);wrap.append(row);
      }
    }catch(error){$('code').textContent='······';$('place-name').textContent=error.message;}
  }
  async function init(){
    try{
      const items=await json('/api/spontangruppen/standorte');
      for(const item of items){const o=document.createElement('option');o.value=String(item.id);o.textContent=item.name;select.append(o);}
      const initial=new URLSearchParams(location.search).get('ortId');
      if(initial&&items.some(x=>String(x.id)===initial))select.value=initial;
      if(!select.value&&items.length===1)select.value=String(items[0].id);
      await refresh();
    }catch(error){$('place-name').textContent=error.message;}
  }
  select.addEventListener('change',()=>{history.replaceState(null,'','?ortId='+encodeURIComponent(select.value));refresh();});
  $('refresh').addEventListener('click',refresh);
  init();setInterval(refresh,20000);
})();