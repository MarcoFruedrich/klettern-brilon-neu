'use strict';
const crypto=require('node:crypto');

// Eine Zahlungsaufforderung darf bei unklarem Providerstatus nicht erneut versendet werden.
// Der vorhandene JSONB-Buchungsdatensatz speichert die Versandreservierung atomar.
function createZahlungsinfoVersand({pool,brevoMail}){
  if(!pool||typeof pool.query!=='function'||typeof brevoMail!=='function')
    throw new TypeError('Zahlungsinfo-Versand benötigt Datenbank und E-Mail-Anbieter.');
  return async function zahlungsinfoVersenden({buchungId,email,text,betreff='Zahlungsinformationen – Klettern & Abenteuer Brilon'}){
    const versuch=crypto.randomUUID();
    const reserviert=await pool.query(`UPDATE brilon_buchungen
      SET data=jsonb_set(data,'{zahlungsinfoVersand}',
        jsonb_build_object('status','unklar','versuch',$2::text,'reserviertAm',NOW()::text),true)
      WHERE id=$1 AND zahlungsinfo_gesendet_am IS NULL
        AND COALESCE(data #>> '{zahlungsinfoVersand,status}','') NOT IN ('unklar','angenommen')
      RETURNING id`,[buchungId,versuch]);
    if(!reserviert.rowCount){
      const current=await pool.query(`SELECT zahlungsinfo_gesendet_am,
        data #>> '{zahlungsinfoVersand,status}' AS status FROM brilon_buchungen WHERE id=$1`,[buchungId]);
      if(!current.rowCount)return {status:'nicht_gefunden',blockiert:true};
      if(current.rows[0].zahlungsinfo_gesendet_am||current.rows[0].status==='angenommen')
        return {status:'bereits_angenommen',blockiert:true};
      return {status:'unklar',blockiert:true,
        hinweis:'Versand läuft bereits oder ist ungeklärt. Bitte zunächst beim E-Mail-Anbieter prüfen.'};
    }

    try{
      await brevoMail(email,betreff,text,{idempotencyKey:versuch});
    }catch(error){
      if(error?.uncertain)return {status:'unklar',blockiert:true,
        hinweis:'Ob der E-Mail-Anbieter die Nachricht angenommen hat, ist ungeklärt. Nicht erneut versenden.'};
      try{
        const q=await pool.query(`UPDATE brilon_buchungen
          SET data=jsonb_set(data,'{zahlungsinfoVersand}',
            jsonb_build_object('status','fehlgeschlagen','versuch',$2::text,
              'fehler',$3::text,'aktualisiertAm',NOW()::text),true)
          WHERE id=$1 AND data #>> '{zahlungsinfoVersand,versuch}'=$2
            AND data #>> '{zahlungsinfoVersand,status}'='unklar' RETURNING id`,
          [buchungId,versuch,String(error?.code||'VERSANDFEHLER').slice(0,80)]);
        if(!q.rowCount)return {status:'unklar',blockiert:true};
      }catch{
        return {status:'unklar',blockiert:true,
          hinweis:'Fehler beim Speichern des Versandstatus. Nicht erneut versenden, bevor der Vorgang geprüft wurde.'};
      }
      return {status:'fehlgeschlagen',blockiert:false};
    }

    try{
      const q=await pool.query(`UPDATE brilon_buchungen
        SET zahlungsinfo_gesendet_am=NOW(),
          data=jsonb_set(data,'{zahlungsinfoVersand}',
            jsonb_build_object('status','angenommen','versuch',$2::text,'angenommenAm',NOW()::text),true)
        WHERE id=$1 AND data #>> '{zahlungsinfoVersand,versuch}'=$2
          AND data #>> '{zahlungsinfoVersand,status}'='unklar'
        RETURNING zahlungsinfo_gesendet_am`,[buchungId,versuch]);
      if(!q.rowCount)return {status:'unklar',blockiert:true,
        hinweis:'E-Mail wurde vom Anbieter angenommen; die Protokollierung ist ungeklärt.'};
      return {status:'angenommen',gesendetAm:q.rows[0].zahlungsinfo_gesendet_am,
        hinweis:'Der E-Mail-Anbieter hat die Nachricht angenommen; die Postfachzustellung ist nicht bestätigt.'};
    }catch{
      return {status:'unklar',blockiert:true,
        hinweis:'E-Mail wurde vom Anbieter angenommen; die Protokollierung ist fehlgeschlagen. Nicht erneut versenden.'};
    }
  };
}

module.exports={createZahlungsinfoVersand};
