
// Klettern & Abenteuer Brilon – Node.js / PostgreSQL
'use strict';
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {Pool}=require('pg');
const { buchungsreferenz } = require('./lib/buchungsreferenz');
const { anschlussrabatte } = require('./lib/anschlussrabatt');
const { zahlungsstand, zahlungErgaenzen } = require('./lib/buchungslogik');

const { createClient } = require('@supabase/supabase-js');

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  : null;


const PORT=Number(process.env.PORT||3000),ROOT=path.join(__dirname,'site');const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:{ca:process.env.DATABASE_CA_CERT,rejectUnauthorized:true}}):null;
const sessions=new Map(), attempts=new Map();const cookieName='brilon_session';const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
async function brevoMail(empfaenger, betreff, inhalt) {
  if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL)
    throw new Error('E-Mail-Versand ist nicht konfiguriert.');
  const antwort = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'api-key': process.env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        name: 'Klettern & Abenteuer Brilon',
        email: process.env.BREVO_SENDER_EMAIL
      },
      to: [{ email: empfaenger }],
      subject: betreff,
      textContent: inhalt
    })
  });

  if (!antwort.ok) {
    throw new Error(
      'Brevo HTTP ' + antwort.status + ': ' + await antwort.text()
    );
  }
}
function reply(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data))}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>16000)throw Error('Anfrage zu groß')}try{return JSON.parse(data)}catch{throw Error('Ungültiges JSON')}}
function limit(key,max=12,window=600000){const now=Date.now(),a=attempts.get(key)||[];const next=a.filter(t=>t>now-window);next.push(now);attempts.set(key,next);return next.length<=max}
function safeText(v,n=200){return typeof v==='string'?v.trim().slice(0,n):''}
function gueltigesDatum(v){
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const datum=new Date(v+'T12:00:00Z');
  return !Number.isNaN(datum.getTime())&&datum.toISOString().slice(0,10)===v;
}
function session(req){const match=(req.headers.cookie||'').match(/(?:^|;\s*)brilon_session=([a-f0-9]{64})/);const token=match?.[1],exp=sessions.get(token);if(!exp)return false;if(exp<Date.now()){sessions.delete(token);return false}return true}
function admin(req,res){if(!session(req)){reply(res,401,{error:'Bitte anmelden.'});return false}return true}

