'use strict';
const crypto=require('node:crypto');
const defaultCategories=[
  {id:'allgemein',titel:'Allgemeines',parentId:null},
  {id:'programm',titel:'Programminformationen',parentId:null},
  {id:'standort',titel:'Standortinformationen',parentId:null},
  {id:'sicherheit',titel:'Sicherheitseinweisungen',parentId:null},
  {id:'ablauf',titel:'Arbeitsabläufe',parentId:null},
  {id:'notfall',titel:'Notfall & Erste Hilfe',parentId:null}
];
const categories=defaultCategories.map(item=>item.id);
const categoryKey='wissensportalKategorien';
async function getCategories(pool){
  const q=await pool.query('SELECT data FROM brilon_rechnungsdaten WHERE id=1');
  const stored=q.rows[0]?.data?.[categoryKey];
  if(!Array.isArray(stored))return defaultCategories;
  const merged=[...defaultCategories,...stored.filter(item=>item&&typeof item.id==='string'&&!categories.includes(item.id))];
  return normalizeCategories(merged)||defaultCategories;
}
function normalizeCategories(input){
  if(!Array.isArray(input)||input.length>150)return null;
  const ids=new Set(),result=[];
  for(const raw of input){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
    const id=trim(raw.id,60),titel=trim(raw.titel,80);
    const parentId=raw.parentId==null||raw.parentId===''?null:trim(raw.parentId,60);
    if(!id||!titel||titel.length>80||ids.has(id)||(!categories.includes(id)&&!/^custom-[0-9a-f-]{36}$/i.test(id)))return null;
    ids.add(id);result.push({id,titel,parentId});
  }
  for(const base of defaultCategories)if(!result.some(item=>item.id===base.id))result.unshift(base);
  const map=new Map(result.map(item=>[item.id,item]));
  for(const item of result){
    if(item.parentId&&!map.has(item.parentId))return null;
    if(categories.includes(item.id)&&item.parentId!==null)return null;
    let parent=item.parentId,depth=1,visited=new Set([item.id]);
    while(parent){
      if(visited.has(parent))return null;
      visited.add(parent);depth++;
      if(depth>5)return null;
      parent=map.get(parent)?.parentId||null;
    }
  }
  return result;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const trim=(v,max)=>typeof v==='string'?v.trim().slice(0,max+1):'';
const https=value=>!value||/^https:\/\/[^\s<>"']+$/i.test(value);
function validate(input,allowedCategories=categories){
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const titel=trim(input.titel,120),kurztext=trim(input.kurztext,500),inhalt=trim(input.inhalt,20000),
    kategorie=input.kategorie,dokumentUrl=trim(input.dokumentUrl||'',1000),bildUrl=trim(input.bildUrl||'',1000);
  const standorte=Array.isArray(input.standorte)?[...new Set(input.standorte.map(Number))]:null;
  const anhaenge=Array.isArray(input.anhaenge)?input.anhaenge:input.anhaenge==null?[]:null;
  if(!titel||titel.length>120||kurztext.length>500||!inhalt||inhalt.length>20000||
    !allowedCategories.includes(kategorie)||typeof input.veroeffentlicht!=='boolean'||
    !standorte||standorte.length>50||standorte.some(n=>!Number.isSafeInteger(n)||n<1)||
    !https(dokumentUrl)||!https(bildUrl)||!anhaenge||anhaenge.length>12)return null;
  const links=[];
  for(const item of anhaenge){
    if(!item||typeof item!=='object'||Array.isArray(item))return null;
    const name=trim(item.titel,120),url=trim(item.url,1000);
    if(!name||name.length>120||url.length>1000||!https(url))return null;
    links.push({titel:name,url});
  }
  return {titel,kurztext,inhalt,kategorie,standorte,veroeffentlicht:input.veroeffentlicht,
    dokumentUrl:dokumentUrl||null,bildUrl:bildUrl||null,anhaenge:links};
}
function createWissensportalApi({pool,admin,staffSession,reply,body,sameOriginMutation}){
  const fields='id,titel,kurztext,inhalt,kategorie,standorte,dokument_url AS "dokumentUrl",bild_url AS "bildUrl",anhaenge,veroeffentlicht,version,erstellt_am,aktualisiert_am';
  return async function handler(req,res,url,route){
    if(!pool)return reply(res,503,{error:'Wissensportal: Datenbank nicht konfiguriert.'});
    const method=req.method,isAdmin=route.startsWith('/api/admin/wissensportal');
    const articleId=route.match(/^\/api\/admin\/wissensportal\/([0-9a-f-]{36})$/i)?.[1];
    const confirmId=route.match(/^\/api\/wissensportal\/([0-9a-f-]{36})\/bestaetigen$/i)?.[1];
    const receiptId=route.match(/^\/api\/admin\/wissensportal\/([0-9a-f-]{36})\/bestaetigungen$/i)?.[1];
    const historyId=route.match(/^\/api\/admin\/wissensportal\/([0-9a-f-]{36})\/versionen$/i)?.[1];
    let staff=null;
    if(isAdmin){if(!await admin(req,res))return;}
    else {staff=await staffSession(req);if(!staff)return reply(res,401,{error:'Mitarbeiteranmeldung erforderlich.'});}
    if(isAdmin&&receiptId&&method==='GET'){
      if(!uuid.test(receiptId))return reply(res,400,{error:'Ungültiger Artikel.'});
      const q=await pool.query("SELECT m.id,m.name,b.version AS bestaetigte_version,b.bestaetigt_am,a.version AS aktuelle_version FROM brilon_wissensportal_artikel a JOIN brilon_pruef_mitarbeitende m ON m.aktiv=true AND (cardinality(a.standorte)=0 OR EXISTS (SELECT 1 FROM brilon_pruef_freigaben f WHERE f.mitarbeiter_id=m.id AND f.ort_id=ANY(a.standorte))) LEFT JOIN brilon_wissensportal_bestaetigungen b ON b.artikel_id=a.id AND b.mitarbeiter_id=m.id WHERE a.id=$1 ORDER BY lower(m.name)",[receiptId]);
      return reply(res,200,{personen:q.rows});
    }
    if(isAdmin&&historyId&&method==='GET'){
      if(!uuid.test(historyId))return reply(res,400,{error:'Ungültiger Artikel.'});
      const [current,history]=await Promise.all([
        pool.query('SELECT id,version,aktualisiert_am FROM brilon_wissensportal_artikel WHERE id=$1',[historyId]),
        pool.query('SELECT version,erstellt_am FROM brilon_wissensportal_versionen WHERE artikel_id=$1 ORDER BY version DESC LIMIT 100',[historyId])
      ]);
      if(!current.rowCount)return reply(res,404,{error:'Artikel nicht gefunden.'});
      return reply(res,200,{aktuell:current.rows[0],vorherige:history.rows});
    }
    if(isAdmin&&route==='/api/admin/wissensportal/kategorien'&&method==='GET'){
      return reply(res,200,{kategorien:await getCategories(pool)});
    }
    if(isAdmin&&route==='/api/admin/wissensportal/kategorien'&&method==='PUT'){
      const payload=await body(req,16000);
      const normalized=normalizeCategories(payload?.kategorien);
      if(!normalized)return reply(res,400,{error:'Bitte gültige Kategorien mit höchstens fünf Ebenen und eindeutigen Namen eingeben.'});
      const custom=normalized.filter(item=>!categories.includes(item.id));
      await pool.query("UPDATE brilon_rechnungsdaten SET data=COALESCE(data,'{}'::jsonb)||$1::jsonb,aktualisiert_am=NOW() WHERE id=1",[JSON.stringify({[categoryKey]:custom})]);
      return reply(res,200,{success:true,kategorien:normalized});
    }
    if(isAdmin&&route==='/api/admin/wissensportal'&&method==='GET'){
      const q=await pool.query('SELECT '+fields+' FROM brilon_wissensportal_artikel ORDER BY aktualisiert_am DESC,id');
      return reply(res,200,{artikel:q.rows,kategorien:await getCategories(pool)});
    }
    if(!isAdmin&&route==='/api/wissensportal'&&method==='GET'){
      const sql='SELECT '+fields+', (SELECT b.version FROM brilon_wissensportal_bestaetigungen b WHERE b.artikel_id=a.id AND b.mitarbeiter_id=$1) AS bestaetigte_version FROM brilon_wissensportal_artikel a WHERE veroeffentlicht=true AND (cardinality(standorte)=0 OR EXISTS (SELECT 1 FROM brilon_pruef_freigaben f WHERE f.mitarbeiter_id=$1 AND f.ort_id=ANY(a.standorte))) ORDER BY CASE kategorie WHEN \'sicherheit\' THEN 0 WHEN \'notfall\' THEN 1 ELSE 2 END,titel';
      const [items,places]=await Promise.all([
        pool.query(sql,[staff.mitarbeiter_id]),
        pool.query('SELECT DISTINCT o.id,o.name FROM brilon_pruef_freigaben f JOIN brilon_orte o ON o.id=f.ort_id AND o.aktiv=true WHERE f.mitarbeiter_id=$1 ORDER BY o.name',[staff.mitarbeiter_id])
      ]);
      return reply(res,200,{artikel:items.rows,standorte:places.rows,kategorien:await getCategories(pool)});
    }
    if(!isAdmin&&confirmId&&method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft nicht zulässig.'});
      if(!uuid.test(confirmId))return reply(res,400,{error:'Ungültiger Artikel.'});
      const q=await pool.query("SELECT id,version FROM brilon_wissensportal_artikel a WHERE a.id=$1 AND a.veroeffentlicht=true AND a.kategorie IN ('sicherheit','notfall') AND (cardinality(a.standorte)=0 OR EXISTS (SELECT 1 FROM brilon_pruef_freigaben f WHERE f.mitarbeiter_id=$2 AND f.ort_id=ANY(a.standorte)))",
        [confirmId,staff.mitarbeiter_id]);
      if(!q.rowCount)return reply(res,404,{error:'Einweisung nicht verfügbar.'});
      const inserted=await pool.query('INSERT INTO brilon_wissensportal_bestaetigungen(artikel_id,mitarbeiter_id,version) VALUES($1,$2,$3) ON CONFLICT(artikel_id,mitarbeiter_id) DO UPDATE SET version=EXCLUDED.version,bestaetigt_am=NOW() RETURNING version,bestaetigt_am',
        [confirmId,staff.mitarbeiter_id,q.rows[0].version]);
      return reply(res,200,{success:true,...inserted.rows[0]});
    }
    if(isAdmin&&(method==='POST'||method==='PUT')&&(route==='/api/admin/wissensportal'||articleId)){
      if(method==='PUT'&&!uuid.test(articleId))return reply(res,400,{error:'Ungültiger Artikel.'});
      const categoryTree=await getCategories(pool);
      const data=validate(await body(req,44000),categoryTree.map(item=>item.id));
      if(!data)return reply(res,400,{error:'Bitte Titel, Kategorie, Text, Standorte und gültige HTTPS-Dokumentlinks angeben.'});
      if(data.standorte.length){
        const sites=await pool.query('SELECT id FROM brilon_orte WHERE id=ANY($1::bigint[]) AND aktiv=true',[data.standorte]);
        if(sites.rowCount!==data.standorte.length)return reply(res,400,{error:'Mindestens ein ausgewählter Standort ist nicht aktiv.'});
      }
      if(method==='POST'){
        const q=await pool.query('INSERT INTO brilon_wissensportal_artikel (id,titel,kurztext,inhalt,kategorie,standorte,dokument_url,bild_url,anhaenge,veroeffentlicht) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING '+fields,
          [crypto.randomUUID(),data.titel,data.kurztext,data.inhalt,data.kategorie,data.standorte,data.dokumentUrl,data.bildUrl,JSON.stringify(data.anhaenge),data.veroeffentlicht]);
        return reply(res,201,q.rows[0]);
      }
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const prev=await client.query('SELECT * FROM brilon_wissensportal_artikel WHERE id=$1 FOR UPDATE',[articleId]);
        if(!prev.rowCount){await client.query('ROLLBACK');return reply(res,404,{error:'Artikel nicht gefunden.'});}
        const old=prev.rows[0];
        const changed=old.titel!==data.titel||old.kurztext!==data.kurztext||old.inhalt!==data.inhalt||
          old.kategorie!==data.kategorie||JSON.stringify((old.standorte||[]).map(Number).sort((a,b)=>a-b))!==JSON.stringify([...data.standorte].sort((a,b)=>a-b))||
          (old.dokument_url||null)!==data.dokumentUrl||(old.bild_url||null)!==data.bildUrl||
          JSON.stringify(old.anhaenge||[])!==JSON.stringify(data.anhaenge);
        if(changed)await client.query('INSERT INTO brilon_wissensportal_versionen(artikel_id,version,inhalt) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',
          [articleId,old.version,JSON.stringify({titel:old.titel,kurztext:old.kurztext,inhalt:old.inhalt,
            kategorie:old.kategorie,standorte:old.standorte,dokumentUrl:old.dokument_url,bildUrl:old.bild_url,anhaenge:old.anhaenge})]);
        const q=await client.query('UPDATE brilon_wissensportal_artikel SET titel=$1,kurztext=$2,inhalt=$3,kategorie=$4,standorte=$5,dokument_url=$6,bild_url=$7,anhaenge=$8::jsonb,veroeffentlicht=$9,version=version+$10,aktualisiert_am=NOW() WHERE id=$11 RETURNING '+fields,
          [data.titel,data.kurztext,data.inhalt,data.kategorie,data.standorte,data.dokumentUrl,data.bildUrl,JSON.stringify(data.anhaenge),data.veroeffentlicht,changed?1:0,articleId]);
        await client.query('COMMIT');return reply(res,200,q.rows[0]);
      }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
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