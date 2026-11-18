'use strict';
const crypto=require('node:crypto');
const {bereinigeBild}=require('./bilddatei');
const TYPES={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
function validPath(v){
  return typeof v==='string'&&v.length<260&&/^(?:(?:[a-zA-Z0-9_-]+)\/)*[a-zA-Z0-9_.-]+\.(?:jpe?g|png|webp)$/i.test(v)&&!v.split('/').some(s=>s==='..'||s.startsWith('.'));
}
function cleanName(v){
  const name=String(v||'').trim().replace(/\.(jpe?g|png|webp)$/i,'');
  return /^[\p{L}\p{N}_ -]{1,70}$/u.test(name)?name:null;
}
function createMedienarchivApi({pool,supabase,reply,body,limit,scanForMalware,malwareScanReply}){
  const storage=()=>supabase.storage.from('angebotsbilder');
  async function usage(url){
    const [a,b]=await Promise.all([
      pool.query('SELECT id,name FROM brilon_angebote WHERE bild_url=$1',[url]),
      pool.query("SELECT id FROM brilon_aktionen WHERE data->>'bild_url'=$1",[url])
    ]);
    return {programme:a.rows.map(x=>({id:x.id,name:x.name})),aktionen:b.rows.map(x=>x.id)};
  }
  async function list(dir='',depth=0,acc=[]){
    if(depth>4)return acc;
    let offset=0;
    while(offset<1000){
      const {data,error}=await storage().list(dir,{limit:100,offset,sortBy:{column:'name',order:'asc'}});
      if(error)throw error;
      for(const item of data||[]){
        const p=dir?dir+'/'+item.name:item.name;
        if(item.id===null&&!item.metadata){await list(p,depth+1,acc);continue;}
        if(!validPath(p))continue;
        const {data:url}=storage().getPublicUrl(p);
        acc.push({path:p,name:item.name,url:url.publicUrl});
      }
      if(!data||data.length<100)break;
      offset+=data.length;
    }
    return acc;
  }
  async function handle(req,res,route,ip){
    // Accept the existing Medienbibliothek name alongside the Bildarchiv endpoint.
    const isArchiveRoute=route==='/api/admin/medienarchiv'||route==='/api/admin/medienbibliothek';
    if(!isArchiveRoute)return false;
    if(!supabase){reply(res,503,{error:'Bildspeicher ist nicht konfiguriert.'});return true;}
    if(isArchiveRoute&&req.method==='GET'){
      try{
        const items=await list();
        const bilder=await Promise.all(items.map(async x=>({...x,verwendung:await usage(x.url)})));
        reply(res,200,bilder);return true;
      }catch(error){console.error('Medienarchiv lesen:',error.message);reply(res,502,{error:'Bildarchiv konnte nicht geladen werden.'});return true;}
    }
    if(isArchiveRoute&&req.method==='POST'){
      if(!limit('medien-upload:'+ip,20,600000)){reply(res,429,{error:'Zu viele Uploads.'});return true;}
      const type=(req.headers['content-type']||'').split(';')[0].toLowerCase();
      if(!TYPES[type]){reply(res,400,{error:'Nur JPG, PNG und WebP erlaubt.'});return true;}
      const chunks=[];let size=0;
      for await(const chunk of req){
        size+=chunk.length;
        if(size>5*1024*1024){reply(res,413,{error:'Maximal 5 MB pro Bild.'});return true;}
        chunks.push(chunk);
      }
      if(!size){reply(res,400,{error:'Keine Bilddatei empfangen.'});return true;}
      let binary;
      try{binary=await bereinigeBild(Buffer.concat(chunks),type);}
      catch{reply(res,400,{error:'Ungültige Bilddatei.'});return true;}
      try{
        const verdict=await scanForMalware(binary);
        if(verdict?.sauber!==true)throw Object.assign(new Error('Scanfehler'),{code:'MALWARE_SCAN_ERROR'});
      }catch(error){malwareScanReply(res,error);return true;}
      const path='medienarchiv/'+crypto.randomUUID()+'.'+TYPES[type];
      const {error}=await storage().upload(path,binary,{contentType:type,upsert:false});
      if(error){reply(res,502,{error:'Bild konnte nicht gespeichert werden.'});return true;}
      const {data}=storage().getPublicUrl(path);
      reply(res,201,{success:true,path,url:data.publicUrl});return true;
    }
    if(isArchiveRoute&&['PATCH','DELETE'].includes(req.method)){
      const data=await body(req,4000),old=data.path;
      if(!validPath(old)){reply(res,400,{error:'Ungültiger Dateipfad.'});return true;}
      const available=await list();
      const record=available.find(x=>x.path===old);
      if(!record){reply(res,404,{error:'Datei nicht im Bildarchiv gefunden.'});return true;}
      const references=await usage(record.url);
      if(req.method==='DELETE'){
        if(data.confirm!==old){reply(res,400,{error:'Löschung muss bestätigt werden.'});return true;}
        if(references.programme.length||references.aktionen.length){
          reply(res,409,{error:'Das Bild wird noch verwendet. Bitte zuerst die Zuordnungen entfernen.',verwendung:references});return true;
        }
        const {error}=await storage().remove([old]);
        if(error){reply(res,502,{error:'Bild konnte nicht gelöscht werden.'});return true;}
        reply(res,200,{success:true});return true;
      }
      const name=cleanName(data.name);
      if(!name){reply(res,400,{error:'Name: 1–70 Zeichen, Buchstaben, Zahlen, Leerzeichen, _ oder -.'});return true;}
      const parent=old.substring(0,old.lastIndexOf('/')+1);
      const ext=old.substring(old.lastIndexOf('.'));
      const next=parent+name+ext;
      if(next===old){reply(res,200,{success:true,path:old,url:record.url});return true;}
      if(available.some(x=>x.path===next)){reply(res,409,{error:'Dateiname ist bereits vorhanden.'});return true;}
      const moved=await storage().move(old,next);
      if(moved.error){reply(res,502,{error:'Bild konnte nicht umbenannt werden.'});return true;}
      const {data:nextUrl}=storage().getPublicUrl(next);
      try{
        await pool.query('UPDATE brilon_angebote SET bild_url=$1 WHERE bild_url=$2',[nextUrl.publicUrl,record.url]);
        await pool.query("UPDATE brilon_aktionen SET data=jsonb_set(data,'{bild_url}',to_jsonb($1::text)) WHERE data->>'bild_url'=$2",[nextUrl.publicUrl,record.url]);
      }catch(error){
        console.error('Bildreferenzen aktualisieren:',error.message);
        // Never report success if references may still point to the old URL.
        reply(res,500,{error:'Datei verschoben, aber die Referenzen konnten nicht vollständig aktualisiert werden. Bitte Administration prüfen.'});return true;
      }
      reply(res,200,{success:true,path:next,url:nextUrl.publicUrl});return true;
    }
    reply(res,405,{error:'Methode nicht unterstützt.'});return true;
  }
  return {handle};
}
module.exports={createMedienarchivApi};
