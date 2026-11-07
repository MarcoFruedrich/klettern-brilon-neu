'use strict';
const {customerConfirmationDue,settingsFromData}=require('./kundenbestaetigungszeiten');
function createKundenbestaetigungService({pool,brevoMail}){
  async function schedule(bookingId,staffId){
    const check=await pool.query(`SELECT b.id FROM brilon_buchungen b
      WHERE b.id=$1 AND b.status='offen'
        AND EXISTS(SELECT 1 FROM brilon_einsaetze e
          JOIN brilon_beschaeftigung c ON c.mitarbeiter_id=e.mitarbeiter_id
          WHERE e.buchung_id=b.id AND e.status='bestaetigt' AND c.vertrauensperson=true)
        AND NOT EXISTS(SELECT 1 FROM brilon_einsaetze e
          WHERE e.buchung_id=b.id AND e.status='eingeteilt')`,[bookingId]);
    if(!check.rowCount)return {geplant:false};
    let settings={};
    try{
      const q=await pool.query(`SELECT verzoegerung_minuten AS "verzoegerungMinuten",
        ruhebeginn,ruheende FROM brilon_kundenbestaetigung_einstellungen WHERE id=1`);
      settings=settingsFromData(q.rows[0]||{});
    }catch(error){
      console.error('Bestätigungszeit-Einstellungen konnten nicht geladen werden; Standardwerte werden verwendet:',error.message);
    }
    const due=customerConfirmationDue(new Date(),settings);
    const q=await pool.query(`INSERT INTO brilon_kundenbestaetigungen
      (buchung_id,anlass_mitarbeiter_id,faellig_ab,status)
      VALUES($1,$2,$3,'geplant')
      ON CONFLICT(buchung_id) DO NOTHING RETURNING faellig_ab`,[bookingId,staffId,due]);
    return {geplant:q.rowCount>0,faelligAb:q.rows[0]?.faellig_ab||null};
  }
  async function processQueue(){
    for(let n=0;n<10;n++){
      const client=await pool.connect();
      let item;
      try{
        await client.query('BEGIN');
        const q=await client.query(`SELECT q.buchung_id,b.data,b.status AS buchungsstatus
          FROM brilon_kundenbestaetigungen q
          JOIN brilon_buchungen b ON b.id=q.buchung_id
          WHERE q.status='geplant' AND q.faellig_ab<=NOW()
          ORDER BY q.faellig_ab LIMIT 1 FOR UPDATE OF q SKIP LOCKED`);
        if(!q.rowCount){await client.query('ROLLBACK');break;}
        item=q.rows[0];
        const confirmed=await client.query(`SELECT
          COUNT(*) FILTER (WHERE status='eingeteilt')::int AS offen,
          COUNT(*) FILTER (WHERE status='bestaetigt')::int AS bestaetigt
          FROM brilon_einsaetze WHERE buchung_id=$1`,[item.buchung_id]);
        if(item.buchungsstatus!=='offen'||!item.data?.email||
          confirmed.rows[0].offen!==0||confirmed.rows[0].bestaetigt<1){
          await client.query(`UPDATE brilon_kundenbestaetigungen
            SET status='abgebrochen',aktualisiert_am=NOW(),fehler=$2
            WHERE buchung_id=$1`,[item.buchung_id,'Buchung/Bestätigungen nicht mehr versandfähig.']);
          await client.query('COMMIT');continue;
        }
        // "versand_laeuft" verhindert automatische Doppelzustellung nach Prozessabbruch.
        await client.query(`UPDATE brilon_kundenbestaetigungen
          SET status='versand_laeuft',aktualisiert_am=NOW() WHERE buchung_id=$1`,[item.buchung_id]);
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
      const data=item.data,name=data.vorname||data.name||'';
      let invoiceSettings={};
      try{
        const q=await pool.query('SELECT data FROM brilon_rechnungsdaten WHERE id=1');
        invoiceSettings=q.rows[0]?.data||{};
      }catch(error){console.error('Zahlungsdaten für Kundenbestätigung konnten nicht geladen werden:',error.message);}
      const total=Number(data.gesamtpreis);
      const totalValid=Number.isFinite(total)&&total>=0;
      const individual=data.buchungsmodus==='einzelplatz';
      const deposit=individual?0:(Number.isFinite(Number(data.anzahlung))?Number(data.anzahlung):Math.round(total*25)/100);
      const rest=individual?total:(Number.isFinite(Number(data.restbetrag))?Number(data.restbetrag):Math.round((total-deposit)*100)/100);
      const euro=value=>Number(value||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
      const bankName=invoiceSettings.bankname||process.env.BANK_NAME||'';
      const iban=invoiceSettings.iban||process.env.BANK_IBAN||'';
      const hasPaymentDetails=!individual&&Boolean(bankName&&iban&&data.buchungsnummer);
      const paymentLines=individual
        ?['Keine Anzahlung erforderlich.',`Der Termin findet ab ${Number(data.mindestteilnehmer)||5} Anmeldungen statt.`]
        :totalValid?[
          `Gesamtpreis: ${euro(total)}`,
          `Anzahlung (25 %), jetzt fällig: ${euro(deposit)}`,
          `Restbetrag am Veranstaltungstag: ${euro(rest)}`,
          'Bitte überweise die Anzahlung innerhalb von 48 Stunden; bei kurzfristigen Buchungen sofort.',
          ...(hasPaymentDetails?[
            '', 'Bankverbindung:',
            `Bank: ${bankName}`,
            `IBAN: ${iban}`,
            `Verwendungszweck: ${data.buchungsnummer}`
          ]:['Die Bankverbindung wird dir separat mitgeteilt.'])
        ]:['Die Zahlungsinformationen folgen in einer separaten Nachricht.'];
      const body=[
        `Hallo ${name},`,
        '',
        `wir bestätigen euren Termin für ${data.angebot||'euer Programm'} am ${data.datum||'dem vereinbarten Datum'} um ${data.uhrzeit||'der vereinbarten Zeit'} Uhr.`,
        '',
        `Buchungsnummer: ${data.buchungsnummer||'siehe ursprüngliche Buchungsanfrage'}`,
        '',
        ...paymentLines,
        '',
        'Klettern & Abenteuer'
      ].join('\n');
      try{
        await brevoMail(data.email,'Bestätigung eures Termins – Klettern & Abenteuer',body);
        await pool.query(`UPDATE brilon_kundenbestaetigungen SET status='gesendet',
          versendet_am=NOW(),aktualisiert_am=NOW(),fehler=NULL WHERE buchung_id=$1
          AND status='versand_laeuft'`,[item.buchung_id]);
        await pool.query(`UPDATE brilon_buchungen SET status='bestaetigt',updated_at=NOW(),
          zahlungsinfo_gesendet_am=CASE WHEN $2 THEN NOW() ELSE zahlungsinfo_gesendet_am END
          WHERE id=$1 AND status='offen'`,[item.buchung_id,hasPaymentDetails]);
      }catch(e){
        console.error('Kundenbestätigung fehlgeschlagen:',e.message);
        await pool.query(`UPDATE brilon_kundenbestaetigungen SET status='fehler',
          aktualisiert_am=NOW(),fehler=$2 WHERE buchung_id=$1 AND status='versand_laeuft'`,
          [item.buchung_id,'E-Mail-Anbieter konnte die Nachricht nicht bestätigen.']);
      }
    }
  }
  return {schedule,processQueue};
}
module.exports={createKundenbestaetigungService};
