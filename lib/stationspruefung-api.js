'use strict';
const crypto=require('node:crypto');
const {emailGueltig,passwortHash,passwortPruefen,codeHash,programmPruefen,fotoBereinigen}=require('./stationspruefung');
const {createPruefMeldungen}=require('./pruef-meldungen');
const {createTabletService}=require('./pruef-tablet');
const {createPruefzugangsbereinigung}=require('./pruef-zugangsbereinigung');
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const COOKIE='brilon_pruef_session';

function createPruefungApi({pool,admin,reply,body,sameOriginMutation,limit,brevoMail,scanForMalware,env=process.env}){
  const meldungen=createPruefMeldungen({pool,brevoMail});
  const tablet=createTabletService({pool});
  const zugangsbereinigung=createPruefzugangsbereinigung({pool});
  async function staffSession(req){
    const token=(req.headers.cookie||'').match(/(?:^|;\s*)brilon_pruef_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if(!token)return null;
    const q=await pool.query(
      'SELECT s.mitarbeiter_id,s.entsperrt_bis,m.name,m.email,m.telefon,m.verwaltungszugang FROM brilon_pruef_sessions s JOIN brilon_pruef_mitarbeitende m ON m.id=s.mitarbeiter_id WHERE s.token_hash=$1 AND s.ablauf>NOW() AND m.aktiv=true',
      [sha256(token)]);
    return q.rows[0]||null;
  }
  const handler=async function(req,res,u,route,ip){
    if(!pool)return reply(res,503,{error:'Prüfdatenbank nicht konfiguriert.'});
    if(route==='/api/pruefung/einladung'&&req.method==='GET'){
      const token=u.searchParams.get('token')||'';
      if(!/^[a-f0-9]{64}$/i.test(token))return reply(res,400,{error:'Einladungslink ist ungültig.'});
      const invitation=await pool.query(`SELECT name,email,ablauf FROM brilon_pruef_einladungen
        WHERE token_hash=$1 AND verwendet_am IS NULL AND widerrufen_am IS NULL AND ablauf>NOW()`,[sha256(token)]);
      if(!invitation.rowCount)return reply(res,410,{error:'Einladung ist abgelaufen oder wurde bereits verwendet.'});
      return reply(res,200,invitation.rows[0]);
    }
    if(route==='/api/pruefung/registrieren'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Registrierung nicht zulässig.'});
      if(!limit('pruef-register:'+ip,8,600000))return reply(res,429,{error:'Zu viele Registrierungsversuche.'});
      const d=await body(req,16_000);
      const token=typeof d.token==='string'?d.token:'';
      const name=typeof d.name==='string'?d.name.trim():'';
      const telefon=typeof d.telefon==='string'?d.telefon.trim():'';
      const strasse=typeof d.strasse==='string'?d.strasse.trim():'';
      const plz=typeof d.plz==='string'?d.plz.trim():'';
      const wohnort=typeof d.wohnort==='string'?d.wohnort.trim():'';
      const qualifikationen=typeof d.qualifikationen==='string'?d.qualifikationen.trim():'';
      if(!/^[a-f0-9]{64}$/i.test(token))return reply(res,400,{error:'Einladungslink ist ungültig.'});
      if(!name||name.length>120||telefon.length>40||strasse.length<3||strasse.length>160||
         plz.length<3||plz.length>12||wohnort.length<2||wohnort.length>100||qualifikationen.length<2||qualifikationen.length>2000)
        return reply(res,400,{error:'Bitte Name, vollständige Anschrift und mindestens eine Qualifikation oder Erfahrung eintragen.'});
      if(d.bescheinigungen!==undefined)
        return reply(res,400,{error:'Bescheinigungen werden nicht im Registrierungsformular hochgeladen. Die Verwaltung fordert benötigte Nachweise per E-Mail an.'});
      let hash;
      try{hash=passwortHash(d.passwort);}catch{return reply(res,400,{error:'Passwort benötigt mindestens 6 Zeichen.'});}
      const invitationCheck=await pool.query(`SELECT id FROM brilon_pruef_einladungen
        WHERE token_hash=$1 AND verwendet_am IS NULL AND widerrufen_am IS NULL AND ablauf>NOW()`,[sha256(token)]);
      if(!invitationCheck.rowCount)return reply(res,410,{error:'Einladung ist abgelaufen oder wurde bereits verwendet.'});
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const invitation=await client.query(`SELECT id,email FROM brilon_pruef_einladungen
          WHERE token_hash=$1 AND verwendet_am IS NULL AND widerrufen_am IS NULL AND ablauf>NOW()
          FOR UPDATE`,[sha256(token)]);
        if(!invitation.rowCount){await client.query('ROLLBACK');return reply(res,410,{error:'Einladung ist abgelaufen oder wurde bereits verwendet.'});}
        const email=invitation.rows[0].email;
        const exists=await client.query('SELECT id FROM brilon_pruef_mitarbeitende WHERE email=$1',[email]);
        if(exists.rowCount){await client.query('ROLLBACK');return reply(res,409,{error:'Für diese E-Mail-Adresse besteht bereits ein Mitarbeiterkonto.'});}
        const staffId=crypto.randomUUID();
        await client.query(`INSERT INTO brilon_pruef_mitarbeitende
          (id,name,email,passwort_hash,aktiv,telefon,strasse,plz,wohnort,qualifikationen,registriert_am)
          VALUES($1,$2,$3,$4,false,$5,$6,$7,$8,$9,NOW())`,
        [staffId,name,email,hash,telefon||null,strasse,plz,wohnort,qualifikationen||null]);
        await client.query('UPDATE brilon_pruef_einladungen SET verwendet_am=NOW() WHERE id=$1',[invitation.rows[0].id]);
        await client.query('COMMIT');
        return reply(res,201,{status:'freigabe_ausstehend',email});
      }catch(error){
        await client.query('ROLLBACK');
        if(error.code==='23505')return reply(res,409,{error:'Für diese E-Mail-Adresse besteht bereits ein Mitarbeiterkonto.'});
        throw error;
      }finally{client.release();}
    }
    if(route.startsWith('/api/admin/pruefung/')){
      if(!await admin(req,res))return;
      if(route==='/api/admin/pruefung/uebersicht'&&req.method==='GET'){
        // Read only: station lock has priority over incidental hints. A report
        // containing "ok" never lifts an existing lock or closes a hint.
        const [summary,blocked,notes,alerts]=await Promise.all([
          pool.query(`SELECT
            (SELECT COUNT(*)::int FROM brilon_pruef_stationen WHERE gesperrt_am IS NOT NULL) AS gesperrt,
            (SELECT COUNT(*)::int FROM brilon_pruef_stationen WHERE aktiv=false) AS stillgelegt,
            (SELECT COUNT(*)::int FROM brilon_pruef_stationen WHERE aktiv=false OR gesperrt_am IS NOT NULL) AS nicht_nutzbar,
            (SELECT COUNT(*)::int FROM brilon_pruef_hinweise WHERE erledigt_am IS NULL) AS hinweise_offen,
            (SELECT COUNT(*)::int FROM brilon_pruef_meldungen WHERE status<>'angenommen') AS meldungen_ungeklaert`),
          pool.query(`SELECT s.id,s.name,s.aktiv,s.gesperrt_am,s.sperrgrund,
            (SELECT COUNT(*)::int FROM brilon_pruef_hinweise h
              WHERE h.station_id=s.id AND h.erledigt_am IS NULL) AS offene_hinweise
            FROM brilon_pruef_stationen s
            WHERE s.gesperrt_am IS NOT NULL OR s.aktiv=false
            ORDER BY (s.gesperrt_am IS NOT NULL) DESC,s.name,s.id LIMIT 100`),
          pool.query(`SELECT h.id,h.station_id,h.bericht_id,h.beschreibung,h.erstellt_am,
             s.name AS station,s.aktiv,s.gesperrt_am
             FROM brilon_pruef_hinweise h JOIN brilon_pruef_stationen s ON s.id=h.station_id
             WHERE h.erledigt_am IS NULL
             ORDER BY (s.gesperrt_am IS NOT NULL) DESC,h.erstellt_am,h.id LIMIT 100`),
          pool.query(`SELECT o.bericht_id,o.status,o.versuche,o.letzter_versuch,
             p.programm
             FROM brilon_pruef_meldungen o
             JOIN brilon_pruef_berichte p ON p.id=o.bericht_id
             WHERE o.status<>'angenommen'
             ORDER BY o.erstellt_am DESC,o.bericht_id DESC LIMIT 50`)
        ]);
        return reply(res,200,{zaehler:summary.rows[0],
          stationen:blocked.rows,hinweise:notes.rows,meldungen:alerts.rows,
          stand:new Date().toISOString(),
          hinweis:'Keine automatische Betriebsfreigabe. Vor jeder Nutzung bleibt die vorgeschriebene Stationskontrolle erforderlich.'});
      }
      if(route==='/api/admin/pruefung/mitarbeitende'&&req.method==='GET'){
        const q=await pool.query(`SELECT m.id,m.name,m.email,m.aktiv,m.erstellt_am,m.telefon,
            m.strasse,m.plz,m.wohnort,m.qualifikationen,m.verwaltungszugang,
            COALESCE((SELECT json_agg(json_build_object('id',d.id,'bezeichnung',d.bezeichnung,
              'dateiname',d.dateiname,'erstellt_am',d.erstellt_am) ORDER BY d.erstellt_am)
              FROM brilon_pruef_personaldokumente d WHERE d.mitarbeiter_id=m.id),'[]'::json) AS bescheinigungen,
            COALESCE((SELECT json_agg(json_build_object('ortId',o.id,'ort',o.name,
              'ortAktiv',o.aktiv,'qualifikation',f.qualifikation)
              ORDER BY o.name,f.qualifikation)
              FROM brilon_pruef_freigaben f JOIN brilon_orte o ON o.id=f.ort_id
              WHERE f.mitarbeiter_id=m.id),'[]'::json) AS freigaben,
            CASE WHEN m.name='Gelöschtes Mitarbeiterkonto' THEN 'geloescht'
              WHEN m.aktiv THEN 'aktiv' WHEN m.registriert_am IS NOT NULL AND m.freigabe_am IS NULL
              THEN 'freigabe_ausstehend' ELSE 'deaktiviert' END AS status,
            'konto' AS art,NULL::timestamptz AS ablauf,
            (m.registriert_am IS NOT NULL AND m.freigabe_am IS NOT NULL) AS freigegeben,
            COALESCE(c.vertrauensperson,false) AS sonderfreigabe
          FROM brilon_pruef_mitarbeitende m
          LEFT JOIN brilon_beschaeftigung c ON c.mitarbeiter_id=m.id
          UNION ALL
          SELECT id,name,email,false AS aktiv,erstellt_am,NULL::text AS telefon,
            NULL::text AS strasse,NULL::text AS plz,NULL::text AS wohnort,
            NULL::text AS qualifikationen,false AS verwaltungszugang,
            '[]'::json AS bescheinigungen,'[]'::json AS freigaben,
            'eingeladen' AS status,'einladung' AS art,ablauf,false AS freigegeben,false AS sonderfreigabe
          FROM brilon_pruef_einladungen
          WHERE verwendet_am IS NULL AND widerrufen_am IS NULL AND ablauf>NOW()
          ORDER BY erstellt_am DESC,id`);
        return reply(res,200,q.rows);
      }
      const certificate=route.match(/^\/api\/admin\/pruefung\/mitarbeitende\/([0-9a-f-]{36})\/bescheinigungen\/([0-9a-f-]{36})$/i);
      if(certificate&&req.method==='GET'){
        const q=await pool.query(`SELECT bezeichnung,dateiname,daten FROM brilon_pruef_personaldokumente
          WHERE mitarbeiter_id=$1 AND id=$2`,[certificate[1],certificate[2]]);
        if(!q.rowCount)return reply(res,404,{error:'Bescheinigung nicht gefunden.'});
        const filename=encodeURIComponent(q.rows[0].dateiname||'bescheinigung.jpg');
        res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':q.rows[0].daten.length,
          'Content-Disposition':`inline; filename="bescheinigung.jpg"; filename*=UTF-8''${filename}`,
          'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
          'X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'});
        res.end(q.rows[0].daten);
        return;
      }
      if(route==='/api/admin/pruefung/mitarbeitende'&&req.method==='POST'){
        if(!limit('pruef-invite:'+ip,10,600000))return reply(res,429,{error:'Zu viele Mitarbeitereinladungen.'});
        const d=await body(req);
        const name=typeof d.name==='string'?d.name.trim():'';
        const email=typeof d.email==='string'?d.email.trim().toLowerCase():'';
        if(!name||name.length>120||!emailGueltig(email))
          return reply(res,400,{error:'Name oder E-Mail ungültig.'});
        let base;
        try{base=new URL(env.PUBLIC_BASE_URL||'');}catch{return reply(res,503,{error:'PUBLIC_BASE_URL muss für Einladungslinks eingerichtet sein.'});}
        if((base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))||base.username||base.password||base.search||base.hash)
          return reply(res,503,{error:'PUBLIC_BASE_URL muss eine sichere HTTPS-Adresse sein.'});
        const linkBase=(env.PUBLIC_BASE_URL||'').replace(/\/+$/,'');
        const token=crypto.randomBytes(32).toString('hex');
        const id=crypto.randomUUID();
        try{
          const client=await pool.connect();
          try{
            await client.query('BEGIN');
            const existing=await client.query('SELECT id FROM brilon_pruef_mitarbeitende WHERE email=$1',[email]);
            if(existing.rowCount){await client.query('ROLLBACK');return reply(res,409,{error:'Für diese E-Mail-Adresse besteht bereits ein Mitarbeiterkonto.'});}
            await client.query(`UPDATE brilon_pruef_einladungen SET widerrufen_am=NOW()
              WHERE email=$1 AND verwendet_am IS NULL AND widerrufen_am IS NULL`,[email]);
            await client.query(`INSERT INTO brilon_pruef_einladungen(id,name,email,token_hash,ablauf)
              VALUES($1,$2,$3,$4,NOW()+INTERVAL '7 days')`,[id,name,email,sha256(token)]);
            await client.query('COMMIT');
          }catch(error){await client.query('ROLLBACK');throw error;}
          finally{client.release();}
          const registrierungsLink=linkBase+'/mitarbeiter-registrierung.html?token='+token;
          let emailVersand='gesendet';
          let emailFehler=null;
          try{
            await brevoMail(email,'Einladung zur Mitarbeiterregistrierung – Klettern & Abenteuer',
              `Hallo ${name},\n\nbitte vervollständige deine Mitarbeiterregistrierung über diesen persönlichen Link:\n${registrierungsLink}\n\nDer Link ist sieben Tage gültig und kann nur einmal verwendet werden. Nach deiner Registrierung prüft die Verwaltung deine Angaben und schaltet den Zugang anschließend frei.\n\nKlettern & Abenteuer Brilon`);
          }catch(error){
            emailVersand=error?.uncertain?'versand_ungeklaert':'fehlgeschlagen';
            emailFehler=typeof error?.code==='string'&&/^(MAIL_[A-Z_]+|BREVO_(?:HTTP_\d{3}|CONNECTION_UNCERTAIN))$/.test(error.code)?error.code:'MAIL_UNEXPECTED_ERROR';
            console.warn('Mitarbeitereinladung: Mailversand fehlgeschlagen',emailFehler);
          }
          return reply(res,201,{id,name,email,status:'eingeladen',emailVersand,
            ...(emailVersand==='gesendet'?{}:{registrierungsLink,emailFehler}),
            ablauf:new Date(Date.now()+7*24*60*60*1000).toISOString()});
        }catch(e){if(e.code==='23505')return reply(res,409,{error:'E-Mail-Adresse besitzt bereits eine offene Einladung.'});throw e;}
      }
      const invitationRevoke=route.match(/^\/api\/admin\/pruefung\/mitarbeitende\/([0-9a-f-]{36})\/einladung$/i);
      if(invitationRevoke&&req.method==='DELETE'){
        const q=await pool.query(`UPDATE brilon_pruef_einladungen SET widerrufen_am=NOW()
          WHERE id=$1 AND verwendet_am IS NULL AND widerrufen_am IS NULL RETURNING id`,[invitationRevoke[1]]);
        if(!q.rowCount)return reply(res,404,{error:'Offene Einladung nicht gefunden oder bereits verwendet.'});
        return reply(res,200,{success:true});
      }
      const staffApproval=route.match(/^\/api\/admin\/pruefung\/mitarbeitende\/([0-9a-f-]{36})\/freigeben$/i);
      if(staffApproval&&req.method==='PATCH'){
        const d=await body(req);
        const standorte=Array.isArray(d.standorte)?[...new Set(d.standorte.map(Number))]:[];
        const qualifikationen=Array.isArray(d.qualifikationen)?[...new Set(d.qualifikationen
          .map(value=>typeof value==='string'?value.trim():''))]:[];
        if(!standorte.length||standorte.length>50||standorte.some(id=>!Number.isSafeInteger(id)||id<1)||
           !qualifikationen.length||qualifikationen.length>20||
           qualifikationen.some(value=>value.length<2||value.length>100))
          return reply(res,400,{error:'Mindestens ein aktiver Standort und eine geprüfte Qualifikation müssen ausgewählt werden.'});
        const client=await pool.connect();
        let approved;
        try{
          await client.query('BEGIN');
          const staff=await client.query(`SELECT id,name,email,qualifikationen FROM brilon_pruef_mitarbeitende
            WHERE id=$1 AND aktiv=false AND registriert_am IS NOT NULL AND freigabe_am IS NULL FOR UPDATE`,[staffApproval[1]]);
          if(!staff.rowCount){await client.query('ROLLBACK');return reply(res,409,{error:'Es liegt keine offene Mitarbeiterfreigabe vor.'});}
          const profileQualifications=(staff.rows[0].qualifikationen||'').split(/[\r\n,;]+/)
            .map(value=>value.trim()).filter(Boolean);
          const evidence=await client.query('SELECT bezeichnung FROM brilon_pruef_personaldokumente WHERE mitarbeiter_id=$1',[staffApproval[1]]);
          const verifiable=new Set([...profileQualifications,...evidence.rows.map(row=>row.bezeichnung)]);
          if(qualifikationen.some(value=>!verifiable.has(value))){
            await client.query('ROLLBACK');
            return reply(res,400,{error:'Freigegebene Qualifikationen müssen in den Mitarbeiterangaben oder Bescheinigungen aufgeführt sein.'});
          }
          const places=await client.query('SELECT id FROM brilon_orte WHERE id=ANY($1::bigint[]) AND aktiv=true',[standorte]);
          if(places.rowCount!==standorte.length){
            await client.query('ROLLBACK');
            return reply(res,400,{error:'Mindestens ein ausgewählter Standort ist inaktiv oder nicht vorhanden.'});
          }
          for(const ortId of standorte){
            for(const qualifikation of qualifikationen){
              await client.query(`INSERT INTO brilon_pruef_freigaben
                (id,mitarbeiter_id,ort_id,qualifikation,erstellt_von)
                VALUES($1,$2,$3,$4,$5)`,[crypto.randomUUID(),staffApproval[1],ortId,qualifikation,env.ADMIN_USER||'Admin']);
            }
          }
          const activated=await client.query(`UPDATE brilon_pruef_mitarbeitende
            SET aktiv=true,freigabe_am=NOW()
            WHERE id=$1 AND aktiv=false AND registriert_am IS NOT NULL AND freigabe_am IS NULL
            RETURNING id,name,email`,[staffApproval[1]]);
          if(!activated.rowCount){await client.query('ROLLBACK');return reply(res,409,{error:'Es liegt keine offene Mitarbeiterfreigabe vor.'});}
          const granted=await client.query(`SELECT o.name AS ort,f.qualifikation
            FROM brilon_pruef_freigaben f JOIN brilon_orte o ON o.id=f.ort_id
            WHERE f.mitarbeiter_id=$1 ORDER BY o.name,f.qualifikation`,[staffApproval[1]]);
          await client.query('COMMIT');approved={...activated.rows[0],freigaben:granted.rows};
        }catch(error){await client.query('ROLLBACK');throw error;}
        finally{client.release();}
        const baseUrl=(env.PUBLIC_BASE_URL||'').replace(/\/+$/,'');
        const loginUrl=baseUrl+'/mitarbeiterbereich.html';
        const pruefUrl=baseUrl+'/pruefung.html';
        let emailVersand='gesendet';
        try{
          const authorizationText=approved.freigaben.map(item=>'• '+item.ort+' – '+item.qualifikation).join('\n');
          await brevoMail(approved.email,'Dein Mitarbeiterzugang ist freigeschaltet – Klettern & Abenteuer',
            `Hallo ${approved.name},\n\nDie Verwaltung hat deinen Mitarbeiterzugang freigeschaltet. Dein eigener Mitarbeiterbereich ist hier erreichbar:\n${loginUrl}\n\nMelde dich dort mit deiner E-Mail-Adresse und dem bei der Registrierung gewählten Passwort an. Die Stationsprüfung erreichst du separat hier:\n${pruefUrl}\n\nDeine Freigaben gelten für:\n${authorizationText}\n\nKlettern & Abenteuer Brilon`);
        }catch(error){emailVersand=error?.uncertain?'versand_ungeklaert':'fehlgeschlagen';}
        return reply(res,200,{...approved,status:'aktiv',emailVersand});
      }
      const adminAccess=route.match(/^\/api\/admin\/pruefung\/mitarbeitende\/([0-9a-f-]{36})\/verwaltungszugang$/i);
      if(adminAccess&&req.method==='PATCH'){
        if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
        const d=await body(req);
        if(typeof d.freigegeben!=='boolean')return reply(res,400,{error:'Bitte Freigabe oder Widerruf auswählen.'});
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          const q=await client.query(`UPDATE brilon_pruef_mitarbeitende SET verwaltungszugang=$2
            WHERE id=$1 AND ($2=false OR (aktiv=true AND freigabe_am IS NOT NULL)) RETURNING id,name,verwaltungszugang`,
            [adminAccess[1],d.freigegeben]);
          if(!q.rowCount){await client.query('ROLLBACK');return reply(res,409,{error:'Nur freigegebene aktive Mitarbeiter können Verwaltungszugang erhalten.'});}
          if(!d.freigegeben)await client.query('DELETE FROM brilon_pruef_admin_sessions WHERE mitarbeiter_id=$1',[adminAccess[1]]);
          await client.query('COMMIT');
          return reply(res,200,{...q.rows[0],widerrufen:!d.freigegeben});
        }catch(error){await client.query('ROLLBACK');throw error;}
        finally{client.release();}
      }
      const staffGrants=route.match(/^\/api\/admin\/pruefung\/mitarbeitende\/([0-9a-f-]{36})\/freigaben$/i);
      if(staffGrants&&req.method==='PUT'){
        const d=await body(req);
        const standorte=Array.isArray(d.standorte)?[...new Set(d.standorte.map(Number))]:[];
        const qualifikationen=Array.isArray(d.qualifikationen)?[...new Set(d.qualifikationen
          .map(value=>typeof value==='string'?value.trim():''))]:[];
        if(standorte.length>50||standorte.some(id=>!Number.isSafeInteger(id)||id<1)||
           qualifikationen.length>20||qualifikationen.some(value=>value.length<2||value.length>100))
          return reply(res,400,{error:'Standort- oder Qualifikationsauswahl ist ungültig.'});
        if(Boolean(standorte.length)!==Boolean(qualifikationen.length))
          return reply(res,400,{error:'Für Freigaben müssen Standort und Qualifikation gemeinsam ausgewählt werden.'});
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          const staff=await client.query(`SELECT id,qualifikationen FROM brilon_pruef_mitarbeitende
            WHERE id=$1 AND registriert_am IS NOT NULL AND freigabe_am IS NOT NULL FOR UPDATE`,[staffGrants[1]]);
          if(!staff.rowCount){await client.query('ROLLBACK');return reply(res,404,{error:'Freigegebenes Mitarbeiterkonto nicht gefunden.'});}
          const profileQualifications=(staff.rows[0].qualifikationen||'').split(/[\r\n,;]+/)
            .map(value=>value.trim()).filter(Boolean);
          const evidence=await client.query('SELECT bezeichnung FROM brilon_pruef_personaldokumente WHERE mitarbeiter_id=$1',[staffGrants[1]]);
          const verifiable=new Set([...profileQualifications,...evidence.rows.map(row=>row.bezeichnung)]);
          if(qualifikationen.some(value=>!verifiable.has(value))){
            await client.query('ROLLBACK');
            return reply(res,400,{error:'Freigegebene Qualifikationen müssen in den Mitarbeiterangaben oder Bescheinigungen aufgeführt sein.'});
          }
          if(standorte.length){
            const places=await client.query(`SELECT id FROM brilon_orte WHERE id=ANY($1::bigint[]) AND
              (aktiv=true OR EXISTS(SELECT 1 FROM brilon_pruef_freigaben f
                WHERE f.mitarbeiter_id=$2 AND f.ort_id=brilon_orte.id))`,[standorte,staffGrants[1]]);
            if(places.rowCount!==standorte.length){
              await client.query('ROLLBACK');
              return reply(res,400,{error:'Ein ausgewählter Standort ist inaktiv oder nicht vorhanden.'});
            }
          }
          await client.query('DELETE FROM brilon_pruef_freigaben WHERE mitarbeiter_id=$1',[staffGrants[1]]);
          for(const ortId of standorte){
            for(const qualifikation of qualifikationen){
              await client.query(`INSERT INTO brilon_pruef_freigaben
                (id,mitarbeiter_id,ort_id,qualifikation,erstellt_von)
                VALUES($1,$2,$3,$4,$5)`,[crypto.randomUUID(),staffGrants[1],ortId,qualifikation,env.ADMIN_USER||'Admin']);
            }
          }
          await client.query('DELETE FROM brilon_pruef_sessions WHERE mitarbeiter_id=$1',[staffGrants[1]]);
          const current=await client.query(`SELECT o.id AS "ortId",o.name AS ort,o.aktiv AS "ortAktiv",f.qualifikation
            FROM brilon_pruef_freigaben f JOIN brilon_orte o ON o.id=f.ort_id
            WHERE f.mitarbeiter_id=$1 ORDER BY o.name,f.qualifikation`,[staffGrants[1]]);
          await client.query('COMMIT');
          return reply(res,200,{freigaben:current.rows,sitzungenWiderrufen:true});
        }catch(error){await client.query('ROLLBACK');throw error;}
        finally{client.release();}
      }
      const deactivate=route.match(/^\/api\/admin\/pruefung\/mitarbeitende\/([0-9a-f-]{36})\/deaktivieren$/i);
      if(deactivate&&req.method==='PATCH'){
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          const q=await client.query('UPDATE brilon_pruef_mitarbeitende SET aktiv=false WHERE id=$1 AND aktiv=true RETURNING id,aktiv',
            [deactivate[1]]);
          if(!q.rowCount){await client.query('ROLLBACK');return reply(res,409,{error:'Mitarbeiter ist bereits deaktiviert oder nicht vorhanden.'});}
          await client.query('DELETE FROM brilon_pruef_sessions WHERE mitarbeiter_id=$1',[deactivate[1]]);
          await client.query('DELETE FROM brilon_pruef_admin_sessions WHERE mitarbeiter_id=$1',[deactivate[1]]);
          await client.query('COMMIT');
          return reply(res,200,q.rows[0]);
        }catch(error){await client.query('ROLLBACK');throw error;}
        finally{client.release();}
      }
      const reactivate=route.match(/^\/api\/admin\/pruefung\/mitarbeitende\/([0-9a-f-]{36})\/reaktivieren$/i);
      if(reactivate&&req.method==='PATCH'){
        const activated=await pool.query('UPDATE brilon_pruef_mitarbeitende SET aktiv=true WHERE id=$1 AND aktiv=false AND freigabe_am IS NOT NULL AND registriert_am IS NOT NULL RETURNING id,name,email',[reactivate[1]]);
        if(!activated.rowCount)return reply(res,409,{error:'Nur ein zuvor freigegebener, pausierter Mitarbeiter kann reaktiviert werden.'});
        const staff=activated.rows[0];
        await pool.query('DELETE FROM brilon_pruef_sessions WHERE mitarbeiter_id=$1',[staff.id]);
        await pool.query('DELETE FROM brilon_pruef_admin_sessions WHERE mitarbeiter_id=$1',[staff.id]);
        let emailVersand='gesendet';
        try{
          await brevoMail(staff.email,'Dein Mitarbeiterzugang ist wieder aktiv – Klettern & Abenteuer',
            'Hallo '+staff.name+',\\n\\nDein Mitarbeiterzugang wurde von der Verwaltung wieder aktiviert. Du kannst dich mit deiner E-Mail-Adresse und deinem bisherigen Passwort anmelden.\\n\\nKlettern & Abenteuer Brilon');
        }catch(error){emailVersand=error?.uncertain?'versand_ungeklaert':'fehlgeschlagen';}
        return reply(res,200,{...staff,aktiv:true,emailVersand});
      }
      const staffDelete=route.match(/^\/api\/admin\/pruefung\/mitarbeitende\/([0-9a-f-]{36})$/i);
      if(staffDelete&&req.method==='DELETE'){
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          const staff=await client.query(`SELECT id,email FROM brilon_pruef_mitarbeitende WHERE id=$1 FOR UPDATE`,[staffDelete[1]]);
          if(!staff.rowCount){await client.query('ROLLBACK');return reply(res,404,{error:'Mitarbeiterkonto nicht gefunden.'});}
          const id=staff.rows[0].id,email=staff.rows[0].email;
          await client.query('DELETE FROM brilon_pruef_sessions WHERE mitarbeiter_id=$1',[id]);
          await client.query('DELETE FROM brilon_pruef_personaldokumente WHERE mitarbeiter_id=$1',[id]);
          await client.query('DELETE FROM brilon_pruef_freigaben WHERE mitarbeiter_id=$1',[id]);
          await client.query(`UPDATE brilon_pruef_einladungen SET widerrufen_am=NOW()
            WHERE email=$1 AND verwendet_am IS NULL AND widerrufen_am IS NULL`,[email]);
          // Keep safety reports and their foreign key, but erase the person's profile and login data.
          await client.query(`UPDATE brilon_pruef_mitarbeitende SET name='Gelöschtes Mitarbeiterkonto',
            email=$2,passwort_hash=$3,aktiv=false,telefon=NULL,strasse=NULL,plz=NULL,wohnort=NULL,
            qualifikationen=NULL,registriert_am=NULL,freigabe_am=NULL WHERE id=$1`,
          [id,'deleted+'+id+'@invalid.local',crypto.randomBytes(32).toString('hex')]);
          await client.query('COMMIT');
          return reply(res,200,{success:true,protokolleAnonymisiert:true});
        }catch(error){await client.query('ROLLBACK');throw error;}
        finally{client.release();}
      }
      const staffEnable=route.match(/^\/api\/admin\/pruefung\/mitarbeitende\/([0-9a-f-]{36})\/(reaktivieren|passwort-setzen)$/i);
      if(staffEnable&&req.method==='PATCH'){
        const d=await body(req);
        let newHash;
        try{newHash=passwortHash(d.passwort);}
        catch{return reply(res,400,{error:'Ein neues Passwort mit mindestens 6 Zeichen ist erforderlich.'});}
        const activate=staffEnable[2]==='reaktivieren';
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          const q=await client.query(
            'UPDATE brilon_pruef_mitarbeitende SET passwort_hash=$2,aktiv=CASE WHEN $3 THEN true ELSE aktiv END WHERE id=$1 AND aktiv=$4 AND (registriert_am IS NULL OR freigabe_am IS NOT NULL) RETURNING id,name,email,aktiv',
            [staffEnable[1],newHash,activate,!activate]);
          if(!q.rowCount){
            await client.query('ROLLBACK');
            return reply(res,409,{error:activate?'Mitarbeiter ist nicht deaktiviert oder nicht vorhanden.':'Passwort kann nur für aktive Mitarbeiter geändert werden.'});
          }
          await client.query('DELETE FROM brilon_pruef_sessions WHERE mitarbeiter_id=$1',[staffEnable[1]]);
          await client.query('DELETE FROM brilon_pruef_admin_sessions WHERE mitarbeiter_id=$1',[staffEnable[1]]);
          await client.query('UPDATE brilon_pruef_passwort_resets SET verwendet_am=NOW() WHERE mitarbeiter_id=$1 AND verwendet_am IS NULL',[staffEnable[1]]);
          await client.query('COMMIT');
          return reply(res,200,{...q.rows[0],sitzungenWiderrufen:true});
        }catch(error){await client.query('ROLLBACK');throw error;}
        finally{client.release();}
      }
      if(route==='/api/admin/pruefung/stationen'&&req.method==='POST'){
        const d=await body(req);
        const name=typeof d.name==='string'?d.name.trim():'';
        const ortId=Number(d.ortId),qualifikation=typeof d.qualifikation==='string'?d.qualifikation.trim():'';
        if(name.length<3||name.length>100)return reply(res,400,{error:'Stationsname muss 3 bis 100 Zeichen enthalten.'});
        if(!Number.isSafeInteger(ortId)||ortId<1||qualifikation.length<2||qualifikation.length>100)
          return reply(res,400,{error:'Aktiver Standort und erforderliche Qualifikation sind erforderlich.'});
        const place=await pool.query('SELECT id FROM brilon_orte WHERE id=$1 AND aktiv=true',[ortId]);
        if(!place.rowCount)return reply(res,400,{error:'Standort ist inaktiv oder nicht vorhanden.'});
        const q=await pool.query(`INSERT INTO brilon_pruef_stationen(id,name,ort_id,qualifikation)
          VALUES($1,$2,$3,$4) RETURNING id,name,aktiv,ort_id,qualifikation`,
          [crypto.randomUUID(),name,ortId,qualifikation]);
        return reply(res,201,q.rows[0]);
      }
      if(route==='/api/admin/pruefung/stationen'&&req.method==='GET'){
        const q=await pool.query(`SELECT s.id,s.name,s.aktiv,s.gesperrt_am,s.sperrgrund,
          s.ort_id,o.name AS ort,s.qualifikation FROM brilon_pruef_stationen s
          LEFT JOIN brilon_orte o ON o.id=s.ort_id ORDER BY s.name,s.id`);
        return reply(res,200,q.rows);
      }
      const stationAssignment=route.match(/^\/api\/admin\/pruefung\/stationen\/([0-9a-f-]{36})\/zuordnung$/i);
      if(stationAssignment&&req.method==='PATCH'){
        const d=await body(req),ortId=Number(d.ortId);
        const qualifikation=typeof d.qualifikation==='string'?d.qualifikation.trim():'';
        if(!Number.isSafeInteger(ortId)||ortId<1||qualifikation.length<2||qualifikation.length>100)
          return reply(res,400,{error:'Aktiver Standort und erforderliche Qualifikation sind erforderlich.'});
        const place=await pool.query('SELECT id FROM brilon_orte WHERE id=$1 AND aktiv=true',[ortId]);
        if(!place.rowCount)return reply(res,400,{error:'Standort ist inaktiv oder nicht vorhanden.'});
        const q=await pool.query(`UPDATE brilon_pruef_stationen SET ort_id=$1,qualifikation=$2
          WHERE id=$3 RETURNING id,name,aktiv,ort_id,qualifikation`,[ortId,qualifikation,stationAssignment[1]]);
        if(!q.rowCount)return reply(res,404,{error:'Station nicht gefunden.'});
        return reply(res,200,q.rows[0]);
      }
      const stationStatus=route.match(/^\/api\/admin\/pruefung\/stationen\/([0-9a-f-]{36})\/(deaktivieren|reaktivieren)$/i);
      if(stationStatus&&req.method==='PATCH'){
        const d=await body(req);
        const begruendung=typeof d.begruendung==='string'?d.begruendung.trim():'';
        if(begruendung.length<15||begruendung.length>2000)
          return reply(res,400,{error:'Die Änderung der Stationsnutzung benötigt eine Begründung (15 bis 2000 Zeichen).'});
        const activate=stationStatus[2]==='reaktivieren';
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          const q=await client.query(
            'UPDATE brilon_pruef_stationen SET aktiv=$2 WHERE id=$1 AND aktiv=$3 RETURNING id,name,aktiv,gesperrt_am,sperrgrund',
            [stationStatus[1],activate,!activate]);
          if(!q.rowCount){
            await client.query('ROLLBACK');
            return reply(res,409,{error:'Station ist nicht vorhanden oder hat bereits diesen Status.'});
          }
          await client.query(
            'INSERT INTO brilon_pruef_stationsstatus(id,station_id,art,begruendung,verantwortlich) VALUES($1,$2,$3,$4,$5)',
            [crypto.randomUUID(),stationStatus[1],activate?'reaktiviert':'deaktiviert',
              begruendung,process.env.ADMIN_USER||'Admin']);
          await client.query('COMMIT');
          return reply(res,200,{...q.rows[0],
            hinweis:activate?'Station reaktiviert; bestehende Sicherheitsmängelsperre bleibt bestehen.':'Station ist von zukünftigen Prüfprotokollen ausgeschlossen.'});
        }catch(error){await client.query('ROLLBACK');throw error;}
        finally{client.release();}
      }
      const stationStatusLog=route.match(/^\/api\/admin\/pruefung\/stationen\/([0-9a-f-]{36})\/statusverlauf$/i);
      if(stationStatusLog&&req.method==='GET'){
        const q=await pool.query(
          'SELECT id,station_id,art,begruendung,verantwortlich,erstellt_am FROM brilon_pruef_stationsstatus WHERE station_id=$1 ORDER BY erstellt_am DESC,id DESC LIMIT 200',
          [stationStatusLog[1]]);
        return reply(res,200,q.rows);
      }
      const release=route.match(/^\/api\/admin\/pruefung\/stationen\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/freigeben$/i);
      if(release&&req.method==='POST'){
        const d=await body(req);
        const freigabeDurch=typeof d.freigabeDurch==='string'?d.freigabeDurch.trim():'';
        const begruendung=typeof d.begruendung==='string'?d.begruendung.trim():'';
        if(d.nachkontrolleBestaetigt!==true||freigabeDurch.length<3||freigabeDurch.length>120||
           begruendung.length<20||begruendung.length>2000)
          return reply(res,400,{error:'Fachliche Nachkontrolle, prüfende Person und eine aussagekräftige Begründung sind erforderlich.'});
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          const q=await client.query(
            'UPDATE brilon_pruef_stationen SET gesperrt_am=NULL,sperrgrund=NULL WHERE id=$1 AND aktiv=true AND gesperrt_am IS NOT NULL RETURNING id,name',
            [release[1]]);
          if(!q.rowCount){await client.query('ROLLBACK');return reply(res,409,{error:'Station ist nicht gesperrt, deaktiviert oder nicht vorhanden.'});}
          await client.query(
            "INSERT INTO brilon_pruef_stationsereignisse(id,station_id,art,notiz,verantwortlich) VALUES($1,$2,'freigabe',$3,$4)",
            [crypto.randomUUID(),release[1],begruendung,
              'Admin: '+(process.env.ADMIN_USER||'unbekannt')+' · Fachprüfung: '+freigabeDurch]);
          await client.query('COMMIT');
          return reply(res,200,{id:q.rows[0].id,name:q.rows[0].name,gesperrt:false,
            hinweis:'Fachliche Freigabe dokumentiert. Die nächste Programmprüfung bleibt erforderlich.'});
        }catch(error){await client.query('ROLLBACK');throw error;}
        finally{client.release();}
      }
      const audit=route.match(/^\/api\/admin\/pruefung\/stationen\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/ereignisse$/i);
      if(audit&&req.method==='GET'){
        const q=await pool.query(
          'SELECT id,station_id,bericht_id,art,notiz,verantwortlich,erstellt_am FROM brilon_pruef_stationsereignisse WHERE station_id=$1 ORDER BY erstellt_am DESC,id DESC LIMIT 200',
          [audit[1]]);
        return reply(res,200,q.rows);
      }
      if(route==='/api/admin/pruefung/tablet/kopplung'&&req.method==='POST'){
        try{return reply(res,201,await tablet.issuePairing());}
        catch{return reply(res,503,{error:'Tablet-Kopplung ist nicht konfiguriert.'});}
      }
      if(route==='/api/admin/pruefung/tablets'&&req.method==='GET'){
        const q=await pool.query("SELECT id,name,aktiv,pruefdisplay,gekoppelt_am,zuletzt_gesehen_am,(aktiv=true AND gekoppelt_am>NOW()-INTERVAL '30 days' AND zuletzt_gesehen_am>NOW()-INTERVAL '45 seconds') AS online FROM brilon_pruef_tablets ORDER BY gekoppelt_am DESC,id DESC LIMIT 100");
        return reply(res,200,q.rows);
      }
      const chooseTablet=route.match(/^\/api\/admin\/pruefung\/tablets\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/pruefdisplay$/i);
      if(chooseTablet&&req.method==='PATCH'){
        const chosen=await tablet.chooseDisplay(chooseTablet[1]);
        if(!chosen)return reply(res,409,{error:'Tablet inaktiv, abgelaufen oder nicht vorhanden.'});
        return reply(res,200,{...chosen,hinweis:'Bisherige Prüfcodes wurden aus Sicherheitsgründen ungültig gemacht.'});
      }
      const replaceTablet=route.match(/^\/api\/admin\/pruefung\/tablets\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/ersetzen$/i);
      if(replaceTablet&&req.method==='POST'){
        const d=await body(req);
        if(d.wechselBestaetigt!==true)
          return reply(res,400,{error:'Gerätewechsel und Sperrung des bisherigen Zugangs bestätigen.'});
        let replaced;
        try{replaced=await tablet.replaceDevice(replaceTablet[1]);}
        catch{return reply(res,503,{error:'Gerät konnte nicht sicher ersetzt werden.'});}
        if(!replaced)return reply(res,409,{error:'Gerät ist bereits gesperrt oder nicht vorhanden.'});
        return reply(res,201,replaced);
      }
      const revokeTablet=route.match(/^\/api\/admin\/pruefung\/tablets\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/sperren$/i);
      if(revokeTablet&&req.method==='PATCH'){
        const revoked=await tablet.revokeTablet(revokeTablet[1]);
        if(!revoked)return reply(res,404,{error:'Tablet nicht gefunden.'});
        return reply(res,200,revoked);
      }
      if(route==='/api/admin/pruefung/code'&&req.method==='POST'){
        try{return reply(res,201,await tablet.issueCode());}
        catch{return reply(res,503,{error:'Stationscode konnte nicht erzeugt werden.'});}
      }
      if(route==='/api/admin/pruefung/hinweise'&&req.method==='GET'){
        const q=await pool.query(`SELECT h.id,h.station_id,h.bericht_id,h.beschreibung,h.erstellt_von,
          h.erstellt_am,h.erledigt_am,h.erledigt_von,h.erledigt_notiz,
          s.name AS station,s.gesperrt_am
          FROM brilon_pruef_hinweise h
          JOIN brilon_pruef_stationen s ON s.id=h.station_id
          ORDER BY (h.erledigt_am IS NULL) DESC,h.erstellt_am DESC,h.id DESC LIMIT 200`);
        return reply(res,200,q.rows);
      }
      const review=route.match(/^\/api\/admin\/pruefung\/hinweise\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/erledigen$/i);
      if(review&&req.method==='POST'){
        const d=await body(req);
        const pruefer=typeof d.pruefer==='string'?d.pruefer.trim():'';
        const ergebnis=typeof d.ergebnis==='string'?d.ergebnis.trim():'';
        if(pruefer.length<3||pruefer.length>120||ergebnis.length<20||ergebnis.length>2000||
          d.geprueft!==true)
          return reply(res,400,{error:'Zur Erledigung sind prüfende Person, Prüfung und Ergebnis erforderlich.'});
        const q=await pool.query(`UPDATE brilon_pruef_hinweise
          SET erledigt_am=NOW(),erledigt_von=$2,erledigt_notiz=$3
          WHERE id=$1 AND erledigt_am IS NULL
          RETURNING id,erledigt_am,erledigt_von`,
          [review[1],pruefer,ergebnis]);
        if(!q.rowCount)return reply(res,409,{error:'Hinweis ist bereits erledigt oder nicht vorhanden.'});
        return reply(res,200,{...q.rows[0],hinweis:'Hinweis geprüft; eine Stationssperre wird hierdurch nicht verändert.'});
      }
      if(route==='/api/admin/pruefung/meldungen'&&req.method==='GET'){
        const q=await pool.query(
          "SELECT o.bericht_id,o.status,o.versuche,o.letzter_versuch,o.angenommen_am,o.letzter_fehler,o.erstellt_am,p.programm,p.beginn,p.pruefungen FROM brilon_pruef_meldungen o JOIN brilon_pruef_berichte p ON p.id=o.bericht_id ORDER BY (o.status NOT IN ('angenommen')) DESC,o.erstellt_am DESC,o.bericht_id DESC LIMIT 100"
        );
        return reply(res,200,q.rows.map(({pruefungen,...item})=>({
          ...item,stationen:pruefungen.filter(x=>x.zustand==='mangel')
            .map(x=>x.station||'Station')
        })));
      }
      const retry=route.match(/^\/api\/admin\/pruefung\/meldungen\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/erneut-senden$/i);
      if(retry&&req.method==='POST'){
        const d=await body(req);
        if(d.doppelversandGeprueft!==true)
          return reply(res,400,{error:'Vor erneutem Versand die mögliche Mehrfachzustellung prüfen und bestätigen.'});
        const result=await meldungen.send(retry[1]);
        if(!result.gefunden)return reply(res,404,{error:'Sicherheitsmängelmeldung nicht gefunden.'});
        if(result.status==='gesendet'&&!result.erneutVersendet)
          return reply(res,409,{error:'Meldung wurde bereits vom E-Mail-Anbieter angenommen.'});
        if(result.status==='versand_ungeklaert')
          return reply(res,409,{error:'Versandzustand ungeklärt – vor einem erneuten Versuch E-Mail-Anbieter prüfen.'});
        return reply(res,200,result);
      }
      if(route==='/api/admin/pruefung/berichte'&&req.method==='GET'){
        const q=await pool.query('SELECT p.id,p.programm,p.beginn,p.erstellt_am,p.hat_mangel,p.hat_hinweis,p.pruefungen,m.name AS pruefer FROM brilon_pruef_berichte p JOIN brilon_pruef_mitarbeitende m ON m.id=p.mitarbeiter_id ORDER BY p.erstellt_am DESC,p.id DESC LIMIT 100');
        return reply(res,200,q.rows.map(row=>({...row,
          pruefungen:row.pruefungen.map(({foto,...item})=>({...item,hatFoto:!!foto}))
        })));
      }
      const photo=route.match(/^\/api\/admin\/pruefung\/berichte\/([0-9a-f-]{36})\/foto\/([0-9a-f-]{36})$/i);
      if(photo&&req.method==='GET'){
        const q=await pool.query('SELECT pruefungen FROM brilon_pruef_berichte WHERE id=$1',[photo[1]]);
        if(!q.rowCount)return reply(res,404,{error:'Prüfbericht nicht gefunden.'});
        const item=q.rows[0].pruefungen.find(x=>x.stationId===photo[2]&&typeof x.foto==='string');
        if(!item)return reply(res,404,{error:'Foto nicht gefunden.'});
        const raw=Buffer.from(item.foto.slice('data:image/jpeg;base64,'.length),'base64');
        res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':raw.length,
          'Content-Disposition':'attachment; filename="stationsfoto.jpg"',
          'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
          'Content-Security-Policy':'sandbox','X-Frame-Options':'DENY'});
        return res.end(raw);
      }
      return reply(res,404,{error:'Prüfverwaltung nicht gefunden.'});
    }
    if(route==='/api/pruefung/tablet/koppeln'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Ungültige Herkunft.'});
      if(!limit('tablet-pair:'+ip,6,600000))return reply(res,429,{error:'Zu viele Kopplungsversuche.'});
      const d=await body(req);
      let paired;
      try{paired=await tablet.pairDevice(d.code,d.name);}
      catch{return reply(res,503,{error:'Kopplung nicht verfügbar.'});}
      if(!paired)return reply(res,409,{error:'Kopplungscode ungültig, abgelaufen oder bereits verwendet.'});
      return reply(res,201,{name:paired.name,gekoppelt:true},{'Set-Cookie':paired.cookie});
    }
    if(route==='/api/pruefung/tablet/anzeige'&&req.method==='GET'){
      const paired=await tablet.authenticatedTablet(req.headers.cookie);
      if(!paired)return reply(res,401,{error:'Tablet nicht gekoppelt oder deaktiviert.'});
      return reply(res,200,{name:paired.name,pruefdisplay:paired.pruefdisplay,
        ...await tablet.display(paired.pruefdisplay?paired.id:null)});
    }
    if(route==='/api/pruefung/login'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anmeldung nicht zulässig.'});
      if(!limit('pruef-login:'+ip,8,600000))return reply(res,429,{error:'Zu viele Anmeldeversuche.'});
      const d=await body(req);
      const email=typeof d.email==='string'?d.email.trim().toLowerCase():'';
      if(!emailGueltig(email))return reply(res,401,{error:'E-Mail-Adresse oder Passwort ist nicht korrekt.'});
      const emailHash=sha256(email);
      const q=await pool.query('SELECT id,name,email,passwort_hash,verwaltungszugang FROM brilon_pruef_mitarbeitende WHERE email=$1 AND aktiv=true',[email]);
      let valid=false;
      if(q.rowCount)try{valid=passwortPruefen(d.passwort,q.rows[0].passwort_hash)}catch{}
      if(!valid){
        const attempts=await pool.query(`INSERT INTO brilon_pruef_login_fehler(email_hash,versuche,fenster_am)
          VALUES($1,1,NOW()) ON CONFLICT(email_hash) DO UPDATE SET
          versuche=CASE WHEN brilon_pruef_login_fehler.fenster_am<NOW()-INTERVAL '24 hours' THEN 1
            ELSE brilon_pruef_login_fehler.versuche+1 END,
          fenster_am=CASE WHEN brilon_pruef_login_fehler.fenster_am<NOW()-INTERVAL '24 hours' THEN NOW()
            ELSE brilon_pruef_login_fehler.fenster_am END RETURNING versuche`,[emailHash]);
        const count=Number(attempts.rows[0]?.versuche||0);
        return reply(res,401,{error:'E-Mail-Adresse oder Passwort ist nicht korrekt.',
          passwortResetMoeglich:count>=6,fehlversuche:count});
      }
      await pool.query('DELETE FROM brilon_pruef_login_fehler WHERE email_hash=$1',[emailHash]);
      const token=crypto.randomBytes(32).toString('hex');
      const tokenHash=sha256(token);
      await pool.query("INSERT INTO brilon_pruef_sessions(token_hash,mitarbeiter_id,ablauf) VALUES($1,$2,NOW()+INTERVAL '4 hours')",
        [tokenHash,q.rows[0].id]);
      const cookies=[COOKIE+'='+token+'; HttpOnly; Secure; SameSite=Strict; Path=/api/pruefung; Max-Age=14400'];
      if(q.rows[0].verwaltungszugang){
        await pool.query("INSERT INTO brilon_pruef_admin_sessions(token_hash,mitarbeiter_id,ablauf) VALUES($1,$2,NOW()+INTERVAL '4 hours')",
          [tokenHash,q.rows[0].id]);
        cookies.push('brilon_session='+token+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=14400');
      }else cookies.push('brilon_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
      return reply(res,200,{name:q.rows[0].name,verwaltungszugang:Boolean(q.rows[0].verwaltungszugang)},{
        'Set-Cookie':cookies
      });
    }
    if(route==='/api/pruefung/passwort-reset-anfordern'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
      if(!limit('pruef-reset-request:'+ip,5,3600000))return reply(res,429,{error:'Zu viele Anfragen. Bitte später erneut versuchen.'});
      const d=await body(req),email=typeof d.email==='string'?d.email.trim().toLowerCase():'';
      const generic={success:true,message:'Falls ein aktives Mitarbeiterkonto nach sechs Fehlversuchen berechtigt ist, wird ein Link an die hinterlegte E-Mail-Adresse gesendet. Bitte prüfe auch den Spam-Ordner.'};
      if(!emailGueltig(email))return reply(res,200,generic);
      const emailHash=sha256(email);
      const failures=await pool.query('SELECT versuche,fenster_am FROM brilon_pruef_login_fehler WHERE email_hash=$1',[emailHash]);
      if(!failures.rowCount||Number(failures.rows[0].versuche)<6||Date.now()-new Date(failures.rows[0].fenster_am).getTime()>86400000)
        return reply(res,200,generic);
      const account=await pool.query('SELECT id,name,email FROM brilon_pruef_mitarbeitende WHERE email=$1 AND aktiv=true',[email]);
      if(!account.rowCount)return reply(res,200,generic);
      const base=(env.PUBLIC_BASE_URL||'').replace(/\/+$/,'');
      let parsed;try{parsed=new URL(base);}catch{return reply(res,200,generic);}
      if(parsed.protocol!=='https:'||parsed.username||parsed.password)return reply(res,200,generic);
      const token=crypto.randomBytes(32).toString('hex'),tokenHash=sha256(token);
      await pool.query('UPDATE brilon_pruef_passwort_resets SET verwendet_am=NOW() WHERE mitarbeiter_id=$1 AND verwendet_am IS NULL',[account.rows[0].id]);
      await pool.query("INSERT INTO brilon_pruef_passwort_resets(token_hash,mitarbeiter_id,ablauf) VALUES($1,$2,NOW()+INTERVAL '30 minutes')",
        [tokenHash,account.rows[0].id]);
      try{
        await brevoMail(email,'Passwort für den Mitarbeiterbereich zurücksetzen',
          `Hallo ${account.rows[0].name},\n\nüber diesen einmaligen Link kannst du innerhalb von 30 Minuten ein neues Passwort festlegen:\n${base}/mitarbeiter-passwort-reset.html?token=${token}\n\nDer Link funktioniert nur einmal. Falls du die Anfrage nicht gestellt hast, kannst du diese Nachricht ignorieren. Dein bisheriges Passwort wird nicht per E-Mail versendet.\n\nKlettern & Abenteuer Brilon`);
      }catch(error){
        console.warn('Mitarbeiter-Passwortreset: Mailversand fehlgeschlagen',
          typeof error?.code==='string'&&/^(MAIL_[A-Z_]+|BREVO_(?:HTTP_\d{3}|CONNECTION_UNCERTAIN))$/.test(error.code)?error.code:'MAIL_UNEXPECTED_ERROR');
      }
      return reply(res,200,generic);
    }
    if(route==='/api/pruefung/passwort-zuruecksetzen'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
      if(!limit('pruef-reset-complete:'+ip,8,3600000))return reply(res,429,{error:'Zu viele Versuche. Bitte später erneut versuchen.'});
      const d=await body(req),token=typeof d.token==='string'?d.token:'',tokenHash=sha256(token);
      let hash;try{hash=passwortHash(d.passwort);}catch{return reply(res,400,{error:'Das neue Passwort muss mindestens 6 Zeichen enthalten.'});}
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const reset=await client.query(`SELECT mitarbeiter_id FROM brilon_pruef_passwort_resets
          WHERE token_hash=$1 AND verwendet_am IS NULL AND ablauf>NOW() FOR UPDATE`,[tokenHash]);
        if(!reset.rowCount){await client.query('ROLLBACK');return reply(res,400,{error:'Der Link ist ungültig, abgelaufen oder bereits verwendet. Bitte fordere einen neuen Link an.'});}
        const updated=await client.query('UPDATE brilon_pruef_mitarbeitende SET passwort_hash=$1 WHERE id=$2 AND aktiv=true',[hash,reset.rows[0].mitarbeiter_id]);
        if(!updated.rowCount){await client.query('ROLLBACK');return reply(res,400,{error:'Der Zugang ist nicht aktiv. Bitte wende dich an die Verwaltung.'});}
        await client.query('UPDATE brilon_pruef_passwort_resets SET verwendet_am=NOW() WHERE token_hash=$1',[tokenHash]);
        await client.query('DELETE FROM brilon_pruef_sessions WHERE mitarbeiter_id=$1',[reset.rows[0].mitarbeiter_id]);
        await client.query('DELETE FROM brilon_pruef_admin_sessions WHERE mitarbeiter_id=$1',[reset.rows[0].mitarbeiter_id]);
        await client.query('COMMIT');
        return reply(res,200,{success:true,message:'Passwort geändert. Du kannst dich jetzt mit dem neuen Passwort anmelden.'});
      }catch(error){await client.query('ROLLBACK');throw error;}
      finally{client.release();}
    }
    const staff=await staffSession(req);
    if(!staff)return reply(res,401,{error:'Mitarbeiteranmeldung erforderlich.'});
    if(route==='/api/pruefung/mitarbeiterbereiche'&&req.method==='GET'){
      const [areas,places,contacts]=await Promise.all([
        pool.query(`SELECT a.id,a.titel,a.inhalt,a.sortierung,a.art,
            COALESCE((SELECT json_agg(json_build_object('id',o.id,'name',o.name) ORDER BY o.name)
              FROM brilon_mitarbeiterbereich_orte ao JOIN brilon_orte o ON o.id=ao.ort_id AND o.aktiv=true
              WHERE ao.bereich_id=a.id),'[]'::json) AS standorte
          FROM brilon_mitarbeiterbereiche a WHERE a.aktiv=true ORDER BY a.sortierung,a.titel,a.id`),
        pool.query('SELECT id,name FROM brilon_orte WHERE aktiv=true ORDER BY name'),
        pool.query(`SELECT id,name,email,telefon FROM brilon_pruef_mitarbeitende
          WHERE aktiv=true ORDER BY lower(name),id`)
      ]);
      return reply(res,200,{mitarbeiter:staff.name,verwaltungszugang:Boolean(staff.verwaltungszugang),profil:{name:staff.name,email:staff.email,telefon:staff.telefon},
        bereiche:areas.rows,orte:places.rows,kontakte:contacts.rows});
    }
    if(route==='/api/pruefung/stationen'&&req.method==='GET'){
      const q=await pool.query(`SELECT DISTINCT s.id,s.name,s.gesperrt_am,s.sperrgrund,
          o.name AS ort,s.qualifikation
        FROM brilon_pruef_stationen s
        JOIN brilon_pruef_freigaben f ON f.ort_id=s.ort_id AND f.qualifikation=s.qualifikation
        JOIN brilon_orte o ON o.id=s.ort_id AND o.aktiv=true
        WHERE s.aktiv=true AND f.mitarbeiter_id=$1 ORDER BY o.name,s.name,s.id`,[staff.mitarbeiter_id]);
      return reply(res,200,{mitarbeiter:staff.name,entsperrtBis:staff.entsperrt_bis,stationen:q.rows});
    }
    if(route==='/api/pruefung/berichte'&&req.method==='GET'){
      // A staff member can review only their own recent reports. Photo payloads
      // stay server-side and are never returned through this personal history.
      const q=await pool.query(`SELECT b.id,b.programm,b.beginn,b.erstellt_am,b.hat_mangel,
        b.hat_hinweis,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'station',item->>'station','zustand',item->>'zustand',
          'beschreibung',item->>'beschreibung','pruefpunkte',COALESCE(item->'pruefpunkte','[]'::jsonb)) ORDER BY item->>'station')
          FROM jsonb_array_elements(b.pruefungen) AS entries(item)),'[]'::jsonb) AS pruefungen
        FROM brilon_pruef_berichte b
        WHERE b.mitarbeiter_id=$1
        ORDER BY b.erstellt_am DESC,b.id DESC LIMIT 20`,[staff.mitarbeiter_id]);
      return reply(res,200,q.rows);
    }
    if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft nicht zulässig.'});
    if(route==='/api/pruefung/profil'&&req.method==='PATCH'){
      const d=await body(req);
      const name=typeof d.name==='string'?d.name.trim():'';
      const telefon=typeof d.telefon==='string'?d.telefon.trim():'';
      if(!name||name.length>120||telefon.length>40)
        return reply(res,400,{error:'Bitte einen gültigen Namen und eine Telefonnummer bis 40 Zeichen angeben.'});
      const q=await pool.query(`UPDATE brilon_pruef_mitarbeitende SET name=$1,telefon=$2
        WHERE id=$3 AND aktiv=true RETURNING name,email,telefon`,[name,telefon||null,staff.mitarbeiter_id]);
      if(!q.rowCount)return reply(res,401,{error:'Mitarbeiterzugang ist nicht mehr aktiv.'});
      return reply(res,200,q.rows[0]);
    }
    if(route==='/api/pruefung/abmelden'&&req.method==='POST'){
      const token=(req.headers.cookie||'').match(/brilon_pruef_session=([a-f0-9]{64})/)?.[1];
      if(token){
        await pool.query('DELETE FROM brilon_pruef_sessions WHERE token_hash=$1',[sha256(token)]);
        await pool.query('DELETE FROM brilon_pruef_admin_sessions WHERE token_hash=$1',[sha256(token)]);
      }
      return reply(res,200,{success:true},{
        'Set-Cookie':[COOKIE+'=; HttpOnly; Secure; SameSite=Strict; Path=/api/pruefung; Max-Age=0',
          'brilon_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0']});
    }
    if(route==='/api/pruefung/code-anfordern'&&req.method==='POST'){
      if(!limit('tablet-code-request:'+staff.mitarbeiter_id,3,600000))
        return reply(res,429,{error:'Zu viele Prüfcode-Anforderungen.'});
      if(!(await tablet.activeTablets()))
        return reply(res,409,{error:'Das ausgewählte Prüfdisplay ist nicht erreichbar. Bitte Verbindung und Verwaltungszuordnung prüfen.'});
      try{
        const code=await tablet.issueCode({requireDisplay:true});
        return reply(res,201,{success:true,gueltigSekunden:code.gueltigSekunden,
          hinweis:'Code wird ausschließlich auf dem von der Verwaltung ausgewählten Tablet angezeigt.'});
      }catch(e){
        if(e.code==='NO_ONLINE_PRUEFDISPLAY')
          return reply(res,409,{error:'Das ausgewählte Prüfdisplay ist nicht mehr erreichbar.'});
        return reply(res,503,{error:'Prüfcode konnte nicht erzeugt werden.'});
      }
    }
    if(route==='/api/pruefung/freischalten'&&req.method==='POST'){
      if(!limit('pruef-code:'+staff.mitarbeiter_id,6,600000))
        return reply(res,429,{error:'Zu viele Codeversuche.'});
      const d=await body(req),code=typeof d.code==='string'?d.code:'';
      if(!/^\d{6}$/.test(code))return reply(res,400,{error:'Sechsstelligen Code eingeben.'});
      const secret=process.env.STATION_CHECK_SECRET;
      if(typeof secret!=='string'||secret.length<32)
        return reply(res,503,{error:'Stationscode-Geheimnis fehlt.'});
      const q=await pool.query('UPDATE brilon_pruef_codes SET verbraucht_am=NOW() WHERE code_hash=$1 AND verbraucht_am IS NULL AND ablauf>NOW() RETURNING id',
        [codeHash(code,secret)]);
      if(!q.rowCount)return reply(res,409,{error:'Code ungültig, bereits verwendet oder abgelaufen.'});
      const token=(req.headers.cookie||'').match(/brilon_pruef_session=([a-f0-9]{64})/)?.[1];
      await pool.query("UPDATE brilon_pruef_sessions SET entsperrt_bis=NOW()+INTERVAL '15 minutes' WHERE token_hash=$1",
        [sha256(token)]);
      return reply(res,200,{success:true,gueltigMinuten:15});
    }
    if(route==='/api/pruefung/berichte'&&req.method==='POST'){
      const q=await pool.query('SELECT entsperrt_bis>NOW() AS freigegeben FROM brilon_pruef_sessions WHERE mitarbeiter_id=$1 AND ablauf>NOW()',
        [staff.mitarbeiter_id]);
      if(!q.rowCount||!q.rows[0].freigegeben)
        return reply(res,403,{error:'Vor-Ort-Code fehlt oder ist abgelaufen.'});
      const stations=await pool.query(`SELECT DISTINCT s.id,s.name,s.ort_id,o.name AS ort,s.qualifikation,
          s.gesperrt_am,s.sperrgrund
        FROM brilon_pruef_stationen s
        JOIN brilon_pruef_freigaben f ON f.ort_id=s.ort_id AND f.qualifikation=s.qualifikation
        JOIN brilon_orte o ON o.id=s.ort_id AND o.aktiv=true
        WHERE s.aktiv=true AND f.mitarbeiter_id=$1`,[staff.mitarbeiter_id]);
      let report;
      const dPruefpunkte=new Map();
      try{
        const d=await body(req,360000);
        if(Array.isArray(d?.pruefungen)){
          for(const pruefung of d.pruefungen){
            if(pruefung?.zustand!=='ok'&&pruefung?.foto){
              pruefung.foto=await fotoBereinigen(pruefung.foto);
              const base64=pruefung.foto.slice(pruefung.foto.indexOf(',')+1);
              const verdict=await scanForMalware(Buffer.from(base64,'base64'));
              if(verdict?.sauber!==true)throw Object.assign(new Error('Malware-Scannerantwort ungültig.'),{code:'MALWARE_SCAN_ERROR'});
            }
          }
        }
        report=programmPruefen(d,stations.rows.map(x=>x.id));
        for(const item of d.pruefungen)dPruefpunkte.set(item.stationId,item.pruefpunkte);
      }
      catch(e){
        if(e.code==='MALWARE_FOUND')return reply(res,422,{error:'Das Foto wurde als Schadsoftware erkannt und abgewiesen.'});
        if(e.code?.startsWith('MALWARE_SCAN_')){
          console.error('Stationsfoto-Prüfung abgebrochen:',e.code);
          return reply(res,503,{error:'Foto-Prüfung ist nicht verfügbar. Das Foto wurde nicht gespeichert.'});
        }
        return reply(res,400,{error:e.message});
      }
      const stationDetails=new Map(stations.rows.map(x=>[x.id,x]));
      const brilonNames={
        kletterwand:['Wandstruktur','Griffe und Tritte','Sicherungspunkte','Sicherungsmaterial','Fallbereich'],
        strickleiter:['Seile und Sprossen','Befestigungen','Sicherungssystem','Ein- und Ausstieg'],
        abseilplattform:['Plattform und Zugang','Anschlagpunkte','Abseilsystem','Zweitsicherung','Landezone'],
        prusikstation:['Aufhängung','Seil und Schlingen','Knoten und Verbindungen','Zusätzliche Sicherung','Bewegungsbereich']
      };
      for(const item of report.pruefungen){
        const station=stationDetails.get(item.stationId);
        const normalized=station.name.toLowerCase().replace(/ü/g,'u').replace(/[^a-z]/g,'');
        const key=Object.keys(brilonNames).find(k=>normalized.includes(k));
        const raw=dPruefpunkte.get(item.stationId);
        if(item.zustand==='nicht_genutzt'){item.pruefpunkte=[];continue;}
        if(key&&/brilon/i.test(station.ort)){
          const expected=brilonNames[key];
          if(!Array.isArray(raw)||raw.length!==expected.length||
             expected.some((name,i)=>raw[i]?.name!==name||!['ok','hinweis','mangel'].includes(raw[i]?.zustand)))
            return reply(res,400,{error:'Die Einzelprüfpunkte der Station '+station.name+' sind nicht vollständig bewertet.'});
          if(raw.some(p=>p.zustand==='mangel')&&item.zustand!=='mangel')
            return reply(res,400,{error:'Sicherheitsmangel eines Prüfpunktes muss die Station sperren.'});
          if(raw.some(p=>p.zustand==='hinweis')&&item.zustand==='ok')
            return reply(res,400,{error:'Hinweis eines Prüfpunktes muss im Stationsbefund erscheinen.'});
          item.pruefpunkte=raw.map(p=>({name:p.name,zustand:p.zustand}));
        }
      }
      const items=report.pruefungen.map(x=>({...x,station:stationDetails.get(x.stationId).name,
        ort:stationDetails.get(x.stationId).ort,qualifikation:stationDetails.get(x.stationId).qualifikation}));
      const id=crypto.randomUUID();
      let gesperrteStationen=[];
      const token=(req.headers.cookie||'').match(/brilon_pruef_session=([a-f0-9]{64})/)?.[1];
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const aktiveStationen=await client.query(
          'SELECT id,aktiv FROM brilon_pruef_stationen WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
          [items.filter(x=>x.zustand!=='nicht_genutzt').map(x=>x.stationId)]);
        if(aktiveStationen.rowCount!==items.filter(x=>x.zustand!=='nicht_genutzt').length||aktiveStationen.rows.some(x=>!x.aktiv)){
          await client.query('ROLLBACK');
          return reply(res,409,{error:'Eine verwendete Station wurde zwischenzeitlich deaktiviert. Bitte Prüfung neu beginnen.'});
        }
        const locked=await client.query('UPDATE brilon_pruef_sessions SET entsperrt_bis=NULL WHERE token_hash=$1 AND entsperrt_bis>NOW() RETURNING mitarbeiter_id',
          [sha256(token)]);
        if(!locked.rowCount){await client.query('ROLLBACK');return reply(res,403,{error:'Freigabe ist bereits verbraucht.'});}
        await client.query('INSERT INTO brilon_pruef_berichte(id,mitarbeiter_id,programm,beginn,pruefungen,hat_mangel,hat_hinweis) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)',
          [id,staff.mitarbeiter_id,report.programm,report.beginn,JSON.stringify(items),report.hatMangel,report.hatHinweis]);
        if(report.hatMangel){
          await client.query(
            "INSERT INTO brilon_pruef_meldungen(bericht_id,status) VALUES($1,'ausstehend')",
            [id]);
        }
        for(const item of items.filter(x=>x.zustand==='hinweis')){
          await client.query(
            'INSERT INTO brilon_pruef_hinweise(id,station_id,bericht_id,beschreibung,erstellt_von) VALUES($1,$2,$3,$4,$5)',
            [crypto.randomUUID(),item.stationId,id,item.beschreibung,staff.name+' · '+staff.email]);
        }
        for(const item of items.filter(x=>x.zustand==='mangel')){
          // Bereits gesperrte Stationen bleiben gesperrt; ältere Sperrgründe werden nicht still überschrieben.
          const lockedStation=await client.query(
            'UPDATE brilon_pruef_stationen SET gesperrt_am=COALESCE(gesperrt_am,NOW()),sperrgrund=CASE WHEN gesperrt_am IS NULL THEN $2 ELSE sperrgrund END WHERE id=$1 AND aktiv=true RETURNING id',
            [item.stationId,item.beschreibung]);
          if(!lockedStation.rowCount)throw Error('Prüfstation wurde zwischenzeitlich deaktiviert.');
          await client.query(
            "INSERT INTO brilon_pruef_stationsereignisse(id,station_id,bericht_id,art,notiz,verantwortlich) VALUES($1,$2,$3,'mangel',$4,$5)",
            [crypto.randomUUID(),item.stationId,id,item.beschreibung,staff.name+' · '+staff.email]);
        }
        const selectedIds=items.filter(x=>x.zustand!=='nicht_genutzt').map(x=>x.stationId);
        const current=await client.query(
          'SELECT id,name,gesperrt_am FROM brilon_pruef_stationen WHERE id=ANY($1::uuid[]) FOR UPDATE',
          [selectedIds]);
        // Speichere auch den Zustand bereits früher gesperrter Stationen im Ergebnis.
        gesperrteStationen=current.rows.filter(x=>x.gesperrt_am).map(x=>({id:x.id,name:x.name}));
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
      let meldung='kein_mangel';
      if(report.hatMangel){
        try{
          const result=await meldungen.send(id);
          meldung=result.status;
        }catch{
          // Report and station lock have already committed. Never turn a
          // notification error into a misleading "inspection not saved" response.
          meldung='versand_ungeklaert';
        }
      }
      return reply(res,201,{id,hatMangel:report.hatMangel,hatHinweis:report.hatHinweis,gesperrteStationen,
        status:gesperrteStationen.length?'station_gesperrt':report.hatHinweis?'hinweis_offen':'ohne_mangel',
        benachrichtigung:meldung});
    }
    return reply(res,404,{error:'Prüffunktion nicht gefunden.'});
  };
  handler.staffSession=staffSession;
  handler.retryRateLimited=meldungen.retryRateLimited;
  handler.bereinigeAbgelaufeneZugaenge=zugangsbereinigung.bereinige;
  return handler;
}
module.exports={createPruefungApi};
