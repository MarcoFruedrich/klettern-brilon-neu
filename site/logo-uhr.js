(() => {
  'use strict';
  const logo=document.querySelector('.site-header .brand-logo');
  if(!logo)return;
  const display=document.createElement('span');
  display.className='logo-datum-uhrzeit';
  display.setAttribute('aria-label','Datum und Uhrzeit in Brilon');
  display.style.cssText='position:absolute;left:50%;bottom:-11px;transform:translateX(-50%);'+
    'display:inline-block;z-index:4;white-space:nowrap;font:600 clamp(10px,1.5vw,13px) system-ui,sans-serif;'+
    'letter-spacing:.03em;color:#163e35;background:#f9f8f4e8;padding:2px 9px;border-radius:12px;'+
    'border:1px solid #dfe5dd;box-shadow:0 1px 3px #163e351c;';
  logo.append(display);
  const formatter=new Intl.DateTimeFormat('de-DE',{
    timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'
  });
  function update(){display.textContent=formatter.format(new Date())+' Uhr';}
  update();setInterval(update,30000);
})();