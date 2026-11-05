'use strict';
const allowed=['campaign-title','campaign-audience','campaign-body','campaign-link','campaign-date','campaign-image','campaign-video','campaign-status'];
const audiences=['Alle Zielgruppen','Familien','Schulen und Jugendgruppen','Vereine','Firmen'];
const statuses=['entwurf','zur-freigabe','freigegeben'];
const platforms=['Facebook','Instagram','WhatsApp Business','X','Google'];
function validate(d){
  if(!d||typeof d!=='object'||Array.isArray(d)||allowed.some(k=>typeof d[k]!=='string'))return 'Ungültige Kampagnendaten.';
  if(!d['campaign-title'].trim()||d['campaign-title'].length>160||d['campaign-body'].length>5000||
     d['campaign-link'].length>1000||d['campaign-image'].length>1000||d['campaign-video'].length>1000||
     d['campaign-date'].length>30||!audiences.includes(d['campaign-audience'])||!statuses.includes(d['campaign-status']))return 'Bitte Felder und Status prüfen.';
  if(!Array.isArray(d.channels)||d.channels.length>5||d.channels.some(c=>!platforms.includes(c)))return 'Ungültige Kanäle.';
  if(['campaign-link','campaign-image','campaign-video'].some(k=>d[k]&&!/^https:\/\//.test(d[k])))return 'Links müssen mit https:// beginnen.';
  if(d['campaign-date']&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d['campaign-date']))return 'Ungültiger Veröffentlichungstermin.';
  return null;
}
function createMarketingCampaignApi({pool,admin,reply,body}){
  return async function handle(req,res,route){
    const base='/api/admin/marketing/kampagnen';
    const single=route.match(/^\/api\/admin\/marketing\/kampagnen\/([a-z0-9-]{1,64})$/);
    if(route!==base&&!single)return false;
    if(!await admin(req,res))return true;
    if(!pool){reply(res,503,{error:'Datenbank nicht verfügbar.'});return true;}
    if(route===base&&req.method==='GET'){
      const q=await pool.query('SELECT id,data,updated_at FROM brilon_marketing_kampagnen ORDER BY updated_at DESC LIMIT 100');
      reply(res,200,{campaigns:q.rows});return true;
    }
    if(!single){reply(res,405,{error:'Methode nicht erlaubt.'});return true;}
    const id=single[1];
    if(req.method==='GET'){
      const q=await pool.query('SELECT data,updated_at FROM brilon_marketing_kampagnen WHERE id=$1',[id]);
      reply(res,200,q.rowCount?{data:q.rows[0].data,updatedAt:q.rows[0].updated_at}:{data:null});return true;
    }
    if(req.method==='DELETE'){
      await pool.query('DELETE FROM brilon_marketing_kampagnen WHERE id=$1',[id]);
      reply(res,200,{deleted:true});return true;
    }
    if(req.method!=='PUT'){reply(res,405,{error:'Methode nicht erlaubt.'});return true;}
    const d=await body(req,12000),error=validate(d);
    if(error){reply(res,400,{error});return true;}
    const data=Object.fromEntries(allowed.map(k=>[k,d[k]]));
    data.channels=[...new Set(d.channels)];
    // Freigabe ist ein Verwaltungsstatus, keine Veröffentlichung.
    data.published=false;
    const q=await pool.query(`INSERT INTO brilon_marketing_kampagnen(id,data,updated_at)
      VALUES($1,$2::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()
      RETURNING updated_at`,[id,JSON.stringify(data)]);
    reply(res,200,{saved:true,updatedAt:q.rows[0].updated_at});return true;
  };
}
module.exports={createMarketingCampaignApi,validate};
