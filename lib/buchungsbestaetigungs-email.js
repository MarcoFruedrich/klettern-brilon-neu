'use strict';
const crypto=require('node:crypto');

// Status und Versuch werden in der Buchung atomar gehalten. Der zuerst
// gestartete Versuch sperrt konkurrierende Versuche über alle Instanzen hinweg.
function createBuchungsbestaetigungsMailer({pool,sendEmail,logger=console,now=()=>new Date()}){
  async function reservieren(buchungId,protokoll){
    const q=await pool.query(`UPDATE brilon_buchungen
      SET data=jsonb_set(COALESCE(data,'{}'::jsonb),'{bestaetigungsEmail}',$1::jsonb,true),
          updated_at=NOW()
      WHERE id=$2
        AND COALESCE(data #>> '{bestaetigungsEmail,status}','')
          NOT IN ('wird_versendet','angenommen','ungeklaert')
      RETURNING id`,[JSON.stringify(protokoll),buchungId]);
    return q.rowCount===1;
  }

  async function aktuellenStatus(buchungId){
    const q=await pool.query(`SELECT data #>> '{bestaetigungsEmail,status}' AS status
      FROM brilon_buchungen WHERE id=$1`,[buchungId]);
    return q.rows[0]?.status||'unbekannt';
  }

  async function speichern(buchungId,versuch,protokoll){
    const q=await pool.query(`UPDATE brilon_buchungen
      SET data=jsonb_set(COALESCE(data,'{}'::jsonb),'{bestaetigungsEmail}',$1::jsonb,true),
          updated_at=NOW()
      WHERE id=$2
        AND data #>> '{bestaetigungsEmail,versuch}'=$3
        AND data #>> '{bestaetigungsEmail,status}'='wird_versendet'
      RETURNING id`,[JSON.stringify(protokoll),buchungId,versuch]);
    if(q.rowCount!==1)throw new Error('Buchungsbestätigung kann nicht sicher protokolliert werden.');
  }

  return async function bestaetigungsEmailSenden({buchungId,email,betreff,text}){
    const versuch=crypto.randomUUID();
    const versuchtAm=now().toISOString();
    const basis={versuch,versuchtAm,angenommenAm:null,fehler:null};
    try{
      const frei=await reservieren(buchungId,{...basis,status:'wird_versendet'});
      if(!frei){
        const status=await aktuellenStatus(buchungId);
        return {status:status==='angenommen'?'bereits_angenommen':'ungeklaert',
          blockiert:true,versuchtAm,
          fehler:'Buchungsbestätigung wurde bereits angenommen, ist im Versand oder muss geprüft werden.'};
      }
    }catch(error){
      logger.error('Buchungsbestätigung: Versandreservierung fehlgeschlagen:',error.message);
      return {status:'ungeklaert',blockiert:true,versuchtAm,
        fehler:'Versandstatus konnte nicht sicher reserviert werden. Kein Versand ausgelöst.'};
    }

    try{
      await sendEmail(email,betreff,text,{idempotencyKey:versuch});
    }catch(error){
      const status=error?.uncertain?'ungeklaert':'fehlgeschlagen';
      const fehler=String(error?.message||'Unbekannter E-Mail-Fehler').replace(/[\r\n]+/g,' ').slice(0,500);
      const protokoll={...basis,status,fehler};
      try{await speichern(buchungId,versuch,protokoll);}
      catch(speicherFehler){
        logger.error('Buchungsbestätigung: Fehlerstatus konnte nicht gespeichert werden:',speicherFehler.message);
        return {...basis,status:'ungeklaert',blockiert:true,
          fehler:'Versandfehler konnte nicht sicher gespeichert werden. Bitte Anbieterstatus prüfen.'};
      }
      logger.error('Buchungsbestätigung konnte nicht versendet werden:',fehler);
      return protokoll;
    }

    const angenommenAm=now().toISOString();
    const protokoll={...basis,status:'angenommen',angenommenAm};
    try{await speichern(buchungId,versuch,protokoll);}
    catch(error){
      logger.error('Buchungsbestätigung vom Anbieter angenommen, Zeitstempel konnte nicht gespeichert werden:',error.message);
      return {...basis,status:'ungeklaert',blockiert:true,
        fehler:'Anbieterannahme bestätigt; Protokollierung ungeklärt. Nicht erneut senden.'};
    }
    return protokoll;
  };
}
module.exports={createBuchungsbestaetigungsMailer};
