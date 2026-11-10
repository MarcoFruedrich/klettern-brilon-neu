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
  if(new RegExp('^/(?:fotos/|images/|bilder/|assets/)[a-zA-Z0-9_./-]+\\.(?:jpe?g|png|webp|gif|svg)$','i').test(url)
    && !url.includes('..'))return url;
  if(new RegExp('^https://fssjruvxkdqeltjdrlfo\\.supabase\\.co/storage/v1/object/public/angebotsbilder/[a-zA-Z0-9_./-]+\\.(?:jpe?g|png|webp|gif)$','i').test(url)
    && !url.includes('..'))return url;
  return '';
}
function visitorGroupId(value){
  return typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{1,39}$/.test(value);
}
function prepareVisitorGroups(input) {
  const configured=Array.isArray(input)?input:[];
  const validCustom=configured.filter(g=>g&&visitorGroupId(g.id)&&!DEFAULT_VISITOR_GROUPS.some(d=>d.id===g.id));
  const defaults=[...DEFAULT_VISITOR_GROUPS];
  const orderedDefaults=Array.isArray(input)
    ?[...input.filter(g=>g&&DEFAULT_VISITOR_GROUPS.some(d=>d.id===g.id))
      .map(g=>DEFAULT_VISITOR_GROUPS.find(d=>d.id===g.id)),
      ...defaults.filter(d=>!input.some(g=>g?.id===d.id))]
    :defaults;
  const ordered=[...orderedDefaults,...validCustom];
  return ordered.slice(0,30).map(g=>{
    const fallback=DEFAULT_VISITOR_GROUPS.find(d=>d.id===g.id)||{
      id:g.id,titel:'Neue Gruppe',icon:'✨',farbe:'#258451',beschreibung:'',
      punkte:[],bild:'/fotos/halle.jpg',programmIds:[],aktiv:true
    };
    const text=(key,max)=>typeof g[key]==='string'&&g[key].trim()
      ?g[key].trim().slice(0,max):fallback[key];
    const rawIds=Array.isArray(g.programmIds)?g.programmIds:[];
    const programmIds=[...new Set(rawIds.map(Number).filter(n=>Number.isSafeInteger(n)&&n>0))].slice(0,250);
    const punkte=Array.isArray(g.punkte)
      ?g.punkte.filter(v=>typeof v==='string'&&v.trim()).slice(0,3).map(v=>v.trim().slice(0,100))
      :fallback.punkte;
    const farbe=/^#[0-9a-f]{6}$/i.test(g.farbe||'')?g.farbe:fallback.farbe;
    return {
      id:fallback.id,titel:text('titel',55),beschreibung:typeof g.beschreibung==='string'?g.beschreibung.trim().slice(0,350):fallback.beschreibung,
      punkte,icon:text('icon',16),iconBild:sichereBesucherBildUrl(g.iconBild),
      farbe,bild:sichereBesucherBildUrl(g.bild)||fallback.bild,
      programmIds,aktiv:g.aktiv!==false
    };
  });
}
function validateVisitorGroups(input) {
  if(!Array.isArray(input)||input.length>30||
     new Set(input.map(g=>g?.id)).size!==input.length||
     input.some(g=>!visitorGroupId(g?.id)))
    return {error:'Bitte gültige Gruppen-IDs wählen. Es sind höchstens 30 Gruppen möglich.'};
  for(const g of input){
    if(typeof g.titel!=='string'||!g.titel.trim()||g.titel.length>55||
       typeof g.beschreibung!=='string'||g.beschreibung.length>350||
       !Array.isArray(g.punkte)||g.punkte.length>3||
       g.punkte.some(s=>typeof s!=='string'||s.length>100)||
       (g.icon!==undefined&&(typeof g.icon!=='string'||g.icon.length>16))||
       (g.farbe!==undefined&&!/^#[0-9a-f]{6}$/i.test(g.farbe))||
       (g.bild&&!sichereBesucherBildUrl(g.bild))||
       (g.iconBild&&!sichereBesucherBildUrl(g.iconBild))||
       !Array.isArray(g.programmIds)||g.programmIds.length>250||
       g.programmIds.some(id=>!Number.isSafeInteger(Number(id))||Number(id)<1)||
       typeof g.aktiv!=='boolean')
      return {error:'Ungültige Felder in der Besuchergruppe '+String(g.id)+'.'};
  }
  return {gruppen:prepareVisitorGroups(input)};
}
module.exports={DEFAULT_VISITOR_GROUPS,prepareVisitorGroups,validateVisitorGroups,sichereBesucherBildUrl};
