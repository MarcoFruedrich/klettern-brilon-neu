
// Klettern & Abenteuer Brilon – Node.js / PostgreSQL
'use strict';
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {Pool}=require('pg');
const { buchungsreferenz } = require('./lib/buchungsreferenz');
const { anschlussrabatte } = require('./lib/anschlussrabatt');
const { zugelasseneAnschlusszeiten, anschlussPreis, erzeugeZugang, pruefeZugang } = require('./lib/anschlussangebote');
const { preisFuerTeilnehmer, zahlungsstand, preisNachAnschlussrabatt, preisBeiAnschlussstorno, zahlungErgaenzen } = require('./lib/buchungslogik');
const { stationFuerSpiel, stationPruefen, gpsSpieldauer } = require('./lib/gpsspiel');
const { gpsTourSpeichern, gpsTourAdminAnsicht } = require('./lib/gpstour');
const { sameOriginMutation } = require('./lib/sicherheit');
const { abgelaufeneEintraegeEntfernen, erstelleRateLimiter, adminLoginErlauben } = require('./lib/sicherheitszustand');
const { decodeBase32:totpSecretDecode, verifyTotp } = require('./lib/totp');
const { summiere: zahlungenSummieren } = require('./site/zahlungsuebersicht');
const { createBrevoMailer } = require('./lib/brevo-mail');
const { buchungsDetails, buchungsstatusNachricht, zahlungsinformationenText } = require('./lib/buchungs-email');
const GPS_GAESTELISTE_EINWILLIGUNG_VERSION='2026-11-02-v1';

const { createClient } = require('@supabase/supabase-js');

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  : null;


const PORT=Number(process.env.PORT||3000),ROOT=path.join(__dirname,'site');const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:{ca:process.env.DATABASE_CA_CERT,rejectUnauthorized:true}}):null;
const sessions=new Map(),totpSteps=new Map(),rateLimiter=erstelleRateLimiter();let sessionChecks=0,persistentSessionChecks=0;const cookieName='brilon_session';const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
const securityHeaders={
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Referrer-Policy':'strict-origin-when-cross-origin'
};
const brevoMail=createBrevoMailer();
function reply(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...securityHeaders,...headers});res.end(JSON.stringify(data))}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>16000)throw Error('Anfrage zu groß')}try{return JSON.parse(data)}catch{throw Error('Ungültiges JSON')}}
function limit(key,max=12,window=600000){return rateLimiter.erlauben(key,max,window)}
async function totpStepEinmalig(factorId,step){
  if(pool){
    const q=await pool.query(
      `INSERT INTO brilon_admin_totp_steps(factor_id,last_step) VALUES($1,$2)
       ON CONFLICT(factor_id) DO UPDATE SET last_step=EXCLUDED.last_step
       WHERE brilon_admin_totp_steps.last_step<EXCLUDED.last_step RETURNING last_step`,[factorId,step]
    );
    return q.rowCount===1;
  }
  const vorher=totpSteps.get(factorId);
  if(Number.isSafeInteger(vorher)&&vorher>=step)return false;
  totpSteps.set(factorId,step);
  return true;
}
function safeText(v,n=200){return typeof v==='string'?v.trim().slice(0,n):''}
function gueltigesDatum(v){
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const datum=new Date(v+'T12:00:00Z');
  return !Number.isNaN(datum.getTime())&&datum.toISOString().slice(0,10)===v;
}
function gpsTokenHash(token){return crypto.createHash('sha256').update(String(token)).digest('hex')}
function anschlussZugang(id){
  const secret=process.env.BOOKING_OFFER_SECRET;
  if(!secret||secret.length<32)return null;
  try{return erzeugeZugang(id,secret)}catch{return null;}
}
function anschlussBuchung(token){
  return pruefeZugang(token,process.env.BOOKING_OFFER_SECRET);
}
function anschlussLink(id){
  const token=anschlussZugang(id),base=process.env.PUBLIC_BASE_URL;
  if(!token||!base)return null;
  try{
    const url=new URL('/anschluss.html',base);
    if(url.protocol!=='https:')return null;
    url.hash='zugang='+encodeURIComponent(token);
    return url.toString();
  }catch{return null;}
}
async function anschlussRabattElternAnwenden(client,zusatz,zusatzId){
  if(!zusatz.anschlussElternId||!zusatz.anschlussRabattAusstehend)return {angewendet:false};
  const q=await client.query('SELECT id,data,status FROM brilon_buchungen WHERE id=$1 FOR UPDATE',[zusatz.anschlussElternId]);
  if(!q.rowCount||q.rows[0].status!=='bestaetigt')return {ungueltig:true};
  const parent=q.rows[0],data=parent.data;
  if(!data.anschlussRabatt10){
    const originalCent=Math.round(Number(data.gesamtpreis)*100),rabattCent=Math.round(originalCent*.1);
    const stand=preisNachAnschlussrabatt(originalCent,rabattCent,Array.isArray(data.zahlungen)?data.zahlungen:[]);
    data.preisanpassungen=[...(Array.isArray(data.preisanpassungen)?data.preisanpassungen:[]),
      {grund:'10 % Anschlussrabatt nach bestätigter Zusatzbuchung',am:new Date().toISOString(),vonCent:originalCent,rabattCent,aufCent:stand.gesamtCent}];
    data.gesamtpreis=stand.gesamtCent/100;data.restbetrag=stand.offenCent/100;
    data.zahlungsgutschriftCent=stand.gutschriftCent;data.anschlussRabatt10=true;data.anschlussRabattCent=rabattCent;
    data.anschlussRabattBasisCent=originalCent;data.anschlussRabattQuelleId=zusatzId;
    const saved=await client.query('UPDATE brilon_buchungen SET data=$1::jsonb,updated_at=NOW() WHERE id=$2 RETURNING id,data',[JSON.stringify(data),parent.id]);
    zusatz.anschlussRabattAusstehend=false;
    return {angewendet:true,buchung:saved.rows[0]};
  }
  zusatz.anschlussRabattAusstehend=false;
  return {angewendet:false};
}
async function anschlussRabattElternZuruecknehmen(client,zusatz,zusatzId){
  if(!zusatz.anschlussElternId)return {zurueckgenommen:false};
  const siblings=await client.query(`SELECT COUNT(*)::integer AS anzahl FROM brilon_buchungen
    WHERE data->>'anschlussElternId'=$1 AND id<>$2 AND status='bestaetigt'`,[zusatz.anschlussElternId,zusatzId]);
  if(Number(siblings.rows[0].anzahl)>0)return {zurueckgenommen:false};
  const q=await client.query('SELECT id,data,status FROM brilon_buchungen WHERE id=$1 FOR UPDATE',[zusatz.anschlussElternId]);
  if(!q.rowCount||q.rows[0].status!=='bestaetigt')return {zurueckgenommen:false};
  const parent=q.rows[0],data=parent.data,basisCent=Number(data.anschlussRabattBasisCent);
  if(!data.anschlussRabattQuelleId||!Number.isSafeInteger(basisCent))return {zurueckgenommen:false};
  const aktuellCent=Math.round(Number(data.gesamtpreis)*100);
  const stand=preisBeiAnschlussstorno(aktuellCent,basisCent,Array.isArray(data.zahlungen)?data.zahlungen:[]);
  data.preisanpassungen=[...(Array.isArray(data.preisanpassungen)?data.preisanpassungen:[]),
    {grund:'Anschlussrabatt nach Storno der Zusatzbuchung zurückgenommen',am:new Date().toISOString(),
      vonCent:aktuellCent,aufCent:basisCent,rabattZurueckgenommenCent:basisCent-aktuellCent}];
  data.gesamtpreis=basisCent/100;data.restbetrag=stand.offenCent/100;
  data.zahlungsgutschriftCent=stand.gutschriftCent;data.anschlussRabatt10=false;
  data.anschlussRabattCent=0;delete data.anschlussRabattBasisCent;delete data.anschlussRabattQuelleId;
  const saved=await client.query('UPDATE brilon_buchungen SET data=$1::jsonb,updated_at=NOW() WHERE id=$2 RETURNING id,data',
    [JSON.stringify(data),parent.id]);
  return {zurueckgenommen:true,buchung:saved.rows[0],stand};
}
async function session(req){
  const jetzt=Date.now();
  const match=(req.headers.cookie||'').match(/(?:^|;\s*)brilon_session=([a-f0-9]{64})/);
  const token=match?.[1];
  if(!token)return {valid:false};
  if(pool){
    try{
      if(++persistentSessionChecks%128===0)
        await pool.query('DELETE FROM brilon_admin_sessions WHERE expires_at<=NOW()');
      const q=await pool.query(
        'SELECT 1 FROM brilon_admin_sessions WHERE token_hash=$1 AND expires_at>NOW()',[gpsTokenHash(token)]
      );
      return {valid:q.rowCount>0};
    }catch{return {unavailable:true};}
  }
  if(++sessionChecks%128===0)abgelaufeneEintraegeEntfernen(sessions,jetzt);
  const exp=sessions.get(token);
  if(!exp)return {valid:false};
  if(exp<=jetzt){sessions.delete(token);return {valid:false};}
  return {valid:true};
}
function adminCsrfToken(token){
  return crypto.createHmac('sha256',token).update('brilon-admin-csrf-v1').digest('hex');
}
function adminCsrfValid(req){
  const sessionToken=(req.headers.cookie||'').match(/(?:^|;\s*)brilon_session=([a-f0-9]{64})/)?.[1];
  const supplied=req.headers['x-csrf-token'];
  if(!sessionToken||typeof supplied!=='string'||! /^[a-f0-9]{64}$/i.test(supplied))return false;
  return crypto.timingSafeEqual(Buffer.from(adminCsrfToken(sessionToken),'hex'),Buffer.from(supplied,'hex'));
}
async function admin(req,res){
  const auth=await session(req);
  if(auth.unavailable){reply(res,503,{error:'Admin-Sitzungsspeicher ist nicht verfügbar.'});return false;}
  if(!auth.valid){reply(res,401,{error:'Bitte anmelden.'});return false}
  if(!sameOriginMutation(req)){reply(res,403,{error:'Admin-Anfragen müssen von derselben Website stammen.'});return false}
  if(!['GET','HEAD','OPTIONS'].includes(String(req.method||'').toUpperCase())&&!adminCsrfValid(req)){
    reply(res,403,{error:'CSRF-Prüfung fehlgeschlagen. Bitte Verwaltung neu laden.'});return false;
  }
  return true;
}

// Ein Zeitfenster ist halb offen: Eine Buchung darf direkt nach der anderen beginnen.
function minuten(v){
  if(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))return null;
  const [h,m]=v.split(':').map(Number);
  return h*60+m;
}
function buchungsfenster(data){
  const n=Number(data.teilnehmer),start=minuten(data.uhrzeit);
  const gespeicherteDauer=Number(data.dauer);
  const dauer=Number.isInteger(gespeicherteDauer)&&gespeicherteDauer>0?gespeicherteDauer:
    n<=4?90:n<=10?150:n<=15?180:n<=20?210:240;
  // Alte Buchungen ohne Startzeit oder individuelle Angebote belegen vorsichtshalber den ganzen Tag.
  return start===null||dauer===null?null:[start,start+dauer];
}
function ueberschneidung(a,b){
  return !a||!b||a[0]<b[1]&&b[0]<a[1];
}
async function pruefeBuchungskonflikt(client,datum,fenster,ausnahmeId=null){
  const sperrung=await client.query(
    `SELECT id FROM brilon_kalender
     WHERE typ='sperrzeit'
     AND datum <= $1::date
     AND COALESCE(enddatum,datum) >= $1::date
     LIMIT 1`,[datum]
  );
  if(sperrung.rowCount)
    return 'Dieser Tag ist leider gesperrt. Bitte wähle ein anderes Datum.';

  const q=await client.query(
    `SELECT id,data FROM brilon_buchungen
     WHERE data->>'datum'=$1
     AND COALESCE(status,'offen') IN ('offen','bestaetigt')
     AND ($2::uuid IS NULL OR id<>$2::uuid)`,
    [datum,ausnahmeId]
  );
  if(q.rows.some(r=>ueberschneidung(fenster,buchungsfenster(r.data))))
    return 'Dieser Zeitraum ist bereits reserviert. Bitte wähle eine andere Anfangszeit oder ein anderes Datum.';
  return null;
}
async function reservierungsTransaktion(aktion){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    // Gemeinsames Datenbank-Schloss gegen gleichzeitige Doppelreservierungen.
    await client.query('SELECT pg_advisory_xact_lock(7112026)');
    const ergebnis=await aktion(client);
    await client.query('COMMIT');
    return ergebnis;
  }catch(e){
    try{await client.query('ROLLBACK')}catch{}
    throw e;
  }finally{
    client.release();
  }
}