// Ein Zeitfenster ist halb offen: Eine Buchung darf direkt nach der anderen beginnen.
function minuten(v){
  if(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))return null;
  const [h,m]=v.split(':').map(Number);
  return h*60+m;
}
function buchungsfenster(data){
  const n=Number(data.teilnehmer),start=minuten(data.uhrzeit);
  const dauer=n>=5&&n<=10?150:n>=11&&n<=15?180:n>=16&&n<=20?210:null;
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

async function main(req,res){
  const u=new URL(req.url,'http://localhost'),
        route=decodeURIComponent(u.pathname),
        ip=req.socket.remoteAddress||'unknown';
  try{
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

const gruppe =
  teilnehmer >= 5 && teilnehmer <= 10 ? '5-10' :
  teilnehmer >= 11 && teilnehmer <= 15 ? '11-15' :
  teilnehmer >= 16 && teilnehmer <= 20 ? '16-20' : null;

if (gruppe) {
  const preisAbfrage = await pool.query(
    `SELECT preise FROM brilon_angebote
     WHERE name = $1 AND aktiv = true
     LIMIT 1`,
    [angebot]
  );

  if (preisAbfrage.rows.length) {
    const preis = preisAbfrage.rows[0].preise?.[gruppe];

    if (typeof preis === 'number' &&
        Number.isFinite(preis) && preis >= 0) {
      gesamtpreis = preis;
    }
  }
}
      const data={
       name,vorname,nachname,email,datum,angebot,teilnehmer,
gesamtpreis,
anzahlung: gesamtpreis === null ? null : Math.round(gesamtpreis * 25) / 100,
restbetrag: gesamtpreis === null ? null : Math.round(gesamtpreis * 75) / 100,
        uhrzeit:safeText(d.uhrzeit,5),
        telefon:safeText(d.telefon,40),
        nachricht:safeText(d.nachricht,2000)
      };

      if(!/^(09|1[0-9]):00$/.test(data.uhrzeit))
        return reply(res,400,{
          error:'Bitte eine gültige Anfangszeit zwischen 09:00 und 19:00 Uhr auswählen.'
        });

      const fenster=buchungsfenster(data);
      const ergebnis=await reservierungsTransaktion(async client=>{
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

const buchungsdetails = [
  `Buchungsnummer: ${ergebnis.buchungsnummer}`,
  `Name: ${name}`,
  `Datum: ${datum}`,
  `Angebot: ${angebot}`,
  `Teilnehmer: ${teilnehmer}`,
  `Beginn: ${data.uhrzeit} Uhr`,
  `Ende: ${ende}${fenster ? ' Uhr' : ''}`,
  `Telefon: ${data.telefon || 'Nicht angegeben'}`,
  `Nachricht: ${data.nachricht || 'Keine'}`
].join('\n');




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

      const dauer =
        teilnehmer >= 5 && teilnehmer <= 10 ? 150 :
        teilnehmer >= 11 && teilnehmer <= 15 ? 180 :
        teilnehmer >= 16 && teilnehmer <= 20 ? 210 : null;

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

    if(route==='/api/admin/login'&&req.method==='POST'){
      if(!limit('login:'+ip,6))
        return reply(res,429,{error:'Zu viele Versuche.'});
      const d=await body(req),
            username=process.env.ADMIN_USER,
            password=process.env.ADMIN_PASSWORD;
      if(!username||!password)
        return reply(res,503,{error:'Admin-Zugang nicht eingerichtet.'});

      const a=Buffer.from(String(d.username||'')),
            b=Buffer.from(username),
            c=Buffer.from(String(d.password||'')),
            e=Buffer.from(password);
      if(a.length!==b.length||c.length!==e.length||
         !crypto.timingSafeEqual(a,b)||!crypto.timingSafeEqual(c,e))
        return reply(res,401,{error:'Zugangsdaten nicht korrekt.'});

      const token=crypto.randomBytes(32).toString('hex');
      sessions.set(token,Date.now()+8*3600000);
      return reply(res,200,{success:true},{
        'Set-Cookie':`${cookieName}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`
      });
    }

    // Nur Vorschau: keine Buchung und kein Zahlungssaldo wird veraendert.
    if(route==='/api/admin/anschlussrabatt/vorschau'&&req.method==='POST'){
      if(!admin(req,res))return;
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

    if(route==='/api/admin/logout'&&req.method==='POST'){
      const match=(req.headers.cookie||'').match(/brilon_session=([a-f0-9]{64})/);
      if(match)sessions.delete(match[1]);
      return reply(res,200,{success:true},{
        'Set-Cookie':`${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
      });
    }

    const zahlungenRoute = route.match(/^\/api\/admin\/buchungen\/([0-9a-fA-F-]{36})\/zahlungen$/);
    if(zahlungenRoute&&req.method==='POST'){
      if(!admin(req,res))return;
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
        if(!Number.isFinite(Number(data.gesamtpreis))||Number(data.gesamtpreis)<0)
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
        const gespeichert=await client.query(
          `UPDATE brilon_buchungen SET data=$1::jsonb,status=$2,updated_at=NOW()
           WHERE id=$3 RETURNING id,data,status`,
          [JSON.stringify(data),neuerStatus,q.rows[0].id]
        );
        return {
          buchung:gespeichert.rows[0],zahlung,stand:neuerStand,
          bestaetigtJetzt:neuerStatus!==q.rows[0].status
        };
      });
      if(ergebnis.fehlt)return reply(res,404,{error:'Buchung nicht gefunden.'});
      if(ergebnis.keinPreis)return reply(res,409,{error:'Für diese Buchung ist kein Gesamtpreis hinterlegt.'});
      if(ergebnis.ueberzahlung)return reply(res,409,{
        error:'Der Betrag übersteigt den noch offenen Betrag.',
        offenCent:ergebnis.offenCent
      });
      if(ergebnis.bestaetigtJetzt){
        const data=ergebnis.buchung.data;
        const bestaetigungsText=`Deine Buchung ${data.buchungsnummer || ''} ist verbindlich bestätigt.\n`+
          `Erfasste Zahlung: ${(ergebnis.stand.erhaltenCent/100).toFixed(2).replace('.',',')} €\n`+
          `Offener Restbetrag: ${(ergebnis.stand.offenCent/100).toFixed(2).replace('.',',')} €\n\n`+
          `Termin: ${data.datum} um ${data.uhrzeit} Uhr`;
        const mails=[brevoMail(data.email,'Deine Buchung ist bestätigt – Klettern & Abenteuer Brilon',
          `Hallo ${data.name || ''},\n\n${bestaetigungsText}\n\nGut Seil!\nKlettern & Abenteuer Brilon`)];
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
      if(!admin(req,res))return;
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
  kundenDaten: buchungsdaten
};

      });

      if(ergebnis.fehlt)
        return reply(res,404,{error:'Buchung nicht gefunden.'});
      if(ergebnis.konflikt)
        return reply(res,409,{error:ergebnis.konflikt});

      
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

  const nachrichten = {
    bestaetigt: {
      betreff: 'Deine Buchung ist bestätigt – Klettern & Abenteuer Brilon',
      text: stand
        ? `Deine Buchung wurde verbindlich bestätigt.\n\nTatsächlich erfasst: ${(stand.erhaltenCent / 100).toFixed(2).replace('.', ',')} €\nNoch offen: ${(stand.offenCent / 100).toFixed(2).replace('.', ',')} €.`
        : 'Deine Buchung wurde verbindlich bestätigt.'
    },
    abgelehnt: {
      betreff: 'Rückmeldung zu deiner Buchungsanfrage – Klettern Brilon',
      text: 'Leider können wir deine Buchungsanfrage nicht annehmen.'
    },
    storniert: {
      betreff: 'Deine Buchung wurde storniert – Klettern Brilon',
      text: 'Deine Buchung wurde storniert.'
    }
  };

  const nachricht = nachrichten[status];

  if (empfaenger && nachricht) {
    const inhalt =
      `Hallo ${kunde.name || ''},\n\n` +
      `${nachricht.text}\n\n` +
      `Datum: ${kunde.datum || 'Nicht angegeben'}\n` +
      `Beginn: ${kunde.uhrzeit || 'Nach Absprache'} Uhr\n` +
      `Teilnehmer: ${kunde.teilnehmer || 'Nicht angegeben'}\n\n` +
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

  if (!admin(req, res)) return;
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
    const gesamtpreis = kunde.gesamtpreis;
const anzahlung = Math.round(gesamtpreis * 25) / 100;
const restbetrag = Math.round((gesamtpreis - anzahlung) * 100) / 100;

const euro = betrag =>
  betrag.toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR'
  });  

     if (!process.env.BANK_NAME || !process.env.BANK_IBAN) {
  return reply(res, 503, {
    error: 'Bankverbindung ist noch nicht vollständig eingerichtet.'
  });
} 
     const zahlungstext = [
  `Hallo ${kunde.name || ''},`,
  '',
  'vielen Dank für deine Buchungsanfrage bei Klettern & Abenteuer Brilon.',
  '',
  `Angebot: ${kunde.angebot}`,
  `Datum: ${kunde.datum}`,
  `Gesamtpreis: ${euro(gesamtpreis)}`,
  '',
  'Zahlungsmöglichkeiten:',
  `1. Anzahlung von 25 %: ${euro(anzahlung)}`,
  `   Restbetrag vor Ort: ${euro(restbetrag)}`,
  `2. Vollständige Vorauszahlung: ${euro(gesamtpreis)}`,
  '',
  'Bankverbindung:',
  `Bank: ${process.env.BANK_NAME || ''}`,
  `IBAN: ${process.env.BANK_IBAN || ''}`,
  `Verwendungszweck: ${kunde.buchungsnummer || buchung.buchungsnummer || buchungsId}`,
  '',
  'Bitte überweise den gewählten Betrag innerhalb von 48 Stunden.',
  'Bei kurzfristigen Buchungen bitten wir um sofortige Überweisung.',
  '',
  'Bei einer Anzahlung kannst du den Restbetrag',
  'am Veranstaltungstag bar oder per Karte bezahlen.',
  '',
  'Die Buchung wird erst nach Eingang der erforderlichen Zahlung',
  'und unserer ausdrücklichen Bestätigung verbindlich.',
  '',
  'Viele Grüße',
  'Klettern & Abenteuer Brilon'
].join('\n'); 
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
      if(!admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      const q=await pool.query(
        'SELECT id,titel,datum::text AS datum,enddatum::text AS enddatum,uhrzeit::text AS uhrzeit,endzeit::text AS endzeit,typ,beschreibung FROM brilon_kalender ORDER BY datum,uhrzeit NULLS LAST LIMIT 1000'
      );
      return reply(res,200,q.rows);
    }

    if(route==='/api/admin/kalender'&&req.method==='POST'){
      if(!admin(req,res))return;
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
      if(!admin(req,res))return;
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
      if(!admin(req,res))return;
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
      if(!admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});

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
        const q=await pool.query(
         
'SELECT id,data,status,bearbeitungsnotiz,created_at,updated_at,zahlungsinfo_gesendet_am FROM brilon_buchungen ORDER BY created_at DESC LIMIT 250'

        );
        return reply(res,200,q.rows);
      }

      const buchungLoeschen=route.match(
        /^\/api\/admin\/buchungen\/([0-9a-fA-F-]{36})$/
      );
      if(buchungLoeschen&&req.method==='DELETE'){
        const id=buchungLoeschen[1];
        const q=await pool.query(
          'DELETE FROM brilon_buchungen WHERE id=$1 RETURNING id',[id]
        );
        if(!q.rowCount)
          return reply(res,404,{error:'Buchungsanfrage nicht gefunden.'});
        return reply(res,200,{success:true});
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
     
  
if (route === '/api/admin/angebote' && req.method === 'GET') {
  const q = await pool.query(
    `SELECT id, name, beschreibung, dauer, preise, aktiv, bild_url
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

  if (!name || !Number.isInteger(dauer) ||
      dauer < 15 || dauer > 1440) {
    return reply(res, 400, {
      error: 'Bitte Namen und gültige Dauer eingeben.'
    });
  }

  const q = await pool.query(
    `INSERT INTO brilon_angebote
      (name, beschreibung, dauer, preise, aktiv)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [name, beschreibung, dauer, '{}', false]
  );

  return reply(res, 201, {
    success: true,
    id: q.rows[0].id
  });
}

     
const preisRoute = route.match(/^\/api\/admin\/angebote\/([0-9]+)$/);

if (preisRoute && req.method === 'PATCH') {
  const d = await body(req);
  const preise = d.preise;

  if (!preise || typeof preise !== 'object' ||
      Array.isArray(preise)) {
    return reply(res, 400, {
      error: 'Ungültige Preisangaben.'
    });
  }

  const neuePreise = {};

  for (const gruppe of ['5-10', '11-15', '16-20']) {
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

  
const aktiv = typeof d.aktiv === 'boolean'
  ? d.aktiv
  : null;

const beschreibung = safeText(d.beschreibung, 1000);

const q = await pool.query(
  `UPDATE brilon_angebote
   SET preise = $1::jsonb,
       aktiv = COALESCE($3, aktiv),
       beschreibung = $4
   WHERE id = $2
   RETURNING id, preise, aktiv, beschreibung`,
  [
    JSON.stringify(neuePreise),
    preisRoute[1],
    aktiv,
    beschreibung
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
 `SELECT id, name, beschreibung, dauer, preise, bild_url
     FROM brilon_angebote
     WHERE aktiv = true
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
        res.writeHead(404);
        return res.end('Nicht gefunden');
      }
      res.writeHead(200,{
        'Content-Type':mime[path.extname(target)]||'application/octet-stream',
        'X-Content-Type-Options':'nosniff',
'Content-Security-Policy':"default-src 'self'; img-src 'self' https://fssjruvxkdqeltjdrlfo.supabase.co; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'self'; frame-ancestors 'none'"      });
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

    await pool.query(
      'CREATE TABLE IF NOT EXISTS brilon_aktionen (id BIGSERIAL PRIMARY KEY,titel TEXT NOT NULL,datum DATE,beschreibung TEXT,created_at TIMESTAMPTZ DEFAULT NOW())'
    );
    
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



