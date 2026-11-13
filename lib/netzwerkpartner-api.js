'use strict';
const crypto=require('node:crypto');
const {emailGueltig,passwortHash,passwortPruefen}=require('./stationspruefung');
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const COOKIE='brilon_netzwerkpartner_session';

function createNetzwerkpartnerApi({pool,admin,reply,body,sameOriginMutation,limit,brevoMail,env=process.env}){
  async function currentPartner(req){
    const token=(req.headers.cookie||'').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})(?:;|$)`))?.[1];
    if(!token)return null;
    const q=await pool.query(`SELECT p.id,p.unternehmen,p.ansprechpartner,p.email,p.ort
      FROM brilon_netzwerkpartner_sessions s JOIN brilon_netzwerkpartner p ON p.id=s.netzwerkpartner_id
      WHERE s.token_hash=$1 AND s.ablauf>NOW() AND p.aktiv=true`,[sha256(token)]);
    return q.rows[0]||null;
  }
  const isBrilonPartner=partner=>Boolean(partner&&(
    (/jugendherberge/i.test(partner.unternehmen||'')&&/brilon/i.test(partner.unternehmen||''))||
    (/jugendherberge/i.test(partner.unternehmen||'')&&/^brilon\b/i.test(partner.ort||''))));
  const handler=async function(req,res,u,route,ip){
    if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
    if(route==='/api/netzwerkpartner/einladung'&&req.method==='GET'){
      const token=u.searchParams.get('token')||'';
      if(!/^[a-f0-9]{64}$/i.test(token))return reply(res,400,{error:'Einladungslink ist ungültig.'});
      const q=await pool.query(`SELECT name,email,ablauf FROM brilon_netzwerkpartner_einladungen
        WHERE token_hash=$1 AND verwendet_am IS NULL AND widerrufen_am IS NULL AND ablauf>NOW()`,[sha256(token)]);
      if(!q.rowCount)return reply(res,410,{error:'Einladung ist abgelaufen oder wurde bereits verwendet.'});
      return reply(res,200,q.rows[0]);
    }
    if(route==='/api/netzwerkpartner/registrieren'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Registrierung nicht zulässig.'});
      if(!limit('netzwerkpartner-register:'+ip,6,600000))return reply(res,429,{error:'Zu viele Registrierungsversuche.'});
      const d=await body(req,16000),token=typeof d.token==='string'?d.token:'';
      const unternehmen=typeof d.unternehmen==='string'?d.unternehmen.trim():'';
      const ansprechpartner=typeof d.ansprechpartner==='string'?d.ansprechpartner.trim():'';
      const telefon=typeof d.telefon==='string'?d.telefon.trim():'';
      const strasse=typeof d.strasse==='string'?d.strasse.trim():'';
      const plz=typeof d.plz==='string'?d.plz.trim():'';
      const ort=typeof d.ort==='string'?d.ort.trim():'';
      const weitereAngaben=typeof d.weitereAngaben==='string'?d.weitereAngaben.trim():'';
      if(!/^[a-f0-9]{64}$/i.test(token))return reply(res,400,{error:'Einladungslink ist ungültig.'});
      if(unternehmen.length<2||unternehmen.length>180||ansprechpartner.length<2||ansprechpartner.length>120||
         telefon.length>40||strasse.length>160||plz.length>12||ort.length>100||weitereAngaben.length>2000)
        return reply(res,400,{error:'Bitte Organisation, Ansprechperson und gültige Kontaktdaten eintragen.'});
      let hash;
      try{hash=passwortHash(d.passwort);}catch{return reply(res,400,{error:'Passwort benötigt mindestens 6 Zeichen.'});}
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const invite=await client.query(`SELECT id,email FROM brilon_netzwerkpartner_einladungen
          WHERE token_hash=$1 AND verwendet_am IS NULL AND widerrufen_am IS NULL AND ablauf>NOW() FOR UPDATE`,[sha256(token)]);
        if(!invite.rowCount){await client.query('ROLLBACK');return reply(res,410,{error:'Einladung ist abgelaufen oder wurde bereits verwendet.'});}
        if((await client.query('SELECT id FROM brilon_netzwerkpartner WHERE email=$1',[invite.rows[0].email])).rowCount){
          await client.query('ROLLBACK');return reply(res,409,{error:'Für diese E-Mail-Adresse besteht bereits ein Partnerkonto.'});
        }
        await client.query(`INSERT INTO brilon_netzwerkpartner
          (id,unternehmen,ansprechpartner,email,telefon,strasse,plz,ort,weitere_angaben,passwort_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [crypto.randomUUID(),unternehmen,ansprechpartner,invite.rows[0].email,telefon||null,strasse||null,
          plz||null,ort||null,weitereAngaben||null,hash]);
        await client.query('UPDATE brilon_netzwerkpartner_einladungen SET verwendet_am=NOW() WHERE id=$1',[invite.rows[0].id]);
        await client.query('COMMIT');
        return reply(res,201,{status:'freigabe_ausstehend'});
      }catch(error){
        await client.query('ROLLBACK');
        if(error.code==='23505')return reply(res,409,{error:'Für diese E-Mail-Adresse besteht bereits ein Partnerkonto.'});
        throw error;
      }finally{client.release();}
    }
    if(route==='/api/netzwerkpartner/login'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anmeldung nicht zulässig.'});
      if(!limit('netzwerkpartner-login:'+ip,8,600000))return reply(res,429,{error:'Zu viele Anmeldeversuche. Bitte später erneut versuchen.'});
      const d=await body(req),email=typeof d.email==='string'?d.email.trim().toLowerCase():'';
      const q=await pool.query(`SELECT id,passwort_hash,aktiv FROM brilon_netzwerkpartner WHERE email=$1`,[email]);
      if(!q.rowCount||!q.rows[0].aktiv||!passwortPruefen(d.passwort,q.rows[0].passwort_hash))
        return reply(res,401,{error:'Anmeldung nicht möglich. Prüfe deine Zugangsdaten oder warte auf die Freigabe.'});
      const token=crypto.randomBytes(32).toString('hex');
      await pool.query(`INSERT INTO brilon_netzwerkpartner_sessions(token_hash,netzwerkpartner_id,ablauf)
        VALUES($1,$2,NOW()+INTERVAL '30 days')`,[sha256(token),q.rows[0].id]);
      const secure=new URL(env.PUBLIC_BASE_URL||'https://example.invalid').protocol==='https:'?'; Secure':'';
      res.setHeader('Set-Cookie',`${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/netzwerkpartner; Max-Age=2592000${secure}`);
      return reply(res,200,{success:true});
    }
    if(route==='/api/netzwerkpartner/logout'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
      const token=(req.headers.cookie||'').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})(?:;|$)`))?.[1];
      if(token)await pool.query('DELETE FROM brilon_netzwerkpartner_sessions WHERE token_hash=$1',[sha256(token)]);
      res.setHeader('Set-Cookie',`${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/netzwerkpartner; Max-Age=0; Secure`);
      return reply(res,200,{success:true});
    }
    if(route==='/api/netzwerkpartner/me'&&req.method==='GET'){
      const token=(req.headers.cookie||'').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})(?:;|$)`))?.[1];
      if(!token)return reply(res,401,{error:'Bitte anmelden.'});
      const q=await pool.query(`SELECT p.id,p.unternehmen,p.ansprechpartner,p.email,p.telefon,p.strasse,p.plz,p.ort,p.weitere_angaben
        FROM brilon_netzwerkpartner_sessions s JOIN brilon_netzwerkpartner p ON p.id=s.netzwerkpartner_id
        WHERE s.token_hash=$1 AND s.ablauf>NOW() AND p.aktiv=true`,[sha256(token)]);
      if(!q.rowCount)return reply(res,401,{error:'Sitzung abgelaufen. Bitte erneut anmelden.'});
      return reply(res,200,q.rows[0]);
    }
    if(route==='/api/netzwerkpartner/brilon-kalender'&&req.method==='GET'){
      const partner=await currentPartner(req);
      if(!partner)return reply(res,401,{error:'Bitte anmelden.'});
      if(!isBrilonPartner(partner))return reply(res,403,{error:'Dieser Kalender ist ausschließlich für den freigegebenen Zugang der Jugendherberge Brilon verfügbar.'});
      const from=u.searchParams.get('von')||new Date().toISOString().slice(0,10),to=u.searchParams.get('bis')||new Date(Date.now()+60*86400000).toISOString().slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||to<from||to>new Date(Date.now()+180*86400000).toISOString().slice(0,10))
        return reply(res,400,{error:'Bitte einen Zeitraum von höchstens 180 Tagen angeben.'});
      const [calendar,bookings]=await Promise.all([
        pool.query(`SELECT id,titel,datum::text AS datum,COALESCE(enddatum,datum)::text AS enddatum,
          uhrzeit::text AS uhrzeit,endzeit::text AS endzeit,typ,beschreibung
          FROM brilon_kalender WHERE datum<=$2::date AND COALESCE(enddatum,datum)>=$1::date
            AND (COALESCE(cardinality(standorte),0)=0 OR 'Jugendherberge Brilon'=ANY(standorte))
          ORDER BY datum,uhrzeit,titel LIMIT 500`,[from,to]),
        pool.query(`SELECT data->>'datum' AS datum,data->>'uhrzeit' AS uhrzeit,data->>'angebot' AS programm,
          SUM(CASE WHEN data->>'teilnehmer' ~ '^[0-9]+$' THEN (data->>'teilnehmer')::int ELSE 0 END)::int AS personen
          FROM brilon_buchungen WHERE data->>'veranstaltungsort'='Jugendherberge Brilon'
            AND data->>'datum' BETWEEN $1 AND $2 AND COALESCE(status,'offen') IN ('offen','bestaetigt')
          GROUP BY data->>'datum',data->>'uhrzeit',data->>'angebot' ORDER BY datum,uhrzeit`,[from,to])
      ]);
      return reply(res,200,{von:from,bis:to,events:[...calendar.rows.map(row=>({...row,art:row.typ==='buchungsfenster'?'Freies Zeitfenster':row.typ==='sperrzeit'?'Gesperrt':'Kalendereintrag'})),
        ...bookings.rows.map(row=>({...row,art:'Programm gebucht',titel:`${row.programm||'Programm'} · ${row.personen} Personen`,typ:'buchung',enddatum:row.datum}))]});
    }
    if(route==='/api/netzwerkpartner/terminanfrage'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
      const partner=await currentPartner(req);
      if(!partner)return reply(res,401,{error:'Bitte anmelden.'});
      if(!isBrilonPartner(partner))return reply(res,403,{error:'Terminwünsche sind ausschließlich für den freigegebenen Zugang der Jugendherberge Brilon verfügbar.'});
      if(!limit('partner-brilon-request:'+partner.id,8,3600000))return reply(res,429,{error:'Bitte später erneut versuchen.'});
      const d=await body(req,10000),datum=typeof d.datum==='string'?d.datum:'',uhrzeit=typeof d.uhrzeit==='string'?d.uhrzeit:'';
      const programm=typeof d.programm==='string'?d.programm.trim().slice(0,120):'';
      const personen=Number(d.personen),nachricht=typeof d.nachricht==='string'?d.nachricht.trim().slice(0,1500):'';
      if(!/^\d{4}-\d{2}-\d{2}$/.test(datum)||datum<new Date().toISOString().slice(0,10)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(uhrzeit)||!programm||!Number.isInteger(personen)||personen<1||personen>150)
        return reply(res,400,{error:'Bitte Datum, Uhrzeit, Programm und eine Personenzahl von 1 bis 150 angeben.'});
      const id=crypto.randomUUID();
      await pool.query(`INSERT INTO brilon_partner_terminanfragen(id,netzwerkpartner_id,datum,uhrzeit,programm,personen,nachricht,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,'offen')`,[id,partner.id,datum,uhrzeit,programm,personen,nachricht]);
      const staff=await pool.query(`SELECT DISTINCT m.email FROM brilon_pruef_freigaben f
        JOIN brilon_orte o ON o.id=f.ort_id AND o.aktiv=true JOIN brilon_pruef_mitarbeitende m ON m.id=f.mitarbeiter_id AND m.aktiv=true
        WHERE lower(o.name)=lower('Jugendherberge Brilon')`);
      const recipients=new Set([env.BOOKING_NOTIFY_EMAIL, ...staff.rows.map(row=>row.email)].filter(Boolean).map(email=>String(email).trim().toLowerCase()));
      const text=`Terminwunsch der Jugendherberge Brilon\n\nProgramm: ${programm}\nWunschtermin: ${datum} um ${uhrzeit} Uhr\nPersonen: ${personen}\n\nAngefragt von: ${partner.ansprechpartner} · ${partner.unternehmen}\nKontakt: ${partner.email}\n${nachricht?`\nNachricht:\n${nachricht}`:''}\n\nBitte mit der Verwaltung abstimmen. Anfrage-ID: ${id}`;
      const result=await Promise.allSettled([...recipients].map(email=>brevoMail(email,`Terminwunsch Brilon · ${datum} ${uhrzeit}`,text)));
      const mailStatus=result.length&&result.every(item=>item.status==='fulfilled')?'gesendet':'teilweise_fehlgeschlagen';
      await pool.query('UPDATE brilon_partner_terminanfragen SET mail_status=$1 WHERE id=$2',[mailStatus,id]);
      return reply(res,201,{success:true,id,mailStatus,message:mailStatus==='gesendet'?'Terminwunsch wurde an die Brilon-Freigaben und Verwaltung weitergeleitet.':'Terminwunsch gespeichert; mindestens eine Benachrichtigung konnte nicht versendet werden.'});
    }
    if(route.startsWith('/api/admin/netzwerkpartner/')){
      if(!await admin(req,res))return;
      if(route==='/api/admin/netzwerkpartner/liste'&&req.method==='GET'){
        const q=await pool.query(`SELECT p.id,p.unternehmen,p.ansprechpartner,p.email,p.telefon,p.strasse,p.plz,p.ort,
          p.programm_benachrichtigung_email,
          p.weitere_angaben,p.aktiv,p.erstellt_am,p.freigabe_am,
          CASE WHEN p.aktiv THEN 'aktiv' ELSE 'freigabe_ausstehend' END AS status,'konto' AS art
          FROM brilon_netzwerkpartner p
          UNION ALL
          SELECT i.id,NULL::text,i.name,i.email,NULL::text,NULL::text,NULL::text,NULL::text,
            NULL::text,NULL::text,false,i.erstellt_am,NULL::timestamptz,'eingeladen','einladung'
          FROM brilon_netzwerkpartner_einladungen i
          WHERE i.verwendet_am IS NULL AND i.widerrufen_am IS NULL AND i.ablauf>NOW()
          ORDER BY erstellt_am DESC,id`);
        return reply(res,200,q.rows);
      }
      if(route==='/api/admin/netzwerkpartner/einladungen'&&req.method==='POST'){
        if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
        if(!limit('netzwerkpartner-invite:'+ip,10,600000))return reply(res,429,{error:'Zu viele Einladungen.'});
        const d=await body(req),name=typeof d.name==='string'?d.name.trim():'';
        const email=typeof d.email==='string'?d.email.trim().toLowerCase():'';
        if(name.length<2||name.length>120||!emailGueltig(email))return reply(res,400,{error:'Name oder E-Mail ungültig.'});
        let base;try{base=new URL(env.PUBLIC_BASE_URL||'');}catch{return reply(res,503,{error:'PUBLIC_BASE_URL muss für Einladungslinks eingerichtet sein.'});}
        if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))
          return reply(res,503,{error:'PUBLIC_BASE_URL muss eine sichere HTTPS-Adresse sein.'});
        const token=crypto.r