'use strict';

// Öffentliches Besuchermenü. Änderungen werden im vorhandenen JSONB-Feld
// brilon_rechnungsdaten.data gespeichert; keine neue Tabelle oder Laufzeitkosten.
const DEFAULT_VISITOR_GROUPS=Object.freeze([
  {id:'familien',titel:'Familien',icon:'👨‍👩‍👧‍👦',farbe:'#599f47',
   beschreibung:'Gemeinsam Abenteuer erleben, Neues ausprobieren und als Familie zusammenwachsen.',
   punkte:['Erlebnisse für Groß und Klein','Begleitete Aktivitäten','Gemeinsame Erinnerungen'],
   bild:'/fotos/kletterheldin-helm.jpg',programmIds:[],aktiv:true},
  {id:'kindergeburtstage',titel:'Kindergeburtstage',icon:'🎂',farbe:'#bf4e7b',
   beschreibung:'Ein besonderer Geburtstag mit Bewegung, Mut, Teamgeist und ganz viel Spaß.',
   punkte:['Abwechslungsreiche Erlebnisse','Altersgerechte Betreuung','Gemeinsam feiern und staunen'],
   bild:'/fotos/halle.jpg',programmIds:[],aktiv:true},
  {id:'schulen',titel:'Schulen',icon:'🎓',farbe:'#578fce',
   beschreibung:'Erlebnispädagogische Programme, die Klassengemeinschaft und Vertrauen stärken.',
   punkte:['Klassen- und Projekttage','Kooperation und Zusammenhalt','Gemeinsame Herausforderungen'],
   bild:'/fotos/abseilen.jpg',programmIds:[],aktiv:true},
  {id:'vereine',titel:'Vereine',icon:'🛡️',farbe:'#7553b5',
   beschreibung:'Gemeinsame Herausforderungen und sportliche Erlebnisse für euren Verein.',
   punkte:['Teamgeist stärken','Sportlich und kreativ','Für verschiedene Vereinsgruppen'],
   bild:'/fotos/halle.jpg',programmIds:[],aktiv:true},
  {id:'jugendgruppen',titel:'Jugendgruppen',icon:'🧭',farbe:'#e18a24',
   beschreibung:'Abenteuer für Jugendverbände, Freizeiten und andere Gruppen.',
   punkte:['Natur und Bewegung','Altersgerechte Herausforderungen','Gemeinsam etwas erreichen'],
   bild:'/fotos/kletterheldin-helm.jpg',programmIds:[],aktiv:true},
  {id:'unternehmen',titel:'Unternehmen',icon:'💼',farbe:'#21989c',
   beschreibung:'Teamerlebnisse für mehr Vertrauen, Kommunikation und ein starkes Miteinander.',
   punkte:['Zusammenarbeit fördern','Gemeinsam Herausforderungen meistern','Individuell planbare Aktionen'],
   bild:'/fotos/abseilen.jpg',programmIds:[],aktiv:true}
]);

function sichereBesucherBildUrl(value) {
  if(typeof value!=='string')return '';
  const url=value.trim();
  if(url.length>900)return '';
  if(/^\/(?:fotos\/|images\/|bilder\/|assets\/)[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp|svg)$/i.test(url)
    && !url.includes('..'))return url;
  if(/^https:\/\/fssjruvxkdqeltjdrlfo\.supabase\.co\/storage\/v1\/object\/public\/angebotsbilder\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(url)
    && !url.includes('..'))return url;
  return '';
}

function prepareVisitorGroups(input) {
  const configured=Array.isArray(input)?input:[];
  return DEFAULT_VISITOR_GROUPS.map(defaults=>{
    const source=configured.find(g=>g&&g.id===defaults.id)||{};
    const text=(key,max)=>typeof source[key]==='string'&&source[key].trim()
      ?source[key].trim().slice(0,max):defaults[key];
    const rawIds=Array.isArray(source.programmIds)?source.programmIds:[];
    const programmIds=[...new Set(rawIds.map(Number).filter(n=>Number.isSafeInteger(n)&&n>0))].slice(0,250);
    const punkte=Array.isArray(source.punkte)
      ?source.punkte.filter(v=>typeof v==='string'&&v.trim()).slice(0,3).map(v=>v.trim().slice(0,100))
      :defaults.punkte;
    return {
      id:defaults.id,titel:text('titel',55),beschreibung:text('beschreibung',350),
      punkte,icon:defaults.icon,farbe:defaults.farbe,
      bild:sichereBesucherBildUrl(source.bild)||defaults.bild,
      programmIds,aktiv:source.aktiv!==false
    };
  });
}

function validateVisitorGroups(input) {
  if(!Array.isArray(input)||input.length!==DEFAULT_VISITOR_GROUPS.length||
     new Set(input.map(g=>g?.id)).size!==DEFAULT_VISITOR_GROUPS.length||
     !DEFAULT_VISITOR_GROUPS.every(d=>input.some(g=>g?.id===d.id)))
    return {error:'Bitte alle sechs Besuchergruppen unverändert in der Auswahl übermitteln.'};
  for(const g of input){
    if(typeof g.titel!=='string'||!g.titel.trim()||g.titel.length>55||
       typeof g.beschreibung!=='string'||!g.beschreibung.trim()||g.beschreibung.length>350||
       !Array.isArray(g.punkte)||g.punkte.length>3||
       g.punkte.some(s=>typeof s!=='string'||s.length>100)||
       (g.bild&&!sichereBesucherBildUrl(g.bild))||
       !Array.isArray(g.programmIds)||g.programmIds.length>250||
       g.programmIds.some(id=>!Number.isSafeInteger(Number(id))||Number(id)<1)||
       typeof g.aktiv!=='boolean')
      return {error:'Ungültige Felder in der Besuchergruppe '+String(g.id)+'.'};
  }
  return {gruppen:prepareVisitorGroups(input)};
}
module.exports={DEFAULT_VISITOR_GROUPS,prepareVisitorGroups,validateVisitorGroups,sichereBesucherBildUrl};
