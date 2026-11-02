'use strict';
const crypto=require('node:crypto');
const {emailGueltig,passwortHash,passwortPruefen,codeHash,programmPruefen}=require('./stationspruefung');
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const COOKIE='brilon_pruef_session';

function createPruefungApi({pool,admin,reply,body,sameOriginMutation,limit,brevoMail}){
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
        const q=await pool.query('UPDATE brilon_pruef_mitarbeitende SET aktiv=false WHERE id=$1 RETURNING id,aktiv',
          [deactivate[1]]);
        if(!q.rowCount)return reply(res,404,{error:'Mitarbeiter nicht gefunden.'});
        await pool.query('DELETE FROM brilon_pruef_sessions WHERE mitarbeiter_id=$1',[deactivate[1]]);
        return reply(res,200,q.rows[0]);
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
      if(route==='/api/admin/pruefung/code'&&req.method==='POST'){
        const secret=process.env.STATION_CHECK_SECRET;
        if(typeof secret!=='string'||secret.length<32)
          return reply(res,503,{error:'Stationscode-Geheimnis nicht konfiguriert.'});
        const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          await client.query('UPDATE brilon_pruef_codes SET verbraucht_am=NOW() WHERE verbraucht_am IS NULL');
          await client.query("INSERT INTO brilon_pruef_codes(id,code_hash,ablauf) VALUES($1,$2,NOW()+INTERVAL '2 minutes')",
            [crypto.randomUUID(),codeHash(code,secret)]);
          await client.query('COMMIT');
        }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
        return reply(res,201,{code,gueltigSekunden:120});
      }
      if(route==='/api/admin/pruefung/berichte'&&req.method==='GET'){
        const q=await pool.query('SELECT p.id,p.programm,p.beginn,p.erstellt_am,p.hat_mangel,p.pruefungen,m.name AS pruefer FROM brilon_pruef_berichte p JOIN brilon_pruef_mitarbeitende m ON m.id=p.mitarbeiter_id ORDER BY p.erstellt_am DESC,p.id DESC LIMIT 100');
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
        const locked=await client.query('UPDATE brilon_pruef_sessions SET entsperrt_bis=NULL WHERE token_hash=$1 AND entsperrt_bis>NOW() RETURNING mitarbeiter_id',
          [sha256(token)]);
        if(!locked.rowCount){await client.query('ROLLBACK');return reply(res,403,{error:'Freigabe ist bereits verbraucht.'});}
        await client.query('INSERT INTO brilon_pruef_berichte(id,mitarbeiter_id,programm,beginn,pruefungen,hat_mangel) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
          [id,staff.mitarbeiter_id,report.programm,report.beginn,JSON.stringify(items),report.hatMangel]);
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
        const address=process.env.PRUEF_MANGEL_EMAIL;
        if(address&&emailGueltig(address)){
          try{
            await brevoMail(address,'Stationsmangel – Klettern & Abenteuer',
              'Prüfnummer: '+id+'\nProgramm: '+report.programm+'\nBeginn: '+report.beginn+
              '\nPrüfer: '+staff.name+'\nMängel:\n'+items.filter(x=>x.zustand==='mangel')
                .map(x=>x.station+': '+x.beschreibung).join('\n')+
              '\n\nStation bis zur fachlichen Freigabe nicht benutzen.');
            meldung='gesendet';
          }catch{meldung='fehlgeschlagen';}
        }else meldung='nicht_konfiguriert';
      }
      return reply(res,201,{id,hatMangel:report.hatMangel,gesperrteStationen,
        status:gesperrteStationen.length?'station_gesperrt':'ohne_mangel',
        benachrichtigung:meldung});
    }
    return reply(res,404,{error:'Prüffunktion nicht gefunden.'});
  };
}
module.exports={createPruefungApi};
