'use strict';
const crypto=require('node:crypto');
const {emailGueltig,passwortHash,passwortPruefen,codeHash,programmPruefen}=require('./stationspruefung');
const {createPruefMeldungen}=require('./pruef-meldungen');
const {createTabletService}=require('./pruef-tablet');
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const COOKIE='brilon_pruef_session';

function createPruefungApi({pool,admin,reply,body,sameOriginMutation,limit,brevoMail}){
  const meldungen=createPruefMeldungen({pool,brevoMail});
  const tablet=createTabletService({pool});
  async function staffSession(req){
    const token=(req.headers.cookie||'').match(/(?:^|;\s*)brilon_pruef_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if(!token)return null;
    const q=await pool.query(
      'SELECT s.mitarbeiter_id,s.entsperrt_bis,m.name,m.email FROM brilon_pruef_sessions s JOIN brilon_pruef_mitarbeitende m ON m.id=s.mitarbeiter_id WHERE s.token_hash=$1 AND s.ablauf>NOW() AND m.aktiv=true',
      [sha256(token)]);
    return q.rows[0]||null;
  }
  return async function(req,res,u,route,ip){
    if(!pool)return reply(res,503,{error:'Prüfdatenbank nicht konfiguriert.'});
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
        const q=await pool.query('SELECT id,name,email,aktiv,erstellt_am FROM brilon_pruef_mitarbeitende ORDER BY name,id');
        return reply(res,200,q.rows);
      }
      if(route==='/api/admin/pruefung/mitarbeitende'&&req.method==='POST'){
        const d=await body(req);
        const name=typeof d.name==='string'?d.name.trim():'';
        const email=typeof d.email==='string'?d.email.trim().toLowerCase():'';
        if(!name||name.length>120||!emailGueltig(email))
          return reply(res,400,{error:'Name oder E-Mail ungültig.'});
        let hash;
        try{hash=passwortHash(d.passwort)}catch{return reply(res,400,{error:'Passwort benötigt mindestens 12 Zeichen.'});}
        try{
          const q=await pool.query('INSERT INTO brilon_pruef_mitarbeitende(id,name,email,passwort_hash) VALUES($1,$2,$3,$4) RETURNING id,name,email,aktiv',
            [crypto.randomUUID(),name,email,hash]);
          return reply(res,201,q.rows[0]);
        }catch(e){if(e.code==='23505')return reply(res,409,{error:'E-Mail bereits vergeben.'});throw e;}
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
          await client.query('COMMIT');
          return reply(res,200,q.rows[0]);
        }catch(error){await client.query('ROLLBACK');throw error;}
        finally{client.release();}
      }
      const staffEnable=route.match(/^\/api\/admin\/pruefung\/mitarbeitende\/([0-9a-f-]{36})\/(reaktivieren|passwort-setzen)$/i);
      if(staffEnable&&req.method==='PATCH'){
        const d=await body(req);
        let newHash;
        try{newHash=passwortHash(d.passwort);}
        catch{return reply(res,400,{error:'Ein neues sicheres Passwort mit mindestens 12 Zeichen ist erforderlich.'});}
        const activate=staffEnable[2]==='reaktivieren';
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          const q=await client.query(
            'UPDATE brilon_pruef_mitarbeitende SET passwort_hash=$2,aktiv=CASE WHEN $3 THEN true ELSE aktiv END WHERE id=$1 AND aktiv=$4 RETURNING id,name,email,aktiv',
            [staffEnable[1],newHash,activate,!activate]);
          if(!q.rowCount){
            await client.query('ROLLBACK');
            return reply(res,409,{error:activate?'Mitarbeiter ist nicht deaktiviert oder nicht vorhanden.':'Passwort kann nur für aktive Mitarbeiter geändert werden.'});
          }
          await client.query('DELETE FROM brilon_pruef_sessions WHERE mitarbeiter_id=$1',[staffEnable[1]]);
          await client.query('COMMIT');
          return reply(res,200,{...q.rows[0],sitzungenWiderrufen:true});
        }catch(error){await client.query('ROLLBACK');throw error;}
        finally{client.release();}
      }
      if(route==='/api/admin/pruefung/stationen'&&req.method==='POST'){
        const d=await body(req);
        const name=typeof d.name==='string'?d.name.trim():'';
        if(name.length<3||name.length>100)return reply(res,400,{error:'Stationsname muss 3 bis 100 Zeichen enthalten.'});
        const q=await pool.query('INSERT INTO brilon_pruef_stationen(id,name) VALUES($1,$2) RETURNING id,name,aktiv',
          [crypto.randomUUID(),name]);
        return reply(res,201,q.rows[0]);
      }
      if(route==='/api/admin/pruefung/stationen'&&req.method==='GET'){
        const q=await pool.query('SELECT id,name,aktiv,gesperrt_am,sperrgrund FROM brilon_pruef_stationen ORDER BY name,id');
        return reply(res,200,q.rows);
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
      const q=await pool.query('SELECT id,name,email,passwort_hash FROM brilon_pruef_mitarbeitende WHERE email=$1 AND aktiv=true',[email]);
      let valid=false;
      if(q.rowCount)try{valid=passwortPruefen(d.passwort,q.rows[0].passwort_hash)}catch{}
      if(!valid)return reply(res,401,{error:'Anmeldedaten ungültig.'});
      const token=crypto.randomBytes(32).toString('hex');
      await pool.query("INSERT INTO brilon_pruef_sessions(token_hash,mitarbeiter_id,ablauf) VALUES($1,$2,NOW()+INTERVAL '4 hours')",
        [sha256(token),q.rows[0].id]);
      return reply(res,200,{name:q.rows[0].name},{
        'Set-Cookie':COOKIE+'='+token+'; HttpOnly; Secure; SameSite=Strict; Path=/api/pruefung; Max-Age=14400'
      });
    }
    const staff=await staffSession(req);
    if(!staff)return reply(res,401,{error:'Mitarbeiteranmeldung erforderlich.'});
    if(route==='/api/pruefung/stationen'&&req.method==='GET'){
      const q=await pool.query('SELECT id,name,gesperrt_am,sperrgrund FROM brilon_pruef_stationen WHERE aktiv=true ORDER BY name,id');
      return reply(res,200,{mitarbeiter:staff.name,entsperrtBis:staff.entsperrt_bis,stationen:q.rows});
    }
    if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft nicht zulässig.'});
    if(route==='/api/pruefung/abmelden'&&req.method==='POST'){
      const token=(req.headers.cookie||'').match(/brilon_pruef_session=([a-f0-9]{64})/)?.[1];
      if(token)await pool.query('DELETE FROM brilon_pruef_sessions WHERE token_hash=$1',[sha256(token)]);
      return reply(res,200,{success:true},{
        'Set-Cookie':COOKIE+'=; HttpOnly; Secure; SameSite=Strict; Path=/api/pruefung; Max-Age=0'});
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
      const stations=await pool.query('SELECT id,name,gesperrt_am,sperrgrund FROM brilon_pruef_stationen WHERE aktiv=true');
      let report;
      try{report=programmPruefen(await body(req,360000),stations.rows.map(x=>x.id));}
      catch(e){return reply(res,400,{error:e.message});}
      const stationNames=new Map(stations.rows.map(x=>[x.id,x.name]));
      const items=report.pruefungen.map(x=>({...x,station:stationNames.get(x.stationId)}));
      const id=crypto.randomUUID();
      let gesperrteStationen=[];
      const token=(req.headers.cookie||'').match(/brilon_pruef_session=([a-f0-9]{64})/)?.[1];
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const aktiveStationen=await client.query(
          'SELECT id,aktiv FROM brilon_pruef_stationen WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
          [items.map(x=>x.stationId)]);
        if(aktiveStationen.rowCount!==items.length||aktiveStationen.rows.some(x=>!x.aktiv)){
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
        const selectedIds=items.map(x=>x.stationId);
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
}
module.exports={createPruefungApi};
