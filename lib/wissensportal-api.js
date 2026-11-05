'use strict';
const crypto=require('node:crypto');
const categories=['allgemein','programm','standort','sicherheit','ablauf','notfall'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const trim=(v,max)=>typeof v==='string'?v.trim().slice(0,max+1):'';
function validate(input){
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const titel=trim(input.titel,120),kurztext=trim(input.kurztext,500),inhalt=trim(input.inhalt,20000),
    kategorie=input.kategorie,dokumentUrl=trim(input.dokumentUrl||'',1000);
  const standorte=Array.isArray(input.standorte)?[...new Set(input.standorte.map(Number))]:null;
  if(!titel||titel.length>120||kurztext.length>500||!inhalt||inhalt.length>20000||
    !categories.includes(kategorie)||typeof input.veroeffentlicht!=='boolean'||
    !standorte||standorte.length>50||standorte.some(n=>!Number.isSafeInteger(n)||n<1)||
    (dokumentUrl&&!/^https:\/\/[^\s<>"']+$/i.test(dokumentUrl)))return null;
  return {titel,kurztext,inhalt,kategorie,standorte,veroeffentlicht:input.veroeffentlicht,dokumentUrl:dokumentUrl||null};
}
function createWissensportalApi({pool,admin,staffSession,reply,body,sameOriginMutation}){
  return async function handler(req,res,url,route){
    if(!pool)return reply(res,503,{error:'Wissensportal: Datenbank nicht konfiguriert.'});
    const method=req.method;
    const isAdmin=route.startsWith('/api/admin/wissensportal');
    const articleId=route.match(/^\/api\/(?:admin\/)?wissensportal\/([0-9a-f-]{36})$/i)?.[1];
    const confirmId=route.match(/^\/api\/wissensportal\/([0-9a-f-]{36})\/bestaetigen$/i)?.[1];
    const columns='id,titel,kurztext,inhalt,kategorie,standorte,dokument_url AS "dokumentUrl",veroeffentlicht,version,erstellt_am,aktualisiert_am';
    let staff=null;
    if(isAdmin){if(!await admin(req,res))return;}
    else {staff=await staffSession(req);if(!staff)return reply(res,401,{error:'Mitarbeiteranmeldung erforderlich.'});}
    if(isAdmin&&route==='/api/admin/wissensportal'&&method==='GET'){
      const items=await pool.query('SELECT '+columns+' FROM brilon_wissensportal_artikel ORDER BY aktualisiert_am DESC,id');
      return reply(res,200,{artikel:items.rows});
    }
    if(!isAdmin&&route==='/api/wissensportal'&&method==='GET'){
      const sql='SELECT '+columns+', (SELECT b.version FROM brilon_wissensportal_bestaetigungen b WHERE b.artikel_id=a.id AND b.mitarbeiter_id=$1) AS bestaetigte_version FROM brilon_wissensportal_artikel a WHERE veroeffentlicht=true AND (cardinality(standorte)=0 OR EXISTS (SELECT 1 FROM brilon_pruef_freigaben f WHERE f.mitarbeiter_id=$1 AND f.ort_id=ANY(a.standorte))) ORDER BY CASE kategorie WHEN \'sicherheit\' THEN 0 WHEN \'notfall\' THEN 1 ELSE 2 END,titel';
      const [items,places]=await Promise.all([
        pool.query(sql,[staff.mitarbeiter_id]),
        pool.query('SELECT DISTINCT o.id,o.name FROM brilon_pruef_freigaben f JOIN brilon_orte o ON o.id=f.ort_id AND o.aktiv=true WHERE f.mitarbeiter_id=$1 ORDER BY o.name',[staff.mitarbeiter_id])
      ]);
      return reply(res,200,{artikel:items.rows,standorte:places.rows});
    }
    if(!isAdmin&&confirmId&&method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft nicht zulässig.'});
      if(!uuid.test(confirmId))return reply(res,400,{error:'Ungültiger Artikel.'});
      const item=await pool.query("SELECT id,version FROM brilon_wissensportal_artikel a WHERE a.id=$1 AND a.veroeffentlicht=true AND a.kategorie IN ('sicherheit','notfall') AND (cardinality(a.standorte)=0 OR EXISTS (SELECT 1 FROM brilon_pruef_freigaben f WHERE f.mitarbeiter_id=$2 AND f.ort_id=ANY(a.standorte)))",
        [confirmId,staff.mitarbeiter_id]);
      if(!item.rowCount)return reply(res,404,{error:'Einweisung nicht verfügbar.'});
      const q=await pool.query('INSERT INTO brilon_wissensportal_bestaetigungen(artikel_id,mitarbeiter_id,version) VALUES($1,$2,$3) ON CONFLICT(artikel_id,mitarbeiter_id) DO UPDATE SET version=EXCLUDED.version,bestaetigt_am=NOW() RETURNING version,bestaetigt_am',
        [confirmId,staff.mitarbeiter_id,item.rows[0].version]);
      return reply(res,200,{success:true,...q.rows[0]});
    }
    if(isAdmin&&(method==='POST'||method==='PUT')&&(route==='/api/admin/wissensportal'||articleId)){
      if(method==='PUT'&&!uuid.test(articleId))return reply(res,400,{error:'Ungültiger Artikel.'});
      const data=validate(await body(req,24000));
      if(!data)return reply(res,400,{error:'Bitte gültige Artikeldaten angeben (Titel, Kategorie, Text, Standorte, Veröffentlichungsstatus).'});
      if(data.standorte.length){
        const sites=await pool.query('SELECT id FROM brilon_orte WHERE id=ANY($1::bigint[]) AND aktiv=true',[data.standorte]);
        if(sites.rowCount!==data.standorte.length)return reply(res,400,{error:'Mindestens ein ausgewählter Standort ist nicht aktiv.'});
      }
      const params=[data.titel,data.kurztext,data.inhalt,data.kategorie,data.standorte,data.dokumentUrl,data.veroeffentlicht];
      if(method==='POST'){
        const q=await pool.query('INSERT INTO brilon_wissensportal_artikel (id,titel,kurztext,inhalt,kategorie,standorte,dokument_url,veroeffentlicht) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING '+columns,
          [crypto.randomUUID(),...params]);
        return reply(res,201,q.rows[0]);
      }
      const q=await pool.query('UPDATE brilon_wissensportal_artikel SET titel=$1,kurztext=$2,inhalt=$3,kategorie=$4,standorte=$5,dokument_url=$6,veroeffentlicht=$7,version=version+CASE WHEN (titel,kurztext,inhalt,kategorie,standorte,dokument_url) IS DISTINCT FROM ($1::text,$2::text,$3::text,$4::text,$5::bigint[],$6::text) THEN 1 ELSE 0 END, aktualisiert_am=NOW() WHERE id=$8 RETURNING '+columns,
        [...params,articleId]);
      if(!q.rowCount)return reply(res,404,{error:'Artikel nicht gefunden.'});
      return reply(res,200,q.rows[0]);
    }
    if(isAdmin&&articleId&&method==='DELETE'){
      if(!uuid.test(articleId))return reply(res,400,{error:'Ungültiger Artikel.'});
      const q=await pool.query('DELETE FROM brilon_wissensportal_artikel WHERE id=$1 RETURNING id',[articleId]);
      if(!q.rowCount)return reply(res,404,{error:'Artikel nicht gefunden.'});
      return reply(res,200,{success:true});
    }
    return reply(res,404,{error:'Wissensportal-Funktion nicht gefunden.'});
  };
}
module.exports={createWissensportalApi,categories,validate};