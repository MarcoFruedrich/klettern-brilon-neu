'use strict';

// Kundenrechnung: ein einziges Versandverfahren für automatische Erstellung
// und manuelles Nachsenden. Der Mailanbieter nimmt eine Nachricht an, bestätigt
// damit aber noch nicht die tatsächliche Postfachzustellung.
function createKundenrechnungsversand({pool,brevoMail}){
  if(!pool||typeof pool.query!=='function'||typeof brevoMail!=='function')
    throw new TypeError('Rechnungsversand benötigt Datenbank und Mailanbieter.');

  async function buchungsstatus(buchungId,status){
    await pool.query(`UPDATE brilon_buchungen
      SET data=jsonb_set(data,'{rechnung,status}',to_jsonb($1::text),true),
          updated_at=NOW() WHERE id=$2`,[status,buchungId]);
  }

  return async function kundenrechnungVersenden(id){
    // Das atomare UPDATE verhindert, dass automatische Erstellung und
    // Verwaltungsbutton dieselbe Rechnung gleichzeitig versenden.
    const reserved=await pool.query(`UPDATE brilon_rechnungen
      SET email_status='unklar',email_fehler='Versand wurde reserviert; bei Abbruch vor erneutem Senden Mailanbieter prüfen.'
      WHERE id=$1 AND email_status IN ('ausstehend','fehlgeschlagen','ohne_empfaenger')
      RETURNING id,buchung_id,rechnungsnummer,data,pdf`,[id]);
    if(!reserved.rowCount){
      const current=await pool.query('SELECT rechnungsnummer,email_status FROM brilon_rechnungen WHERE id=$1',[id]);
      const status=current.rows[0]?.email_status||'nicht_gefunden';
      return {
        status,nummer:current.rows[0]?.rechnungsnummer||null,blockiert:status!=='angenommen',
        hinweis:status==='unklar'?'Bitte zuerst beim E-Mail-Anbieter prüfen, ob die Rechnung versendet wurde.':
          undefined
      };
    }

    const row=reserved.rows[0];
    const data=typeof row.data==='string'?JSON.parse(row.data):row.data||{};
    const booking=await pool.query(`SELECT data->>'email' AS email,
        COALESCE((data->>'partnerhausAbwicklung')::boolean,false) AS partnerhaus
      FROM brilon_buchungen WHERE id=$1`,[row.buchung_id]);
    const email=String(booking.rows[0]?.email||'').trim();
    if(!booking.rowCount||booking.rows[0].partnerhaus||!/^\S+@\S+\.\S+$/.test(email)){
      const problem=booking.rows[0]?.partnerhaus?
        'Kundenrechnungen dürfen nicht für Partnerhausbuchungen versendet werden.':
        'Keine gültige Kunden-E-Mail-Adresse hinterlegt.';
      await pool.query(`UPDATE brilon_rechnungen
        SET email_status='ohne_empfaenger',email_fehler=$2
        WHERE id=$1 AND email_status='unklar'`,[id,problem]);
      await buchungsstatus(row.buchung_id,'ohne_empfaenger');
      return {status:'ohne_empfaenger',nummer:row.rechnungsnummer};
    }

    const issuer=data.aussteller?.firma||'Klettern & Abenteuer Brilon';
    let mailError;
    try{
      await brevoMail(email,'Deine Rechnung – Klettern & Abenteuer Brilon',
        `Guten Tag,\n\nanbei erhältst du deine Rechnung ${row.rechnungsnummer} als PDF. Der Zahlungseingang ist vollständig erfasst.\n\nViele Grüße\n${issuer}`,
        {idempotencyKey:id,attachments:[{name:`Rechnung-${row.rechnungsnummer}.pdf`,
          content:Buffer.from(row.pdf).toString('base64')}]});
    }catch(error){mailError=error;}

    if(mailError){
      const status=mailError.uncertain?'unklar':'fehlgeschlagen';
      await pool.query(`UPDATE brilon_rechnungen
        SET email_status=$1,email_fehler=$2 WHERE id=$3 AND email_status='unklar'`,
        [status,String(mailError.message||'Versandfehler').slice(0,250),id]);
      await buchungsstatus(row.buchung_id,status);
      return {status,nummer:row.rechnungsnummer};
    }

    // Nach erfolgreicher Providerannahme darf ein DB-Fehler niemals als
    // "nicht versendet" behandelt werden: der Datensatz bleibt gesperrt,
    // bis Versand und Datenbankstatus geklärt sind.
    try{
      await pool.query(`UPDATE brilon_rechnungen
        SET email_status='angenommen',email_fehler=NULL,versandt_am=NOW()
        WHERE id=$1 AND email_status='unklar'`,[id]);
      await buchungsstatus(row.buchung_id,'angenommen');
    }catch(error){
      console.error('Rechnungs-E-Mail vom Anbieter angenommen, Protokollstatus unklar:',error.code||'DB_ERROR');
      return {status:'unklar',nummer:row.rechnungsnummer,blockiert:true,
        hinweis:'Der E-Mail-Anbieter hat die Rechnung angenommen, aber die Protokollierung muss geprüft werden.'};
    }
    return {status:'angenommen',nummer:row.rechnungsnummer};
  };
}

module.exports={createKundenrechnungsversand};
