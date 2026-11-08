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
  async function issueCode({requireDisplay=false}={}){
    const key=secret();secretKey(key);
    const code=String(crypto.randomInt(1000000)).padStart(6,'0');
    const encrypted=encryptCode(code,key);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      let tabletId=null;
      if(requireDisplay){
        // Lock the selected device until the code has been committed.
        // Switching or revoking the device waits, then invalidates its old codes.
        const selected=await client.query(
          "SELECT id FROM brilon_pruef_tablets WHERE pruefdisplay=true AND aktiv=true AND gekoppelt_am>NOW()-INTERVAL '30 days' AND zuletzt_gesehen_am>NOW()-INTERVAL '45 seconds' FOR SHARE");
        if(!selected.rowCount){
          await client.query('ROLLBACK');
          const error=Error('Kein erreichbares, von der Verwaltung freigegebenes Prüfdisplay.');
          error.code='NO_ONLINE_PRUEFDISPLAY';
          throw error;
        }
        tabletId=selected.rows[0].id;
      }
      await client.query('UPDATE brilon_pruef_codes SET verbraucht_am=NOW() WHERE verbraucht_am IS NULL');
      await client.query(
        "INSERT INTO brilon_pruef_codes(id,code_hash,ablauf,code_verschluesselt,tablet_id) VALUES($1,$2,NOW()+INTERVAL '2 minutes',$3,$4)",
        [crypto.randomUUID(),codeHash(code,key),encrypted,tabletId]);
      await client.query('COMMIT');
      return {code,gueltigSekunden:120};
    }catch(e){
      // A failed precondition already rolled back. Rolling back again is harmless
      // in PostgreSQL and keeps the transaction state safe on other errors.
      await client.query('ROLLBACK');throw e;
    }finally{client.release();}
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
  async function replaceDevice(tabletId){
    // Replacement is a single administrative operation: old access and codes
    // are revoked before issuing a one-use new pairing invitation.
    const key=secret();secretKey(key);
    const code=String(crypto.randomInt(100000000)).padStart(8,'0');
    const encryptedHash=pairingHash(code,key);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const previous=await client.query(
        'UPDATE brilon_pruef_tablets SET aktiv=false,pruefdisplay=false WHERE id=$1 AND aktiv=true RETURNING id,name',
        [tabletId]);
      if(!previous.rowCount){
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(
        'UPDATE brilon_pruef_codes SET verbraucht_am=NOW() WHERE tablet_id=$1 AND verbraucht_am IS NULL',
        [tabletId]);
      // There is exactly one pending pairing invitation for the site.
      await client.query(
        'UPDATE brilon_pruef_tablet_kopplungen SET verwendet_am=NOW() WHERE verwendet_am IS NULL');
      await client.query(
        "INSERT INTO brilon_pruef_tablet_kopplungen(id,code_hash,ablauf) VALUES($1,$2,NOW()+INTERVAL '10 minutes')",
        [crypto.randomUUID(),encryptedHash]);
      await client.query('COMMIT');
      return {code,gueltigSekunden:600,
        bisherigesGeraet:{id:previous.rows[0].id,name:previous.rows[0].name},
        hinweis:'Alter Gerätezugang gesperrt; das neue Gerät muss gekoppelt und als Prüfdisplay ausgewählt werden.'};
    }catch(e){await client.query('ROLLBACK');throw e;}
    finally{client.release();}
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
    // Read authorization and update the last-seen heartbeat in one statement.
    // The conditional update avoids a database write on every 3-second poll.
    const q=await pool.query(
      "WITH gerate AS (SELECT t.id,t.name,t.pruefdisplay,t.ort_id,CASE WHEN o.aktiv=true THEN o.name ELSE NULL END AS standort FROM brilon_pruef_tablets t LEFT JOIN brilon_orte o ON o.id=t.ort_id WHERE t.token_hash=$1 AND t.aktiv=true AND t.gekoppelt_am>NOW()-INTERVAL '30 days'), ping AS (UPDATE brilon_pruef_tablets SET zuletzt_gesehen_am=NOW() WHERE id IN (SELECT id FROM gerate) AND (zuletzt_gesehen_am IS NULL OR zuletzt_gesehen_am<NOW()-INTERVAL '10 seconds') RETURNING id) SELECT id,name,pruefdisplay,CASE WHEN standort IS NOT NULL THEN ort_id ELSE NULL END AS ort_id,standort FROM gerate",
      [hash(token)]);
    return q.rows[0]||null;
  }
  // Nur am zugewiesenen, aktiven Standort freigegebene öffentliche Programme.
  // Die Berechtigung kommt ausschließlich aus dem an das Gerät gebundenen Cookie.
  async function siteOffers(tabletId){
    const q=await pool.query(`SELECT a.id,a.name,a.beschreibung,a.hinweise
      FROM brilon_pruef_tablets t
      JOIN brilon_orte o ON o.id=t.ort_id AND o.aktiv=true
      JOIN brilon_angebote a ON (
        CASE WHEN jsonb_typeof(a.veranstaltungsorte)='array' AND
          jsonb_array_length(a.veranstaltungsorte)>0
          THEN a.veranstaltungsorte ? o.name
          ELSE a.veranstaltungsort=o.name END)
      WHERE t.id=$1 AND t.aktiv=true AND t.gekoppelt_am>NOW()-INTERVAL '30 days'
        AND a.archiviert=false AND a.aktiv=true AND a.buchbar=true
        AND a.veroeffentlicht=true
      ORDER BY a.sortierung ASC,a.name ASC LIMIT 16`,[tabletId]);
    return q.rows;
  }
  async function chooseSite(tabletId,ortId){
    if(ortId!==null){
      const found=await pool.query('SELECT id FROM brilon_orte WHERE id=$1 AND aktiv=true',[ortId]);
      if(!found.rowCount)return null;
    }
    const q=await pool.query(
      'UPDATE brilon_pruef_tablets SET ort_id=$2 WHERE id=$1 AND aktiv=true RETURNING id,name,ort_id',
      [tabletId,ortId]);
    if(!q.rowCount)return null;
    return q.rows[0];
  }
  async function activeTablets(){
    const q=await pool.query("SELECT COUNT(*)::int AS count FROM brilon_pruef_tablets WHERE pruefdisplay=true AND aktiv=true AND gekoppelt_am>NOW()-INTERVAL '30 days' AND zuletzt_gesehen_am>NOW()-INTERVAL '45 seconds'");
    return Number(q.rows[0].count);
  }
  async function display(tabletId){
    if(!tabletId)return {code:null,gueltigSekunden:0};
    const q=await pool.query(
      'SELECT code_verschluesselt,CEIL(EXTRACT(EPOCH FROM (ablauf-NOW())))::int AS sekunden FROM brilon_pruef_codes WHERE tablet_id=$1 AND verbraucht_am IS NULL AND ablauf>NOW() AND code_verschluesselt IS NOT NULL ORDER BY ablauf DESC,id DESC LIMIT 1',
      [tabletId]);
    if(!q.rowCount)return {code:null,gueltigSekunden:0};
    try{return {code:decryptCode(q.rows[0].code_verschluesselt,secret()),
      gueltigSekunden:Math.max(0,Number(q.rows[0].sekunden))};}
    catch{return {code:null,gueltigSekunden:0};}
  }
  async function chooseDisplay(tabletId){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      // Only active, nonexpired devices may be designated.
      const present=await client.query(
        "SELECT id,name FROM brilon_pruef_tablets WHERE id=$1 AND aktiv=true AND gekoppelt_am>NOW()-INTERVAL '30 days' FOR UPDATE",
        [tabletId]);
      if(!present.rowCount){await client.query('ROLLBACK');return null;}
      await client.query('UPDATE brilon_pruef_tablets SET pruefdisplay=false WHERE pruefdisplay=true AND id<>$1',[tabletId]);
      await client.query('UPDATE brilon_pruef_tablets SET pruefdisplay=true WHERE id=$1',[tabletId]);
      // Switching displays invalidates every outstanding tablet-bound code.
      await client.query('UPDATE brilon_pruef_codes SET verbraucht_am=NOW() WHERE tablet_id IS NOT NULL AND verbraucht_am IS NULL');
      await client.query('COMMIT');
      return {id:present.rows[0].id,name:present.rows[0].name,pruefdisplay:true};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  async function deleteTablet(tabletId){
    // Sicherheit sofort und atomar entziehen, aber historische Prüfberichte und
    // referenzierte Prüfcodes nicht aus der Datenbank löschen.
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const q=await client.query(
        `UPDATE brilon_pruef_tablets
          SET aktiv=false,pruefdisplay=false,ort_id=NULL,
              token_hash=$2,geloescht_am=NOW()
          WHERE id=$1 AND geloescht_am IS NULL
          RETURNING id,name,pruefdisplay`,
        [tabletId,hash(crypto.randomBytes(32))]);
      if(!q.rowCount){await client.query('ROLLBACK');return null;}
      await client.query(
        'UPDATE brilon_pruef_codes SET verbraucht_am=NOW() WHERE tablet_id=$1 AND verbraucht_am IS NULL',
        [tabletId]);
      await client.query('COMMIT');
      return {id:q.rows[0].id,name:q.rows[0].name,gelöscht:true,zugangGesperrt:true};
    }catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }
  async function revokeTablet(tabletId){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const q=await client.query(
        'UPDATE brilon_pruef_tablets SET aktiv=false,pruefdisplay=false WHERE id=$1 RETURNING id,name,aktiv',
        [tabletId]);
      if(!q.rowCount){await client.query('ROLLBACK');return null;}
      await client.query('UPDATE brilon_pruef_codes SET verbraucht_am=NOW() WHERE tablet_id=$1 AND verbraucht_am IS NULL',[tabletId]);
      await client.query('COMMIT');
      return q.rows[0];
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  return {issueCode,issuePairing,pairDevice,authenticatedTablet,siteOffers,chooseSite,activeTablets,display,chooseDisplay,revokeTablet,deleteTablet,replaceDevice};
}
module.exports={createTabletService,encryptCode,decryptCode,pairingHash};
