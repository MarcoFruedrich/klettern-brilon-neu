'use strict';
const crypto=require('node:crypto');
const {emailGueltig,passwortHash,passwortPruefen}=require('./stationspruefung');
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const COOKIE='brilon_netzwerkpartner_session';
function endeBerechnen(uhrzeit,dauer){
  const match=/^(\d{2}):(\d{2})$/.exec(String(uhrzeit||''));
  const minuten=Number(dauer);
  if(!match||!Number.isInteger(minuten)||minuten<1||minuten>1440)return null;
  const ende=Number(match[1])*60+Number(match[2])+minuten;
  if(ende>1440)return null;
  return String(Math.floor(ende/60)).padStart(2,'0')+':'+String(ende%60).padStart(2,'0');
}
function isoDatum(value){
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
    !Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}


function createNetzwerkpartnerApi({pool,admin,reply,body,sameOriginMutation,limit,brevoMail,env=process.env}){
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
      const q=await pool.query(`SELECT p.unternehmen,p.ansprechpartner,p.email,p.telefon,p.strasse,p.plz,p.ort,p.weitere_angaben,
          p.standort_id,o.name AS standort_name,o.aktiv AS standort_aktiv
        FROM brilon_netzwerkpartner_sessions s JOIN brilon_netzwerkpartner p ON p.id=s.netzwerkpartner_id
        LEFT JOIN brilon_orte o ON o.id=p.standort_id
        WHERE s.token_hash=$1 AND s.ablauf>NOW() AND p.aktiv=true`,[sha256(token)]);
      if(!q.rowCount)return reply(res,401,{error:'Sitzung abgelaufen. Bitte erneut anmelden.'});
      return reply(res,200,q.rows[0]);
    }
    if(route==='/api/netzwerkpartner/kalender'&&req.method==='GET'){
      const token=(req.headers.cookie||'').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})(?:;|$)`))?.[1];
      if(!token)return reply(res,401,{error:'Bitte anmelden.'});
      const start=u.searchParams.get('start')||'',end=u.searchParams.get('end')||'';
      const span=(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;
      if(!isoDatum(start)||!isoDatum(end)||!Number.isInteger(span)||span<0||span>41)
        return reply(res,400,{error:'Der angefragte Kalenderzeitraum ist ungültig.'});
      const partner=await pool.query(`SELECT o.id,o.name,o.aktiv
        FROM brilon_netzwerkpartner_sessions s
        JOIN brilon_netzwerkpartner p ON p.id=s.netzwerkpartner_id
        LEFT JOIN brilon_orte o ON o.id=p.standort_id
        WHERE s.token_hash=$1 AND s.ablauf>NOW() AND p.aktiv=true`,[sha256(token)]);
      if(!partner.rowCount)return reply(res,401,{error:'Sitzung abgelaufen. Bitte erneut anmelden.'});
      if(!partner.rows[0].id)return reply(res,409,{error:'Für deinen Zugang ist noch kein Standort freigegeben.'});
      if(!partner.rows[0].aktiv)return reply(res,409,{error:'Der freigegebene Standort ist derzeit nicht aktiv.'});
      const location=partner.rows[0].name;
      const [events,bookings]=await Promise.all([
        pool.query(`SELECT titel,datum::text AS datum,COALESCE(enddatum,datum)::text AS enddatum,
            uhrzeit::text AS uhrzeit,endzeit::text AS endzeit,typ
          FROM brilon_kalender
          WHERE typ IN ('termin','sperrzeit') AND datum<=$2::date AND COALESCE(enddatum,datum)>=$1::date
            AND (COALESCE(cardinality(standorte),0)=0 OR $3=ANY(standorte))
          ORDER BY datum,uhrzeit NULLS LAST`,[start,end,location]),
        pool.query(`SELECT data->>'datum' AS datum,data->>'uhrzeit' AS uhrzeit,
            data->>'dauer' AS dauer,status
          FROM brilon_buchungen
          WHERE data->>'veranstaltungsort'=$1 AND data->>'datum'>=$2 AND data->>'datum'<=$3
            AND COALESCE(status,'offen') IN ('offen','bestaetigt')
          ORDER BY data->>'datum',data->>'uhrzeit'`,[location,start,end])
      ]);
      return reply(res,200,{
        standort:location,start,end,
        termine:events.rows.map(event=>({titel:event.titel,datum:event.datum,enddatum:event.enddatum,
          uhrzeit:event.uhrzeit?String(event.uhrzeit).slice(0,5):null,
          endzeit:event.endzeit?String(event.endzeit).slice(0,5):null,typ:event.typ})),
        buchungen:bookings.rows.map(item=>({datum:item.datum,uhrzeit:item.uhrzeit?String(item.uhrzeit).slice(0,5):null,
          endzeit:endeBerechnen(item.uhrzeit,item.dauer),status:item.status==='bestaetigt'?'belegt':'anfrage'}))
      });
    }
    if(route.startsWith('/api/admin/netzwerkpartner/')){
      if(!await admin(req,res))return;
      if(route==='/api/admin/netzwerkpartner/liste'&&req.method==='GET'){
        const q=await pool.query(`SELECT p.id,p.unternehmen,p.ansprechpartner,p.email,p.telefon,p.strasse,p.plz,p.ort,
          p.weitere_angaben,p.aktiv,p.erstellt_am,p.freigabe_am,p.standort_id,o.name AS standort_name,
          CASE WHEN p.aktiv THEN 'aktiv' ELSE 'freigabe_ausstehend' END AS status,'konto' AS art
          FROM brilon_netzwerkpartner p LEFT JOIN brilon_orte o ON o.id=p.standort_id
          UNION ALL
          SELECT i.id,NULL::text,i.name,i.email,NULL::text,NULL::text,NULL::text,NULL::text,
            NULL::text,false,i.erstellt_am,NULL::timestamptz,'eingeladen','einladung'
          FROM brilon_netzwerkpartner_einladungen i
          WHERE i.verwendet_am IS NULL AND i.widerrufen_am IS NULL AND i.ablauf>NOW()
          ORDER BY erstellt_am DESC,id`);
        return reply(res,200,q.rows);
      }
      const locationMatch=route.match(/^\/api\/admin\/netzwerkpartner\/([0-9a-f-]{36})\/standort$/i);
      if(locationMatch&&req.method==='PATCH'){
        if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
        const d=await body(req);
        const raw=d?.standortId;
        let standortId=null;
        if(raw!==null&&raw!==undefined&&raw!==''){
          standortId=Number(raw);
          if(!Number.isSafeInteger(standortId)||standortId<1)
            return reply(res,400,{error:'Bitte einen gültigen Standort auswählen.'});
          const place=await pool.query('SELECT id FROM brilon_orte WHERE id=$1 AND aktiv=true',[standortId]);
          if(!place.rowCount)return reply(res,400,{error:'Der Standort ist nicht aktiv oder nicht vorhanden.'});
        }
        const saved=await pool.query(`UPDATE brilon_netzwerkpartner SET standort_id=$2 WHERE id=$1
          RETURNING id,standort_id`,[locationMatch[1],standortId]);
        if(!saved.rowCount)return reply(res,404,{error:'Netzwerkpartner nicht gefunden.'});
        const place=standortId===null?{rows:[{name:null}]}:
          await pool.query('SELECT name FROM brilon_orte WHERE id=$1',[standortId]);
        return reply(res,200,{...saved.rows[0],standort_name:place.rows[0]?.name||null});
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
        const token=crypto.randomBytes(32).toString('hex'),id=crypto.randomUUID();
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          if((await client.query('SELECT id FROM brilon_netzwerkpartner WHERE email=$1',[email])).rowCount){
            await client.query('ROLLBACK');return reply(res,409,{error:'Für diese E-Mail-Adresse besteht bereits ein Partnerkonto.'});
          }
          await client.query(`UPDATE brilon_netzwerkpartner_einladungen SET widerrufen_am=NOW()
            WHERE email=$1 AND verwendet_am IS NULL AND widerrufen_am IS NULL`,[email]);
          await client.query(`INSERT INTO brilon_netzwerkpartner_einladungen(id,name,email,token_hash,ablauf)
            VALUES($1,$2,$3,$4,NOW()+INTERVAL '7 days')`,[id,name,email,sha256(token)]);
          await client.query('COMMIT');
        }catch(error){await client.query('ROLLBACK');if(error.code==='23505')return reply(res,409,{error:'Für diese E-Mail-Adresse besteht bereits eine offene Einladung.'});throw error;}
        finally{client.release();}
        const link=base.origin+'/netzwerkpartner-registrierung.html?token='+token;
        let emailVersand='gesendet',emailFehler=null;
        try{await brevoMail(email,'Einladung zum Netzwerkpartnerbereich – Klettern & Abenteuer',
          `Hallo ${name},\n\nbitte trage deine Kontaktdaten über diesen persönlichen Link ein:\n${link}\n\nNach deiner Registrierung prüft die Verwaltung deine Angaben und schaltet den ausschließlich für dich vorgesehenen Partnerbereich frei. Der Link ist sieben Tage gültig und einmalig verwendbar.\n\nKlettern & Abenteuer Brilon`);
        }catch(error){emailVersand=error?.uncertain?'versand_ungeklaert':'fehlgeschlagen';emailFehler=error?.code||'MAIL_UNEXPECTED_ERROR';}
        return reply(res,201,{id,name,email,emailVersand,emailFehler,...(emailVersand==='gesendet'?{}:{registrierungsLink:link})});
      }
      const invite=route.match(/^\/api\/admin\/netzwerkpartner\/einladungen\/([0-9a-f-]{36})$/i);
      if(invite&&req.method==='DELETE'){
        if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
        const q=await pool.query(`UPDATE brilon_netzwerkpartner_einladungen SET widerrufen_am=NOW()
          WHERE id=$1 AND verwendet_am IS NULL AND widerrufen_am IS NULL RETURNING id`,[invite[1]]);
        if(!q.rowCount)return reply(res,404,{error:'Offene Einladung nicht gefunden.'});
        return reply(res,200,{success:true});
      }
      const approve=route.match(/^\/api\/admin\/netzwerkpartner\/([0-9a-f-]{36})\/freigeben$/i);
      if(approve&&req.method==='PATCH'){
        if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
        const q=await pool.query(`UPDATE brilon_netzwerkpartner SET aktiv=true,freigabe_am=NOW()
          WHERE id=$1 AND aktiv=false AND standort_id IS NOT NULL RETURNING unternehmen,ansprechpartner,email`,[approve[1]]);
        if(!q.rowCount)return reply(res,409,{error:'Bitte zuerst einen aktiven Standort zuweisen. Es liegt keine offene Partnerfreigabe vor.'});
        const partner=q.rows[0],portal=(env.PUBLIC_BASE_URL||'').replace(/\/+$/,'')+'/netzwerkpartnerbereich.html';
        let emailVersand='gesendet';
        try{await brevoMail(partner.email,'Dein Netzwerkpartnerzugang ist freigeschaltet – Klettern & Abenteuer',
          `Hallo ${partner.ansprechpartner},\n\nDie Verwaltung hat den Zugang für ${partner.unternehmen} freigeschaltet. Melde dich hier mit deiner E-Mail-Adresse und dem bei der Registrierung gewählten Passwort an:\n${portal}\n\nDieser Bereich ist ausschließlich für deinen Netzwerkpartnerzugang vorgesehen.\n\nKlettern & Abenteuer Brilon`);
        }catch(error){emailVersand=error?.uncertain?'versand_ungeklaert':'fehlgeschlagen';}
        return reply(res,200,{...partner,status:'aktiv',emailVersand});
      }
    }
    return reply(res,404,{error:'Nicht gefunden.'});
  };
  return handler;
}
module.exports={createNetzwerkpartnerApi};
