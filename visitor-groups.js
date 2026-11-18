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
  if(!url||url.length>900||url.includes('..'))return '';
  if(/^\/(?:fotos\/|images\/|bilder\/|assets\/)[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp|svg|gif)$/i.test(url))return url;
  try {
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash)return '';
    if(parsed.hostname!=='fssjruvxkdqeltjdrlfo.supabase.co')return '';
    if(!/^\/storage\/v1\/object\/public\/angebotsbilder\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp|gif)$/i.test(parsed.pathname))return '';
    return url;
  } catch {return '';}
}
function sichereId(v) {
  return typeof v==='string'&&/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(v)?v:'';
}
function prepareVisitorGroups(input) {
  // Existing user-managed groups are authoritative; never recreate or silently
  // discard renamed/added groups when reading a stored array.
  const configured=Array.isArray(input)?input:DEFAULT_VISITOR_GROUPS;
  return configured.filter(g=>g&&sichereId(g.id)).slice(0,40).map((source,index)=>{
    const defaults=DEFAULT_VISITOR_GROUPS.find(g=>g.id===source.id)||{};
    const text=(key,max)=>typeof source[key]==='string'&&source[key].trim()
      ?source[key].trim().slice(0,max):(defaults[key]||'');
    const rawIds=Array.isArray(source.programmIds)?source.programmIds:[];
    const programmIds=[...new Set(rawIds.map(Number).filter(n=>Number.isSafeInteger(n)&&n>0))].slice(0,250);
    const punkte=Array.isArray(source.punkte)
      ?source.punkte.filter(v=>typeof v==='string'&&v.trim()).slice(0,3).map(v=>v.trim().slice(0,100))
      :(defaults.punkte||[]);
    return {
      id:source.id,
      titel:text('titel',55),
      beschreibung:text('beschreibung',650),
      punkte,
      icon:typeof source.icon==='string'&&source.icon.length<=24?source.icon:(defaults.icon||'👥'),
      farbe:typeof source.farbe==='string'&&/^#[a-f0-9]{6}$/i.test(source.farbe)?source.farbe:(defaults.farbe||'#599f47'),
      bild:sichereBesucherBildUrl(source.bild)||defaults.bild||'',
      programmIds,
      aktiv:source.aktiv!==false
    };
  });
}
function validateVisitorGroups(input) {
  if(!Array.isArray(input)||input.length>40||
     new Set(input.map(g=>sichereId(g?.id))).size!==input.length||
     input.some(g=>!sichereId(g?.id)))
    return {error:'Ungültige Gruppenliste: Gruppen müssen eindeutige Kennungen haben (maximal 40 Gruppen).'};
  for(const g of input){
    if(typeof g.titel!=='string'||!g.titel.trim()||g.titel.length>55||
       typeof g.beschreibung!=='string'||g.beschreibung.length>650||
       !Array.isArray(g.punkte)||g.punkte.length>3||
       g.punkte.some(v=>typeof v!=='string'||v.length>100)||
       (g.bild&&!sichereBesucherBildUrl(g.bild))||
       !Array.isArray(g.programmIds)||g.programmIds.length>250||
       g.programmIds.some(id=>!Number.isSafeInteger(Number(id))||Number(id)<1)||
       typeof g.aktiv!=='boolean'||
       (g.icon!==undefined&&(typeof g.icon!=='string'||g.icon.length>24))||
       (g.farbe!==undefined&&(typeof g.farbe!=='string'||!/^#[a-f0-9]{6}$/i.test(g.farbe))))
      return {error:'Ungültige Felder in der Besuchergruppe '+String(g.titel||g.id)+'.'};
  }
  return {gruppen:prepareVisitorGroups(input)};
}
module.exports={DEFAULT_VISITOR_GROUPS,prepareVisitorGroups,validateVisitorGroups,sichereBesucherBildUrl};
