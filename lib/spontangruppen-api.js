'use strict';
const crypto=require('node:crypto');

function createSpontanGruppenApi({pool,admin,reply,body,sameOriginMutation,limit}){
  const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
  const validUuid=value=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value);
  async function board(sessionId){
    const [totals,slots]=await Promise.all([
      pool.query(`SELECT COUNT(*) FILTER(WHERE interesse)::int AS interessierte,
          COALESCE(SUM(personen) FILTER(WHERE interesse),0)::int AS personen
        FROM brilon_spontan_teilnahmen WHERE session_id=$1`,[sessionId]),
      pool.query(`SELECT s.id,s.datum,s.uhrzeit,COUNT(v.teilnahme_id)::int AS stimmen
        FROM brilon_spontan_zeiten s LEFT JOIN brilon_spontan_zeitstimmen v ON v.zeit_id=s.id
        WHERE s.session_id=$1 AND s.datum>=CURRENT_DATE
        GROUP BY s.id ORDER BY s.datum,s.uhrzeit`,[sessionId])
    ]);
    return {interessierte:totals.rows[0]?.interessierte||0,personen:totals.rows[0]?.personen||0,zeiten:slots.rows};
  }
  const handler=async(req,res,u,route,ip)=>{
    if(!pool)return reply(res,503,{error:'Spontane Gruppenangebote sind derzeit nicht verfügbar.'});
    if(route==='/api/spontangruppen/standorte'&&req.method==='GET'){
      const q=await pool.query('SELECT id,name FROM brilon_orte WHERE aktiv=true ORDER BY name');
      return reply(res,200,q.rows);
    }
    if(route==='/api/spontangruppen/monitor'&&req.method==='GET'){
      if(!await admin(req,res))return;
      const ortId=Number(u.searchParams.get('ortId'));
      if(!Number.isSafeInteger(ortId)||ortId<1)return reply(res,400,{error:'Bitte einen gültigen Standort auswählen.'});
      const place=await pool.query('SELECT id,name FROM brilon_orte WHERE id=$1 AND aktiv=true',[ortId]);
      if(!place.rowCount)return reply(res,404,{error:'Der Standort ist nicht aktiv.'});
      await pool.query('UPDATE brilon_spontan_sessions SET aktiv=false WHERE standort_id=$1 AND aktiv=true AND ablauf<=NOW()',[ortId]);
      await pool.query("DELETE FROM brilon_spontan_sessions WHERE ablauf<NOW()-INTERVAL '7 days'");
      let session=(await pool.query(`SELECT id,code,code_ablauf,ablauf FROM brilon_spontan_sessions
        WHERE standort_id=$1 AND aktiv=true ORDER BY erstellt_am DESC LIMIT 1`,[ortId])).rows[0];
      if(!session){
        const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
        try{
          const q=await pool.query(`INSERT INTO brilon_spontan_sessions(id,standort_id,code,code_hash,code_ablauf,ablauf)
            VALUES($1,$2,$3,$4,NOW()+INTERVAL '10 minutes',NOW()+INTERVAL '24 hours')
            RETURNING id,code,code_ablauf,ablauf`,[crypto.randomUUID(),ortId,code,sha256(code)]);
          session=q.rows[0];
        }catch(error){
          if(error.code!=='23505')throw error;
          session=(await pool.query(`SELECT id,code,code_ablauf,ablauf FROM brilon_spontan_sessions
            WHERE standort_id=$1 AND aktiv=true ORDER BY erstellt_am DESC LIMIT 1`,[ortId])).rows[0];
          if(!session)throw error;
        }
      }
      if(new Date(session.code_ablauf).getTime()<=Date.now()){
        const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
        const q=await pool.query(`UPDATE brilon_spontan_sessions SET code=$2,code_hash=$3,code_ablauf=NOW()+INTERVAL '10 minutes'
          WHERE id=$1 RETURNING id,code,code_ablauf,ablauf`,[session.id,code,sha256(code)]);
        session=q.rows[0];
      }
      return reply(res,200,{sessionId:session.id,standort:place.rows[0].name,ortId,
        code:session.code,codeGueltigBis:session.code_ablauf,sessionGueltigBis:session.ablauf,
        link:'/spontangruppen.html?ortId='+ortId,...await board(session.id)});
    }
    if(route==='/api/spontangruppen/board'&&req.method==='GET'){
      const ortId=Number(u.searchParams.get('ortId'));
      if(!Number.isSafeInteger(ortId)||ortId<1)return reply(res,400,{error:'Bitte einen gültigen Standort auswählen.'});
      const q=await pool.query(`SELECT s.id,s.standort_id,o.name AS standort
        FROM brilon_spontan_sessions s JOIN brilon_orte o ON o.id=s.standort_id
        WHERE s.standort_id=$1 AND s.aktiv=true AND s.ablauf>NOW()
        ORDER BY s.erstellt_am DESC LIMIT 1`,[ortId]);
      if(!q.rowCount)return reply(res,200,{aktiv:false,standort:null,interessierte:0,personen:0,zeiten:[]});
      return reply(res,200,{aktiv:true,sessionId:q.rows[0].id,standort:q.rows[0].standort,
        ...await board(q.rows[0].id)});
    }
    if(route==='/api/spontangruppen/abstimmung'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
      if(!limit('spontangruppen:'+ip,20,600000))return reply(res,429,{error:'Bitte später erneut versuchen.'});
      const d=await body(req,8000),ortId=Number(d.ortId),code=typeof d.code==='string'?d.code.trim():'';
      const teilnahmeId=typeof d.teilnahmeId==='string'?d.teilnahmeId:'';
      const interesse=d.interesse===true,personen=Number(d.personen||1);
      if(!Number.isSafeInteger(ortId)||ortId<1||!/^[0-9]{6}$/.test(code)||!validUuid(teilnahmeId)||
        (interesse&&(!Number.isInteger(personen)||personen<1||personen>15)))
        return reply(res,400,{error:'Bitte den sechsstelligen Monitorcode eingeben und die Abstimmung vollständig ausfüllen.'});
      const active=await pool.query(`SELECT id FROM brilon_spontan_sessions
        WHERE standort_id=$1 AND aktiv=true AND ablauf>NOW() AND code_ablauf>NOW() AND code_hash=$2
        ORDER BY erstellt_am DESC LIMIT 1`,[ortId,sha256(code)]);
      if(!active.rowCount)return reply(res,403,{error:'Der Code ist abgelaufen oder gehört zu einem anderen Standort. Bitte den aktuellen Code am Monitor verwenden.'});
      const sessionId=active.rows[0].id;
      const proposals=interesse&&Array.isArray(d.neueZeiten)?d.neueZeiten.slice(0,4):[];
      const added=[];
      for(const item of proposals){
        if(!item||typeof item.datum!=='string'||typeof item.uhrzeit!=='string'||
          !/^\d{4}-\d{2}-\d{2}$/.test(item.datum)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.uhrzeit))continue;
        const slotDate=new Date(item.datum+'T00:00:00Z'),today=new Date();today.setUTCHours(0,0,0,0);
        if(Number.isNaN(slotDate.getTime())||slotDate<today||slotDate>new Date(today.getTime()+90*86400000))continue;
        const ins=await pool.query(`INSERT INTO brilon_spontan_zeiten(id,session_id,datum,uhrzeit)
          VALUES($1,$2,$3,$4) ON CONFLICT(session_id,datum,uhrzeit) DO NOTHING
          RETURNING id`,[crypto.randomUUID(),sessionId,item.datum,item.uhrzeit]);
        let slotId=ins.rows[0]?.id;
        if(!slotId)slotId=(await pool.query('SELECT id FROM brilon_spontan_zeiten WHERE session_id=$1 AND datum=$2 AND uhrzeit=$3',[sessionId,item.datum,item.uhrzeit])).rows[0]?.id;
        if(slotId)added.push(slotId);
      }
      await pool.query(`INSERT INTO brilon_spontan_teilnahmen(session_id,teilnahme_id,interesse,personen)
        VALUES($1,$2,$3,$4) ON CONFLICT(session_id,teilnahme_id)
        DO UPDATE SET interesse=EXCLUDED.interesse,personen=EXCLUDED.personen,updated_at=NOW()`,
        [sessionId,teilnahmeId,interesse,interesse?personen:0]);
      await pool.query(`DELETE FROM brilon_spontan_zeitstimmen v USING brilon_spontan_zeiten s
        WHERE v.zeit_id=s.id AND s.session_id=$1 AND v.teilnahme_id=$2`,[sessionId,teilnahmeId]);
      const selected=interesse&&Array.isArray(d.zeitenIds)?d.zeitenIds.filter(validUuid).slice(0,20):[];
      for(const slotId of [...new Set([...selected,...added])]){
        const slot=await pool.query('SELECT id FROM brilon_spontan_zeiten WHERE id=$1 AND session_id=$2',[slotId,sessionId]);
        if(slot.rowCount)await pool.query(`INSERT INTO brilon_spontan_zeitstimmen(zeit_id,teilnahme_id)
          VALUES($1,$2) ON CONFLICT DO NOTHING`,[slotId,teilnahmeId]);
      }
      const place=await pool.query('SELECT name FROM brilon_orte WHERE id=$1',[ortId]);
      return reply(res,200,{success:true,standort:place.rows[0]?.name||'',...await board(sessionId)});
    }
    return reply(res,404,{error:'Nicht gefunden.'});
  };
  return handler;
}
module.exports={createSpontanGruppenApi};