async function anschlussApi(req,res,url,route,ip){
  if(!pool)return reply(res,503,{error:'Anschlussangebote derzeit nicht verfügbar.'});
  if(['POST'].includes(req.method)&&['/api/anschlussangebote/vorschau','/api/anschlussangebote/buchen'].includes(route)&&!limit('add-on:'+ip,10))
    return reply(res,429,{error:'Bitte später erneut versuchen.'});
  const request=['/api/anschlussangebote/vorschau','/api/anschlussangebote/buchen'].includes(route)&&req.method==='POST'?await body(req):null;
  const token=request?.zugang;
  const parentId=anschlussBuchung(token);
  if(!parentId)return reply(res,401,{error:'Der Angebotslink ist ungültig oder abgelaufen.'});
  const parentQuery=await pool.query('SELECT id,status,data FROM brilon_buchungen WHERE id=$1',[parentId]);
  if(!parentQuery.rowCount||parentQuery.rows[0].status!=='bestaetigt')
    return reply(res,409,{error:'Anschlussangebote gibt es erst nach bestätigter Buchung.'});
  const parent=parentQuery.rows[0],base=parent.data,window=buchungsfenster(base);
  if(!window||!gueltigesDatum(base.datum)||base.datum<new Date().toISOString().slice(0,10))
    return reply(res,200,{datum:base.datum,teilnehmer:Number(base.teilnehmer)||0,programme:[]});
  if(route==='/api/anschlussangebote/vorschau'&&req.method==='POST'){
    const [programs,bookings,blocked]=await Promise.all([
      pool.query(`SELECT id,name,beschreibung,dauer,preise,kapazitaet,verfuegbare_termine FROM brilon_angebote WHERE aktiv=true AND buchbar=true AND veroeffentlicht=true ORDER BY name`),
      pool.query(`SELECT id,data FROM brilon_buchungen WHERE data->>'datum'=$1 AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,[base.datum]),
      pool.query(`SELECT 1 FROM brilon_kalender WHERE typ='sperrzeit' AND datum<=$1::date AND COALESCE(enddatum,datum)>=$1::date LIMIT 1`,[base.datum])
    ]);
    if(blocked.rowCount)return reply(res,200,{datum:base.datum,teilnehmer:Number(base.teilnehmer)||0,programme:[]});
    const participants=Number(base.teilnehmer);
    if(!Number.isInteger(participants)||participants<1||participants>150)
      return reply(res,409,{error:'Die Gruppengröße der bestätigten Buchung ist ungültig.'});
    const occupied=bookings.rows.filter(b=>b.id!==parentId).map(b=>buchungsfenster(b.data));
    const suggestions=[];
    for(const p of programs.rows){
      if(p.name===base.angebot)continue;
      const dates=Array.isArray(p.verfuegbare_termine)?p.verfuegbare_termine:[];
      const price=preisFuerTeilnehmer(p.preise,participants),duration=Number(p.dauer);
      if((dates.length&&!dates.includes(base.datum))||participants>Number(p.kapazitaet)||price===null||!Number.isInteger(duration)||duration<1)continue;
      const cap=await pool.query(`SELECT COALESCE(SUM(CASE WHEN data->>'teilnehmer' ~ '^[0-9]+$' THEN (data->>'teilnehmer')::integer ELSE 0 END),0) AS n FROM brilon_buchungen WHERE data->>'datum'=$1 AND data->>'angebot'=$2 AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,[base.datum,p.name]);
      if(Number(cap.rows[0].n)+participants>Number(p.kapazitaet))continue;
      const times=zugelasseneAnschlusszeiten(window[0],window[1],duration)
        .filter(t=>!occupied.some(w=>ueberschneidung([t.beginnMinuten,t.endeMinuten],w)))
        .map(t=>({...t,uhrzeit:String(Math.floor(t.beginnMinuten/60)).padStart(2,'0')+':00'}));
      if(times.length){const quote=anschlussPreis(price);suggestions.push({id:p.id,name:p.name,beschreibung:p.beschreibung,dauer:duration,
        originalCent:quote.originalCent,rabattCent:quote.rabattCent,endpreisCent:quote.endpreisCent,zeiten:times});}
    }
    return reply(res,200,{datum:base.datum,teilnehmer:participants,programme:suggestions});
  }
  if(route==='/api/anschlussangebote/buchen'&&req.method==='POST'){
    const d=request,requestParentId=anschlussBuchung(d?.zugang),programId=String(d?.programmId||''),time=safeText(d?.uhrzeit,5);
    if(requestParentId!==parentId||! /^[1-9]\d{0,17}$/.test(programId)||!/^([01]\d|2[0-3]):00$/.test(time))return reply(res,400,{error:'Anschlussauswahl ist ungültig.'});
    const result=await reservierungsTransaktion(async client=>{
      const q=await client.query('SELECT id,status,data FROM brilon_buchungen WHERE id=$1 FOR UPDATE',[parentId]);
      if(!q.rowCount||q.rows[0].status!=='bestaetigt')return {ungueltig:true};
      const original=q.rows[0].data,oldWindow=buchungsfenster(original),participants=Number(original.teilnehmer);
      const pQuery=await client.query(`SELECT id,name,beschreibung,dauer,preise,kapazitaet,verfuegbare_termine FROM brilon_angebote WHERE id=$1 AND aktiv=true AND buchbar=true AND veroeffentlicht=true`,[programId]);
      if(!pQuery.rowCount)return {programm:false};
      const p=pQuery.rows[0],duration=Number(p.dauer),start=Number(time.slice(0,2))*60;
      if(!oldWindow||!Number.isInteger(participants)||participants<1||participants>150||p.name===original.angebot||!Number.isInteger(duration)||participants>Number(p.kapazitaet)||
         !zugelasseneAnschlusszeiten(oldWindow[0],oldWindow[1],duration).some(t=>t.beginnMinuten===start&&t.endeMinuten<=1440))return {zeit:false};
      const dates=Array.isArray(p.verfuegbare_termine)?p.verfuegbare_termine:[];
      if(dates.length&&!dates.includes(original.datum))return {freigabe:false};
      const price=preisFuerTeilnehmer(p.preise,participants);if(price===null)return {preis:false};
      const duplicate=await client.query(`SELECT 1 FROM brilon_buchungen WHERE data->>'anschlussElternId'=$1
        AND data->>'angebot'=$2 AND data->>'uhrzeit'=$3 AND COALESCE(status,'offen') NOT IN ('abgelehnt','storniert') LIMIT 1`,
        [parentId,p.name,time]);
      if(duplicate.rowCount)return {duplikat:true};
      const cap=await client.query(`SELECT COALESCE(SUM(CASE WHEN data->>'teilnehmer' ~ '^[0-9]+$' THEN (data->>'teilnehmer')::integer ELSE 0 END),0) AS n FROM brilon_buchungen WHERE data->>'datum'=$1 AND data->>'angebot'=$2 AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,[original.datum,p.name]);
      if(Number(cap.rows[0].n)+participants>Number(p.kapazitaet))return {kapazität:false};
      const conflict=await pruefeBuchungskonflikt(client,original.datum,[start,start+duration],parentId);if(conflict)return {konflikt:conflict};
      const quote=anschlussPreis(price),id=crypto.randomUUID(),first=safeText(original.vorname,80),last=safeText(original.nachname,80);
      const baseRef=buchungsreferenz(last,first,original.datum),refs=await client.query('SELECT buchungsnummer FROM brilon_buchungen WHERE buchungsnummer=$1 OR buchungsnummer LIKE $2',[baseRef,baseRef+'-%']);
      const used=new Set(refs.rows.map(r=>r.buchungsnummer));let serial=1,reference=baseRef;while(used.has(reference)){serial++;reference=buchungsreferenz(last,first,original.datum,serial);}
      const data={...original,angebot:p.name,uhrzeit:time,dauer:duration,gesamtpreis:quote.endpreisCent/100,
        anzahlung:Math.round(quote.endpreisCent*0.25)/100,restbetrag:Math.round(quote.endpreisCent*0.75)/100,
        zahlungen:[],zahlungsgutschriftCent:0,buchungsnummer:reference,anschlussElternId:parentId,anschlussRabatt10:true,
        anschlussRabattCent:quote.rabattCent,anschlussRabattAusstehend:!original.anschlussRabatt10,
        preisOhneAnschlussRabattCent:price,preisanpassungen:[{grund:'10 % Anschlussrabatt auf Zusatzprogramm',am:new Date().toISOString(),vonCent:price,rabattCent:quote.rabattCent,aufCent:quote.endpreisCent}]};
      const saved=await client.query(`INSERT INTO brilon_buchungen(id,data,status,buchungsnummer) VALUES($1,$2::jsonb,'offen',$3) RETURNING id,data`,[id,JSON.stringify(data),reference]);
      return {buchung:saved.rows[0],quote,programm:p.name};
    });
    if(result.ungültig)return reply(res,409,{error:'Die Buchung ist nicht mehr gültig.'});
    if(result.programm===false)return reply(res,409,{error:'Dieses Programm ist nicht mehr buchbar.'});
    if(result.zeit===false)return reply(res,409,{error:'Zeit, Kapazität oder Anschluss passen nicht mehr.'});
    if(result.freigabe===false)return reply(res,409,{error:'Das Programm ist an diesem Tag nicht freigegeben.'});
    if(result.preis===false)return reply(res,409,{error:'Für diese Gruppengröße fehlt ein Preis.'});
    if(result.duplikat)return reply(res,409,{error:'Diese Anschlussbuchung wurde bereits angefragt.'});
    if(result.kapazität===false)return reply(res,409,{error:'Die Kapazität ist inzwischen ausgeschöpft.'});
    if(result.konflikt)return reply(res,409,{error:result.konflikt});
    const data=result.buchung.data,details=`Neue Buchungsnummer: ${data.buchungsnummer}\nProgramm: ${result.programm}\nDatum: ${data.datum}\nBeginn: ${data.uhrzeit} Uhr\nPreis nach 10 % Anschlussrabatt: ${(result.quote.endpreisCent/100).toFixed(2).replace('.',',')} €`;
    const mails=[brevoMail(data.email,'Deine Anschlussanfrage – Klettern & Abenteuer Brilon',`Hallo ${data.name},\n\n${details}\n\nDie Anfrage ist eingegangen und noch nicht verbindlich bestätigt. Der Rabatt auf das bereits bestätigte Programm wird nach Bestätigung dieser Zusatzbuchung berücksichtigt.\n\nGut Seil!\nKlettern & Abenteuer Brilon`)];
    if(process.env.BOOKING_NOTIFY_EMAIL)mails.push(brevoMail(process.env.BOOKING_NOTIFY_EMAIL,'Neue Anschlussbuchung',details+`\n\nKunde: ${data.name} · ${data.email}`));
    Promise.allSettled(mails).then(results=>results.forEach(r=>{if(r.status==='rejected')console.error('Anschlussbuchungs-E-Mail konnte nicht versendet werden.');}));
    return reply(res,201,{success:true,buchungsnummer:data.buchungsnummer,gesamtpreis:data.gesamtpreis,rabattCent:result.quote.rabattCent});
  }
  return reply(res,404,{error:'Nicht gefunden.'});
}

async function main(req,res){
  const u=new URL(req.url,'http://localhost'),
        route=decodeURIComponent(u.pathname),
        ip=req.socket.remoteAddress||'unknown';
  try{
    if(route==='/api/anschlussangebote/vorschau'||route==='/api/anschlussangebote/buchen')
      return await anschlussApi(req,res,u,route,ip);
    if(route==='/api/buchungen'&&req.method==='POST'){
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      if(!limit('booking:'+ip,6))return reply(res,429,{error:'Bitte später erneut versuchen.'});
      const d=await body(req);
      if(d.website)return reply(res,201,{success:true});

      const vorname=safeText(d.vorname,80),
            nachname=safeText(d.nachname,80),
            name=(vorname+' '+nachname).trim(),
            email=safeText(d.email,180),
            datum=safeText(d.datum,10),
            angebot=safeText(d.angebot,120),
            teilnehmer=Number(d.teilnehmer);

      if(!vorname||!nachname||!/^\S+@\S+\.\S+$/.test(email)||
         !gueltigesDatum(datum)||
         !angebot||!Number.isInteger(teilnehmer)||
         teilnehmer<1||teilnehmer>150||d.datenschutz!=='on')
        return reply(res,400,{error:'Bitte Pflichtfelder korrekt ausfüllen.'});

      let gesamtpreis = null;
      const preisAbfrage = await pool.query(
        `SELECT preise,kapazitaet,verfuegbare_termine,buchbar,veroeffentlicht
         FROM brilon_angebote
         WHERE name = $1 AND aktiv=true AND buchbar=true AND veroeffentlicht=true
         LIMIT 1`,[angebot]
      );
      if(!preisAbfrage.rows.length)return reply(res,409,{error:'Dieses Programm ist derzeit nicht buchbar.'});
      const programm=preisAbfrage.rows[0];
      const verfuegbareTermine=Array.isArray(programm.verfuegbare_termine)?programm.verfuegbare_termine:[];
      if(verfuegbareTermine.length&&!verfuegbareTermine.includes(datum))
        return reply(res,409,{error:'Für dieses Programm ist an dem Datum kein Termin freigegeben.'});
      if(teilnehmer>Number(programm.kapazitaet))return reply(res,409,{error:'Die Gruppengröße überschreitet die maximale Kapazität.'});
      const preisCent=preisFuerTeilnehmer(programm.preise,teilnehmer);
      if(preisCent===null)return reply(res,409,{error:'Für diese Teilnehmerzahl ist kein Preis hinterlegt.'});
      gesamtpreis=preisCent/100;
      const data={
       name,vorname,nachname,email,datum,angebot,teilnehmer,
gesamtpreis,
anzahlung: gesamtpreis === null ? null : Math.round(gesamtpreis * 25) / 100,
restbetrag: gesamtpreis === null ? null : Math.round(gesamtpreis * 75) / 100,
        uhrzeit:safeText(d.uhrzeit,5),
        telefon:safeText(d.telefon,40),
       nachricht:safeText(d.nachricht,2000),dauer:programm.dauer
      };

      if(!/^(09|1[0-9]):00$/.test(data.uhrzeit))
        return reply(res,400,{
          error:'Bitte eine gültige Anfangszeit zwischen 09:00 und 19:00 Uhr auswählen.'
        });

      const fenster=buchungsfenster(data);
      if(!fenster||fenster[1]>1440)return reply(res,400,{error:'Die Programmdauer passt nicht in den gewählten Veranstaltungstag.'});
      const ergebnis=await reservierungsTransaktion(async client=>{
        const kapazitaet=await client.query(
          `SELECT COALESCE(SUM(CASE WHEN data->>'teilnehmer' ~ '^[0-9]+$' THEN (data->>'teilnehmer')::integer ELSE 0 END),0) AS gebucht
           FROM brilon_buchungen WHERE data->>'datum'=$1 AND data->>'angebot'=$2
             AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,[datum,angebot]
        );
        if(Number(kapazitaet.rows[0].gebucht)+teilnehmer>Number(programm.kapazitaet))
          return {konflikt:'Die Kapazität für dieses Programm ist am gewählten Tag ausgeschöpft.'};
        const konflikt=await pruefeBuchungskonflikt(client,datum,fenster);
        if(konflikt)return {konflikt};

        const id=crypto.randomUUID();
        const basis=buchungsreferenz(nachname,vorname,datum);
        const vorhanden=await client.query(
          `SELECT buchungsnummer FROM brilon_buchungen WHERE buchungsnummer=$1 OR buchungsnummer LIKE $2`,
          [basis,basis+'-%']
        );
        const belegte=new Set(vorhanden.rows.map(r=>r.buchungsnummer));
        let laufnummer=1, buchungsnummer=basis;
        while(belegte.has(buchungsnummer)) {
          laufnummer++;
          buchungsnummer=buchungsreferenz(nachname,vorname,datum,laufnummer);
        }
        data.buchungsnummer=buchungsnummer;
        await client.query(
          'INSERT INTO brilon_buchungen (id,data,status,buchungsnummer) VALUES ($1,$2,$3,$4)',
          [id,JSON.stringify(data),'offen',buchungsnummer]
        );
        return {id,buchungsnummer:data.buchungsnummer};
      });

      if(ergebnis.konflikt)
        return reply(res,409,{error:ergebnis.konflikt});

      
const dauer = fenster ? fenster[1] - fenster[0] : null;
const ende = fenster
  ? String(Math.floor(fenster[1] / 60)).padStart(2, '0') +
    ':' + String(fenster[1] % 60).padStart(2, '0')
  : 'nach Absprache';

const buchungsdetails=buchungsDetails({...data,ende:`${ende}${fenster?' Uhr':''}`});




const benachrichtigungen = [
  brevoMail(
    email,
    'Deine Buchungsanfrage – Klettern & Abenteuer Brilon',
    `Hallo ${name},\n\n` +
    `vielen Dank für deine Buchungsanfrage.\n\n` +
    buchungsdetails +
    `\n\nDeine Anfrage ist eingegangen, aber noch nicht verbindlich bestätigt.` +
    `\nDu erhältst eine gesonderte Rückmeldung.\n\n` +
    `Gut Seil!\nKlettern & Abenteuer Brilon`
  )
];
if (process.env.BOOKING_NOTIFY_EMAIL) {
  benachrichtigungen.push(brevoMail(
    process.env.BOOKING_NOTIFY_EMAIL,
    'Neue Buchungsanfrage – Klettern Brilon',
    `Eine neue Buchungsanfrage ist eingegangen:\n\n` +
    buchungsdetails +
    `\n\nKunden-E-Mail: ${email}\nStatus: Offen`
  ));
}
Promise.allSettled(benachrichtigungen).then(ergebnisse => {
  ergebnisse.forEach((ergebnis, index) => {
    if (ergebnis.status === 'rejected') {
      console.error(
        'Brevo-E-Mail fehlgeschlagen:',
        index === 0 ? 'Kunde' : 'Betreiber',
        ergebnis.reason
      );
    }
  });
});


      return reply(res,201,{success:true,id:ergebnis.id,buchungsnummer:ergebnis.buchungsnummer});
    }

    if(route==='/api/belegte-zeiten'&&req.method==='GET'){
      if(!pool)return reply(res,503,{
        error:'Verfügbarkeit derzeit nicht abrufbar.'
      });

      const datum=safeText(u.searchParams.get('datum'),10);
      const gueltig=/^\d{4}-\d{2}-\d{2}$/.test(datum)&&
        !Number.isNaN(Date.parse(datum))&&
        new Date(datum).toISOString().slice(0,10)===datum;

      if(!gueltig)return reply(res,400,{
        error:'Bitte ein gültiges Datum angeben.'
      });

      const q=await pool.query(
        `SELECT data
         FROM brilon_buchungen
         WHERE data->>'datum'=$1
         AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,
        [datum]
      );

      const buchungen=q.rows.map(r=>buchungsfenster(r.data));

     
      const teilnehmer = Number(u.searchParams.get('teilnehmer'));

      if (!Number.isInteger(teilnehmer) ||
          teilnehmer < 1 || teilnehmer > 150) {
        return reply(res,400,{
          error:'Bitte eine gültige Teilnehmerzahl angeben.'
        });
      }

      const angebot=safeText(u.searchParams.get('angebot'),120);
      const programm=await pool.query(
        `SELECT dauer FROM brilon_angebote WHERE name=$1 AND aktiv=true AND buchbar=true AND veroeffentlicht=true LIMIT 1`,[angebot]
      );
      if(!programm.rowCount)return reply(res,409,{error:'Programm ist nicht verfügbar.'});
      const dauer=Number(programm.rows[0].dauer)||
        (teilnehmer<=4?90:teilnehmer<=10?150:teilnehmer<=15?180:teilnehmer<=20?210:240);

      const zeiten=[];

      for(let stunde=9;stunde<=19;stunde++){
        const uhrzeit=String(stunde).padStart(2,'0')+':00';
        const start=stunde*60;

        const neuesFenster=
          dauer===null ? null : [start,start+dauer];

        const belegt=buchungen.some(fenster=>
          ueberschneidung(neuesFenster,fenster)
        );

        zeiten.push({uhrzeit,belegt});
      }

      return reply(res,200,{datum,zeiten});

    }


    
    if(route==='/api/sperrzeiten'&&req.method==='GET'){
      if(!pool)return reply(res,503,{
        error:'Verfügbarkeit derzeit nicht abrufbar.'
      });
      const q=await pool.query(
        `SELECT datum::text AS datum,
                COALESCE(enddatum,datum)::text AS enddatum
         FROM brilon_kalender
         WHERE typ='sperrzeit'
         ORDER BY datum ASC`
      );
      return reply(res,200,q.rows);
    }

    if(route==='/api/aktionen'&&req.method==='GET'){
      if(!pool)return reply(res,200,[]);
      const q=await pool.query(
"SELECT id,data->>'titel' AS titel,data->>'datum' AS datum,data->>'beschreibung' AS beschreibung,data->>'preis' AS preis,data->>'bild_url' AS bild_url FROM brilon_aktionen ORDER BY data->>'datum' ASC NULLS LAST,id DESC LIMIT 100"      );
      return reply(res,200,q.rows);
    }

    if(route==='/api/gps/start'&&req.method==='POST'){
      if(!pool)return reply(res,503,{error:'Spiel derzeit nicht verfügbar.'});
      if(!limit('gps-start:'+ip,30,600000))return reply(res,429,{error:'Bitte kurz warten.'});
      const d=await body(req),token=safeText(d.token,120);
      if(token.length<32)return reply(res,401,{error:'Ungültiger Spielzugang.'});
      const q=await pool.query(
        `SELECT g.id,g.station_index,g.gestartet_am,g.abgeschlossen_am,g.spielzeit_sekunden,
                t.data AS tour
         FROM brilon_gps_spiele g
         JOIN brilon_gps_touren t ON t.id=g.tour_id
         JOIN brilon_buchungen b ON b.id=g.buchung_id
         WHERE g.token_hash=$1 AND t.aktiv=true AND t.data->>'buchbar'='true'
           AND b.status='bestaetigt'`,[gpsTokenHash(token)]
      );
      if(!q.rowCount)return reply(res,404,{error:'Spielzugang nicht gefunden oder nicht freigegeben.'});
      const game=q.rows[0];
      if(game.abgeschlossen_am)return reply(res,200,{abgeschlossen:true,spielzeitSekunden:game.spielzeit_sekunden});
      if(!game.gestartet_am){
        const gestartet=await pool.query(
          'UPDATE brilon_gps_spiele SET gestartet_am=NOW() WHERE id=$1 AND gestartet_am IS NULL RETURNING gestartet_am',[game.id]
        );
        game.gestartet_am=gestartet.rows[0]?.gestartet_am||new Date();
      }
      return reply(res,200,{tour:game.tour.titel,...stationFuerSpiel(game.tour,game.station_index)});
    }

    if(route==='/api/gps/pruefen'&&req.method==='POST'){
      if(!pool)return reply(res,503,{error:'Spiel derzeit nicht verfügbar.'});
      const d=await body(req),token=safeText(d.token,120);
      if(token.length<32||!limit('gps-answer:'+gpsTokenHash(token),20,600000))
        return reply(res,429,{error:'Zu viele Versuche oder ungültiger Zugang.'});
      const client=await pool.connect();
      let ergebnis;
      try{
        await client.query('BEGIN');
        const q=await client.query(
          `SELECT g.id,g.station_index,g.gestartet_am,g.abgeschlossen_am,t.data AS tour
           FROM brilon_gps_spiele g JOIN brilon_gps_touren t ON t.id=g.tour_id
           JOIN brilon_buchungen b ON b.id=g.buchung_id
           WHERE g.token_hash=$1 AND t.aktiv=true AND b.status='bestaetigt' FOR UPDATE OF g`,
          [gpsTokenHash(token)]
        );
        if(!q.rowCount){ergebnis={ungueltig:true};await client.query('ROLLBACK');}
        else{
          const game=q.rows[0];
          if(!game.gestartet_am||game.abgeschlossen_am){ergebnis={ungueltig:true};await client.query('ROLLBACK');}
          else{
            const check=stationPruefen(game.tour,{stationIndex:game.station_index,abgeschlossen:false},
              {qrId:d.qrId,kontrollcode:d.kontrollcode,antwort:d.antwort},process.env.GPS_CODE_SECRET);
            if(!check.korrekt){ergebnis={falsch:true,grund:check.grund};await client.query('ROLLBACK');}
            else{
              const abgeschlossen=check.spiel.abgeschlossen;
              const dauer=abgeschlossen?gpsSpieldauer(new Date(game.gestartet_am).getTime(),Date.now()):null;
              await client.query(
                `UPDATE brilon_gps_spiele SET station_index=$1,
                 abgeschlossen_am=CASE WHEN $2 THEN NOW() ELSE NULL END,
                 spielzeit_sekunden=CASE WHEN $2 THEN $3 ELSE NULL END WHERE id=$4`,
                [check.spiel.stationIndex,abgeschlossen,dauer,game.id]
              );
              ergebnis={korrekt:true,abgeschlossen,spielzeitSekunden:dauer,
                naechsteStation:check.naechsteStation};
              await client.query('COMMIT');
            }
          }
        }
      }catch(error){try{await client.query('ROLLBACK')}catch{};throw error;}
      finally{client.release();}
      if(ergebnis.ungueltig)return reply(res,404,{error:'Spielzugang nicht aktiv.'});
      if(ergebnis.falsch)return reply(res,422,{error:'QR-Code, Kontrollcode oder Antwort stimmen nicht.'});
      return reply(res,200,ergebnis);
    }

    if(route==='/api/gps/abschluss'&&req.method==='POST'){
      if(!pool)return reply(res,503,{error:'Gästeliste derzeit nicht verfügbar.'});
      const d=await body(req),token=safeText(d.token,120),einwilligung=d.einwilligung===true;
      if(token.length<32||!limit('gps-guest:'+ip,12,600000))return reply(res,429,{error:'Bitte kurz warten.'});
      const name=einwilligung?safeText(d.name,80):null;
      if(einwilligung&&!name)return reply(res,400,{error:'Bitte einen Namen eingeben oder nicht zustimmen.'});
      if(einwilligung&&d.einwilligungVersion!==GPS_GAESTELISTE_EINWILLIGUNG_VERSION)
        return reply(res,409,{error:'Der Einwilligungstext wurde aktualisiert. Bitte lade die Seite neu.'});
      const q=await pool.query(
        `UPDATE brilon_gps_spiele SET gast_name=$1,gast_einwilligung=$2,
           gast_einwilligung_am=CASE WHEN $2 THEN NOW() ELSE NULL END,
           gast_einwilligung_version=CASE WHEN $2 THEN $3 ELSE NULL END
         WHERE token_hash=$4 AND abgeschlossen_am IS NOT NULL RETURNING id`,
        [name,einwilligung,einwilligung?GPS_GAESTELISTE_EINWILLIGUNG_VERSION:null,gpsTokenHash(token)]
      );
      if(!q.rowCount)return reply(res,404,{error:'Spiel nicht abgeschlossen oder Zugang ungültig.'});
      return reply(res,200,{success:true,oeffentlich:einwilligung});
    }

    if(route==='/api/gps/gaesteliste'&&req.method==='GET'){
      if(!pool)return reply(res,200,[]);
      const tourId=safeText(u.searchParams.get('tour'),36);
      if(!/^[0-9a-f-]{36}$/i.test(tourId))return reply(res,400,{error:'Tour-ID ungültig.'});
      const q=await pool.query(
        `SELECT g.gast_name AS name,to_char(g.abgeschlossen_am,'YYYY-MM-DD') AS datum,
                g.spielzeit_sekunden AS dauer_sekunden
         FROM brilon_gps_spiele g WHERE g.tour_id=$1 AND g.gast_einwilligung=true
           AND g.gast_name IS NOT NULL AND g.abgeschlossen_am IS NOT NULL
         ORDER BY g.abgeschlossen_am DESC LIMIT 200`,[tourId]
      );
      return reply(res,200,q.rows);
    }

    if(route==='/api/admin/login'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Admin-Anfragen müssen von derselben Website stammen.'});
      const kontoId=gpsTokenHash(process.env.ADMIN_USER||'unconfigured');
      if(!adminLoginErlauben(rateLimiter,ip,kontoId))
        return reply(res,429,{error:'Zu viele Versuche.'});
      const d=await body(req),
            username=process.env.ADMIN_USER,
            password=process.env.ADMIN_PASSWORD;
      if(!username||!password)
        return reply(res,503,{error:'Admin-Zugang nicht eingerichtet.'});
      const totpSecret=process.env.ADMIN_TOTP_SECRET_BASE32;
      try{totpSecretDecode(totpSecret);}catch{return reply(res,503,{error:'Zweiter Faktor ist nicht sicher eingerichtet.'});}

      const a=Buffer.from(String(d.username||'')),
            b=Buffer.from(username),
            c=Buffer.from(String(d.password||'')),
            e=Buffer.from(password);
      if(a.length!==b.length||c.length!==e.length||
         !crypto.timingSafeEqual(a,b)||!crypto.timingSafeEqual(c,e))
        return reply(res,401,{error:'Zugangsdaten nicht korrekt.'});

      const totpStep=verifyTotp(totpSecret,typeof d.totp==='string'?d.totp:'');
      if(totpStep===null)return reply(res,401,{error:'Zugangsdaten oder Authenticator-Code nicht korrekt.'});
      try{
        const factorId=gpsTokenHash(totpSecret);
        if(!await totpStepEinmalig(factorId,totpStep))
          return reply(res,401,{error:'Authenticator-Code wurde bereits verwendet.'});
      }catch{return reply(res,503,{error:'Speicher für den zweiten Faktor ist nicht initialisiert.'});}

      const token=crypto.randomBytes(32).toString('hex');
      const ablauf=new Date(Date.now()+8*3600000);
      if(pool){
        try{
          await pool.query('DELETE FROM brilon_admin_sessions WHERE expires_at<=NOW()');
          await pool.query('INSERT INTO brilon_admin_sessions(token_hash,expires_at) VALUES($1,$2)',
            [gpsTokenHash(token),ablauf]);
        }catch{return reply(res,503,{error:'Admin-Sitzungsspeicher ist nicht initialisiert.'});}
      }else{
        abgelaufeneEintraegeEntfernen(sessions);
        sessions.set(token,ablauf.getTime());
      }
      return reply(res,200,{success:true,csrfToken:adminCsrfToken(token)},{
        'Set-Cookie':`${cookieName}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`
      });
    }

    if(route==='/api/admin/csrf'&&req.method==='GET'){
      if(!await admin(req,res))return;
      const token=(req.headers.cookie||'').match(/(?:^|;\s*)brilon_session=([a-f0-9]{64})/)?.[1];
      return reply(res,200,{csrfToken:adminCsrfToken(token)});
    }

    // Nur Vorschau: keine Buchung und kein Zahlungssaldo wird veraendert.
    if(route==='/api/admin/anschlussrabatt/vorschau'&&req.method==='POST'){
      if(!await admin(req,res))return;
      const d=await body(req);
      if(!d||!Array.isArray(d.programme)||d.programme.length<2||d.programme.length>20)
        return reply(res,400,{error:'Bitte 2 bis 20 Programme angeben.'});
      try{
        const positionen=anschlussrabatte(d.programme);
        return reply(res,200,{
          positionen,
          rabattGesamtCent:positionen.reduce((sum,p)=>sum+p.rabattCent,0),
          endpreisGesamtCent:positionen.reduce((sum,p)=>sum+p.endpreisCent,0)
        });
      }catch(fehler){
        return reply(res,400,{error:fehler.message});
      }
    }

    if(route==='/api/admin/anschlussrabatt/anwenden'&&req.method==='POST'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      const d=await body(req),ids=Array.isArray(d?.buchungsIds)?[...new Set(d.buchungsIds)]:[];
      if(ids.length<2||ids.length>20||ids.some(id=>typeof id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)))
        return reply(res,400,{error:'Bitte 2 bis 20 gültige Buchungen auswählen.'});
      const ergebnis=await reservierungsTransaktion(async client=>{
        const q=await client.query(
          `SELECT id,status,data FROM brilon_buchungen WHERE id=ANY($1::uuid[]) FOR UPDATE`,[ids]
        );
        if(q.rowCount!==ids.length)return {ungueltig:true};
        if(q.rows.some(b=>b.status!=='bestaetigt'))return {nichtBestaetigt:true};
        const datum=q.rows[0].data.datum;
        if(q.rows.some(b=>b.data.datum!==datum))return {verschiedeneTage:true};
        if(q.rows.some(b=>b.data.anschlussRabatt10||Number(b.data.anschlussRabattCent)>0))
          return {bereitsRabattiert:true};
        const programme=q.rows.map(b=>{
          const fenster=buchungsfenster(b.data);
          if(!fenster||!Number.isFinite(Number(b.data.gesamtpreis)))throw new Error('Preis oder Zeitfenster fehlt.');
          const start=new Date(datum+'T00:00:00Z').getTime()+fenster[0]*60000;
          const ende=new Date(datum+'T00:00:00Z').getTime()+fenster[1]*60000;
          return {id:b.id,start:new Date(start).toISOString(),ende:new Date(ende).toISOString(),
            preisCent:Math.round(Number(b.data.gesamtpreis)*100)};
        });
        let positionen;
        try{positionen=anschlussrabatte(programme);}catch(error){return {ungueltig:true,fehler:error.message};}
        const nachPosition=new Map(positionen.map(p=>[p.id,p]));
        const updates=[];
        for(const buchung of q.rows){
          const position=nachPosition.get(buchung.id);
          if(!position?.rabattCent)continue;
          const data=buchung.data,alterCent=position.originalCent,neuerCent=position.endpreisCent;
          const payments=Array.isArray(data.zahlungen)?data.zahlungen:[];
          const stand=preisNachAnschlussrabatt(alterCent,position.rabattCent,payments);
          const anpassung={grund:'Anschlussrabatt 10 %',am:new Date().toISOString(),vonCent:alterCent,
            rabattCent:position.rabattCent,aufCent:neuerCent};
          data.preisanpassungen=[...(Array.isArray(data.preisanpassungen)?data.preisanpassungen:[]),anpassung];
          data.gesamtpreis=neuerCent/100;
          data.anschlussRabattCent=position.rabattCent;
          data.anschlussRabatt10=true;
          data.restbetrag=stand.offenCent/100;
          data.zahlungsgutschriftCent=stand.gutschriftCent;
          const saved=await client.query(
            'UPDATE brilon_buchungen SET data=$1::jsonb,updated_at=NOW() WHERE id=$2 RETURNING id,buchungsnummer,status,data',
            [JSON.stringify(data),buchung.id]
          );
          updates.push({buchung:saved.rows[0],rabattCent:position.rabattCent,stand});
        }
        if(!updates.length)return {keineAnschluesse:true};
        return {updates};
      });
      if(ergebnis.ungueltig)return reply(res,400,{error:ergebnis.fehler||'Ausgewählte Buchungen sind ungültig.'});
      if(ergebnis.nichtBestaetigt)return reply(res,409,{error:'Nur bestätigte Buchungen können rabattiert werden.'});
      if(ergebnis.verschiedeneTage)return reply(res,409,{error:'Alle Buchungen müssen am selben Tag stattfinden.'});
      if(ergebnis.bereitsRabattiert)return reply(res,409,{error:'Mindestens eine Buchung hat bereits einen Anschlussrabatt erhalten.'});
      if(ergebnis.keineAnschluesse)return reply(res,409,{error:'Keine direkt anschließenden Programmzeiten gefunden.'});
      for(const item of ergebnis.updates){
        const data=item.buchung.data;
        if(data.email)Promise.allSettled([brevoMail(data.email,
          'Dein Anschlussrabatt – Klettern & Abenteuer Brilon',
          `Für Buchung ${data.buchungsnummer||''} wurde ein einmaliger Anschlussrabatt von 10 % erfasst.\n`+
          `Neuer Gesamtpreis: ${Number(data.gesamtpreis).toFixed(2).replace('.',',')} €\n`+
          `Eingegangen: ${(item.stand.erhaltenCent/100).toFixed(2).replace('.',',')} €\n`+
          `Noch offen: ${(item.stand.offenCent/100).toFixed(2).replace('.',',')} €\n`+
          (data.zahlungsgutschriftCent?`Zahlungsgutschrift: ${(data.zahlungsgutschriftCent/100).toFixed(2).replace('.',',')} € – bitte manuell ausgleichen.\n`:'')+
          `\nBei Fragen melde dich bitte bei uns.`)]).then(results=>results.forEach(r=>{
            if(r.status==='rejected')console.error('Anschlussrabatt-E-Mail konnte nicht versendet werden.');
          }));
      }
      return reply(res,200,{success:true,updates:ergebnis.updates.map(x=>({
        id:x.buchung.id,buchungsnummer:x.buchung.buchungsnummer,rabattCent:x.rabattCent,
        gesamtpreis:x.buchung.data.gesamtpreis,restbetrag:x.stand.offenCent/100,
        zahlungsgutschriftCent:x.buchung.data.zahlungsgutschriftCent
      }))});
    }

    if(route==='/api/admin/logout'&&req.method==='POST'){
      const match=(req.headers.cookie||'').match(/brilon_session=([a-f0-9]{64})/);
      if(!await admin(req,res))return;
      if(match){
        if(pool){
          try{await pool.query('DELETE FROM brilon_admin_sessions WHERE token_hash=$1',[gpsTokenHash(match[1])]);}
          catch{return reply(res,503,{error:'Admin-Sitzung konnte nicht beendet werden.'});}
        }else sessions.delete(match[1]);
      }
      return reply(res,200,{success:true},{
        'Set-Cookie':`${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
      });
    }

    const zahlungenRoute = route.match(/^\/api\/admin\/buchungen\/([0-9a-fA-F-]{36})\/zahlungen$/);
    if(zahlungenRoute&&req.method==='POST'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      const d=await body(req);
      const betragText=typeof d.betrag==='string'?d.betrag:String(d.betrag??'');
      if(!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(betragText))
        return reply(res,400,{error:'Bitte einen gültigen Zahlbetrag eingeben.'});
      const betragCent=Math.round(Number(betragText.replace(',','.'))*100);
      if(!Number.isSafeInteger(betragCent)||betragCent<=0)
        return reply(res,400,{error:'Der Zahlbetrag muss größer als 0 € sein.'});
      const methode=safeText(d.methode,24);
      if(!['ueberweisung','bar','karte','sonstiges'].includes(methode))
        return reply(res,400,{error:'Bitte eine gültige Zahlungsart auswählen.'});
      const ergebnis=await reservierungsTransaktion(async client=>{
        const q=await client.query(
          'SELECT id,data,status FROM brilon_buchungen WHERE id=$1 FOR UPDATE',
          [zahlungenRoute[1]]
        );
        if(!q.rowCount)return {fehlt:true};
        const data=q.rows[0].data;
        if(typeof data.gesamtpreis!=='number'||!Number.isFinite(data.gesamtpreis)||data.gesamtpreis<0)
          return {keinPreis:true};
        const zahlungen=Array.isArray(data.zahlungen)?data.zahlungen:[];
        const gesamtCent=Math.round(Number(data.gesamtpreis)*100);
        let zahlungsErgebnis;
        try { zahlungsErgebnis=zahlungErgaenzen(gesamtCent,zahlungen,betragCent,methode); }
        catch(error){
          if(error.message.includes('offenen Rest'))
            return {ueberzahlung:true,offenCent:zahlungsstand(gesamtCent,zahlungen).offenCent};
          throw error;
        }
        const zahlung={
          id:crypto.randomUUID(),
          betragCent,
          methode,
          erhaltenAm:new Date().toISOString(),
          notiz:safeText(d.notiz,300),
          erfasstVon:safeText(process.env.ADMIN_USER,100)||'admin'
        };
        data.zahlungen=[...zahlungen,zahlung];
        const neuerStand=zahlungsstand(Math.round(Number(data.gesamtpreis)*100),data.zahlungen);
        const neuerStatus=neuerStand.anzahlungErreicht&&q.rows[0].status==='offen'
          ?'bestaetigt':q.rows[0].status;
        const elternRabatt=neuerStatus==='bestaetigt'
          ?await anschlussRabattElternAnwenden(client,data,q.rows[0].id):{angewendet:false};
        if(elternRabatt.ungueltig)return {anschlussElternUngueltig:true};
        const gespeichert=await client.query(
          `UPDATE brilon_buchungen SET data=$1::jsonb,status=$2,updated_at=NOW()
           WHERE id=$3 RETURNING id,data,status`,
          [JSON.stringify(data),neuerStatus,q.rows[0].id]
        );
        return {
          buchung:gespeichert.rows[0],zahlung,stand:neuerStand,
          bestaetigtJetzt:neuerStatus!==q.rows[0].status,elternRabatt
        };
      });
      if(ergebnis.anschlussElternUngueltig)return reply(res,409,{error:'Die Ursprungsbuchung ist nicht mehr bestätigt.'});
      if(ergebnis.fehlt)return reply(res,404,{error:'Buchung nicht gefunden.'});
      if(ergebnis.keinPreis)return reply(res,409,{error:'Für diese Buchung ist kein Gesamtpreis hinterlegt.'});
      if(ergebnis.ueberzahlung)return reply(res,409,{
        error:'Der Betrag übersteigt den noch offenen Betrag.',
        offenCent:ergebnis.offenCent
      });
      if(ergebnis.bestaetigtJetzt){
        const data=ergebnis.buchung.data;
        const bestaetigungsText=`Deine Buchung ${data.buchungsnummer || ''} ist verbindlich bestätigt.\n`+
          `Gesamtpreis: ${(ergebnis.stand.gesamtCent/100).toFixed(2).replace('.',',')} €\n`+
          `Anzahlung (25 %): ${(ergebnis.stand.anzahlungCent/100).toFixed(2).replace('.',',')} €\n`+
          `Tatsächlich erfasst: ${(ergebnis.stand.erhaltenCent/100).toFixed(2).replace('.',',')} €\n`+
          `Offener Restbetrag: ${(ergebnis.stand.offenCent/100).toFixed(2).replace('.',',')} €\n\n`+
          `Termin: ${data.datum} um ${data.uhrzeit} Uhr`+
          (ergebnis.elternRabatt?.angewendet?'\nDer 10-%-Anschlussrabatt wurde auch auf deine ursprüngliche Buchung angewendet.':'');
        const offerLink=anschlussLink(ergebnis.buchung.id);
        const angeboteText=offerLink?`\n\nPassende Anschlussprogramme mit 10 % Rabatt findest du hier:\n${offerLink}`:'';
        const mails=[brevoMail(data.email,'Deine Buchung ist bestätigt – Klettern & Abenteuer Brilon',
          `Hallo ${data.name || ''},\n\n${bestaetigungsText}${angeboteText}\n\nGut Seil!\nKlettern & Abenteuer Brilon`)];
        if(process.env.BOOKING_NOTIFY_EMAIL)mails.push(brevoMail(
          process.env.BOOKING_NOTIFY_EMAIL,'Buchung bestätigt – Zahlungseingang erfasst',
          `${bestaetigungsText}\n\nKundin/Kunde: ${data.name || ''} · ${data.email || ''}`
        ));
        Promise.allSettled(mails).then(results=>results.forEach(result=>{
          if(result.status==='rejected')console.error('Buchungsbestätigung konnte nicht versendet werden.');
        }));
      }
      return reply(res,201,ergebnis);
    }

    if(route.match(/^\/api\/admin\/buchungen\/[0-9a-f-]{36}$/)&&req.method==='PATCH'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});

      const id=route.split('/').pop(),d=await body(req);
      if(!d||typeof d!=='object'||Array.isArray(d))
        return reply(res,400,{error:'Ungültige Eingabe.'});

      if(d.zahlungsstatus!==undefined)
        return reply(res,400,{error:'Zahlungen müssen mit Betrag und Zahlungsart einzeln erfasst werden.'});

      let status = d.status,
      notiz = safeText(d.bearbeitungsnotiz, 2000);
      if(!['offen','bestaetigt','abgelehnt','storniert'].includes(status))
        return reply(res,400,{error:'Ungültiger Buchungsstatus.'});

      const ergebnis=await reservierungsTransaktion(async client=>{
        
const alt=await client.query(
  'SELECT id,data,status FROM brilon_buchungen WHERE id=$1',
  [id]
);

        if(!alt.rowCount)return {fehlt:true};
        
const alterStatus = alt.rows[0].status;
    const buchungsdaten = alt.rows[0].data;


        if(status==='offen'||status==='bestaetigt'){
          const data=alt.rows[0].data;
          const konflikt=await pruefeBuchungskonflikt(
            client,data.datum,buchungsfenster(data),id
          );
          if(konflikt)return {konflikt};
        }
        const elternRabatt=status==='bestaetigt'
          ?await anschlussRabattElternAnwenden(client,buchungsdaten,id):{angewendet:false};
        if(elternRabatt.ungueltig)return {anschlussElternUngueltig:true};
        const elternRabattZurueck=status!=='bestaetigt'&&alterStatus==='bestaetigt'&&
          ['storniert','abgelehnt'].includes(status)
          ?await anschlussRabattElternZuruecknehmen(client,buchungsdaten,id):{zurueckgenommen:false};

       const q = await client.query(
  `UPDATE brilon_buchungen
   SET status=$1,
       bearbeitungsnotiz=$2,
       data=$3::jsonb,
       updated_at=NOW()
   WHERE id=$4
   RETURNING id,status,data`,
  [status, notiz, JSON.stringify(buchungsdaten), id]
);
       
return {
  buchung: q.rows[0],
  alterStatus,
  kundenDaten: buchungsdaten,
  elternRabatt,
  elternRabattZurueck
};

      });

      if(ergebnis.fehlt)
        return reply(res,404,{error:'Buchung nicht gefunden.'});
      if(ergebnis.konflikt)
        return reply(res,409,{error:ergebnis.konflikt});
      if(ergebnis.anschlussElternUngueltig)
        return reply(res,409,{error:'Die Ursprungsbuchung ist nicht mehr bestätigt.'});

      
if (
  ergebnis.alterStatus !== status && status !== 'offen'
) {
  const kunde = ergebnis.kundenDaten;
  const empfaenger = kunde?.email;
  const gesamtCent = Number.isFinite(Number(kunde.gesamtpreis))
    ? Math.round(Number(kunde.gesamtpreis) * 100) : null;
  const stand = gesamtCent === null ? null : zahlungsstand(
    gesamtCent, Array.isArray(kunde.zahlungen) ? kunde.zahlungen : []
  );

  const nachricht=buchungsstatusNachricht(status,kunde,stand);

  if (empfaenger && nachricht) {
    const inhalt =
      `Hallo ${kunde.name || ''},\n\n` +
      `${nachricht.text}\n\n` +
      `Datum: ${kunde.datum || 'Nicht angegeben'}\n` +
      `Beginn: ${kunde.uhrzeit || 'Nach Absprache'} Uhr\n` +
      `Teilnehmer: ${kunde.teilnehmer || 'Nicht angegeben'}\n\n` +
      (status==='bestaetigt'&&anschlussLink(ergebnis.buchung.id)
        ?`Passende Anschlussprogramme mit 10 % Rabatt: ${anschlussLink(ergebnis.buchung.id)}\n\n`:'' )+
      (ergebnis.elternRabatt?.angewendet?'Der Anschlussrabatt wurde auch auf die ursprüngliche Buchung angewendet.\n\n':'')+
      (ergebnis.elternRabattZurueck?.zurueckgenommen
        ?`Der Rabatt auf die ursprüngliche Buchung wurde nach dem Storno zurückgenommen. Neuer Preis: ${(ergebnis.elternRabattZurueck.buchung.data.gesamtpreis).toFixed(2).replace('.',',')} €, offen: ${(ergebnis.elternRabattZurueck.stand.offenCent/100).toFixed(2).replace('.',',')} €.\n\n`:'' )+
      `Bei Fragen antworte bitte auf diese E-Mail.\n\n` +
      `Gut Seil!\nKlettern & Abenteuer Brilon`;

    brevoMail(empfaenger, nachricht.betreff, inhalt)
      .catch(fehler => {
        console.error('Status-E-Mail fehlgeschlagen:', fehler);
      });
  }
}

      return reply(res,200,ergebnis.buchung);
    }

    if (route.match(/^\/api\/admin\/buchungen\/[0-9a-f-]{36}\/zahlung$/)
    && req.method === 'POST') {

  if (!await admin(req, res)) return;
  if (!pool) {
    return reply(res, 503, {
      error: 'Datenbank nicht verfügbar.'
    });
  }

    const buchungsId = route.split('/')[4];

const buchungAbfrage = await pool.query(
  `SELECT id, data, status, buchungsnummer
   FROM brilon_buchungen
   WHERE id = $1`,
  [buchungsId]
);

if (!buchungAbfrage.rows.length) {
  return reply(res, 404, {
    error: 'Buchungsanfrage nicht gefunden.'
  });
}

const buchung = buchungAbfrage.rows[0];
const kunde = buchung.data;

if (
  typeof kunde.gesamtpreis !== 'number' ||
  !Number.isFinite(kunde.gesamtpreis) ||
  kunde.gesamtpreis < 0
) {
  return reply(res, 400, {
    error: 'Für diese Buchung ist kein gültiger Gesamtpreis hinterlegt.'
  });
}  
     if (!process.env.BANK_NAME || !process.env.BANK_IBAN) {
  return reply(res, 503, {
    error: 'Bankverbindung ist noch nicht vollständig eingerichtet.'
  });
} 
     const zahlungstext=zahlungsinformationenText(kunde,{
       bankName:process.env.BANK_NAME,iban:process.env.BANK_IBAN,
       bookingId:buchung.buchungsnummer||buchungsId
     });
  if (!kunde.email) {
  return reply(res, 400, {
    error: 'Für diese Buchung ist keine Kunden-E-Mail hinterlegt.'
  });
}

try {
  await brevoMail(
    kunde.email,
    'Zahlungsinformationen – Klettern & Abenteuer Brilon',
    zahlungstext
  );
  
await pool.query(
  `UPDATE brilon_buchungen
   SET zahlungsinfo_gesendet_am = NOW()
   WHERE id = $1`,
  [buchungsId]
);


  return reply(res, 200, {
    success: true,
    message: 'Zahlungsinformationen wurden versendet.'
  });
} catch (fehler) {
  console.error('Zahlungs-E-Mail fehlgeschlagen:', fehler);

  return reply(res, 502, {
    error: 'Die Zahlungs-E-Mail konnte nicht versendet werden.'
  });
}
}
    if(route==='/api/admin/kalender'&&req.method==='GET'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      const q=await pool.query(
        'SELECT id,titel,datum::text AS datum,enddatum::text AS enddatum,uhrzeit::text AS uhrzeit,endzeit::text AS endzeit,typ,beschreibung FROM brilon_kalender ORDER BY datum,uhrzeit NULLS LAST LIMIT 1000'
      );
      return reply(res,200,q.rows);
    }

    if(route==='/api/admin/kalender'&&req.method==='POST'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});

      const d=await body(req);
      if(!d||typeof d!=='object'||Array.isArray(d))
        return reply(res,400,{error:'Ungültige Eingabe.'});

      const titel=safeText(d.titel,120);
      const datum=safeText(d.datum,10);
      const enddatum=safeText(d.enddatum,10)||null;
      const uhrzeit=safeText(d.uhrzeit,5)||null;
      const endzeit=safeText(d.endzeit,5)||null;
      const typ=safeText(d.typ,20);
      const beschreibung=safeText(d.beschreibung,1000),
