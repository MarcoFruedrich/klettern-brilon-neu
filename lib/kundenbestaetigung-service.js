'use strict';
const {customerConfirmationDue,settingsFromData}=require('./kundenbestaetigungszeiten');
const {zahlungsstand}=require('./buchungslogik');
const {sonderangebotVorschlaege}=require('./sonderangebot-vorschlaege');
const {erzeugeZugang}=require('./anschlussangebote');
const {createZahlungsinfoVersand}=require('./zahlungsinfo-versand');
const {createBuchungsbestaetigungsMailer}=require('./buchungsbestaetigungs-email');
const {createPartnerhausWeiterleitung}=require('./partnerhaus-weiterleitung');
function createKundenbestaetigungService({pool,brevoMail,workTimers=globalThis,now=()=>Date.now()}){
  const zahlungsinfoVersenden=createZahlungsinfoVersand({pool,brevoMail});
  const bestaetigungVersenden=createBuchungsbestaetigungsMailer({pool,sendEmail:brevoMail});
  const partnerhausWeiterleiten=createPartnerhausWeiterleitung({pool,brevoMail});
  let workerStarted=false,activeRun=null,workerInterval=null;
  const faelligeTimer=new Map();
  // Nur eine Warteschlangenabfrage je Prozess; Datenbanksperren verhindern
  // zusätzlich doppelte Verarbeitung über mehrere Serverinstanzen hinweg.
  function wake(){
    if(activeRun)return activeRun;
    const request=processQueue()
      .catch(error=>{
        console.error('Kundenbenachrichtigungen: Warteschlange fehlgeschlagen:',
          error.code||error.message||'DB_ERROR');
      })
      .finally(()=>{if(activeRun===request)activeRun=null;});
    activeRun=request;
    return request;
  }
  function erinnereZumTermin(bookingId,due){
    if(!workerStarted||!due)return;
    const zeit=new Date(due).getTime();
    if(!Number.isFinite(zeit))return;
    if(faelligeTimer.has(bookingId))workTimers.clearTimeout(faelligeTimer.get(bookingId));
    // Verhindert Overflow bei fernen Terminen. Der periodische Scanner
    // bleibt unabhängig davon ein dauerhafter Fallback, solange Render läuft.
    const rest=Math.max(0,Math.min(2147483647,zeit-now()+250));
    const timer=workTimers.setTimeout(()=>{
      faelligeTimer.delete(bookingId);
      void wake();
    },rest);
    timer?.unref?.();
    faelligeTimer.set(bookingId,timer);
  }
  function startWorker(){
    if(workerStarted)return activeRun;
    workerStarted=true;
    // Der bisherige 60-s-Abstand konnte den Test-Versand um bis zu eine Minute
    // verzögern. Der 15-s-Scanner und ein zusätzlicher Fälligkeitstimer
    // verbessern die Genauigkeit, ersetzen aber keinen Always-on-Dienst.
    workerInterval=workTimers.setInterval(()=>{void wake();},15_000);
    workerInterval?.unref?.();
    return wake();
  }
  async function schedule(bookingId,staffId){
    const check=await pool.query(`SELECT b.id FROM brilon_buchungen b
      WHERE b.id=$1 AND b.status='offen'
        -- Die Zustimmung sämtlicher zugewiesener Mitarbeitenden genügt.
        -- Eine spezielle Vertrauenspersonen-Freigabe ist nicht Voraussetzung.
        AND EXISTS(SELECT 1 FROM brilon_einsaetze e
          WHERE e.buchung_id=b.id AND e.status='bestaetigt')
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
      ON CONFLICT(buchung_id) DO UPDATE SET
        anlass_mitarbeiter_id=EXCLUDED.anlass_mitarbeiter_id,
        faellig_ab=EXCLUDED.faellig_ab,status='geplant',
        aktualisiert_am=NOW(),versendet_am=NULL,fehler=NULL
      WHERE brilon_kundenbestaetigungen.status IN ('abgebrochen','fehler','gesendet')
      RETURNING faellig_ab`,[bookingId,staffId,due]);
    if(q.rowCount>0)erinnereZumTermin(bookingId,q.rows[0]?.faellig_ab||due);
    return {geplant:q.rowCount>0,faelligAb:q.rows[0]?.faellig_ab||null};
  }
  async function processQueue(onlyBookingId=null){
    for(let n=0;n<(onlyBookingId?1:10);n++){
      const client=await pool.connect();
      let item;
      try{
        await client.query('BEGIN');
        const q=await client.query(`SELECT q.buchung_id,b.data,b.status AS buchungsstatus,b.zahlungsinfo_gesendet_am
          FROM brilon_kundenbestaetigungen q
          JOIN brilon_buchungen b ON b.id=q.buchung_id
          WHERE q.status='geplant' AND q.faellig_ab<=NOW()
            AND ($1::uuid IS NULL OR q.buchung_id=$1::uuid)
          ORDER BY q.faellig_ab LIMIT 1 FOR UPDATE OF q SKIP LOCKED`,[onlyBookingId]);
        if(!q.rowCount){await client.query('ROLLBACK');break;}
        item=q.rows[0];
        const confirmed=await client.query(`SELECT
          COUNT(*) FILTER (WHERE status='eingeteilt')::int AS offen,
          COUNT(*) FILTER (WHERE status='bestaetigt')::int AS bestaetigt
          FROM brilon_einsaetze WHERE buchung_id=$1`,[item.buchung_id]);
        if(item.buchungsstatus!=='offen'||
          (!item.data?.email&&item.data?.partnerhausAbwicklung!==true)||
          Number(confirmed.rows[0].offen)!==0||Number(confirmed.rows[0].bestaetigt)<1){
          await client.query(`UPDATE brilon_kundenbestaetigungen
            SET status='abgebrochen',aktualisiert_am=NOW(),fehler=$2
            WHERE buchung_id=$1`,[item.buchung_id,'Buchung/Bestätigungen nicht mehr versandfähig.']);
          await client.query('COMMIT');continue;
        }
        // "versand_laeuft" verhindert automatische Doppelzustellung nach Prozessabbruch.
        await client.query(`UPDATE brilon_kundenbestaetigungen
          SET status='versand_laeuft',aktualisiert_am=NOW() WHERE buchung_id=$1`,[item.buchung_id]);
        await client.query('COMMIT');
      }catch(e){
        // Preserve the original database error if the connection has already closed.
        try{await client.query('ROLLBACK');}
        catch(rollbackError){console.error('Kundenbestätigung: Rollback fehlgeschlagen:',rollbackError.message);}
        throw e;
      }finally{client.release();}
      const data=item.data,name=data.vorname||data.name||'';
      if(data.partnerhausAbwicklung===true){
        // Partner informiert Gast und übernimmt Zahlung/Rechnung selbst.
        // Wiederholte Zustellung wird durch partnerhausWeiterleitung atomar verhindert.
        try{
          const partnerStatus=await partnerhausWeiterleiten(item.buchung_id);
          const ok=['angenommen','bereits_angenommen'].includes(partnerStatus.status);
          const status=ok?'gesendet':partnerStatus.blockiert?'abgebrochen':'fehler';
          await pool.query(`UPDATE brilon_kundenbestaetigungen SET status=$2,
            versendet_am=CASE WHEN $2='gesendet' THEN NOW() ELSE versendet_am END,
            aktualisiert_am=NOW(),fehler=$3
            WHERE buchung_id=$1 AND status='versand_laeuft'`,
            [item.buchung_id,status,ok?null:String(partnerStatus.hinweis||partnerStatus.fehler||
              'Der Partnerkontakt konnte nicht sicher informiert werden.').slice(0,250)]);
        }catch(error){
          console.error('Automatische Partnerbenachrichtigung fehlgeschlagen:',error.code||'DB_ERROR');
          await pool.query(`UPDATE brilon_kundenbestaetigungen
            SET status='abgebrochen',aktualisiert_am=NOW(),fehler=$2
            WHERE buchung_id=$1 AND status='versand_laeuft'`,
            [item.buchung_id,'Partnerbenachrichtigung ungeklärt; Versandstatus manuell prüfen.']);
        }
        continue;
      }
      let invoiceSettings={};
      try{
        const q=await pool.query('SELECT data FROM brilon_rechnungsdaten WHERE id=1');
        invoiceSettings=q.rows[0]?.data||{};
      }catch(error){console.error('Zahlungsdaten für Kundenbestätigung konnten nicht geladen werden:',error.message);}
      // A missing price must never be interpreted as a free, fully paid booking.
      const rawTotal=data.gesamtpreis;
      const totalValid=rawTotal!==null&&rawTotal!==undefined&&
        (typeof rawTotal==='number'||typeof rawTotal==='string'&&rawTotal.trim()!=='')&&
        Number.isFinite(Number(rawTotal))&&Number(rawTotal)>=0;
      if(!totalValid){
        await pool.query(`UPDATE brilon_kundenbestaetigungen
          SET status='fehler',aktualisiert_am=NOW(),fehler=$2
          WHERE buchung_id=$1 AND status='versand_laeuft'`,
          [item.buchung_id,'Gesamtpreis fehlt oder ist ungültig; automatische Bestätigung gesperrt.']);
        continue;
      }
      const total=Number(rawTotal);
      const individual=data.buchungsmodus==='einzelplatz';
      const paidStand=totalValid&&total>=0?zahlungsstand(Math.round(total*100),
        Array.isArray(data.zahlungen)?data.zahlungen:[]):null;
      const depositReceived=individual||total===0||Boolean(paidStand?.anzahlungErreicht);
      // Bereits zugestellte Zahlungsinformationen nicht automatisch erneut versenden.
      if(!depositReceived&&(item.zahlungsinfo_gesendet_am||
        ['unklar','angenommen'].includes(data.zahlungsinfoVersand?.status))){
        await pool.query(`UPDATE brilon_kundenbestaetigungen
          SET status='abgebrochen',aktualisiert_am=NOW(),fehler=$2 WHERE buchung_id=$1
          AND status='versand_laeuft'`,[item.buchung_id,'Zahlungsaufforderung wurde zuvor bereits versendet.']);
        continue;
      }
      const deposit=individual?0:(Number.isFinite(Number(data.anzahlung))?Number(data.anzahlung):Math.round(total*25)/100);
      const rest=individual?total:(Number.isFinite(Number(data.restbetrag))?Number(data.restbetrag):Math.round((total-deposit)*100)/100);
      const euro=value=>Number(value||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
      const bankName=invoiceSettings.bankname||process.env.BANK_NAME||'';
      const iban=invoiceSettings.iban||process.env.BANK_IBAN||'';
      const hasPaymentDetails=!individual&&Boolean(bankName&&iban&&data.buchungsnummer);
      if(!depositReceived&&!hasPaymentDetails){
        await pool.query(`UPDATE brilon_kundenbestaetigungen
          SET status='fehler',aktualisiert_am=NOW(),fehler=$2
          WHERE buchung_id=$1 AND status='versand_laeuft'`,
          [item.buchung_id,'Bankdaten/Buchungsnummer fehlen; vor Zahlung keine Bestätigung versenden.']);
        continue;
      }
      const paymentLines=individual
        ?['Keine Anzahlung erforderlich.',`Der Termin findet ab ${Number(data.mindestteilnehmer)||5} Anmeldungen statt.`]
        :totalValid?[
          `Gesamtpreis: ${euro(total)}`,
          depositReceived?'Erforderliche Anzahlung: eingegangen.':`Anzahlung (25 %), jetzt fällig: ${euro(deposit)}`,
          `Restbetrag am Veranstaltungstag: ${euro(rest)}`,
          ...(!depositReceived?['Bitte überweise die Anzahlung innerhalb von 48 Stunden; bei kurzfristigen Buchungen sofort.']:[]),
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
        depositReceived
          ?`wir bestätigen eure Buchung für ${data.angebot||'euer Programm'} am ${data.datum||'dem vereinbarten Datum'} um ${data.uhrzeit||'der vereinbarten Zeit'} Uhr verbindlich.`
          :`eure Terminanfrage für ${data.angebot||'euer Programm'} am ${data.datum||'dem vereinbarten Datum'} um ${data.uhrzeit||'der vereinbarten Zeit'} Uhr ist personell geprüft, aber bis zum Zahlungseingang ausdrücklich UNVERBINDLICH vorgemerkt.`,
        '',
        `Buchungsnummer: ${data.buchungsnummer||'siehe ursprüngliche Buchungsanfrage'}`,
        '',
        ...paymentLines,
        '',
        'Klettern & Abenteuer'
      ].join('\n');
      try{
        // Der automatische Versand nutzt denselben atomaren E-Mail-Sperrmechanismus
        // wie der manuelle Verwaltungsbutton; dadurch entsteht kein zweiter Versand.
        if(!depositReceived){
          const ergebnis=await zahlungsinfoVersenden({
            buchungId:item.buchung_id,email:data.email,text:body,
            betreff:'Zahlungsinformationen zu deiner unverbindlichen Terminanfrage – Klettern & Abenteuer'
          });
          if(ergebnis.status==='angenommen'){
            await pool.query(`UPDATE brilon_kundenbestaetigungen SET status='gesendet',
              versendet_am=NOW(),aktualisiert_am=NOW(),fehler=NULL WHERE buchung_id=$1
              AND status='versand_laeuft'`,[item.buchung_id]);
          }else{
            // Unklare Annahme niemals automatisch wiederholen.
            const blockiert=ergebnis.blockiert===true;
            await pool.query(`UPDATE brilon_kundenbestaetigungen SET status=$2,
              aktualisiert_am=NOW(),fehler=$3 WHERE buchung_id=$1
              AND status='versand_laeuft'`,[item.buchung_id,blockiert?'abgebrochen':'fehler',
              String(ergebnis.fehler||ergebnis.hinweis||
                'Zahlungsinfo konnte nicht versendet werden.').slice(0,250)]);
          }
          continue;
        }
        // Verwaltung und automatische Warteschlange verwenden dieselbe atomare Versandreservierung.
        const bestaetigung=await bestaetigungVersenden({
          buchungId:item.buchung_id,email:data.email,
          betreff:'Verbindliche Buchungsbestätigung – Klettern & Abenteuer',text:body
        });
        if(!['angenommen','bereits_angenommen'].includes(bestaetigung.status)){
          await pool.query(`UPDATE brilon_kundenbestaetigungen SET status='abgebrochen',
            aktualisiert_am=NOW(),fehler=$2 WHERE buchung_id=$1
            AND status='versand_laeuft'`,[item.buchung_id,
            String(bestaetigung.fehler||'Bestätigungs-Mailversand konnte nicht sicher bestätigt werden.').slice(0,250)]);
          continue;
        }
        await pool.query(`UPDATE brilon_kundenbestaetigungen SET status='gesendet',
          versendet_am=NOW(),aktualisiert_am=NOW(),fehler=NULL WHERE buchung_id=$1
          AND status='versand_laeuft'`,[item.buchung_id]);
        if(depositReceived){
          const update=await pool.query(`UPDATE brilon_buchungen SET status='bestaetigt',updated_at=NOW()
            WHERE id=$1 AND status='offen' RETURNING id`,[item.buchung_id]);
          if(update.rowCount){
            const base=process.env.PUBLIC_BASE_URL,secret=process.env.BOOKING_OFFER_SECRET;
            if(base&&typeof secret==='string'&&secret.length>=32){
              try{
                const addons=await sonderangebotVorschlaege(pool,item.buchung_id);
                if(addons.ok){
                  const url=new URL('/anschluss.html',base);
                  if(url.protocol==='https:'){
                    url.hash='zugang='+encodeURIComponent(erzeugeZugang(item.buchung_id,secret));
                    await brevoMail(data.email,'Zusätzliche Anschlussprogramme – Klettern & Abenteuer',
                      'Passende Anschlussprogramme zu deiner verbindlichen Buchung findest du hier:\n'+url.toString()+
                      '\n\nAlle Zusatztermine werden erst nach eigener Buchungsbestätigung verbindlich.');
                  }
                }
              }catch(error){console.error('Anschlussangebot nach automatischer Buchungsbestätigung fehlgeschlagen:',error.message);}
            }
          }
        }
      }catch(e){
        console.error('Kundenbestätigung fehlgeschlagen:',e.message);
        await pool.query(`UPDATE brilon_kundenbestaetigungen SET status='fehler',
          aktualisiert_am=NOW(),fehler=$2 WHERE buchung_id=$1 AND status='versand_laeuft'`,
          [item.buchung_id,'E-Mail-Anbieter konnte die Nachricht nicht bestätigen.']);
      }
    }
  }
  return {schedule,processQueue,startWorker};
}
module.exports={createKundenbestaetigungService};
