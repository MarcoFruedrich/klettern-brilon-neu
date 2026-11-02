'use strict';
// Uses the authenticated admin API helper from admin.js; does not persist secrets locally.
(function(){
  const find=id=>document.getElementById(id);
  const elt=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  let initialized=false;
  async function refresh(){
    if(!initialized||find('workspace')?.hidden)return;
    for(const [url,container,statusId,render] of [
      ['/api/admin/pruefung/mitarbeitende','pruef-personal-list','pruef-personal-status',renderStaff],
      ['/api/admin/pruefung/stationen','pruef-station-list','pruef-station-status',renderStations],
      ['/api/admin/pruefung/berichte','pruef-report-list','pruef-report-status',renderReports]
    ]){
      try{render(find(container),await api(url));}
      catch(err){find(statusId).textContent='Laden fehlgeschlagen: '+err.message;}
    }
  }
  function renderStaff(target,people){
    target.replaceChildren();
    for(const person of people){
      const card=elt('p',person.name+' · '+person.email+' · '+(person.aktiv?'Aktiv':'Deaktiviert'));
      if(person.aktiv){
        const button=elt('button','Zugang deaktivieren');button.type='button';button.className='btn secondary';
        button.addEventListener('click',async()=>{
          if(!confirm('Mitarbeiterzugang dauerhaft deaktivieren?'))return;
          try{await api('/api/admin/pruefung/mitarbeitende/'+encodeURIComponent(person.id)+'/deaktivieren',
            {method:'PATCH'});await refresh();}
          catch(err){find('pruef-personal-status').textContent='Fehler: '+err.message;}
        });
        card.append(button);
      }
      target.append(card);
    }
  }
  function renderStations(target,stations){
    target.replaceChildren();
    for(const station of stations)target.append(elt('p',station.name+' · '+(station.aktiv?'Aktiv':'Inaktiv')));
  }
  function renderReports(target,reports){
    target.replaceChildren();
    for(const report of reports){
      const article=elt('article');article.className='booking';
      article.append(elt('strong',report.programm+' · '+report.beginn),
        elt('p','Prüfer: '+report.pruefer+' · Ergebnis: '+(report.hat_mangel?'MANGEL – nicht freigegeben':'Kein Mangel gemeldet')));
      for(const p of report.pruefungen){
        article.append(elt('p',
          (p.station||'Station')+': '+(p.zustand==='ok'?'In Ordnung':'Mangel – '+p.beschreibung)));
        if(p.hatFoto){
          const link=elt('a','Fotobeleg herunterladen – '+(p.station||'Station'));
          link.href='/api/admin/pruefung/berichte/'+encodeURIComponent(report.id)+
            '/foto/'+encodeURIComponent(p.stationId);
          link.download='stationsfoto.jpg';
          article.append(link);
        }
      }
      target.append(article);
    }
  }
  find('pruef-personal-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;
    const status=find('pruef-personal-status');
    try{
      await api('/api/admin/pruefung/mitarbeitende',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(Object.fromEntries(new FormData(form)))});
      form.reset();status.textContent='Mitarbeiter angelegt. Passwort sicher übermitteln.';
      await refresh();
    }catch(err){status.textContent='Fehler: '+err.message;}
  });
  find('pruef-station-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;
    try{
      await api('/api/admin/pruefung/stationen',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(Object.fromEntries(new FormData(form)))});
      form.reset();find('pruef-station-status').textContent='Station gespeichert.';
      await refresh();
    }catch(err){find('pruef-station-status').textContent='Fehler: '+err.message;}
  });
  find('pruef-code-generate')?.addEventListener('click',async()=>{
    const target=find('pruef-code-display');target.textContent='Code wird erzeugt …';
    try{
      const response=await api('/api/admin/pruefung/code',{method:'POST'});
      target.textContent=response.code+' (120 Sekunden gültig, einmalig)';
    }catch(err){target.textContent='Fehler: '+err.message;}
  });
  find('pruef-report-refresh')?.addEventListener('click',refresh);
  // The admin workspace is revealed by the existing login flow.
  const observer=new MutationObserver(()=>{
    if(!find('workspace')?.hidden && !initialized){initialized=true;refresh();}
    if(find('workspace')?.hidden)initialized=false;
  });
  if(find('workspace'))observer.observe(find('workspace'),{attributes:true,attributeFilter:['hidden']});
})();
