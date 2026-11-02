'use strict';
const crypto=require('node:crypto');
const {codeHash}=require('./stationspruefung');
const COOKIE='brilon_tablet';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function secretKey(secret){
  if(typeof secret!=='string'||secret.length<32)throw Error('STATION_CHECK_SECRET fehlt.');
  return crypto.createHash('sha256').update('brilon-tablet-aes-v1:'+secret).digest();
}
function encryptCode(code,secret){
  if(!/^\d{6}$/.test(code))throw Error('Prüfcode ungültig.');
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',secretKey(secret),iv);
  const encrypted=Buffer.concat([cipher.update(code,'utf8'),cipher.final()]);
  return [iv.toString('hex'),cipher.getAuthTag().toString('hex'),encrypted.toString('hex')].join('.');
}
function decryptCode(value,secret){
  const [nonce,tag,data]=String(value||'').split('.');
  if(!nonce||!tag||!data)throw Error('Verschlüsselter Prüfcode ungültig.');
  const cipher=crypto.createDecipheriv('aes-256-gcm',secretKey(secret),Buffer.from(nonce,'hex'));
  cipher.setAuthTag(Buffer.from(tag,'hex'));
  const result=Buffer.concat([cipher.update(Buffer.from(data,'hex')),cipher.final()]).toString('utf8');
  if(!/^\d{6}$/.test(result))throw Error('Entschlüsselter Prüfcode ungültig.');
  return result;
}
function pairingHash(code,secret){
  if(!/^\d{8}$/.test(code))throw Error('Kopplungscode ungültig.');
  return crypto.createHmac('sha256',secretKey(secret)).update('brilon-tablet-kopplung-v1:'+code).digest('hex');
}
function createTabletService({pool,secret=()=>process.env.STATION_CHECK_SECRET}){
  async function issueCode(){
    const key=secret();secretKey(key);
    const code=String(crypto.randomInt(1000000)).padStart(6,'0');
    const encrypted=encryptCode(code,key);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('UPDATE brilon_pruef_codes SET verbraucht_am=NOW() WHERE verbraucht_am IS NULL');
      await client.query("INSERT INTO brilon_pruef_codes(id,code_hash,ablauf,code_verschluesselt) VALUES($1,$2,NOW()+INTERVAL '2 minutes',$3)",
        [crypto.randomUUID(),codeHash(code,key),encrypted]);
      await client.query('COMMIT');
      return {code,gueltigSekunden:120};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  async function issuePairing(){
    const code=String(crypto.randomInt(100000000)).padStart(8,'0');
    const encryptedHash=pairingHash(code,secret());
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('UPDATE brilon_pruef_tablet_kopplungen SET verwendet_am=NOW() WHERE verwendet_am IS NULL');
      await client.query("INSERT INTO brilon_pruef_tablet_kopplungen(id,code_hash,ablauf) VALUES($1,$2,NOW()+INTERVAL '10 minutes')",
        [crypto.randomUUID(),encryptedHash]);
      await client.query('COMMIT');
      return {code,gueltigSekunden:600};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  async function pairDevice(code,name){
    if(typeof code!=='string'||!/^\d{8}$/.test(code)||typeof name!=='string'||
      name.trim().length<3||name.trim().length>80)return null;
    const hashCode=pairingHash(code,secret());
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const result=await client.query(
        'UPDATE brilon_pruef_tablet_kopplungen SET verwendet_am=NOW() WHERE code_hash=$1 AND ablauf>NOW() AND verwendet_am IS NULL RETURNING id',
        [hashCode]);
      if(!result.rowCount){await client.query('ROLLBACK');return null;}
      const token=crypto.randomBytes(32).toString('hex'),id=crypto.randomUUID();
      await client.query(
        'INSERT INTO brilon_pruef_tablets(id,name,token_hash) VALUES($1,$2,$3)',
        [id,name.trim(),hash(token)]);
      await client.query('COMMIT');
      return {id,name:name.trim(),cookie:COOKIE+'='+token+
        '; HttpOnly; Secure; SameSite=Strict; Path=/api/pruefung/tablet; Max-Age=2592000'};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  async function authenticatedTablet(cookie){
    const token=String(cookie||'').match(/(?:^|;\s*)brilon_tablet=([0-9a-f]{64})(?:;|$)/)?.[1];
    if(!token)return null;
    const q=await pool.query(
      'SELECT id,name FROM brilon_pruef_tablets WHERE token_hash=$1 AND aktiv=true AND gekoppelt_am>NOW()-INTERVAL \'30 days\'',
      [hash(token)]);
    return q.rows[0]||null;
  }
  async function activeTablets(){
    const q=await pool.query('SELECT COUNT(*)::int AS count FROM brilon_pruef_tablets WHERE aktiv=true AND gekoppelt_am>NOW()-INTERVAL \'30 days\'');
    return Number(q.rows[0].count);
  }
  async function display(){
    const q=await pool.query(
      'SELECT code_verschluesselt,CEIL(EXTRACT(EPOCH FROM (ablauf-NOW())))::int AS sekunden FROM brilon_pruef_codes WHERE verbraucht_am IS NULL AND ablauf>NOW() AND code_verschluesselt IS NOT NULL ORDER BY ablauf DESC,id DESC LIMIT 1');
    if(!q.rowCount)return {code:null,gueltigSekunden:0};
    try{return {code:decryptCode(q.rows[0].code_verschluesselt,secret()),
      gueltigSekunden:Math.max(0,Number(q.rows[0].sekunden))};}
    catch{return {code:null,gueltigSekunden:0};}
  }
  return {issueCode,issuePairing,pairDevice,authenticatedTablet,activeTablets,display};
}
module.exports={createTabletService,encryptCode,decryptCode,pairingHash};
