'use strict';
const fs=require('node:fs');
const path=require('node:path');

function standortFehler(orte,angebote,aktionen=[]){
  if(!Array.isArray(orte)||!Array.isArray(angebote)||!Array.isArray(aktionen))
    return ['Öffentliche APIs liefern ungültige Datenstrukturen.'];
  const issues=[],names=new Set(orte.map(o=>o?.name).filter(x=>typeof x==='string'&&x.trim()));
  if(names.size!==orte.length)issues.push('Standorte fehlen oder sind doppelt vorhanden.');
  if(!names.size)issues.push('Keine aktiven Standorte veröffentlicht.');
  if(!angebote.length)issues.push('Keine buchbaren Programme veröffentlicht.');
  const ids=new Set();
  for(const p of angebote){
    if(!p||!String(p.name||'').trim()||!Number.isInteger(Number(p.id)))issues.push('Programm ohne gültigen Namen oder ID.');
    if(ids.has(String(p.id)))issues.push('Doppelte Programm-ID.');ids.add(String(p.id));
    const sites=Array.isArray(p.veranstaltungsorte)&&p.veranstaltungsorte.length?
      p.veranstaltungsorte:[p.veranstaltungsort].filter(Boolean);
    if(!sites.length)issues.push('Programm ohne Standortzuordnung.');
    if(sites.some(x=>!names.has(x)))issues.push('Programm verweist auf inaktiven/nicht vorhandenen Standort.');
    if(new Set(sites).size!==sites.length)issues.push('Programmstandort mehrfach zugeordnet.');
  }
  for(const a of aktionen){
    const sites=Array.isArray(a?.veranstaltungsorte)&&a.veranstaltungsorte.length?
      a.veranstaltungsorte:[a?.veranstaltungsort].filter(Boolean);
    if(sites.some(x=>!names.has(x)))issues.push('Sonderaktion verweist auf inaktiven Standort.');
  }
  return [...new Set(issues)];
}
async function smoke({base,domain=false,fetcher=fetch,timeout=18000}={}){
  const url=new URL(base||'https://klettern-brilon-neu.onrender.com/');
  if(url.protocol!=='https:')throw Error('Die Live-Prüfung setzt HTTPS voraus.');
  const rows=[],warnings=[],totals={standorte:0,programme:0,aktionen:0};
  async function get(path,json=false){
    const target=new URL(path,url);
    const r=await fetcher(target.toString(),{method:'GET',redirect:'follow',signal:AbortSignal.timeout(timeout)});
    if(!r.ok)throw Error('HTTP '+r.status);
    if(new URL(r.url||target).origin!==url.origin)throw Error('Unerwartete externe Weiterleitung.');
    if(json){
      if(!(r.headers.get('content-type')||'').includes('json'))throw Error('Keine JSON-Antwort.');
      return r.json();
    }
    return r.text();
  }
  async function check(name,fn){
    try{const note=await fn();rows.push({name,pass:true,note:note||'OK'});}
    catch(e){rows.push({name,pass:false,note:String(e?.message||e).slice(0,150)});}
  }
  const allPages=fs.readdirSync(path.join(__dirname,'..','site'))
    .filter(name=>/\.html$/.test(name)).map(name=>'/'+name);
  const pages=domain?['/','/widerruf.html']:
    ['/',...allPages.filter(name=>name!=='/index.html')];
  const assets=new Set();
  for(const p of pages){
    await check('Seite '+p,async()=>{
      const html=await get(p);
      if(!/<html[\s>]/i.test(html)||!/<body[\s>]/i.test(html))throw Error('HTML unvollständig');
      if(!domain){
        for(const match of html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/gi)){
          const asset=match[1];
          if(asset.startsWith('/')&&/^\/[^?#]+\.(?:js|css)(?:\?|#|$)/i.test(asset))
            assets.add(asset);
        }
      }
      return 'HTML erreichbar';
    });
  }
  if(!domain){
    for(const p of new Set(['/app.js','/admin.js','/social-links-public.js',...assets])){
      await check('Skript/Style '+p.replace(/\?.*$/,''),async()=>{
        if((await get(p)).length<20)throw Error('Datei fehlt oder ist leer.');
      });
    }
    await check('Verwaltungs-API erfordert Anmeldung',async()=>{
      for(const route of ['/api/admin/buchungen','/api/admin/angebote']){
        const target=new URL(route,url);
        const r=await fetcher(target.toString(),{method:'GET',redirect:'manual',
          signal:AbortSignal.timeout(timeout)});
        if(r.status!==401&&r.status!==403)
          throw Error('Unerwarteter öffentlicher HTTP-Status '+r.status+' bei '+route);
      }
      return 'Verwaltungsdaten nicht ohne Anmeldung abrufbar';
    });
    let orte,angebote,aktionen;
    await check('/api/orte',async()=>{
      orte=await get('/api/orte',true);
      if(!Array.isArray(orte))throw Error('Standorte nicht als Liste verfügbar');
      totals.standorte=orte.length;return String(orte.length)+' aktive Standorte';
    });
    await check('/api/angebote',async()=>{
      angebote=await get('/api/angebote',true);
      if(!Array.isArray(angebote))throw Error('Programme nicht als Liste verfügbar');
      totals.programme=angebote.length;return String(angebote.length)+' Programme';
    });
    await check('/api/aktionen',async()=>{
      aktionen=await get('/api/aktionen',true);
      if(!Array.isArray(aktionen))throw Error('Aktionen nicht als Liste verfügbar');
      totals.aktionen=aktionen.length;
      if(!aktionen.length)warnings.push('Keine Tages- oder Sonderaktionen veröffentlicht.');
      return String(aktionen.length)+' Aktionen';
    });
    await check('/api/social-links',async()=>{
      const r=await get('/api/social-links',true);
      if(!Array.isArray(r?.kanäle))throw Error('Social-Media-Freigaben fehlerhaft.');
      if(r.kanäle.some(c=>c.aktiv===false))throw Error('Inaktiver Kanal wurde öffentlich freigegeben.');
      return 'Social-Media-Freigaben eingehalten';
    });
    if(orte&&angebote&&aktionen){
      await check('Standortzuordnung aller Programme',async()=>{
        const problems=standortFehler(orte,angebote,aktionen);
        if(problems.length)throw Error(problems.join(' / '));
        return 'Alle öffentlichen Standortreferenzen gültig';
      });
    }
    if(orte?.length&&angebote?.length){
      const date=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
      await check('Verfügbarkeit pro Programm und Standort',async()=>{
        let success=0;
        const broken=[],covered=new Set();
        for(const programm of angebote){
          const sites=Array.isArray(programm.veranstaltungsorte)&&programm.veranstaltungsorte.length?
            programm.veranstaltungsorte:[programm.veranstaltungsort].filter(Boolean);
          const tiers=Array.isArray(programm.gruppenstufen)?
            programm.gruppenstufen.filter(x=>Number.isInteger(Number(x.min))&&Number(x.min)>=1):[];
          const stage=tiers[0];
          const participants=programm.buchungsmodus==='einzelplatz'?1:(stage?Number(stage.min):6);
          for(const name of sites){
            if(!orte.some(x=>x.name===name))continue;
            let query='/api/belegte-zeiten?datum='+date+
              '&standort='+encodeURIComponent(name)+
              '&angebot='+encodeURIComponent(programm.name)+
              '&teilnehmer='+encodeURIComponent(participants);
            const duration=programm.dauer_modus==='gruppenstufe'?Number(stage?.dauer):Number(programm.dauer);
            if(Number.isInteger(duration)&&duration>0)
              query+='&programmdauer='+duration;
            try{
              const response=await get(query,true);
              if(!Array.isArray(response?.zeiten))throw Error('Zeitfenster fehlen');
              success++;covered.add(name);
            }catch(error){
              broken.push('Programm '+String(programm.id||'?')+': '+String(error.message||error).slice(0,50));
            }
          }
        }
        for(const place of orte){
          if(!covered.has(place.name))
            warnings.push('Aktiver Standort ohne geprüftes buchbares Programm: '+place.name);
        }
        if(broken.length)
          throw Error(broken.length+' Kalenderprüfungen fehlgeschlagen: '+[...new Set(broken)].slice(0,3).join('; '));
        return success+' Programm-/Standortkombinationen erfolgreich geprüft';
      });
    }
  }
  return {url:url.origin,rows,totals,warnings};
}
function bericht(data){
  const good=data.rows.filter(x=>x.pass).length;
  return ['## Live-Prüfung: '+data.url,'',
    '**'+good+'/'+data.rows.length+' Prüfungen bestanden**','','| Prüfung | Status |',
    '|---|---|',...data.rows.map(r=>'| '+r.name+' | '+(r.pass?'OK':'FEHLER')+
      ': '+r.note.replace(/\|/g,'/').replace(/[\r\n]/g,' ')+' |'),'',
    'Aktive Standorte: '+data.totals.standorte+'; Programme: '+data.totals.programme+
      '; Sonderaktionen: '+data.totals.aktionen,'',
    '### Offene Einrichtung und Inhalte', '',
    ...(data.warnings?.length?data.warnings.map(x=>'- WARNUNG: '+x.replace(/[\r\n]/g,' ').slice(0,140)):
      ['Keine inhaltlichen Warnungen bei den geprüften öffentlichen Daten.']), '',
    'Ausschließlich lesende GET-Anfragen, keine Buchungen oder Kundendaten verändert.'
  ].join('\n')+'\n';
}
if(require.main===module){
  const domain=process.env.LIVE_MODE==='domain';
  smoke({domain,base:domain?'https://klettern-abenteuer.de/':'https://klettern-brilon-neu.onrender.com/'})
    .then(result=>{
      const text=bericht(result);console.log(text);
      if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,text);
      if(result.rows.some(x=>!x.pass))process.exitCode=1;
    })
    .catch(e=>{console.error('Live-Test nicht möglich:',String(e.message||e).slice(0,200));process.exitCode=1;});
}
module.exports={standortFehler,smoke,bericht};
