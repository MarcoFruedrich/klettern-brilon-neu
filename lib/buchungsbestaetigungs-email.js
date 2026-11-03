'use strict';

function createBuchungsbestaetigungsMailer({pool,sendEmail,logger=console,now=()=>new Date()}){
  async function speichern(buchungId,protokoll){
    const q=await pool.query(
      "UPDATE brilon_buchungen SET data=COALESCE(data,'{}'::jsonb)||$1::jsonb,updated_at=NOW() WHERE id=$2 RETURNING id",
      [JSON.stringify({bestaetigungsEmail:protokoll}),buchungId]
    );
    if(q.rowCount!==1)throw new Error('Buchungsdatensatz für Versandprotokoll nicht gefunden.');
  }

  return async function bestaetigungsEmailSenden({buchungId,email,betreff,text}){
    const versuchtAm=now().toISOString();
    const basis={versuchtAm,angenommenAm:null,fehler:null};
    try{
      await speichern(buchungId,{...basis,status:'wird_versendet'});
    }catch(error){
      logger.error('Buchungsbestätigung: Versandversuch konnte nicht protokolliert werden:',error.message);
      return {status:'ungeklaert',versuchtAm,fehler:'Versandversuch konnte nicht protokolliert werden.'};
    }

    try{
      await sendEmail(email,betreff,text);
    }catch(error){
      const status=error?.uncertain?'ungeklaert':'fehlgeschlagen';
      const fehler=String(error?.message||'Unbekannter E-Mail-Fehler').replace(/[\\r\\n]+/g,' ').slice(0,500);
      const protokoll={...basis,status,fehler};
      try{await speichern(buchungId,protokoll);}
      catch(speicherFehler){
        logger.error('Buchungsbestätigung: Fehlerstatus konnte nicht gespeichert werden:',speicherFehler.message);
      }
      logger.error('Buchungsbestätigung konnte nicht versendet werden:',fehler);
      return protokoll;
    }

    const angenommenAm=now().toISOString();
    const protokoll={status:'angenommen',versuchtAm,angenommenAm,fehler:null};
    try{await speichern(buchungId,protokoll);}
    catch(error){
      logger.error('Buchungsbestätigung vom Anbieter angenommen, Zeitstempel konnte nicht gespeichert werden:',error.message);
      return {status:'ungeklaert',versuchtAm,angenommenAm:null,fehler:'Anbieterannahme bestätigt, Zeitstempel konnte nicht gespeichert werden.'};
    }
    return protokoll;
  };
}

module.exports={createBuchungsbestaetigungsMailer};
