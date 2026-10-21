
// Klettern & Abenteuer Brilon – Node.js / PostgreSQL
'use strict';
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {Pool}=require('pg');

const nodemailer = require('nodemailer');

const mailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});


const PORT=Number(process.env.PORT||3000),ROOT=path.join(__dirname,'site');const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:{ca:process.env.DATABASE_CA_CERT,rejectUnauthorized:true}}):null;
const sessions=new Map(), attempts=new Map();const cookieName='brilon_session';const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
function reply(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data))}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>16000)throw Error('Anfrage zu groß')}try{return JSON.parse(data)}catch{throw Error('Ungültiges JSON')}}
function limit(key,max=12,window=600000){const now=Date.now(),a=attempts.get(key)||[];const next=a.filter(t=>t>now-window);next.push(now);attempts.set(key,next);return next.length<=max}
function safeText(v,n=200){return typeof v==='string'?v.trim().slice(0,n):''}
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

      const name=safeText(d.name,120),
            email=safeText(d.email,180),
            datum=safeText(d.datum,10),
            angebot=safeText(d.angebot,120),
            teilnehmer=Number(d.teilnehmer);

      if(!name||!/^\S+@\S+\.\S+$/.test(email)||
         !/^\d{4}-\d{2}-\d{2}$/.test(datum)||
         !angebot||!Number.isInteger(teilnehmer)||
         teilnehmer<1||teilnehmer>150||d.datenschutz!=='on')
        return reply(res,400,{error:'Bitte Pflichtfelder korrekt ausfüllen.'});

      const data={
        name,email,datum,angebot,teilnehmer,
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
        await client.query(
          'INSERT INTO brilon_buchungen (id,data,status) VALUES ($1,$2,$3)',
          [id,JSON.stringify(data),'offen']
        );
        return {id};
      });

      if(ergebnis.konflikt)
        return reply(res,409,{error:ergebnis.konflikt});

      
const dauer = fenster ? fenster[1] - fenster[0] : null;
const ende = fenster
  ? String(Math.floor(fenster[1] / 60)).padStart(2, '0') +
    ':' + String(fenster[1] % 60).padStart(2, '0')
  : 'nach Absprache';

const buchungsdetails = [
  `Name: ${name}`,
  `Datum: ${datum}`,
  `Angebot: ${angebot}`,
  `Teilnehmer: ${teilnehmer}`,
  `Beginn: ${data.uhrzeit} Uhr`,
  `Ende: ${ende}${fenster ? ' Uhr' : ''}`,
  `Telefon: ${data.telefon || 'Nicht angegeben'}`,
  `Nachricht: ${data.nachricht || 'Keine'}`
].join('\n');


async function brevoMail(empfaenger, betreff, inhalt) {
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
        email: 'vormund.friedrich@gmail.com'
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

Promise.allSettled([
  brevoMail(
    email,
    'Deine Buchungsanfrage – Klettern & Abenteuer Brilon',
    `Hallo ${name},\n\n` +
    `vielen Dank für deine Buchungsanfrage.\n\n` +
    buchungsdetails +
    `\n\nDeine Anfrage ist eingegangen, aber noch nicht verbindlich bestätigt.` +
    `\nDu erhältst eine gesonderte Rückmeldung.\n\n` +
    `Gut Seil!\nKlettern & Abenteuer Brilon`
  ),
  brevoMail(
    'vormund.friedrich@gmail.com',
    'Neue Buchungsanfrage – Klettern Brilon',
    `Eine neue Buchungsanfrage ist eingegangen:\n\n` +
    buchungsdetails +
    `\n\nKunden-E-Mail: ${email}\nStatus: Offen`
  )
]).then(ergebnisse => {
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


      return reply(res,201,{success:true,id:ergebnis.id});
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
        "SELECT id,data->>'titel' AS titel,data->>'datum' AS datum,data->>'beschreibung' AS beschreibung FROM brilon_aktionen ORDER BY data->>'datum' ASC NULLS LAST,id DESC LIMIT 100"
      );
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

    if(route==='/api/admin/logout'&&req.method==='POST'){
      const match=(req.headers.cookie||'').match(/brilon_session=([a-f0-9]{64})/);
      if(match)sessions.delete(match[1]);
      return reply(res,200,{success:true},{
        'Set-Cookie':`${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
      });
    }

    if(route.match(/^\/api\/admin\/buchungen\/[0-9a-f-]{36}$/)&&req.method==='PATCH'){
      if(!admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});

      const id=route.split('/').pop(),d=await body(req);
      if(!d||typeof d!=='object'||Array.isArray(d))
        return reply(res,400,{error:'Ungültige Eingabe.'});

      const status=d.status,
            notiz=safeText(d.bearbeitungsnotiz,2000);
      if(!['offen','bestaetigt','abgelehnt','storniert'].includes(status))
        return reply(res,400,{error:'Ungültiger Buchungsstatus.'});

      const ergebnis=await reservierungsTransaktion(async client=>{
        const alt=await client.query(
          'SELECT id,data FROM brilon_buchungen WHERE id=$1',[id]
        );
        if(!alt.rowCount)return {fehlt:true};

        if(status==='offen'||status==='bestaetigt'){
          const data=alt.rows[0].data;
          const konflikt=await pruefeBuchungskonflikt(
            client,data.datum,buchungsfenster(data),id
          );
          if(konflikt)return {konflikt};
        }

        const q=await client.query(
          'UPDATE brilon_buchungen SET status=$1,bearbeitungsnotiz=$2,updated_at=NOW() WHERE id=$3 RETURNING id,status,bearbeitungsnotiz,updated_at',
          [status,notiz,id]
        );
        return {buchung:q.rows[0]};
      });

      if(ergebnis.fehlt)
        return reply(res,404,{error:'Buchung nicht gefunden.'});
      if(ergebnis.konflikt)
        return reply(res,409,{error:ergebnis.konflikt});
      return reply(res,200,ergebnis.buchung);
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
      const beschreibung=safeText(d.beschreibung,1000);

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

      if(route==='/api/admin/buchungen'&&req.method==='GET'){
        const q=await pool.query(
          'SELECT id,data,status,bearbeitungsnotiz,created_at,updated_at FROM brilon_buchungen ORDER BY created_at DESC LIMIT 250'
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
              beschreibung=safeText(d.beschreibung,1000);
        if(!titel||datum&&!/^\d{4}-\d{2}-\d{2}$/.test(datum))
          return reply(res,400,{error:'Ungültige Eingabe.'});
        const q=await pool.query(
          'INSERT INTO brilon_aktionen(id,data) VALUES ($1,$2) RETURNING id',
          [crypto.randomUUID(),JSON.stringify({titel,datum,beschreibung})]
        );
        return reply(res,201,{id:q.rows[0].id});
      }

      const m=route.match(/^\/api\/admin\/aktionen\/([0-9a-fA-F-]{36})$/);
      if(m&&req.method==='DELETE'){
        await pool.query('DELETE FROM brilon_aktionen WHERE id=$1',[m[1]]);
        return reply(res,200,{success:true});
      }
      return reply(res,404,{error:'Nicht gefunden.'});
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
        'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'self'; frame-ancestors 'none'"
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
      'CREATE TABLE IF NOT EXISTS brilon_aktionen (id BIGSERIAL PRIMARY KEY,titel TEXT NOT NULL,datum DATE,beschreibung TEXT,created_at TIMESTAMPTZ DEFAULT NOW())'
    );
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