preis=safeText(d.preis,50);

      const gueltigesDatum=v=>{
        if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
        const t=new Date(v+'T12:00:00Z');
        return !Number.isNaN(t.getTime())&&
          t.toISOString().slice(0,10)===v;
      };

      if(!titel||!gueltigesDatum(datum)||
         (enddatum&&(!gueltigesDatum(enddatum)||enddatum<datum))||
         (uhrzeit&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(uhrzeit))||
         (endzeit&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(endzeit))||
         !['termin','sperrzeit'].includes(typ))
        return reply(res,400,{error:'Ungültige Kalenderdaten.'});

      const q=await pool.query(
        'INSERT INTO brilon_kalender(titel,datum,enddatum,uhrzeit,endzeit,typ,beschreibung) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [titel,datum,enddatum,uhrzeit,endzeit,typ,beschreibung]
      );
      return reply(res,201,{id:q.rows[0].id});
    }

    if(/^\/api\/admin\/kalender\/[0-9a-fA-F-]{36}$/.test(route)&&req.method==='DELETE'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});

      const id=route.split('/').pop();
      const q=await pool.query(
        'DELETE FROM brilon_kalender WHERE id=$1 RETURNING id',[id]
      );
      if(!q.rowCount)
        return reply(res,404,{error:'Kalendereintrag nicht gefunden.'});
      return reply(res,200,{success:true});
    }

    if(/^\/api\/admin\/kalender\/[0-9a-fA-F-]{36}$/.test(route)&&req.method==='PATCH'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});

      const id=route.split('/').pop();
      const d=await body(req);
      if(!d||typeof d!=='object'||Array.isArray(d))
        return reply(res,400,{error:'Ungültige Eingabe.'});

      const titel=safeText(d.titel,120);
      const datum=safeText(d.datum,10);
      const enddatum=safeText(d.enddatum,10)||null;
      const uhrzeit=safeText(d.uhrzeit,5)||null;
      const endzeit=safeText(d.endzeit,5)||null;
      const typ=safeText(d.typ,20);
      const beschreibung=safeText(d.beschreibung,1000);

      const gueltigesDatum=v=>{
        if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
        const t=new Date(v+'T12:00:00Z');
        return !Number.isNaN(t.getTime())&&t.toISOString().slice(0,10)===v;
      };

      if(!titel||!gueltigesDatum(datum)||
         (enddatum&&(!gueltigesDatum(enddatum)||enddatum<datum))||
         (uhrzeit&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(uhrzeit))||
         (endzeit&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(endzeit))||
         !['termin','sperrzeit'].includes(typ))
        return reply(res,400,{error:'Ungültige Kalenderdaten.'});

      const q=await pool.query(
        'UPDATE brilon_kalender SET titel=$1,datum=$2,enddatum=$3,uhrzeit=$4,endzeit=$5,typ=$6,beschreibung=$7 WHERE id=$8 RETURNING id',
        [titel,datum,enddatum,uhrzeit,endzeit,typ,beschreibung,id]
      );
      if(!q.rowCount)
        return reply(res,404,{error:'Kalendereintrag nicht gefunden.'});
      return reply(res,200,{success:true,id:q.rows[0].id});
    }

    if(route.startsWith('/api/admin/')){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});

      if(route==='/api/admin/gps/gaesteliste'&&req.method==='GET'){
        const tourId=safeText(u.searchParams.get('tour'),36)||null;
        if(tourId&&!/^[0-9a-f-]{36}$/i.test(tourId))
          return reply(res,400,{error:'Tour-ID ungültig.'});
        const q=await pool.query(
          `SELECT g.id,g.gast_name AS name,to_char(g.abgeschlossen_am,'YYYY-MM-DD') AS datum,
                  g.gast_einwilligung_am AS einwilligung_am,
                  g.gast_einwilligung_version AS einwilligung_version,
                  g.spielzeit_sekunden AS dauer_sekunden,t.data->>'titel' AS tour
           FROM brilon_gps_spiele g JOIN brilon_gps_touren t ON t.id=g.tour_id
           WHERE g.gast_einwilligung=true AND g.gast_name IS NOT NULL
             AND g.abgeschlossen_am IS NOT NULL AND ($1::uuid IS NULL OR g.tour_id=$1::uuid)
           ORDER BY g.abgeschlossen_am DESC LIMIT 500`,[tourId]
        );
        return reply(res,200,q.rows);
      }

      if(route==='/api/admin/kalenderbuchungen'&&req.method==='GET'){
        const monat=safeText(u.searchParams.get('monat'),7);
        const match=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(monat);
        if(!match||Number(match[1])<1900||Number(match[1])>9998)
          return reply(res,400,{error:'Ungültiger Kalendermonat.'});
        const start=monat+'-01';
        const endDate=new Date(Date.UTC(Number(match[1]),Number(match[2]),1));
        const ende=endDate.toISOString().slice(0,10);
        const q=await pool.query(
          `SELECT id,data,status,created_at
           FROM brilon_buchungen
           WHERE data->>'datum'>=$1 AND data->>'datum'<$2
             AND COALESCE(status,'offen') IN ('offen','bestaetigt')
           ORDER BY data->>'datum',data->>'uhrzeit',created_at`,[start,ende]
        );
        return reply(res,200,q.rows);
      }

      if(route==='/api/admin/zahlungsuebersicht'&&req.method==='GET'){
        const seiteText=u.searchParams.get('seite')||'1',seite=Number(seiteText),proSeite=50;
        const filter=safeText(u.searchParams.get('filter'),20)||'alle';
        const erlaubteFilter=['alle','offen','teilzahlung','vollstaendig','gutschrift'];
        if(!/^\d+$/.test(seiteText)||!Number.isSafeInteger(seite)||seite<1||seite>100000)
          return reply(res,400,{error:'Ungültige Zahlungsseite.'});
        if(!erlaubteFilter.includes(filter))return reply(res,400,{error:'Ungültiger Zahlungsfilter.'});
        const q=await pool.query(
          `SELECT id,status,buchungsnummer,
             jsonb_build_object(
               'buchungsnummer',data->'buchungsnummer','name',data->'name','angebot',data->'angebot',
               'datum',data->'datum','gesamtpreis',data->'gesamtpreis','zahlungen',data->'zahlungen',
               'zahlungsgutschriftCent',data->'zahlungsgutschriftCent'
             ) AS data
           FROM brilon_buchungen ORDER BY created_at DESC`
        );
        const totals=zahlungenSummieren(q.rows);
        const gefiltert=totals.eintraege.filter(e=>{
          if(filter==='offen')return e.offenCent>0;
          if(filter==='teilzahlung')return e.eingegangenCent>0&&e.offenCent>0;
          if(filter==='vollstaendig')return e.gesamtpreisCent!==null&&e.gesamtpreisCent>0&&e.eingegangenCent>=e.gesamtpreisCent;
          if(filter==='gutschrift')return e.gutschriftCent>0;
          return true;
        });
        return reply(res,200,{
          eintraege:gefiltert.slice((seite-1)*proSeite,seite*proSeite),anzahl:gefiltert.length,
          seite,proSeite,summen:{eingegangenCent:totals.eingegangenCent,offenCent:totals.offenCent,
            gutschriftCent:totals.gutschriftCent,zahlungseingaenge:totals.zahlungseingaenge}
        });
      }

      const guestbookEntry=route.match(/^\/api\/admin\/gps\/gaesteliste\/([0-9a-f-]{36})$/i);
      if(guestbookEntry&&req.method==='DELETE'){
        const q=await pool.query(
          `UPDATE brilon_gps_spiele SET gast_name=NULL,gast_einwilligung=false,gast_einwilligung_am=NULL,
             gast_einwilligung_version=NULL
           WHERE id=$1 AND gast_einwilligung=true RETURNING id`,[guestbookEntry[1]]
        );
        if(!q.rowCount)return reply(res,404,{error:'Freigegebener Gästelisteneintrag nicht gefunden.'});
        return reply(res,200,{success:true});
      }

      if(route==='/api/admin/gps/touren'&&req.method==='GET'){
        const q=await pool.query('SELECT id,data,aktiv,erstellt_am,aktualisiert_am FROM brilon_gps_touren ORDER BY erstellt_am DESC');
        return reply(res,200,q.rows.map(r=>({id:r.id,...gpsTourAdminAnsicht(r.data),aktiv:r.aktiv,
          erstelltAm:r.erstellt_am,aktualisiertAm:r.aktualisiert_am})));
      }

      if(route==='/api/admin/gps/touren'&&req.method==='POST'){
        const d=await body(req);
        let data;
        try{data=gpsTourSpeichern(d,null,process.env.GPS_CODE_SECRET);}catch(error){return reply(res,400,{error:error.message});}
        const id=crypto.randomUUID(),aktiv=d.aktiv===true&&data.buchbar;
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          const offer=await client.query(
            `INSERT INTO brilon_angebote(name,beschreibung,dauer,preise,aktiv)
             VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id`,
            [data.angebotName,data.beschreibung,data.dauer,
              JSON.stringify({'1-4':data.preis,'5-10':data.preis,'11-15':data.preis,'16-20':data.preis,'21-150':data.preis}),aktiv]
          );
          await client.query('INSERT INTO brilon_gps_touren(id,angebot_id,data,aktiv) VALUES($1,$2,$3::jsonb,$4)',
            [id,offer.rows[0].id,JSON.stringify(data),aktiv]);
          await client.query('COMMIT');
        }catch(error){try{await client.query('ROLLBACK')}catch{};throw error;}
        finally{client.release();}
        return reply(res,201,{id,aktiv,angebotName:data.angebotName});
      }

      const tourRoute=route.match(/^\/api\/admin\/gps\/touren\/([0-9a-fA-F-]{36})$/);
      if(tourRoute&&req.method==='PATCH'){
        const d=await body(req);
        if(typeof d.aktiv==='boolean'&&d.stationen===undefined){
          const status=await pool.query(
            'UPDATE brilon_gps_touren SET aktiv=$1,aktualisiert_am=NOW() WHERE id=$2 RETURNING id,aktiv',
            [d.aktiv,tourRoute[1]]
          );
          if(!status.rowCount)return reply(res,404,{error:'GPS-Tour nicht gefunden.'});
          const offerId=await pool.query('SELECT angebot_id,data FROM brilon_gps_touren WHERE id=$1',[tourRoute[1]]);
          if(offerId.rows[0].angebot_id)await pool.query('UPDATE brilon_angebote SET aktiv=$1 WHERE id=$2',
            [d.aktiv&&offerId.rows[0].data.buchbar,offerId.rows[0].angebot_id]);
          return reply(res,200,status.rows[0]);
        }
        const aktuell=await pool.query('SELECT data,angebot_id FROM brilon_gps_touren WHERE id=$1',[tourRoute[1]]);
        if(!aktuell.rowCount)return reply(res,404,{error:'GPS-Tour nicht gefunden.'});
        let data;
        try{data=gpsTourSpeichern(d,aktuell.rows[0].data,process.env.GPS_CODE_SECRET);}catch(error){return reply(res,400,{error:error.message});}
        const aktiv=typeof d.aktiv==='boolean'?d.aktiv:null;
        const q=await pool.query(
          'UPDATE brilon_gps_touren SET data=$1::jsonb,aktiv=COALESCE($2,aktiv),aktualisiert_am=NOW() WHERE id=$3 RETURNING id,aktiv',
          [JSON.stringify(data),aktiv===true&&!data.buchbar?false:aktiv,tourRoute[1]]
        );
        if(aktuell.rows[0].angebot_id)await pool.query(
          `UPDATE brilon_angebote SET name=$1,beschreibung=$2,dauer=$3,preise=$4::jsonb,aktiv=$5 WHERE id=$6`,
          [data.angebotName,data.beschreibung,data.dauer,
            JSON.stringify({'1-4':data.preis,'5-10':data.preis,'11-15':data.preis,'16-20':data.preis,'21-150':data.preis}),
            q.rows[0].aktiv&&data.buchbar,aktuell.rows[0].angebot_id]
        );
        return reply(res,200,{id:q.rows[0].id,aktiv:q.rows[0].aktiv});
      }

      if(route==='/api/admin/gps/spiele'&&req.method==='POST'){
        const d=await body(req),tourId=safeText(d.tourId,36),buchungId=safeText(d.buchungId,36);
        if(!/^[0-9a-f-]{36}$/i.test(tourId)||!/^[0-9a-f-]{36}$/i.test(buchungId))
          return reply(res,400,{error:'Tour und bestätigte Buchung auswählen.'});
        const zulassung=await pool.query(
          `SELECT t.id FROM brilon_gps_touren t JOIN brilon_buchungen b ON b.id=$2
           WHERE t.id=$1 AND t.aktiv=true AND t.data->>'buchbar'='true'
             AND b.status='bestaetigt' AND b.data->>'angebot'=t.data->>'angebotName'`,
          [tourId,buchungId]
        );
        if(!zulassung.rowCount)return reply(res,409,{error:'Tour oder Buchung ist nicht freigegeben.'});
        const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID();
        await pool.query(
          'INSERT INTO brilon_gps_spiele(id,token_hash,tour_id,buchung_id) VALUES($1,$2,$3,$4)',
          [id,gpsTokenHash(token),tourId,buchungId]
        );
        return reply(res,201,{id,zugangslink:`/gps.html?zugang=${encodeURIComponent(token)}`});
      }

      // Lesende Uebersicht: angrenzende bestaetigte Buchungen am selben Tag.
      // Keine automatische Rabattberechtigung und keine Preisveraenderung.
      if(route==='/api/admin/anschlussrabatt/kandidaten'&&req.method==='GET'){
        const datum=u.searchParams.get('datum')||'';
        if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(datum))
          return reply(res,400,{error:'Datum im Format YYYY-MM-DD erforderlich.'});
        const q=await pool.query(
          `SELECT id,buchungsnummer,data FROM brilon_buchungen
           WHERE data->>'datum'=$1 AND status='bestaetigt'
           ORDER BY data->>'uhrzeit',created_at`,
          [datum]
        );
        const kandidaten=q.rows.map(b=>{
          const fenster=buchungsfenster(b.data);
          return {
            id:b.id,
            buchungsnummer:b.buchungsnummer||b.data.buchungsnummer||null,
            angebot:b.data.angebot,
            uhrzeit:b.data.uhrzeit,
            beginnMinuten:fenster?fenster[0]:null,
            endeMinuten:fenster?fenster[1]:null,
            preisCent:Number.isFinite(Number(b.data.gesamtpreis))
              &&b.data.gesamtpreis!==null
              ?Math.round(Number(b.data.gesamtpreis)*100):null
          };
        });
        return reply(res,200,{datum,kandidaten,hinweis:
          'Nur Zeituebersicht. Rabatte, Kapazitaet und Zahlungen muessen gesondert geprueft werden.'});
      }

      if(route==='/api/admin/buchungen'&&req.method==='GET'){
        const statusFilter=safeText(u.searchParams.get('status'),20)||'alle';
        const allowedStatus=['alle','offen','bestaetigt','abgelehnt','storniert'];
        if(!allowedStatus.includes(statusFilter))return reply(res,400,{error:'Ungültiger Statusfilter.'});
        const suchtext=safeText(u.searchParams.get('suche'),120);
        if(u.searchParams.has('seite')){
          const seiteText=u.searchParams.get('seite'),seite=Number(seiteText),proSeite=50;
          if(!/^\d+$/.test(seiteText)||!Number.isSafeInteger(seite)||seite<1||seite>100000)
            return reply(res,400,{error:'Ungültige Buchungsseite.'});
          const filterParams=[statusFilter,suchtext];
          const where=`WHERE ($1::text='alle' OR COALESCE(status,'offen')=$1)
             AND ($2::text='' OR concat_ws(' ',data->>'name',buchungsnummer,data->>'buchungsnummer',
               data->>'email',data->>'angebot') ILIKE '%' || $2 || '%')`;
          const count=await pool.query(`SELECT COUNT(*)::text AS anzahl FROM brilon_buchungen ${where}`,filterParams);
          const q=await pool.query(
            `SELECT id,data,status,bearbeitungsnotiz,created_at,updated_at,zahlungsinfo_gesendet_am
             FROM brilon_buchungen ${where}
             ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
            [...filterParams,proSeite,(seite-1)*proSeite]
          );
          return reply(res,200,{buchungen:q.rows,anzahl:Number(count.rows[0]?.anzahl||0),seite,proSeite});
        }
        const q=await pool.query(
          `SELECT id,data,status,bearbeitungsnotiz,created_at,updated_at,zahlungsinfo_gesendet_am
           FROM brilon_buchungen
           WHERE ($1::text='alle' OR COALESCE(status,'offen')=$1)
             AND ($2::text='' OR concat_ws(' ',data->>'name',buchungsnummer,data->>'buchungsnummer',
               data->>'email',data->>'angebot') ILIKE '%' || $2 || '%')
           ORDER BY created_at DESC LIMIT 250`,[statusFilter,suchtext]
        );
        return reply(res,200,q.rows);
      }

      const buchungsExport=route.match(/^\/api\/admin\/buchungen\/([0-9a-fA-F-]{36})\/export$/);
      if(buchungsExport&&req.method==='GET'){
        const q=await pool.query(
          `SELECT id,data,status,created_at,updated_at,zahlungsinfo_gesendet_am
           FROM brilon_buchungen WHERE id=$1`,[buchungsExport[1]]
        );
        if(!q.rowCount)return reply(res,404,{error:'Buchungsanfrage nicht gefunden.'});
        const selected=q.rows[0],selectedData=selected.data||{};
        const kontaktEmail=typeof selectedData.email==='string'?selectedData.email.trim():'';
        const kundenBuchungen=kontaktEmail
          ?await pool.query(
            `SELECT id,data,status,buchungsnummer,created_at,updated_at,zahlungsinfo_gesendet_am
             FROM brilon_buchungen
             WHERE LOWER(BTRIM(data->>'email'))=LOWER($1)
             ORDER BY created_at,id`,[kontaktEmail]
          )
          :{rows:[selected]};
        const buchungsIds=kundenBuchungen.rows.map(row=>row.id);
        const gps=await pool.query(
          `SELECT t.data->>'titel' AS tour,g.gestartet_am AS gestartet_am,
                  g.abgeschlossen_am AS abgeschlossen_am,g.spielzeit_sekunden AS spielzeit_sekunden,
                  g.station_index AS station_index,g.gast_name AS gast_name,
                  g.gast_einwilligung AS gast_einwilligung,
                  g.gast_einwilligung_am AS einwilligung_am,
                  g.gast_einwilligung_version AS einwilligung_version
           FROM brilon_gps_spiele g JOIN brilon_gps_touren t ON t.id=g.tour_id
           WHERE g.buchung_id=ANY($1::uuid[]) ORDER BY g.erstellt_am`,[buchungsIds]
        );
        const exportDatensatz={
          exportformat:'klettern-abenteuer-kundendaten-v2',exportiertAm:new Date().toISOString(),
          kontaktEmail:kontaktEmail||null,
          buchungen:kundenBuchungen.rows.map(row=>{
            const data=row.data||{};
            return {
              kunde:{vorname:data.vorname||null,nachname:data.nachname||null,name:data.name||null,
                email:data.email||null,telefon:data.telefon||null},
              buchung:{referenz:row.buchungsnummer||data.buchungsnummer||null,status:row.status||'offen',
                angebot:data.angebot||null,datum:data.datum||null,uhrzeit:data.uhrzeit||null,
                teilnehmer:data.teilnehmer??null,dauer:data.dauer??null,nachricht:data.nachricht||null,
                erstelltAm:row.created_at||null,aktualisiertAm:row.updated_at||null,
                zahlungsinformationenGesendetAm:row.zahlungsinfo_gesendet_am||null},
              zahlung:{gesamtpreis:data.gesamtpreis??null,anzahlung:data.anzahlung??null,restbetrag:data.restbetrag??null,
                zahlungsgutschriftCent:data.zahlungsgutschriftCent??0,
                zahlungen:(Array.isArray(data.zahlungen)?data.zahlungen:[])
                  .filter(z=>Number.isSafeInteger(z?.betragCent)&&z.betragCent>0)
                  .map(z=>({betragCent:z.betragCent,methode:z.methode||null,erhaltenAm:z.erhaltenAm||null})),
                preisanpassungen:Array.isArray(data.preisanpassungen)?data.preisanpassungen:[]},
              datenschutzangabe:data.datenschutz||null,
              gpsSpiele:gps.rows.filter(spiel=>spiel.buchung_id===row.id)
                .map(spiel=>({tour:spiel.tour||null,gestartetAm:spiel.gestartet_am||null,
                  abgeschlossenAm:spiel.abgeschlossen_am||null,spielzeitSekunden:spiel.spielzeit_sekunden??null,
                  erreichteStation:spiel.station_index??null,
                  gaestelistenName:spiel.gast_einwilligung===true?spiel.gast_name||null:null,
                  oeffentlicheEinwilligung:spiel.gast_einwilligung===true,
                  einwilligungAm:spiel.einwilligung_am||null,einwilligungVersion:spiel.einwilligung_version||null}))
            };
          })
        };
        return reply(res,200,exportDatensatz,{'Content-Disposition':`attachment; filename="buchung-${buchungsExport[1]}.json"`});
      }

      const buchungLoeschen=route.match(
        /^\/api\/admin\/buchungen\/([0-9a-fA-F-]{36})$/
      );
      if(buchungLoeschen&&req.method==='DELETE'){
        if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
        const id=buchungLoeschen[1];
        const loeschung=await reservierungsTransaktion(async client=>{
          const buchung=await client.query('SELECT id,data FROM brilon_buchungen WHERE id=$1 FOR UPDATE',[id]);
          if(!buchung.rowCount)return {nichtGefunden:true};
          const data=buchung.rows[0].data||{};
          const kindBuchung=await client.query(
            `SELECT id FROM brilon_buchungen WHERE data->>'anschlussElternId'=$1 LIMIT 1`,[id]
          );
          if(data.anschlussElternId||data.anschlussRabattQuelleId||kindBuchung.rowCount)
            return {anschlussVerknuepft:true};
          const gps=await client.query('DELETE FROM brilon_gps_spiele WHERE buchung_id=$1',[id]);
          const entfernt=await client.query('DELETE FROM brilon_buchungen WHERE id=$1 RETURNING id',[id]);
          return {geloescht:entfernt.rowCount===1,gpsSpieleGeloescht:gps.rowCount};
        });
        if(loeschung.nichtGefunden)
          return reply(res,404,{error:'Buchungsanfrage nicht gefunden.'});
        if(loeschung.anschlussVerknuepft)
          return reply(res,409,{error:'Diese Buchung ist mit einem Anschlussrabatt verknüpft. Bitte stornieren, damit Zahlungs- und Rabattverlauf erhalten bleiben.'});
        if(!loeschung.geloescht)return reply(res,409,{error:'Buchung konnte nicht gelöscht werden.'});
        return reply(res,200,{success:true,gpsSpieleGeloescht:loeschung.gpsSpieleGeloescht});
      }

      if(route==='/api/admin/aktionen'&&req.method==='POST'){
        const d=await body(req),
      titel=safeText(d.titel,120),
      datum=safeText(d.datum,10)||null,
      beschreibung=safeText(d.beschreibung,1000),
      preis=safeText(d.preis,50);
        if(!titel||datum&&!/^\d{4}-\d{2}-\d{2}$/.test(datum))
          return reply(res,400,{error:'Ungültige Eingabe.'});
        const q=await pool.query(
          'INSERT INTO brilon_aktionen(id,data) VALUES ($1,$2) RETURNING id',
          [crypto.randomUUID(),JSON.stringify({titel,datum,beschreibung,preis})]
        );
        return reply(res,201,{id:q.rows[0].id});
      }

      const m=route.match(/^\/api\/admin\/aktionen\/([0-9a-fA-F-]{36})$/);
      if(m&&req.method==='DELETE'){
        await pool.query('DELETE FROM brilon_aktionen WHERE id=$1',[m[1]]);
        return reply(res,200,{success:true});
      }
     
  
if(route==='/api/admin/orte'&&req.method==='GET'){
  const q=await pool.query('SELECT id,name,aktiv FROM brilon_orte WHERE aktiv=true ORDER BY name');
  return reply(res,200,q.rows);
}
if(route==='/api/admin/orte'&&req.method==='POST'){
  const d=await body(req),name=safeText(d.name,80);
  if(!name)return reply(res,400,{error:'Ort ist erforderlich.'});
  const q=await pool.query(
    `INSERT INTO brilon_orte(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET aktiv=true RETURNING id,name,aktiv`,[name]
  );
  return reply(res,201,q.rows[0]);
}

if (route === '/api/admin/angebote' && req.method === 'GET') {
  const q = await pool.query(
    `SELECT id,name,beschreibung,dauer,preise,aktiv,bild_url,kategorie,zielgruppe,
            veranstaltungsort,kapazitaet,verfuegbare_termine,hinweise,buchbar,veroeffentlicht
     FROM brilon_angebote
     ORDER BY id DESC`
  );

  return reply(res, 200, q.rows);
}
  
if (route === '/api/admin/angebote' && req.method === 'POST') {
  const d = await body(req);

  const name = safeText(d.name, 120);
  const beschreibung = safeText(d.beschreibung, 1000);
  const dauer = Number(d.dauer);
  const kategorie=safeText(d.kategorie,60)||'Klettern';
  const zielgruppe=safeText(d.zielgruppe,120);
  const veranstaltungsort=safeText(d.veranstaltungsort,80)||'Brilon';
  const kapazitaet=Number(d.kapazitaet||20);
  const hinweise=safeText(d.hinweise,1000);
  const termine=Array.isArray(d.verfuegbare_termine)?d.verfuegbare_termine:[];

  if (!name || !Number.isInteger(dauer) ||
      dauer < 15 || dauer > 1440 || !Number.isInteger(kapazitaet)||kapazitaet<1||kapazitaet>500||
      termine.some(t=>!gueltigesDatum(t))) {
    return reply(res, 400, {
      error: 'Bitte Name, Dauer, Kapazität und gültige Termine eingeben.'
    });
  }

  const place=await pool.query('SELECT id FROM brilon_orte WHERE name=$1 AND aktiv=true',[veranstaltungsort]);
  if(!place.rowCount)return reply(res,400,{error:'Veranstaltungsort ist nicht angelegt.'});

  const q = await pool.query(
    `INSERT INTO brilon_angebote
      (name,beschreibung,dauer,preise,aktiv,kategorie,zielgruppe,veranstaltungsort,kapazitaet,
       verfuegbare_termine,hinweise,buchbar,veroeffentlicht)
     VALUES ($1,$2,$3,'{}',false,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
     RETURNING id`,
    [name,beschreibung,dauer,kategorie,zielgruppe,veranstaltungsort,kapazitaet,
      JSON.stringify(termine),hinweise,d.buchbar===true,d.veroeffentlicht===true]
  );

  return reply(res, 201, {
    success: true,
    id: q.rows[0].id
  });
}

     
const preisRoute = route.match(/^\/api\/admin\/angebote\/([0-9]+)$/);

if (preisRoute && req.method === 'PATCH') {
  const d = await body(req);
  const bisher=await pool.query(
    `SELECT * FROM brilon_angebote WHERE id=$1`,[preisRoute[1]]
  );
  if(!bisher.rowCount)return reply(res,404,{error:'Angebot nicht gefunden.'});
  const alt=bisher.rows[0];
  const preise = d.preise;

  if (!preise || typeof preise !== 'object' ||
      Array.isArray(preise)) {
    return reply(res, 400, {
      error: 'Ungültige Preisangaben.'
    });
  }

  const neuePreise = {};

  for (const gruppe of ['1-4','5-10','11-15','16-20','21-150']) {
    const wert = preise[gruppe];

    if (wert === '' || wert === null || wert === undefined) {
      continue;
    }

    const preis = Number(wert);

    if (!Number.isFinite(preis) || preis < 0) {
      return reply(res, 400, {
        error: 'Bitte gültige Preise eingeben.'
      });
    }

    neuePreise[gruppe] = preis;
  }

  
const aktiv = typeof d.aktiv === 'boolean' ? d.aktiv : null;
const name=d.name===undefined?alt.name:safeText(d.name,120);
const beschreibung = d.beschreibung===undefined?alt.beschreibung:safeText(d.beschreibung,1000);
const kategorie=d.kategorie===undefined?alt.kategorie:safeText(d.kategorie,60);
const zielgruppe=d.zielgruppe===undefined?alt.zielgruppe:safeText(d.zielgruppe,120);
const veranstaltungsort=d.veranstaltungsort===undefined?alt.veranstaltungsort:safeText(d.veranstaltungsort,80);
const kapazitaet=Number(d.kapazitaet??alt.kapazitaet);
const hinweise=d.hinweise===undefined?alt.hinweise:safeText(d.hinweise,1000);
const termine=Array.isArray(d.verfuegbare_termine)?d.verfuegbare_termine:alt.verfuegbare_termine;
const buchbar=typeof d.buchbar==='boolean'?d.buchbar:alt.buchbar;
const veroeffentlicht=typeof d.veroeffentlicht==='boolean'?d.veroeffentlicht:alt.veroeffentlicht;
if(!name||!kategorie||!veranstaltungsort||!Number.isInteger(kapazitaet)||kapazitaet<1||kapazitaet>500||termine.some(t=>!gueltigesDatum(t)))
  return reply(res,400,{error:'Kapazität oder verfügbare Termine sind ungültig.'});
const place=await pool.query('SELECT id FROM brilon_orte WHERE name=$1 AND aktiv=true',[veranstaltungsort]);
if(!place.rowCount)return reply(res,400,{error:'Veranstaltungsort ist nicht angelegt.'});

const q = await pool.query(
  `UPDATE brilon_angebote
   SET preise = $1::jsonb,
       aktiv = COALESCE($3, aktiv),
       name=$4,beschreibung = $5,
       kategorie=$6,zielgruppe=$7,veranstaltungsort=$8,kapazitaet=$9,
       verfuegbare_termine=$10::jsonb,hinweise=$11,buchbar=$12,veroeffentlicht=$13
   WHERE id = $2
   RETURNING id,preise,aktiv,name,beschreibung,kategorie,zielgruppe,veranstaltungsort,
             kapazitaet,verfuegbare_termine,hinweise,buchbar,veroeffentlicht`,
  [
    JSON.stringify(neuePreise),
    preisRoute[1],
    aktiv,
    name,beschreibung,kategorie,zielgruppe,veranstaltungsort,kapazitaet,
    JSON.stringify(termine),hinweise,buchbar,veroeffentlicht
  ]
);


  if (!q.rowCount) {
    return reply(res, 404, {
      error: 'Angebot nicht gefunden.'
    });
  }

  return reply(res, 200, q.rows[0]);
}
     const bildRoute = route.match(
  /^\/api\/admin\/angebote\/([0-9]+)\/bild$/
);

if (bildRoute && req.method === 'POST') {
  const angebotId = Number(bildRoute[1]);

  const erlaubteTypen = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };

  const dateityp = (req.headers['content-type'] || '')
    .split(';')[0]
    .toLowerCase();

  const endung = erlaubteTypen[dateityp];

  if (!endung) {
    return reply(res, 400, {
      error: 'Nur JPG, PNG und WebP erlaubt.'
    });
  }

  const teile = [];
  let groesse = 0;

  for await (const teil of req) {
    groesse += teil.length;

    if (groesse > 5 * 1024 * 1024) {
      return reply(res, 413, {
        error: 'Das Bild darf maximal 5 MB groß sein.'
      });
    }

    teile.push(teil);
  }

  if (!groesse) {
    return reply(res, 400, {
      error: 'Keine Bilddatei empfangen.'
    });
  }

  const bild = Buffer.concat(teile);

  const signaturen = {
    jpg: bild.length >= 3 &&
      bild[0] === 0xff && bild[1] === 0xd8 && bild[2] === 0xff,
    png: bild.length >= 8 &&
      bild.subarray(0, 8).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      ),
    webp: bild.length >= 12 &&
      bild.toString('ascii', 0, 4) === 'RIFF' &&
      bild.toString('ascii', 8, 12) === 'WEBP'
  };

  if (!signaturen[endung]) {
    return reply(res, 400, {
      error: 'Ungültige Bilddatei.'
    });
  }

  const vorhanden = await pool.query(
    'SELECT id FROM brilon_angebote WHERE id = $1',
    [angebotId]
  );

  if (!vorhanden.rowCount) {
    return reply(res, 404, {
      error: 'Angebot nicht gefunden.'
    });
  }

  const dateiname =
    angebotId + '/' + crypto.randomUUID() + '.' + endung;

      if (!supabase) return reply(res,503,{error:'Bildspeicher ist nicht konfiguriert.'});
      const { error } = await supabase.storage
    .from('angebotsbilder')
    .upload(dateiname, bild, {
      contentType: dateityp,
      upsert: false
    });

  if (error) {
    console.error('Bildupload fehlgeschlagen:', error);
    return reply(res, 502, {
      error: 'Bild konnte nicht gespeichert werden.'
    });
  }

  const { data } = supabase.storage
    .from('angebotsbilder')
    .getPublicUrl(dateiname);

  const speicherung = await pool.query(
  'UPDATE brilon_angebote SET bild_url = $1 WHERE id = $2 RETURNING id, bild_url',
  [data.publicUrl, angebotId]
);

if (speicherung.rowCount !== 1) {
  console.error('Bildadresse nicht gespeichert. Angebots-ID:', angebotId);
  return reply(res, 500, {
    error: 'Bild hochgeladen, aber Bildadresse nicht gespeichert.'
  });
}

  return reply(res, 200, {
    success: true,
    bild_url: data.publicUrl
  });
}
 const aktionsBildRoute = route.match(
  /^\/api\/admin\/aktionen\/([0-9a-fA-F-]{36})\/bild$/
);

if (aktionsBildRoute && req.method === 'POST') {
  const aktionsId = aktionsBildRoute[1];

  const erlaubteTypen = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };

  const dateityp = (req.headers['content-type'] || '')
    .split(';')[0].toLowerCase();
  const endung = erlaubteTypen[dateityp];

  if (!endung) {
    return reply(res, 400, {
      error: 'Nur JPG, PNG und WebP erlaubt.'
    });
  }

  const teile = [];
  let groesse = 0;

  for await (const teil of req) {
    groesse += teil.length;

    if (groesse > 5 * 1024 * 1024) {
      return reply(res, 413, {
        error: 'Das Bild darf maximal 5 MB groß sein.'
      });
    }

    teile.push(teil);
  }

  if (!groesse) {
    return reply(res, 400, {
      error: 'Keine Bilddatei empfangen.'
    });
  }

  const bild = Buffer.concat(teile);

  const gueltig =
    (endung === 'jpg' && bild.length >= 3 &&
      bild[0] === 0xff && bild[1] === 0xd8 && bild[2] === 0xff) ||
    (endung === 'png' && bild.length >= 8 &&
      bild.subarray(0, 8).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      )) ||
    (endung === 'webp' && bild.length >= 12 &&
      bild.toString('ascii', 0, 4) === 'RIFF' &&
      bild.toString('ascii', 8, 12) === 'WEBP');

  if (!gueltig) {
    return reply(res, 400, {
      error: 'Ungültige Bilddatei.'
    });
  }

  const vorhanden = await pool.query(
    'SELECT id FROM brilon_aktionen WHERE id = $1',
    [aktionsId]
  );

  if (!vorhanden.rowCount) {
    return reply(res, 404, {
      error: 'Sonderangebot nicht gefunden.'
    });
  }

  const dateiname =
    'sonderaktionen/' + aktionsId + '/' +
    crypto.randomUUID() + '.' + endung;

  if (!supabase) return reply(res,503,{error:'Bildspeicher ist nicht konfiguriert.'});
  const { error } = await supabase.storage
    .from('angebotsbilder')
    .upload(dateiname, bild, {
      contentType: dateityp,
      upsert: false
    });

  if (error) {
    console.error('Aktionsbild-Upload fehlgeschlagen:', error);
    return reply(res, 502, {
      error: 'Bild konnte nicht gespeichert werden.'
    });
  }

  const { data } = supabase.storage
    .from('angebotsbilder')
    .getPublicUrl(dateiname);

 const speicherung = await pool.query(
  `UPDATE brilon_aktionen
   SET data = jsonb_set(data, '{bild_url}', to_jsonb($1::text))
   WHERE id = $2
   RETURNING id`,
  [data.publicUrl, aktionsId]
);

if (speicherung.rowCount !== 1) {
  return reply(res, 500, {
    error: 'Bildadresse konnte nicht gespeichert werden.'
  });
}

  return reply(res, 200, {
    success: true,
    bild_url: data.publicUrl
  });
}
      return reply(res,404,{error:'Nicht gefunden.'});
    }

    


   
if (route === '/api/angebote' && req.method === 'GET') {
  if (!pool) {
    return reply(res, 503, {
      error: 'Angebote derzeit nicht verfügbar.'
    });
  }

  const q = await pool.query(
 `SELECT id,name,beschreibung,dauer,preise,bild_url,kategorie,zielgruppe,
        veranstaltungsort,kapazitaet,verfuegbare_termine,hinweise
     FROM brilon_angebote
     WHERE aktiv=true AND buchbar=true AND veroeffentlicht=true
     ORDER BY name ASC`
  );

  return reply(res, 200, q.rows);
}

    if(route.startsWith('/api/'))
      
      return reply(res,404,{error:'Nicht gefunden.'});

    if(req.method!=='GET'&&req.method!=='HEAD')
      return reply(res,405,{error:'Methode nicht erlaubt.'});

    const file=route==='/'?'/index.html':route;
    const target=path.resolve(ROOT,'.'+file);
    if(!target.startsWith(ROOT+path.sep))
      return reply(res,403,{error:'Nicht erlaubt.'});

    fs.readFile(target,(err,data)=>{
      if(err){
        res.writeHead(404,securityHeaders);
        return res.end('Nicht gefunden');
      }
      res.writeHead(200,{
        'Content-Type':mime[path.extname(target)]||'application/octet-stream',
        ...securityHeaders,
        'Content-Security-Policy':"default-src 'self'; img-src 'self' https://fssjruvxkdqeltjdrlfo.supabase.co; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'self'; frame-ancestors 'none'"
      });
      res.end(req.method==='HEAD'?undefined:data);
    });
  }catch(e){
    console.error('Anfragefehler:',e.message);
    reply(res,e.message==='Ungültiges JSON'||e.message==='Anfrage zu groß'?400:500,{
      error:e.message==='Ungültiges JSON'||e.message==='Anfrage zu groß'?
        e.message:'Interner Serverfehler.'
    });
  }
}

async function start(){
  if(pool){
    await pool.query('SELECT 1');
    // Schema changes are opt-in. A normal server start must not alter a live database.
    if(process.env.RUN_SCHEMA_MIGRATIONS==='true'){
    await pool.query(
      'CREATE TABLE IF NOT EXISTS brilon_buchungen (id UUID PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
    );
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_admin_sessions (
      token_hash CHAR(64) PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_admin_sessions_expires_at_idx ON brilon_admin_sessions(expires_at)');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_admin_totp_steps (
      factor_id CHAR(64) PRIMARY KEY,
      last_step BIGINT NOT NULL
    )`);
    await pool.query(
      "ALTER TABLE brilon_buchungen ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'offen'"
    );
    await pool.query(
      'ALTER TABLE brilon_buchungen ADD COLUMN IF NOT EXISTS bearbeitungsnotiz TEXT'
    );
    await pool.query(
      'ALTER TABLE brilon_buchungen ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ'
    );
    
await pool.query(
  'ALTER TABLE brilon_buchungen ADD COLUMN IF NOT EXISTS zahlungsinfo_gesendet_am TIMESTAMPTZ'
);
await pool.query('ALTER TABLE brilon_buchungen ADD COLUMN IF NOT EXISTS buchungsnummer TEXT');
await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS brilon_buchungen_buchungsnummer_unique ON brilon_buchungen (buchungsnummer)');

    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_aktionen(
      id UUID PRIMARY KEY,data JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_kalender(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),titel TEXT NOT NULL,datum DATE NOT NULL,
      enddatum DATE,uhrzeit TIME,endzeit TIME,typ TEXT NOT NULL CHECK(typ IN ('termin','sperrzeit')),
      beschreibung TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    
await pool.query(`
  CREATE TABLE IF NOT EXISTS brilon_angebote (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    beschreibung TEXT DEFAULT '',
    dauer INTEGER,
    preise JSONB NOT NULL DEFAULT '{}'::jsonb,
    aktiv BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
    await pool.query(`ALTER TABLE brilon_angebote
      ADD COLUMN IF NOT EXISTS bild_url TEXT,
      ADD COLUMN IF NOT EXISTS kategorie TEXT NOT NULL DEFAULT 'Klettern',
      ADD COLUMN IF NOT EXISTS zielgruppe TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS veranstaltungsort TEXT NOT NULL DEFAULT 'Brilon',
      ADD COLUMN IF NOT EXISTS kapazitaet INTEGER NOT NULL DEFAULT 20,
      ADD COLUMN IF NOT EXISTS verfuegbare_termine JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS hinweise TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS buchbar BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS veroeffentlicht BOOLEAN NOT NULL DEFAULT true`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_orte(
      id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL UNIQUE,aktiv BOOLEAN NOT NULL DEFAULT true,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`INSERT INTO brilon_orte(name) VALUES('Brilon'),('Rüthen'),('Soest'),('Sundern') ON CONFLICT(name) DO NOTHING`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS brilon_gps_touren (
        id UUID PRIMARY KEY,
        angebot_id BIGINT REFERENCES brilon_angebote(id),
        data JSONB NOT NULL,
        aktiv BOOLEAN NOT NULL DEFAULT false,
        erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query('ALTER TABLE brilon_gps_touren ADD COLUMN IF NOT EXISTS angebot_id BIGINT REFERENCES brilon_angebote(id)');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS brilon_gps_spiele (
        id UUID PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        tour_id UUID NOT NULL REFERENCES brilon_gps_touren(id),
        buchung_id UUID NOT NULL REFERENCES brilon_buchungen(id),
        station_index INTEGER NOT NULL DEFAULT 0,
        gestartet_am TIMESTAMPTZ,
        abgeschlossen_am TIMESTAMPTZ,
        spielzeit_sekunden INTEGER,
        gast_name TEXT,
        gast_einwilligung BOOLEAN NOT NULL DEFAULT false,
        gast_einwilligung_am TIMESTAMPTZ,
        gast_einwilligung_version TEXT,
        erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query('ALTER TABLE brilon_gps_spiele ADD COLUMN IF NOT EXISTS gast_einwilligung_am TIMESTAMPTZ');
    await pool.query('ALTER TABLE brilon_gps_spiele ADD COLUMN IF NOT EXISTS gast_einwilligung_version TEXT');
    } else {
      console.log('Schemaänderungen übersprungen (RUN_SCHEMA_MIGRATIONS ist nicht true)');
    }
    console.log('PostgreSQL verbunden');
  }else{
    console.warn('DATABASE_URL fehlt: Datenbankfunktionen nicht verfügbar');
  }
  http.createServer(main).listen(PORT,'0.0.0.0',()=>{
    console.log('Server auf Port '+PORT);
  });
}
start().catch(e=>{
  console.error('Datenbank-Start fehlgeschlagen:',e.message);
  process.exit(1);
});



