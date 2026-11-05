'use strict';

const RATE_LIMIT_RETRY_REASON='Brevo hat den Versand begrenzt; ein einmaliger Wiederholungsversuch ist vorgemerkt.';

// Persistent notification outbox, manually retryable for known failures.
// 'angenommen' means accepted by the mail provider, not inbox delivery.
// Interrupted 'sendet' state requires human review to avoid duplicate alerts.
function createPruefMeldungen({pool,brevoMail,env=process.env}){
  const statusPublic=s=>({
    ausstehend:'ausstehend',sendet:'versand_ungeklaert',
    angenommen:'gesendet',fehlgeschlagen:'fehlgeschlagen',
    nicht_konfiguriert:'nicht_konfiguriert'
  })[s]||'unbekannt';

  async function send(berichtId){
    // Atomic conditional claim prevents two concurrent requests from sending twice.
    const claim=await pool.query(
      "UPDATE brilon_pruef_meldungen SET status='sendet',versuche=versuche+1,letzter_versuch=NOW(),letzter_fehler=NULL WHERE bericht_id=$1 AND status IN ('ausstehend','fehlgeschlagen','nicht_konfiguriert') RETURNING bericht_id,versuche",
      [berichtId]);
    if(!claim.rowCount){
      const existing=await pool.query(
        'SELECT status FROM brilon_pruef_meldungen WHERE bericht_id=$1',[berichtId]);
      if(!existing.rowCount)return {gefunden:false,status:'nicht_vorhanden'};
      return {gefunden:true,erneutVersendet:false,status:statusPublic(existing.rows[0].status)};
    }
    const address=env.PRUEF_MANGEL_EMAIL;
    if(typeof address!=='string'||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).test(address)||address.length>180){
      await pool.query(
        "UPDATE brilon_pruef_meldungen SET status='nicht_konfiguriert',letzter_fehler=$2 WHERE bericht_id=$1 AND status='sendet'",
        [berichtId,'Empfängeradresse nicht konfiguriert.']);
      return {gefunden:true,erneutVersendet:false,status:'nicht_konfiguriert'};
    }
    try{
      const report=await pool.query(
        "SELECT p.programm,p.beginn,p.pruefungen,m.name AS pruefer FROM brilon_pruef_berichte p JOIN brilon_pruef_mitarbeitende m ON m.id=p.mitarbeiter_id WHERE p.id=$1 AND p.hat_mangel=true",
        [berichtId]);
      if(!report.rowCount)throw Error('Fehlender Sicherheitsmangelbericht.');
      const data=report.rows[0];
      const mangel=data.pruefungen.filter(p=>p.zustand==='mangel')
        .map(p=>(p.station||'Station')+': '+p.beschreibung).join('\n');
      await brevoMail(address,'Sicherheitsmangel – Klettern & Abenteuer',
        'Prüfnummer: '+berichtId+'\nProgramm: '+data.programm+'\nBeginn: '+data.beginn+
        '\nPrüfperson: '+data.pruefer+'\nSicherheitsmängel:\n'+mangel+
        '\n\nBetroffene Stationen sind gesperrt. Nicht benutzen, bis eine fachliche Freigabe dokumentiert wurde.',
        {idempotencyKey:berichtId});
      // The provider accepted the mail; a failure to persist this fact must
      // remain "sendet" (manual review), never "fehlgeschlagen" (retryable).
      try{
        await pool.query(
          "UPDATE brilon_pruef_meldungen SET status='angenommen',angenommen_am=NOW(),letzter_fehler=NULL WHERE bericht_id=$1 AND status='sendet'",
          [berichtId]);
      }catch{
        return {gefunden:true,erneutVersendet:false,status:'versand_ungeklaert'};
      }
      return {gefunden:true,erneutVersendet:true,status:'gesendet'};
    }catch(error){
      // Never persist potentially sensitive mail provider responses.
      // An ambiguous provider response stays quarantined in 'sendet'; after the
      // provider's idempotency window expires it must not become retryable.
      if(error?.uncertain)
        return {gefunden:true,erneutVersendet:false,status:'versand_ungeklaert'};
      const retryOnce=error?.retryable===true&&claim.rows[0].versuche===1;
      await pool.query(
        "UPDATE brilon_pruef_meldungen SET status='fehlgeschlagen',letzter_fehler=$2 WHERE bericht_id=$1 AND status='sendet'",
        [berichtId,retryOnce?RATE_LIMIT_RETRY_REASON:
          'Mail-Anbieter hat den Versand nicht bestätigt; Doppelversandrisiko vor erneutem Versuch prüfen.']);
      return {gefunden:true,erneutVersendet:false,status:'fehlgeschlagen'};
    }
  }

  async function retryRateLimited(){
    if(!pool)return {geprueft:0,erneutVersendet:0};
    const due=await pool.query(
      `SELECT bericht_id FROM brilon_pruef_meldungen
       WHERE status='fehlgeschlagen' AND letzter_fehler=$1 AND versuche=1
         AND letzter_versuch<NOW()-INTERVAL '2 minutes'
         AND letzter_versuch>NOW()-INTERVAL '25 minutes'
       ORDER BY letzter_versuch ASC,bericht_id ASC LIMIT 5`,
      [RATE_LIMIT_RETRY_REASON]);
    const results=await Promise.allSettled(due.rows.map(row=>send(row.bericht_id)));
    return {geprueft:results.length,erneutVersendet:results.filter(result=>
      result.status==='fulfilled'&&result.value.status==='gesendet'&&result.value.erneutVersendet).length};
  }
  return {send,statusPublic,retryRateLimited};
}
module.exports={createPruefMeldungen};
