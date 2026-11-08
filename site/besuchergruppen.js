'use strict';
(() => {
  const root=document.getElementById('besuchergruppen-kacheln');
  if(!root)return;
  const defaults=[
    {id:'familien',titel:'Familien',icon:'👨‍👩‍👧‍👦',farbe:'#599f47',beschreibung:'Gemeinsam Abenteuer erleben, Neues ausprobieren und als Familie zusammenwachsen.',punkte:['Erlebnisse für Groß und Klein','Begleitete Aktivitäten','Gemeinsame Erinnerungen'],bild:'/fotos/kletterheldin-helm.jpg',programmIds:[],aktiv:true},
    {id:'kindergeburtstage',titel:'Kindergeburtstage',icon:'🎂',farbe:'#bf4e7b',beschreibung:'Ein besonderer Geburtstag mit Bewegung, Mut, Teamgeist und ganz viel Spaß.',punkte:['Abwechslungsreiche Erlebnisse','Altersgerechte Betreuung','Gemeinsam feiern und staunen'],bild:'/fotos/halle.jpg',programmIds:[],aktiv:true},
    {id:'schulen',titel:'Schulen',icon:'🎓',farbe:'#578fce',beschreibung:'Erlebnispädagogische Programme, die Klassengemeinschaft und Vertrauen stärken.',punkte:['Klassen- und Projekttage','Kooperation und Zusammenhalt','Gemeinsame Herausforderungen'],bild:'/fotos/abseilen.jpg',programmIds:[],aktiv:true},
    {id:'vereine',titel:'Vereine',icon:'🛡️',farbe:'#7553b5',beschreibung:'Gemeinsame Herausforderungen und sportliche Erlebnisse für euren Verein.',punkte:['Teamgeist stärken','Sportlich und kreativ','Für verschiedene Vereinsgruppen'],bild:'/fotos/halle.jpg',programmIds:[],aktiv:true},
    {id:'jugendgruppen',titel:'Jugendgruppen',icon:'🧭',farbe:'#e18a24',beschreibung:'Abenteuer für Jugendverbände, Freizeiten und andere Gruppen.',punkte:['Natur und Bewegung','Altersgerechte Herausforderungen','Gemeinsam etwas erreichen'],bild:'/fotos/kletterheldin-helm.jpg',programmIds:[],aktiv:true},
    {id:'unternehmen',titel:'Unternehmen',icon:'💼',farbe:'#21989c',beschreibung:'Teamerlebnisse für mehr Vertrauen, Kommunikation und ein starkes Miteinander.',punkte:['Zusammenarbeit fördern','Gemeinsam Herausforderungen meistern','Individuell planbare Aktionen'],bild:'/fotos/abseilen.jpg',programmIds:[],aktiv:true}
  ];
  let gruppen=defaults;
  const synonyms={
    familien:/famil|eltern|kind|alle/i,
    kindergeburtstage:/geburtstag|kindergeburtstag|party/i,
    schulen:/schul|klasse|projekt|lehrer/i,
    vereine:/verein|sportgruppe/i,
    jugendgruppen:/jugend|freizeit|verband|pfadfinder/i,
    unternehmen:/firma|unternehmen|betrieb|team|kolleg/i
  };
  window.aktiveBesuchergruppe=null;
  window.besuchergruppeName=()=>gruppen.find(g=>g.id===window.aktiveBesuchergruppe)?.titel||'';
  window.besuchergruppePasst=(angebot)=>{
    if(!window.aktiveBesuchergruppe)return true;
    const group=gruppen.find(g=>g.id===window.aktiveBesuchergruppe);
    if(!group)return true;
    if(group.programmIds?.length)return group.programmIds.some(id=>String(id)===String(angebot.id));
    const text=[angebot.zielgruppe,angebot.name,angebot.kategorie].filter(Boolean).join(' ');
    return Boolean(synonyms[group.id]?.test(text));
  };
  window.besuchergruppeZuruecksetzen=()=>{
    window.aktiveBesuchergruppe=null;
    document.dispatchEvent(new CustomEvent('besuchergruppenwechsel'));
  };
  function element(tag,cls,txt){
    const e=document.createElement(tag);if(cls)e.className=cls;if(txt)e.textContent=txt;return e;
  }
  function render(){
    root.replaceChildren();
    gruppen.filter(g=>g.aktiv).forEach(g=>{
      const card=element('article','besuchergruppe-karte');
      card.style.setProperty('--gruppe-farbe',g.farbe||'#267c50');
      const image=element('img','besuchergruppe-bild');
      image.src=g.bild;image.alt='Erlebnisbild: '+g.titel;image.loading='lazy';
      const content=element('div','besuchergruppe-inhalt');
      const heading=element('h3','besuchergruppe-titel',g.titel);
      const badge=element('span','besuchergruppe-symbol',g.icon);
      badge.setAttribute('aria-hidden','true');
      const head=element('div','besuchergruppe-head');head.append(badge,heading);
      const description=element('p','besuchergruppe-beschreibung',g.beschreibung);
      const benefits=element('ul','besuchergruppe-vorteile');
      (g.punkte||[]).forEach(p=>benefits.append(element('li','',p)));
      const link=element('a','besuchergruppe-button','Angebote entdecken →');
      link.href='#angebote';
      link.addEventListener('click',()=>{
        window.aktiveBesuchergruppe=g.id;
        document.dispatchEvent(new CustomEvent('besuchergruppenwechsel'));
      });
      content.append(head,description,benefits,link);
      card.append(image,content);
      root.append(card);
    });
  }
  render();
  fetch('/api/besuchergruppen')
    .then(r=>{if(!r.ok)throw Error('Besuchergruppen nicht erreichbar');return r.json();})
    .then(data=>{if(Array.isArray(data)&&data.length===6){gruppen=data;render();}})
    .catch(()=>{}); // Die sechs sichtbaren Standardkacheln bleiben verfügbar.
})();