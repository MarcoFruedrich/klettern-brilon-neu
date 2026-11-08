'use strict';
(() => {
  const workspace=document.getElementById('workspace');
  const bell=document.getElementById('admin-notifications-button');
  const count=document.getElementById('admin-notifications-total');
  const tabs=Array.from(document.querySelectorAll('[data-notification-target]'));
  const summary=Array.from(document.querySelectorAll('[data-notification-summary="buchungen"]'));
  if(!workspace||!bell||!count||tabs.length!==2)return;
  const keys=['offen','storniert'];
  let counts={offen:0,storniert:0};
  let loading=false,reading=false;
  const labelFor={offen:'neue Buchungsanfragen',storniert:'neue Stornierungen'};
  const indicator=(link)=>{
    let badge=link.querySelector('.admin-unread-count');
    if(!badge){
      badge=document.createElement('span');
      badge.className='admin-unread-count';
      badge.setAttribute('aria-hidden','true');
      link.append(badge);
    }
    return badge;
  };
  function render(){
    const total=keys.reduce((sum,key)=>sum+counts[key],0);
    bell.hidden=workspace.hidden||total===0;
    bell.setAttribute('aria-label',total+' ungelesene Buchungsvorgänge öffnen');
    bell.title=keys.filter(key=>counts[key]).map(key=>counts[key]+' '+labelFor[key]).join(' · ');
    count.textContent=total>99?'99+':String(total);
    for(const tab of tabs){
      const n=counts[tab.dataset.notificationTarget]||0;
      const badge=indicator(tab);
      badge.hidden=n===0;
      badge.textContent=n>99?'🔔 99+':'🔔 '+n;
      tab.setAttribute('aria-label',tab.textContent.replace(/🔔\s*\d+\+?/g,'').trim()+
        (n?' – '+n+' ungelesene Vorgänge':''));
    }
    for(const link of summary){
      const badge=indicator(link);
      badge.hidden=total===0;
      badge.textContent=total>99?'🔔 99+':'🔔 '+total;
    }
  }
  async function reload(){
    if(workspace.hidden||document.hidden||loading)return;
    loading=true;
    try{
      const data=await api('/api/admin/benachrichtigungen');
      counts={offen:Math.max(0,Number(data.offen)||0),
        storniert:Math.max(0,Number(data.storniert)||0)};
      render();
    }catch(error){
      // Daten bei einem Verbindungsfehler nicht löschen und nie neue Counts erfinden.
      console.warn('Benachrichtigungen derzeit nicht abrufbar:',error.message);
    }finally{loading=false;}
  }
  async function markRead(category){
    if(!keys.includes(category)||reading||workspace.hidden)return;
    reading=true;
    try{
      await api('/api/admin/benachrichtigungen/lesen',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({bereich:category})
      });
      counts[category]=0;
      render();
      await reload();
    }catch(error){
      console.warn('Benachrichtigung konnte nicht als gelesen markiert werden:',error.message);
    }finally{reading=false;}
  }
  for(const tab of tabs)tab.addEventListener('click',()=>{
    // Der reguläre Navigationshandler wechselt zuerst in die passende gefilterte Liste.
    markRead(tab.dataset.notificationTarget);
  });
  bell.addEventListener('click',()=>{
    const category=counts.offen?'offen':counts.storniert?'storniert':null;
    const tab=tabs.find(link=>link.dataset.notificationTarget===category);
    if(tab)tab.click();
  });
  const observer=new MutationObserver(()=>{
    if(workspace.hidden){counts={offen:0,storniert:0};render();}
    else reload();
  });
  observer.observe(workspace,{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)reload();});
  window.addEventListener('focus',reload);
  window.setInterval(reload,45000);
  render();
  if(!workspace.hidden)reload();
})();