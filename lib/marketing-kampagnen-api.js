'use strict';
function createMarketingCampaignApi({pool,admin,reply,body}) {
  return async function handle(req,res,route) {
    if(route!=='/api/admin/marketing/kampagne')return false;
    if(!await admin(req,res))return true;
    if(!pool){reply(res,503,{error:'Datenbank nicht verfügbar.'});return true;}
    if(req.method==='GET'){
      const q=await pool.query('SELECT data,updated_at FROM brilon_marketing_kampagnen WHERE id=$1',['startkampagne']);
      reply(res,200,q.rowCount?{data:q.rows[0].data,updatedAt:q.rows[0].updated_at}:{data:null});
      return true;
    }
    if(req.method!=='PUT'){reply(res,405,{error:'Methode nicht erlaubt.'});return true;}
    const d=await body(req,12000);
    const allowed=['campaign-title','campaign-audience','campaign-body','campaign-link','campaign-date'];
    if(!d||typeof d!=='object'||Array.isArray(d)||allowed.some(k=>typeof d[k]!=='string')){
      reply(res,400,{error:'Ungültige Kampagnendaten.'});return true;
    }
    if(!d['campaign-title'].trim()||d['campaign-title'].length>160||d['campaign-body'].length>5000||
      d['campaign-link'].length>1000||d['campaign-date'].length>30||
      !['Alle Zielgruppen','Familien','Schulen und Jugendgruppen','Vereine','Firmen'].includes(d['campaign-audience'])||
      !Array.isArray(d.channels)||d.channels.length>5||
      d.channels.some(x=>!['Facebook','Instagram','WhatsApp Business','X','Google'].includes(x))||
      (d['campaign-link']&&!/^https:\/\//.test(d['campaign-link']))){
      reply(res,400,{error:'Kampagnendaten bitte prüfen.'});return true;
    }
    const data=Object.fromEntries(allowed.map(k=>[k,d[k]]));data.channels=[...new Set(d.channels)];
    const q=await pool.query(`INSERT INTO brilon_marketing_kampagnen(id,data,updated_at)
      VALUES($1,$2::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()
      RETURNING updated_at`,['startkampagne',JSON.stringify(data)]);
    reply(res,200,{saved:true,updatedAt:q.rows[0].updated_at});
    return true;
  };
}
module.exports={createMarketingCampaignApi};
