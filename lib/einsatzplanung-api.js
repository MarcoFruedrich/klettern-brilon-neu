'use strict';
const {UUID,minutes,calculateLoad,checkLimits,checkRest,moneyLimit}=require('./einsatzplanung');
function createEinsatzplanungApi({pool,admin,staffSession,reply,body,sameOriginMutation,brevoMail}){
  const json=(r,s,x)=>reply(r,s,x);
  const base='/api/admin/einsatzplanung';
  const staffBase='/api/pruefung/einsatzplanung';
  async function assignmentsFor(id){
    const r=await pool.query(`SELECT e.buchung_id,e.mitarbeiter_id,e.status,e.arbeitsminuten,e.ist_minuten,
      e.bewerbung_am,e.zugewiesen_am,e.bestaetigt_am,e.abgeschlossen_am,
      b.data->>'datum' AS datum,b.data->>'uhrzeit' AS uhrzeit,b.data->>'angebot' AS angebot,
      b.data->>'veranstaltungsort' AS ort,m.name
      FROM brilon_einsaetze e JOIN brilon_buchungen b ON b.id=e.buchung_id
      JOIN brilon_pruef_mitarbeitende m ON m.id=e.mitarbeiter_id
      WHERE e.mitarbeiter_id=$1 ORDER BY b.data->>'datum',b.data->>'uhrzeit'`,[id]);
    return r.rows;
  }
  async function report(id,date){
    const [contract,rows]=await Promise.all([
      pool.query('SELECT * FROM brilon_beschaeftigung WHERE mitarbeiter_id=$1',[id]),
      assignmentsFor(id)]);
    const c=contract.rows[0]||{art:'nicht_hinterlegt'};
    const load=calculateLoad(rows.rows,date);
    const rate=Number(c.stundenlohn_cent||0);
    const monthlyLimit=c.art==='minijob'?moneyLimit(c,Number(date.slice(0,4))):null;
    return {vertrag:c,load,
      geplantWocheStunden:Number((load.weekMin/60).toFixed(2)),
      geleistetWocheStunden:Number((load.weekWorkedMin/60).toFixed(2)),
      geplantMonatStunden:Number((load.monthMin/60).toFixed(2)),
      geleistetMonatStunden:Number((load.monthWorkedMin/60).toFixed(2)),
      geplantMonatEuro:Number((load.monthMin*rate/6000).toFixed(2)),
      minijobGrenzeEuro:monthlyLimit==null?null:monthlyLimit/100};
  }
  async function sendStaff(person,subject,text){
    if(!person?.email)return {emailVersand:'keine_adresse'};
    try{await brevoMail(person.email,subject,text);return {emailVersand:'gesendet'};}
    catch(e){console.error('Einsatzplanung: Mitarbeiter-E-Mail fehlgeschlagen:',e.message);return {emailVersand:'fehlgeschlagen'};}
  }
  return async function(req,res,u,route){
    if(!pool)return json(res,503,{error:'Datenbank nicht verfügbar.'});
    const method=req.method;
    if(route.startsWith(base)){
      if(!await admin(req,res))return;
      if(route===base+'/personen'&&method==='GET'){
        const q=await pool.query(`SELECT m.id,m.name,m.email,m.aktiv,c.art,c.stundenlohn_cent,
          c.wochenstunden,c.monatsstunden,c.minijob_grenze_cent,c.gueltig_ab,c.gueltig_bis
          FROM brilon_pruef_mitarbeitende m LEFT JOIN brilon_beschaeftigung c ON c.mitarbeiter_id=m.id
          WHERE m.name<>'Gelöschtes Mitarbeiterkonto' ORDER BY m.name,m.id`);
        return json(res,200,q.rows);
      }
      const contract=route.match(/^\/api\/admin\/einsatzplanung\/vertrag\/([0-9a-f-]{36})$/i);
      if(contract&&method==='PUT'){
        const d=await body(req);
        const types=['nicht_hinterlegt','minijob','teilzeit','vollzeit','honorar'];
        const art=String(d?.art||'nicht_hinterlegt');
        const euros=x=>x==null||x===''?null:Math.round(Number(x)*100);
        const rate=euros(d?.stundenlohn),limit=euros(d?.minijobGrenze);
        const weekly=d?.wochenstunden===''||d?.wochenstunden==null?null:Number(d.wochenstunden);
        const monthly=d?.monatsstunden===''||d?.monatsstunden==null?null:Number(d.monatsstunden);
        if(!types.includes(art)||[rate,limit].some(v=>v!==null&&(!Number.isSafeInteger(v)||v<0||v>1000000))||
          [weekly,monthly].some(v=>v!==null&&(!Number.isFinite(v)||v<0||v>350)))
          return json(res,400,{error:'Vertragsdaten ungültig.'});
        if(art==='minijob'&&(!rate||rate<1390))
          return json(res,400,{error:'Für Minijobs ist ein gültiger Stundenlohn erforderlich (2026 grundsätzlich mindestens 13,90 €).'});
        const q=await pool.query(`INSERT INTO brilon_beschaeftigung
          (mitarbeiter_id,art,stundenlohn_cent,wochenstunden,monatsstunden,minijob_grenze_cent,aktualisiert_am)
          SELECT id,$2,$3,$4,$5,$6,NOW() FROM brilon_pruef_mitarbeitende WHERE id=$1
          ON CONFLICT(mitarbeiter_id) DO UPDATE SET art=EXCLUDED.art,stundenlohn_cent=EXCLUDED.stundenlohn_cent,
            wochenstunden=EXCLUDED.wochenstunden,monatsstunden=EXCLUDED.monatsstunden,
            minijob_grenze_cent=EXCLUDED.minijob_grenze_cent,aktualisiert_am=NOW()
          RETURNING *`,[contract[1],art,rate,weekly,monthly,limit]);
        if(!q.rowCount)return json(res,404,{error:'Mitarbeiter nicht gefunden.'});
        return json(res,200,q.rows[0]);
      }
      if(route===base+'/kalender'&&method==='GET'){
        const month=u.searchParams.get('monat')||'';
        if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(month))return json(res,400,{error:'Monat ungültig.'});
        const [bookings,assignments]=await Promise.all([
          pool.query(`SELECT id,status,data->>'datum' AS datum,data->>'uhrzeit' AS uhrzeit,
            data->>'angebot' AS angebot,data->>'veranstaltungsort' AS ort,
            data->>'dauer' AS dauer FROM brilon_buchungen
            WHERE data->>'datum' LIKE $1 AND status IN ('offen','bestaetigt')
            ORDER BY data->>'datum',data->>'uhrzeit'`,[month+'%']),
          pool.query(`SELECT e.buchung_id,e.mitarbeiter_id,e.status,e.arbeitsminuten,e.ist_minuten,
            m.name,m.email FROM brilon_einsaetze e JOIN brilon_pruef_mitarbeitende m ON m.id=e.mitarbeiter_id
            JOIN brilon_buchungen b ON b.id=e.buchung_id
            WHERE b.data->>'datum' LIKE $1 ORDER BY m.name`,[month+'%'])
        ]);
        return json(res,200,{buchungen:bookings.rows,einsaetze:assignments.rows});
      }
      const load=route.match(/^\/api\/admin\/einsatzplanung\/stunden\/([0-9a-f-]{36})$/i);
      if(load&&method==='GET'){
        const date=u.searchParams.get('datum')||new Date().toISOString().slice(0,10);
        if(!/^\d{4}-\d\d-\d\d$/.test(date))return json(res,400,{error:'Datum ungültig.'});
        return json(res,200,await report(load[1],date));
      }
      const assign=route.match(/^\/api\/admin\/einsatzplanung\/zuweisen\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i);
      if(assign&&method==='POST'){
        const [bookingId,staffId]=[assign[1],assign[2]];
        const client=await pool.connect();
        let person,booking,worked;
        try{
          await client.query('BEGIN');
          const b=await client.query(`SELECT id,data,status FROM brilon_buchungen WHERE id=$1 FOR UPDATE`,[bookingId]);
          if(!b.rowCount||!['offen','bestaetigt'].includes(b.rows[0].status)){
            await client.query('ROLLBACK');return json(res,409,{error:'Die Buchung ist nicht aktiv.'});
          }
          booking=b.rows[0];const date=booking.data?.datum;const duration=minutes(booking.data);
          if(!/^\d{4}-\d\d-\d\d$/.test(date||'')||!duration){
            await client.query('ROLLBACK');return json(res,409,{error:'Termin oder Dauer der Buchung fehlt.'});
          }
          const s=await client.query(`SELECT id,name,email FROM brilon_pruef_mitarbeitende
            WHERE id=$1 AND aktiv=true AND registriert_am IS NOT NULL AND freigabe_am IS NOT NULL
            AND EXISTS(SELECT 1 FROM brilon_pruef_freigaben f JOIN brilon_orte o ON o.id=f.ort_id
              WHERE f.mitarbeiter_id=brilon_pruef_mitarbeitende.id
                AND o.name=$2 AND o.aktiv=true) FOR UPDATE`,[staffId,booking.data.veranstaltungsort]);
          if(!s.rowCount){await client.query('ROLLBACK');return json(res,409,{error:'Mitarbeiter nicht freigegeben.'});}
          person=s.rows[0];
          const old=await client.query(`SELECT status FROM brilon_einsaetze
            WHERE buchung_id=$1 AND mitarbeiter_id=$2 FOR UPDATE`,[bookingId,staffId]);
          if(old.rows[0]?.status==='abgeschlossen'){
            await client.query('ROLLBACK');return json(res,409,{error:'Abgeschlossene Einsätze dürfen nicht neu eingeteilt werden.'});
          }
          const c=await client.query('SELECT * FROM brilon_beschaeftigung WHERE mitarbeiter_id=$1',[staffId]);
          const entries=await client.query(`SELECT e.buchung_id,e.status,e.arbeitsminuten,e.ist_minuten,
            b.data->>'datum' AS datum,b.data->>'uhrzeit' AS uhrzeit FROM brilon_einsaetze e
            JOIN brilon_buchungen b ON b.id=e.buchung_id WHERE e.mitarbeiter_id=$1`,[staffId]);
          const load=calculateLoad(entries.rows,date,bookingId);
          const issues=[...checkLimits(c.rows[0],load,duration,date),...checkRest(entries.rows,date,booking.data.uhrzeit,duration,bookingId)];
          if(issues.length){await client.query('ROLLBACK');return json(res,409,{error:'Einteilung gesperrt: '+issues.join(' '),warnungen:issues});}
          await client.query(`INSERT INTO brilon_einsaetze
            (buchung_id,mitarbeiter_id,status,arbeitsminuten,zugewiesen_am,aktualisiert_am)
            VALUES($1,$2,'eingeteilt',$3,NOW(),NOW())
            ON CONFLICT(buchung_id,mitarbeiter_id) DO UPDATE SET
            status='eingeteilt',arbeitsminuten=EXCLUDED.arbeitsminuten,
            zugewiesen_am=NOW(),aktualisiert_am=NOW()`,[bookingId,staffId,duration]);
          await client.query('COMMIT');
          worked={status:'eingeteilt',dauerMinuten:duration};
        }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
        const notice=await sendStaff(person,'Neue Einteilung – Klettern & Abenteuer',
          `Hallo ${person.name},\\n\\nDu wurdest für ${booking.data.datum} um ${booking.data.uhrzeit||'Zeit offen'} Uhr (${booking.data.angebot||'Programm'}) eingeteilt. Bitte bestätige oder lehne den Einsatz in deinem Mitarbeiterbereich ab.\\n\\nKlettern & Abenteuer`);
        return json(res,200,{success:true,...worked,...notice});
      }
      const remove=route.match(/^\/api\/admin\/einsatzplanung\/zuweisen\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i);
      if(remove&&method==='DELETE'){
        const q=await pool.query(`DELETE FROM brilon_einsaetze WHERE buchung_id=$1 AND mitarbeiter_id=$2
          AND status IN ('beworben','eingeteilt','bestaetigt','abgelehnt') RETURNING mitarbeiter_id`,
          [remove[1],remove[2]]);
        if(!q.rowCount)return json(res,409,{error:'Kein änderbarer Einsatz gefunden.'});
        return json(res,200,{success:true});
      }
      const actual=route.match(/^\/api\/admin\/einsatzplanung\/istzeit\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i);
      if(actual&&method==='POST'){
        const d=await body(req),min=Number(d?.minuten);
        if(!Number.isInteger(min)||min<0||min>1440)return json(res,400,{error:'Arbeitsminuten ungültig.'});
        const q=await pool.query(`UPDATE brilon_einsaetze SET status='abgeschlossen',
          ist_minuten=$3,abgeschlossen_am=NOW(),aktualisiert_am=NOW()
          WHERE buchung_id=$1 AND mitarbeiter_id=$2 AND status IN ('eingeteilt','bestaetigt')
          RETURNING buchung_id,mitarbeiter_id,ist_minuten`,[actual[1],actual[2],min]);
        if(!q.rowCount)return json(res,409,{error:'Dieser Einsatz kann nicht abgeschlossen werden.'});
        return json(res,200,q.rows[0]);
      }
      return json(res,404,{error:'Einsatzplanung-Funktion nicht gefunden.'});
    }
    if(route.startsWith(staffBase)){
      const staff=await staffSession(req);
      if(!staff)return json(res,401,{error:'Bitte im Mitarbeiterbereich anmelden.'});
      if(!sameOriginMutation(req))return json(res,403,{error:'Anfrage von fremder Website abgewiesen.'});
      if(route===staffBase+'/termine'&&method==='GET'){
        const q=await pool.query(`SELECT b.id,b.data->>'datum' AS datum,b.data->>'uhrzeit' AS uhrzeit,
           b.data->>'angebot' AS angebot,b.data->>'veranstaltungsort' AS ort,
           b.data->>'dauer' AS dauer,e.status AS mein_status,e.arbeitsminuten
           FROM brilon_buchungen b LEFT JOIN brilon_einsaetze e
             ON e.buchung_id=b.id AND e.mitarbeiter_id=$1
           WHERE b.status IN ('offen','bestaetigt') AND b.data->>'datum'>=CURRENT_DATE::text
           AND EXISTS(SELECT 1 FROM brilon_pruef_freigaben f JOIN brilon_orte o ON o.id=f.ort_id
             WHERE f.mitarbeiter_id=$1 AND o.name=b.data->>'veranstaltungsort' AND o.aktiv=true)
           ORDER BY b.data->>'datum',b.data->>'uhrzeit' LIMIT 150`,[staff.mitarbeiter_id]);
        return json(res,200,q.rows);
      }
      const application=route.match(/^\/api\/pruefung\/einsatzplanung\/bewerben\/([0-9a-f-]{36})$/i);
      if(application&&method==='POST'){
        const q=await pool.query(`INSERT INTO brilon_einsaetze(buchung_id,mitarbeiter_id,status,bewerbung_am)
          SELECT b.id,$2,'beworben',NOW() FROM brilon_buchungen b
          WHERE b.id=$1 AND b.status IN ('offen','bestaetigt')
            AND b.data->>'datum'>=CURRENT_DATE::text
            AND EXISTS(SELECT 1 FROM brilon_pruef_freigaben f JOIN brilon_orte o ON o.id=f.ort_id
              WHERE f.mitarbeiter_id=$2 AND o.name=b.data->>'veranstaltungsort' AND o.aktiv=true)
          ON CONFLICT(buchung_id,mitarbeiter_id) DO UPDATE
            SET status='beworben',bewerbung_am=NOW(),aktualisiert_am=NOW()
            WHERE brilon_einsaetze.status IN ('beworben','abgelehnt')
          RETURNING status`,[application[1],staff.mitarbeiter_id]);
        if(!q.rowCount)return json(res,409,{error:'Bewerbung nicht möglich; Einsatz ist bereits verbindlich eingeteilt oder Termin nicht verfügbar.'});
        return json(res,200,{status:'beworben'});
      }
      const confirm=route.match(/^\/api\/pruefung\/einsatzplanung\/antwort\/([0-9a-f-]{36})$/i);
      if(confirm&&method==='POST'){
        const d=await body(req);
        if(!['bestaetigt','abgelehnt'].includes(d?.status))
          return json(res,400,{error:'Bitte bestätigen oder ablehnen.'});
        const q=await pool.query(`UPDATE brilon_einsaetze SET status=$3,
          bestaetigt_am=CASE WHEN $3='bestaetigt' THEN NOW() ELSE NULL END,
          aktualisiert_am=NOW() WHERE buchung_id=$1 AND mitarbeiter_id=$2
            AND status='eingeteilt' RETURNING status`,[confirm[1],staff.mitarbeiter_id,d.status]);
        if(!q.rowCount)return json(res,409,{error:'Keine offene Einteilung vorhanden.'});
        return json(res,200,q.rows[0]);
      }
      return json(res,404,{error:'Mitarbeitereinsatz-Funktion nicht gefunden.'});
    }
    return json(res,404,{error:'Nicht gefunden.'});
  };
}
module.exports={createEinsatzplanungApi};
