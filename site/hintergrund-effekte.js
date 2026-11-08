(() => {
  'use strict';
  // Der Effekt ist rein dekorativ: keine Blockade der Bedienung oder Eingabefelder.
  if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  fetch('/api/website-effekte',{credentials:'omit',cache:'no-store'})
    .then(response=>{if(!response.ok)throw Error('Effekte nicht verfügbar');return response.json();})
    .then(settings=>{
      if(!settings?.aktiv||!Array.isArray(settings.eintraege))return;
      const item=settings.eintraege.find(entry=>entry.id===settings.aktiveId);
      if(!item||typeof item.symbol!=='string')return;
      const count=Math.min(20,Math.max(1,Number(item.anzahl)||1),
        window.innerWidth<560?7:20);
      const duration=Math.max(8,Math.min(90,Number(item.dauerSekunden)||20));
      const style=document.createElement('style');
      style.textContent=`
        .website-hintergrund-effekte{position:fixed;inset:0;pointer-events:none;overflow:hidden;
          z-index:2;aria-hidden:true;contain:layout style paint}
        .website-hintergrund-effekte span{position:absolute;top:-70px;left:var(--x);
          font-size:var(--size);line-height:1;opacity:.72;filter:drop-shadow(0 1px 1px #ffffff88);
          animation:website-effekt-fall var(--duration) linear infinite;
          animation-delay:var(--delay);will-change:transform}
        @keyframes website-effekt-fall{
          0%{transform:translate3d(0,-80px,0) rotate(0deg);opacity:0}
          7%{opacity:.72}
          90%{opacity:.72}
          100%{transform:translate3d(var(--drift),calc(100vh + 140px),0) rotate(290deg);opacity:0}
        }
        @media(prefers-reduced-motion:reduce),print{
          .website-hintergrund-effekte{display:none!important}
        }`;
      document.head.append(style);
      const layer=document.createElement('div');
      layer.className='website-hintergrund-effekte';
      layer.setAttribute('aria-hidden','true');
      for(let i=0;i<count;i++){
        const particle=document.createElement('span');
        particle.textContent=item.symbol;
        particle.style.setProperty('--x',((i+.5)/count*100).toFixed(2)+'%');
        particle.style.setProperty('--size',(14+(i*7%11))+'px');
        particle.style.setProperty('--duration',(duration+(i*3%11))+'s');
        particle.style.setProperty('--delay',(-(i*13%31))+'s');
        particle.style.setProperty('--drift',(((i*37)%130)-65)+'px');
        layer.append(particle);
      }
      document.body.append(layer);
    }).catch(()=>{ /* Dekoration darf Buchung und Navigation nie beeinträchtigen. */ });
})();