'use strict';
const crypto=require('node:crypto');
function createMitarbeiterStornoMail({pool,brevoMail}){
  if(!pool||typeof pool.query!=='function'||typeof brevoMail!=='function')
    throw new TypeError('Storno-Mail benötigt Datenbank und E-Mail-Anbieter.');
  async function informiereEinzeln(buchungId,person){
    const mitarbeiterId=String(person.mitarbeiter_id),versuch=crypto.randomUUID();
    const reserviert=await pool.query(
      "UPDATE brilon_buchungen SET data=jsonb_set(COALESCE(data,'{}'::jsonb),"+
      "'{mitarbeiterStornoMails}',COALESCE(data->'mitarbeiterStornoMails','{}'::jsonb) || "+
      "jsonb_build_object($2::text,$3::jsonb),true),updated_at=NOW() "+
      "WHERE id=$1 AND status IN ('storniert','abgelehnt') "+
      "AND COALESCE(data #>> ARRAY['mitarbeiterStornoMails',$2::text,'status'],'') "+
      "NOT IN ('wird_versendet','angenommen','unklar') RETURNING data",
      [buchungId,mitarbeiterId,JSON.stringify({status:'wird_versendet',versuch,versuchtAm:new Date().toISOString()})]);
    if(!reserviert.rowCount)return {mitarbeiterId,status:'bereits_bearbeitet',blockiert:true};
    const data=reserviert.rows[0].data||{},email=String(person.email||'').trim();
    let status='angenommen',fehler=null;
    if(!/^\S+@\S+\.\S+$/.test(email)){
      status='keine_adresse';fehler='Keine gültige Mitarbeiter-E-Mail-Adresse.';
    }else{
      try{
        await brevoMail(email,'Einsatz entfällt – Buchung storniert',
          ['Hallo '+String(person.name||'')+',','',
           'Dein bisheriger Einsatz findet aufgrund einer Buchungsabsage nicht statt.',
           'Programm: '+String(data.angebot||'—'),
           'Buchungsnummer: '+String(data.buchungsnummer||'—'),
           'Datum: '+String(data.datum||'—')+' um '+String(data.uhrzeit||'—')+' Uhr',
           'Standort: '+String(data.veranstaltungsort||'—'),
           'Bitte plane den Einsatz nicht mehr ein.','','Klettern & Abenteuer'].join('\n'),
          {idempotencyKey:versuch});
      }catch(error){
        status=error?.uncertain?'unklar':'fehlgeschlagen';
        fehler=String(error?.code||error?.message||'Unbekannter Fehler').slice(0,150);
      }
    }
    const record={status,versuch,empfaenger:email,versuchtAm:new Date().toISOString(),
      ...(status==='angenommen'?{angenommenAm:new Date().toISOString()}:{fehler})};
    try{
      const q=await pool.query(
        "UPDATE brilon_buchungen SET data=jsonb_set(data,'{mitarbeiterStornoMails}',"+
        "COALESCE(data->'mitarbeiterStornoMails','{}'::jsonb) || "+
        "jsonb_build_object($2::text,$4::jsonb),true),updated_at=NOW() "+
        "WHERE id=$1 AND data #>> ARRAY['mitarbeiterStornoMails',$2::text,'versuch']=$3 "+
        "AND data #>> ARRAY['mitarbeiterStornoMails',$2::text,'status']='wird_versendet' RETURNING id",
        [buchungId,mitarbeiterId,versuch,JSON.stringify(record)]);
      if(q.rowCount!==1)throw Error('Mailstatus überschrieben');
    }catch{return {mitarbeiterId,status:'unklar',blockiert:true,
      hinweis:'Mailannahme und Datenbankstatus prüfen. Kein automatischer Neuversand.'};}
    return {mitarbeiterId,status,fehler};
  }
  return async function mitarbeiterAbsageInformieren(buchungId){
    const persons=await pool.query(
      "SELECT e.mitarbeiter_id,m.name,m.email FROM brilon_einsaetze e "+
      "JOIN brilon_pruef_mitarbeitende m ON m.id=e.mitarbeiter_id "+
      "WHERE e.buchung_id=$1 AND e.status IN ('eingeteilt','bestaetigt')",[buchungId]);
    const ergebnisse=[];
    for(const p of persons.rows){
      try{ergebnisse.push(await informiereEinzeln(buchungId,p));}
      catch(error){ergebnisse.push({mitarbeiterId:String(p.mitarbeiter_id),status:'unklar',
        hinweis:'Benachrichtigung konnte nicht sicher verarbeitet werden.'});}
    }
    return {anzahl:persons.rows.length,ergebnisse};
  };
}
module.exports={createMitarbeiterStornoMail};
