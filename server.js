
// Klettern & Abenteuer Brilon – Node.js / PostgreSQL
'use strict';
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {Pool}=require('pg');
const { buchungsreferenz } = require('./lib/buchungsreferenz');
const { heuteInBerlin } = require('./lib/kalendertag');
const { datenbankKonfiguration } = require('./lib/datenbank-konfiguration');
const { anschlussrabatte } = require('./lib/anschlussrabatt');
const { zugelasseneAnschlusszeiten, anschlussPreis, erzeugeZugang, pruefeZugang } = require('./lib/anschlussangebote');
const { preisFuerTeilnehmer, zahlungsstand, preisNachAnschlussrabatt, preisBeiAnschlussstorno, zahlungErgaenzen } = require('./lib/buchungslogik');
const { buchungsdauerBerechnen, buchungsdauerFuerProgramm } = require('./lib/buchungsdauer');
const { stationFuerSpiel, stationPruefen, gpsSpieldauer } = require('./lib/gpsspiel');
const { gpsTourSpeichern, gpsTourAdminAnsicht } = require('./lib/gpstour');
const { sameOriginMutation } = require('./lib/sicherheit');
const { abgelaufeneEintraegeEntfernen, erstelleRateLimiter, adminLoginErlauben } = require('./lib/sicherheitszustand');
const { summiere: zahlungenSummieren } = require('./site/zahlungsuebersicht');
const { createBrevoMailer } = require('./lib/brevo-mail');
const { createPdf: erstelleRechnungsPdf, formatDate: rechnungsDatumFormatieren } = require('./lib/rechnung');
const { createBuchungsbestaetigungsMailer } = require('./lib/buchungsbestaetigungs-email');
const { createPruefungApi } = require('./lib/stationspruefung-api');
const { createEinsatzplanungApi } = require('./lib/einsatzplanung-api');
const { createKundenbestaetigungService } = require('./lib/kundenbestaetigung-service');
const { sonderangebotVorschlaege } = require('./lib/sonderangebot-vorschlaege');
const { createNetzwerkpartnerApi } = require('./lib/netzwerkpartner-api');
const { createKundenfeedbackApi } = require('./lib/kundenfeedback-api');
const { createSpontanGruppenApi } = require('./lib/spontangruppen-api');
const { createMarketingCampaignApi } = require('./lib/marketing-kampagnen-api');
const { createWissensportalApi } = require('./lib/wissensportal-api');
const { createSocialLinksApi } = require('./lib/social-links-api');
const { aktionAmStandortFreigegeben } = require('./lib/aktionsstandorte');
const { buchungsDetails, buchungsstatusNachricht, zahlungsinformationenText } = require('./lib/buchungs-email');
const { bereinigeBild, analysiereBild } = require('./lib/bilddatei');
const { createClamScanner } = require('./lib/malware-scanner');
const GPS_GAESTELISTE_EINWILLIGUNG_VERSION='2026-11-02-v1';
const BUCHUNGS_DATENSCHUTZ_VERSION='2026-11-03-v1';
const BUCHUNGS_AGB_VERSION=1;

const { createClient } = require('@supabase/supabase-js');

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  : null;


const PORT=Number(process.env.PORT||3000),ROOT=path.join(__dirname,'site');
const dbConfig=datenbankKonfiguration(process.env.DATABASE_URL,process.env.DATABASE_CA_CERT,process.env.DATABASE_SSL_MODE);
const pool=dbConfig?new Pool(dbConfig):null;
const sessions=new Map(),rateLimiter=erstelleRateLimiter();let sessionChecks=0,persistentSessionChecks=0;const cookieName='brilon_session';const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/manifest+json'};
const securityHeaders={
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Referrer-Policy':'strict-origin-when-cross-origin'
};
const brevoMail=createBrevoMailer();
const buchungsbestaetigungsEmail=createBuchungsbestaetigungsMailer({pool,sendEmail:brevoMail});
const scanForMalware=process.env.NODE_ENV==='test'&&process.env.MOCK_MALWARE_SCAN==='1'
  ?async()=>({sauber:true}):createClamScanner();
/* Nur für authentifizierte JPG/PNG/WebP-Bild-Uploads. Es werden ausschließlich
 * von Sharp vollständig decodierte und neu codierte Bilddaten gespeichert.
 * Falls ClamAV konfiguriert ist, bleibt sein Scan verpflichtend (fail closed).
 * Diese Alternative ersetzt keinen Malware-Scanner und gilt nicht für
 * Stationsprüfungen, Dokumente oder andere Dateien.
 */
async function pruefeNeuCodiertesAdminBild(bild,mimeType){
  analysiereBild(bild,mimeType);
  if(!process.env.CLAMD_HOST?.trim()){
    return {modus:'bild-neucodierung-ohne-virenscan'};
  }
  const verdict=await scanForMalware(bild);
  if(verdict?.sauber!==true)
    throw Object.assign(new Error('Ungültige Scannerantwort.'),{code:'MALWARE_SCAN_ERROR'});
  return {modus:'clamav'};
}
if(!process.env.CLAMD_HOST?.trim())
  console.warn('Bild-Uploads: streng validierte Bild-Neucodierung aktiv; kein Virenscanner konfiguriert. Stationsfotos bleiben gesperrt.');
function reply(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...securityHeaders,...headers});res.end(JSON.stringify(data))}
function malwareScanReply(res,error){
  const detected=error?.code==='MALWARE_FOUND';
  console.error('Bildprüfung abgebrochen:',error?.code||'unbekannter Fehler');
  return reply(res,detected?422:503,{error:detected?
    'Die Bilddatei wurde als Schadsoftware erkannt und abgewiesen.':
    'Bildprüfung ist nicht verfügbar. Die Bilddatei wurde nicht gespeichert.'});
}
async function body(req,maxBytes=16000){const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>maxBytes)throw Error('Anfrage zu groß');chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Error('Ungültiges JSON')}}
function limit(key,max=12,window=600000){return rateLimiter.erlauben(key,max,window)}
function safeText(v,n=200){return typeof v==='string'?v.trim().slice(0,n):''}
const MUSTER_AGB=`1. Buchung und Zahlung
Eine Buchungsanfrage ist zunächst unverbindlich. Ein Vertrag kommt erst mit der Bestätigung durch Klettern & Abenteuer zustande. Für Gruppenveranstaltungen wird eine Anzahlung in Höhe von 25 % vereinbart; die Zahlungsfrist steht in der Bestätigung. Der Restbetrag ist spätestens am Veranstaltungstag fällig.

2. Rücktritt durch den Kunden
Ein kostenfreier Rücktritt ist bis einschließlich zehn Kalendertage vor dem Veranstaltungstermin möglich. Bei einem späteren Rücktritt kann ein angemessener Ersatz des tatsächlich entstandenen Schadens verlangt werden. Ersparte Aufwendungen und eine anderweitige Besetzung des Termins werden angerechnet. Wird eine Pauschale vereinbart, darf der Kunde ausdrücklich nachweisen, dass kein oder ein wesentlich geringerer Schaden entstanden ist.

3. Nichterscheinen
Bei Nichterscheinen ohne rechtzeitige Absage kann ein Anspruch auf Ersatz des tatsächlich entstandenen Schadens entstehen. Die Anwesenheit des Trainers allein führt nicht automatisch zum Einbehalt des gesamten Veranstaltungspreises. Ersparte Aufwendungen, eine anderweitige Nutzung des Termins und ein Nachweis eines geringeren oder fehlenden Schadens werden berücksichtigt.

4. Absage durch den Veranstalter
Kann Klettern & Abenteuer die Veranstaltung nicht durchführen, werden bereits geleistete Zahlungen für die nicht erbrachte Leistung erstattet oder auf Wunsch auf einen Ersatztermin angerechnet.

5. Widerruf
Bei Freizeitdienstleistungen, für die ein konkreter Termin oder Zeitraum vereinbart wird, kann das gesetzliche Widerrufsrecht ausgeschlossen sein. Die Anwendbarkeit richtet sich nach dem jeweiligen Angebot; gesetzliche Rechte bleiben unberührt.`;
function rechnungsdatenVollstaendig(data){
  const r=data||{};
  return Boolean(r.firma&&r.name&&r.strasse&&r.plz&&r.ort&&r.email&&r.telefon&&
    (r.steuernummer||r.ustIdNr||r.steuerhinweis));
}
async function rechnungSichernUndVersenden(buchungId){
  const client=await pool.connect();let pdf,email,invoiceId,invoiceData;
  try{
    await client.query('BEGIN');
    const b=await client.query('SELECT id,data,status FROM brilon_buchungen WHERE id=$1 FOR UPDATE',[buchungId]);
    if(!b.rowCount){await client.query('ROLLBACK');return {status:'buchung_fehlt'};}
    const already=await client.query('SELECT id,rechnungsnummer,email_status FROM brilon_rechnungen WHERE buchung_id=$1',[buchungId]);
    if(already.rowCount){await client.query('COMMIT');return {status:already.rows[0].email_status, id:already.rows[0].id, nummer:already.rows[0].rechnungsnummer};}
    const settings=await client.query('SELECT data,naechste_nummer FROM brilon_rechnungsdaten WHERE id=1 FOR UPDATE');
    if(!settings.rowCount){await client.query('ROLLBACK');return {status:'rechnungsdaten_fehlen'};}
    const config=settings.rows[0].data||{};const booking=b.rows[0].data||{};
    if(booking.partnerhausAbwicklung===true){await client.query('ROLLBACK');return {status:'partnerhaus_abrechnung',hinweis:'Die Kundenrechnung wird vom Partnerhaus gestellt.'};}
    const payments=Array.isArray(booking.zahlungen)?booking.zahlungen:[];
    const total=Math.round(Number(booking.gesamtpreis||0)*100);
    if(total<=0||zahlungsstand(total,payments).offenCent>0){await client.query('ROLLBACK');return {status:'nicht_vollstaendig'};}
    if(!rechnungsdatenVollstaendig(config)){await client.query('ROLLBACK');return {status:'rechnungsdaten_unvollstaendig'};}
    const addr=booking.rechnungsadresse||{};
    if(addr.erforderlich===true&&(!addr.strasse||!addr.plz||!addr.ort)){
      await client.query('ROLLBACK');return {status:'rechnungsanschrift_unvollstaendig'};
    }
    const prefix=safeText(config.rechnungsPraefix,20)||'KA-';
    const year=heuteInBerlin().slice(0,4),sequence=Number(settings.rows[0].naechste_nummer)||1;
    const number=`${prefix}${year}-${String(sequence).padStart(4,'0')}`;
    const id=crypto.randomUUID(),lastPayment=payments[payments.length-1]||{};
    const methodNames={ueberweisung:'Überweisung',bar:'Barzahlung',karte:'Kartenzahlung',sonstiges:'Sonstige'};
    const rabattCent=Math.max(0,Number(booking.rabattCent)||Number(booking.anschlussRabattGesamtCent)||
      Number(booking.empfehlungRabattCent)||Number(booking.anschlussRabattCent)||0);
    const rabattBezeichnung=booking.rabattArt==='anschlussbuchung'||(!booking.rabattArt&&(booking.anschlussElternId||booking.anschlussRabatt10))
      ?'Anschlussrabatt (Ergänzungsbuchung)'
      :booking.rabattArt==='empfehlung'||booking.empfehlung?'Empfehlungsrabatt (Freunde werben)'
      :booking.anschlussRabattCent?'Anschlussrabatt (Ergänzungsbuchung)':'';
    invoiceData={
      nummer:number,rechnungsdatum:rechnungsDatumFormatieren(heuteInBerlin()),
      zahlungseingang:rechnungsDatumFormatieren(lastPayment.eingangsdatum||lastPayment.erhaltenAm),
      zahlungsarten:[...new Set(payments.map(p=>methodNames[p.methode]||p.methode).filter(Boolean))].join(', '),
      betragCent:total,
      grundpreisCent:total+rabattCent,
      rabattCent,rabattBezeichnung,
      empfehlungRabattCent:Math.max(0,Number(booking.empfehlungRabattCent)||0),
      empfehlungsWerbetext:safeText(config.empfehlungsText,300),
      aussteller:{firma:config.firma,name:config.name,strasse:config.strasse,plz:config.plz,ort:config.ort,
        email:config.email,telefon:config.telefon,steuernummer:config.steuernummer,ustIdNr:config.ustIdNr,
        steuerhinweis:config.steuerhinweis,bankname:config.bankname,iban:config.iban,bic:config.bic,rechnungshinweis:config.rechnungshinweis},
      kunde:{name:booking.name,firma:addr.firma,strasse:addr.strasse,plz:addr.plz,ort:addr.ort,
        email:booking.email,telefon:booking.telefon},
      buchung:{buchungsnummer:booking.buchungsnummer,angebot:booking.angebot,veranstaltungsort:booking.veranstaltungsort,
        datum:rechnungsDatumFormatieren(booking.datum),uhrzeit:booking.uhrzeit,teilnehmer:booking.teilnehmer}
    };
    pdf=erstelleRechnungsPdf(invoiceData);email=booking.email;invoiceId=id;
    await client.query('UPDATE brilon_rechnungsdaten SET naechste_nummer=$1,aktualisiert_am=NOW() WHERE id=1',[sequence+1]);
    await client.query(`INSERT INTO brilon_rechnungen(id,buchung_id,rechnungsnummer,data,pdf,email_status)
      VALUES($1,$2,$3,$4::jsonb,$5,'ausstehend')`,[id,buchungId,number,JSON.stringify(invoiceData),pdf]);
    booking.rechnung={id,nummer:number,status:'ausstehend',erstelltAm:new Date().toISOString()};
    await client.query('UPDATE brilon_buchungen SET data=$1::jsonb,updated_at=NOW() WHERE id=$2',[JSON.stringify(booking),buchungId]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  if(!email||!/^\S+@\S+\.\S+$/.test(email)){
    await pool.query("UPDATE brilon_rechnungen SET email_status='ohne_empfaenger' WHERE id=$1",[invoiceId]);
    return {status:'ohne_empfaenger',id:invoiceId};
  }
  try{
    await brevoMail(email,'Deine Rechnung – Klettern & Abenteuer Brilon',
      `Guten Tag,\n\nanbei erhältst du deine Rechnung ${invoiceData.nummer} als PDF. Der Zahlungseingang ist vollständig erfasst.\n\nViele Grüße\n${invoiceData.aussteller.firma}`,
      {idempotencyKey:invoiceId,attachments:[{name:`Rechnung-${invoiceData.nummer}.pdf`,content:pdf.toString('base64')}]});
    await pool.query("UPDATE brilon_rechnungen SET email_status='angenommen',versandt_am=NOW() WHERE id=$1",[invoiceId]);
    await pool.query("UPDATE brilon_buchungen SET data=jsonb_set(data,'{rechnung,status}',to_jsonb('angenommen'::text),true) WHERE id=$1",[buchungId]);
    return {status:'angenommen',id:invoiceId,nummer:invoiceData.nummer};
  }catch(error){
    const emailStatus=error?.uncertain?'unklar':'fehlgeschlagen';
    await pool.query('UPDATE brilon_rechnungen SET email_status=$1,email_fehler=$2 WHERE id=$3',[emailStatus,safeText(error.message,250),invoiceId]);
    await pool.query("UPDATE brilon_buchungen SET data=jsonb_set(data,'{rechnung,status}',to_jsonb($1::text),true) WHERE id=$2",[emailStatus,buchungId]);
    return {status:emailStatus,id:invoiceId,nummer:invoiceData.nummer};
  }
}
function gueltigesDatum(v){
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const datum=new Date(v+'T12:00:00Z');
  return !Number.isNaN(datum.getTime())&&datum.toISOString().slice(0,10)===v;
}
function gpsTokenHash(token){return crypto.createHash('sha256').update(String(token)).digest('hex')}
function anschlussZugang(id){
  const secret=process.env.BOOKING_OFFER_SECRET;
  if(!secret||secret.length<32)return null;
  try{return erzeugeZugang(id,secret)}catch{return null;}
}
function anschlussBuchung(token){
  return pruefeZugang(token,process.env.BOOKING_OFFER_SECRET);
}
function anschlussLink(id){
  const token=anschlussZugang(id),base=process.env.PUBLIC_BASE_URL;
  if(!token||!base)return null;
  try{
    const url=new URL('/anschluss.html',base);
    if(url.protocol!=='https:')return null;
    url.hash='zugang='+encodeURIComponent(token);
    return url.toString();
  }catch{return null;}
}
async function anschlussRabattElternAnwenden(client,zusatz,zusatzId){
  if(!zusatz.anschlussElternId||!zusatz.anschlussRabattAusstehend)return {angewendet:false};
  const q=await client.query('SELECT id,data,status FROM brilon_buchungen WHERE id=$1 FOR UPDATE',[zusatz.anschlussElternId]);
  if(!q.rowCount||q.rows[0].status!=='bestaetigt')return {ungueltig:true};
  const parent=q.rows[0],data=parent.data;
  if(!data.anschlussRabatt10){
    const aktuellCent=Math.round(Number(data.gesamtpreis)*100);
    const basisCent=Number.isSafeInteger(data.preisVorEmpfehlungsrabattCent)
      ?data.preisVorEmpfehlungsrabattCent:aktuellCent;
    const bisherigerRabattCent=Math.max(0,Number(data.rabattCent??data.empfehlungRabattCent)||0);
    const anschlussRabattGesamtCent=Math.max(bisherigerRabattCent,Math.round(basisCent*.1));
    const zielCent=Math.max(0,basisCent-anschlussRabattGesamtCent);
    const rabattCent=Math.max(0,aktuellCent-zielCent);
    const stand=preisNachAnschlussrabatt(aktuellCent,rabattCent,Array.isArray(data.zahlungen)?data.zahlungen:[]);
    data.anschlussRabattVorher={art:data.rabattArt|| (data.empfehlung?'empfehlung':null),
      cent:Number(data.rabattCent??data.empfehlungRabattCent)||0,basisCent:Number(data.rabattBasisCent)||basisCent};
    data.preisanpassungen=[...(Array.isArray(data.preisanpassungen)?data.preisanpassungen:[]),
      {grund:'Rabatte nicht addiert: maximal 10 % Anschlussrabatt nach bestätigter Zusatzbuchung',am:new Date().toISOString(),vonCent:aktuellCent,rabattCent,aufCent:stand.gesamtCent}];
    data.gesamtpreis=stand.gesamtCent/100;data.restbetrag=stand.offenCent/100;
    data.zahlungsgutschriftCent=stand.gutschriftCent;data.anschlussRabatt10=true;data.anschlussRabattCent=rabattCent;
    data.anschlussRabattGesamtCent=anschlussRabattGesamtCent;
    data.anschlussRabattBasisCent=aktuellCent;data.anschlussRabattQuelleId=zusatzId;
    if(anschlussRabattGesamtCent>bisherigerRabattCent)data.rabattArt='anschlussbuchung';
    data.rabattCent=anschlussRabattGesamtCent;data.rabattBasisCent=basisCent;
    const saved=await client.query('UPDATE brilon_buchungen SET data=$1::jsonb,updated_at=NOW() WHERE id=$2 RETURNING id,data',[JSON.stringify(data),parent.id]);
    zusatz.anschlussRabattAusstehend=false;
    return {angewendet:rabattCent>0,hoehererRabattBestand:rabattCent===0,buchung:saved.rows[0],rabattCent};
  }
  zusatz.anschlussRabattAusstehend=false;
  return {angewendet:false};
}
async function anschlussRabattElternZuruecknehmen(client,zusatz,zusatzId){
  if(!zusatz.anschlussElternId)return {zurueckgenommen:false};
  const siblings=await client.query(`SELECT COUNT(*)::integer AS anzahl FROM brilon_buchungen
    WHERE data->>'anschlussElternId'=$1 AND id<>$2 AND status='bestaetigt'`,[zusatz.anschlussElternId,zusatzId]);
  if(Number(siblings.rows[0].anzahl)>0)return {zurueckgenommen:false};
  const q=await client.query('SELECT id,data,status FROM brilon_buchungen WHERE id=$1 FOR UPDATE',[zusatz.anschlussElternId]);
  if(!q.rowCount||q.rows[0].status!=='bestaetigt')return {zurueckgenommen:false};
  const parent=q.rows[0],data=parent.data,basisCent=Number(data.anschlussRabattBasisCent);
  if(!data.anschlussRabattQuelleId||!Number.isSafeInteger(basisCent))return {zurueckgenommen:false};
  const aktuellCent=Math.round(Number(data.gesamtpreis)*100);
  const stand=preisBeiAnschlussstorno(aktuellCent,basisCent,Array.isArray(data.zahlungen)?data.zahlungen:[]);
  data.preisanpassungen=[...(Array.isArray(data.preisanpassungen)?data.preisanpassungen:[]),
    {grund:'Anschlussrabatt nach Storno der Zusatzbuchung zurückgenommen',am:new Date().toISOString(),
      vonCent:aktuellCent,aufCent:basisCent,rabattZurueckgenommenCent:basisCent-aktuellCent}];
  data.gesamtpreis=basisCent/100;data.restbetrag=stand.offenCent/100;
  data.zahlungsgutschriftCent=stand.gutschriftCent;data.anschlussRabatt10=false;
  data.anschlussRabattCent=0;delete data.anschlussRabattBasisCent;delete data.anschlussRabattQuelleId;
  delete data.anschlussRabattGesamtCent;
  if(data.anschlussRabattVorher){
    const vorher=data.anschlussRabattVorher;
    if(vorher.art)data.rabattArt=vorher.art;else delete data.rabattArt;
    if(vorher.cent)data.rabattCent=vorher.cent;else delete data.rabattCent;
    if(vorher.basisCent)data.rabattBasisCent=vorher.basisCent;else delete data.rabattBasisCent;
    delete data.anschlussRabattVorher;
  }else if(data.empfehlung){
    data.rabattArt='empfehlung';data.rabattCent=Number(data.empfehlungRabattCent)||0;
  }else{
    delete data.rabattArt;delete data.rabattCent;delete data.rabattBasisCent;
  }
  const saved=await client.query('UPDATE brilon_buchungen SET data=$1::jsonb,updated_at=NOW() WHERE id=$2 RETURNING id,data',
    [JSON.stringify(data),parent.id]);
  return {zurueckgenommen:true,buchung:saved.rows[0],stand};
}
async function session(req){
  const jetzt=Date.now();
  const match=(req.headers.cookie||'').match(/(?:^|;\s*)brilon_session=([a-f0-9]{64})/);
  const token=match?.[1];
  if(!token)return {valid:false};
  if(pool){
    try{
      if(++persistentSessionChecks%128===0)
        await pool.query('DELETE FROM brilon_admin_sessions WHERE expires_at<=NOW()');
      const hash=gpsTokenHash(token);
      const q=await pool.query('SELECT 1 FROM brilon_admin_sessions WHERE token_hash=$1 AND expires_at>NOW()',[hash]);
      if(q.rowCount)return {valid:true};
      const delegated=await pool.query(`SELECT 1 FROM brilon_pruef_admin_sessions s
        JOIN brilon_pruef_mitarbeitende m ON m.id=s.mitarbeiter_id
        WHERE s.token_hash=$1 AND s.ablauf>NOW() AND m.aktiv=true AND m.verwaltungszugang=true`,[hash]);
      return {valid:delegated.rowCount>0};
    }catch(error){
      if(error?.code==='42P01')return {valid:false};
      return {unavailable:true};
    }
  }
  if(++sessionChecks%128===0)abgelaufeneEintraegeEntfernen(sessions,jetzt);
  const exp=sessions.get(token);
  if(!exp)return {valid:false};
  if(exp<=jetzt){sessions.delete(token);return {valid:false};}
  return {valid:true};
}
function adminCsrfToken(token){
  return crypto.createHmac('sha256',token).update('brilon-admin-csrf-v1').digest('hex');
}
function adminCsrfValid(req){
  const sessionToken=(req.headers.cookie||'').match(/(?:^|;\s*)brilon_session=([a-f0-9]{64})/)?.[1];
  const supplied=req.headers['x-csrf-token'];
  if(!sessionToken||typeof supplied!=='string'||! /^[a-f0-9]{64}$/i.test(supplied))return false;
  return crypto.timingSafeEqual(Buffer.from(adminCsrfToken(sessionToken),'hex'),Buffer.from(supplied,'hex'));
}
async function admin(req,res){
  const auth=await session(req);
  if(auth.unavailable){reply(res,503,{error:'Admin-Sitzungsspeicher ist nicht verfügbar.'});return false;}
  if(!auth.valid){reply(res,401,{error:'Bitte anmelden.'});return false}
  if(!sameOriginMutation(req)){reply(res,403,{error:'Admin-Anfragen müssen von derselben Website stammen.'});return false}
  if(!['GET','HEAD','OPTIONS'].includes(String(req.method||'').toUpperCase())&&!adminCsrfValid(req)){
    reply(res,403,{error:'CSRF-Prüfung fehlgeschlagen. Bitte Verwaltung neu laden.'});return false;
  }
  return true;
}

// Ein Zeitfenster ist halb offen: Eine Buchung darf direkt nach der anderen beginnen.
function minuten(v){
  if(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))return null;
  const [h,m]=v.split(':').map(Number);
  return h*60+m;
}
function buchungsfenster(data){
  const n=Number(data.teilnehmer),start=minuten(data.uhrzeit);
  const gespeicherteDauer=Number(data.dauer);
  const dauer=Number.isInteger(gespeicherteDauer)&&gespeicherteDauer>0?gespeicherteDauer:
    buchungsdauerBerechnen(n,150);
  // Alte Buchungen ohne Startzeit oder individuelle Angebote belegen vorsichtshalber den ganzen Tag.
  return start===null||dauer===null?null:[start,start+dauer];
}
function ueberschneidung(a,b){
  return !a||!b||a[0]<b[1]&&b[0]<a[1];
}
async function pruefeBuchungskonflikt(client,datum,fenster,ausnahmeId=null,gleicheSitzung=null,standort=null){
  const formatMinuten=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
  const beginn=Array.isArray(fenster)?formatMinuten(fenster[0]):'00:00';
  const ende=Array.isArray(fenster)?formatMinuten(fenster[1]):'24:00';
  const sperrung=await client.query(
    `SELECT id FROM brilon_kalender
     WHERE typ='sperrzeit'
     AND datum <= $1::date
     AND COALESCE(enddatum,datum) >= $1::date
     AND (COALESCE(cardinality(standorte),0)=0 OR ($2::text IS NOT NULL AND $2=ANY(standorte)))
     AND (uhrzeit IS NULL OR endzeit IS NULL
       OR (uhrzeit < $4::time AND endzeit > $3::time))
     LIMIT 1`,[datum,standort,beginn,ende]
  );
  if(sperrung.rowCount)
    return 'Dieses Zeitfenster ist gesperrt. Bitte wähle eine andere Uhrzeit oder ein anderes Datum.';

  const q=await client.query(
    `SELECT id,data FROM brilon_buchungen
     WHERE data->>'datum'=$1
     AND COALESCE(status,'offen') IN ('offen','bestaetigt')
     AND ($2::uuid IS NULL OR id<>$2::uuid)
     AND ($3::text IS NULL OR data->>'veranstaltungsort'=$3 OR data->>'veranstaltungsort' IS NULL)`,
    [datum,ausnahmeId,standort]
  );
  if(q.rows.some(r=>{
    const same=gleicheSitzung&&r.data?.buchungsmodus==='einzelplatz'&&
      r.data?.angebot===gleicheSitzung.angebot&&r.data?.uhrzeit===gleicheSitzung.uhrzeit&&
      (!standort||r.data?.veranstaltungsort===standort);
    return !same&&ueberschneidung(fenster,buchungsfenster(r.data));
  }))
    return 'Dieser Zeitraum ist bereits reserviert. Bitte wähle eine andere Anfangszeit oder ein anderes Datum.';
  return null;
}
async function reservierungsTransaktion(aktion){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    // Gemeinsames Datenbank-Schloss gegen gleichzeitige Doppelreservierungen.
    await client.query('SELECT pg_advisory_xact_lock(7112026)');
    const ergebnis=await aktion(client);
    await client.query('COMMIT');
    return ergebnis;
  }catch(e){
    try{await client.query('ROLLBACK')}catch{}
    throw e;
  }finally{
    client.release();
  }
}

async function anschlussApi(req,res,url,route,ip){
  if(!pool)return reply(res,503,{error:'Anschlussangebote derzeit nicht verfügbar.'});
  if(['POST'].includes(req.method)&&['/api/anschlussangebote/vorschau','/api/anschlussangebote/buchen'].includes(route)&&!limit('add-on:'+ip,10))
    return reply(res,429,{error:'Bitte später erneut versuchen.'});
  const request=['/api/anschlussangebote/vorschau','/api/anschlussangebote/buchen'].includes(route)&&req.method==='POST'?await body(req):null;
  const token=request?.zugang;
  const parentId=anschlussBuchung(token);
  if(!parentId)return reply(res,401,{error:'Der Angebotslink ist ungültig oder abgelaufen.'});
  const parentQuery=await pool.query('SELECT id,status,data FROM brilon_buchungen WHERE id=$1',[parentId]);
  if(!parentQuery.rowCount||parentQuery.rows[0].status!=='bestaetigt')
    return reply(res,409,{error:'Anschlussangebote gibt es erst nach bestätigter Buchung.'});
  const parent=parentQuery.rows[0],base=parent.data,window=buchungsfenster(base);
  if(!window||!gueltigesDatum(base.datum)||base.datum<heuteInBerlin()){
    if(route==='/api/anschlussangebote/buchen')
      return reply(res,409,{error:'Für einen vergangenen oder ungültigen Buchungstag sind keine Anschlussbuchungen möglich.'});
    return reply(res,200,{datum:base.datum,teilnehmer:Number(base.teilnehmer)||0,programme:[]});
  }
  if(route==='/api/anschlussangebote/vorschau'&&req.method==='POST'){
    const [programs,bookings,blocked]=await Promise.all([
      pool.query(`SELECT id,name,beschreibung,dauer,preise,kapazitaet,verfuegbare_termine,veranstaltungsort,gruppenstufen,dauer_modus FROM brilon_angebote WHERE archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true ORDER BY sortierung,name`),
      pool.query(`SELECT id,data FROM brilon_buchungen WHERE data->>'datum'=$1 AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,[base.datum]),
      pool.query(`SELECT COALESCE(standorte,'{}'::text[]) AS standorte FROM brilon_kalender WHERE typ='sperrzeit' AND datum<=$1::date AND COALESCE(enddatum,datum)>=$1::date`,[base.datum])
    ]);
    const participants=Number(base.teilnehmer);
    if(!Number.isInteger(participants)||participants<1||participants>150)
      return reply(res,409,{error:'Die Gruppengröße der bestätigten Buchung ist ungültig.'});
    const occupied=bookings.rows.filter(b=>b.id!==parentId).map(b=>buchungsfenster(b.data));
    const suggestions=[];
    for(const p of programs.rows){
      if(blocked.rows.some(entry=>!entry.standorte.length||entry.standorte.includes(p.veranstaltungsort)))continue;
      if(p.name===base.angebot)continue;
      const dates=Array.isArray(p.verfuegbare_termine)?p.verfuegbare_termine:[];
      const price=preisFuerTeilnehmer(p.preise,participants,p.gruppenstufen),duration=buchungsdauerFuerProgramm(participants,p);
      if((dates.length&&!dates.includes(base.datum))||participants>Number(p.kapazitaet)||price===null||!Number.isInteger(duration)||duration<1)continue;
      const cap=await pool.query(`SELECT COALESCE(SUM(CASE WHEN data->>'teilnehmer' ~ '^[0-9]+$' THEN (data->>'teilnehmer')::integer ELSE 0 END),0) AS n FROM brilon_buchungen WHERE data->>'datum'=$1 AND data->>'angebot'=$2 AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,[base.datum,p.name]);
      if(Number(cap.rows[0].n)+participants>Number(p.kapazitaet))continue;
      const times=zugelasseneAnschlusszeiten(window[0],window[1],duration)
        .filter(t=>!occupied.some(w=>ueberschneidung([t.beginnMinuten,t.endeMinuten],w)))
        .map(t=>({...t,uhrzeit:String(Math.floor(t.beginnMinuten/60)).padStart(2,'0')+':00'}));
      if(times.length){const quote=anschlussPreis(price);suggestions.push({id:p.id,name:p.name,beschreibung:p.beschreibung,dauer:duration,
        originalCent:quote.originalCent,rabattCent:quote.rabattCent,endpreisCent:quote.endpreisCent,zeiten:times});}
    }
    return reply(res,200,{datum:base.datum,teilnehmer:participants,programme:suggestions});
  }
  if(route==='/api/anschlussangebote/buchen'&&req.method==='POST'){
    const d=request,requestParentId=anschlussBuchung(d?.zugang),programId=String(d?.programmId||''),time=safeText(d?.uhrzeit,5);
    if(requestParentId!==parentId||! /^[1-9]\d{0,17}$/.test(programId)||!/^([01]\d|2[0-3]):00$/.test(time))return reply(res,400,{error:'Anschlussauswahl ist ungültig.'});
    const result=await reservierungsTransaktion(async client=>{
      const q=await client.query('SELECT id,status,data FROM brilon_buchungen WHERE id=$1 FOR UPDATE',[parentId]);
      if(!q.rowCount||q.rows[0].status!=='bestaetigt')return {ungueltig:true};
      const original=q.rows[0].data,oldWindow=buchungsfenster(original),participants=Number(original.teilnehmer);
      const pQuery=await client.query(`SELECT id,name,beschreibung,dauer,preise,kapazitaet,verfuegbare_termine,gruppenstufen,dauer_modus FROM brilon_angebote WHERE id=$1 AND archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true`,[programId]);
      if(!pQuery.rowCount)return {programm:false};
      const p=pQuery.rows[0],duration=buchungsdauerFuerProgramm(participants,p),start=Number(time.slice(0,2))*60;
      if(!oldWindow||!gueltigesDatum(original.datum)||original.datum<heuteInBerlin()||!Number.isInteger(participants)||participants<1||participants>150||p.name===original.angebot||!Number.isInteger(duration)||participants>Number(p.kapazitaet)||
         !zugelasseneAnschlusszeiten(oldWindow[0],oldWindow[1],duration).some(t=>t.beginnMinuten===start&&t.endeMinuten<=1440))return {zeit:false};
      const dates=Array.isArray(p.verfuegbare_termine)?p.verfuegbare_termine:[];
      if(dates.length&&!dates.includes(original.datum))return {freigabe:false};
      const price=preisFuerTeilnehmer(p.preise,participants,p.gruppenstufen);if(price===null)return {preis:false};
      const duplicate=await client.query(`SELECT 1 FROM brilon_buchungen WHERE data->>'anschlussElternId'=$1
        AND data->>'angebot'=$2 AND data->>'uhrzeit'=$3 AND COALESCE(status,'offen') NOT IN ('abgelehnt','storniert') LIMIT 1`,
        [parentId,p.name,time]);
      if(duplicate.rowCount)return {duplikat:true};
      const cap=await client.query(`SELECT COALESCE(SUM(CASE WHEN data->>'teilnehmer' ~ '^[0-9]+$' THEN (data->>'teilnehmer')::integer ELSE 0 END),0) AS n FROM brilon_buchungen WHERE data->>'datum'=$1 AND data->>'angebot'=$2 AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,[original.datum,p.name]);
      if(Number(cap.rows[0].n)+participants>Number(p.kapazitaet))return {kapazität:false};
      const conflict=await pruefeBuchungskonflikt(client,original.datum,[start,start+duration],parentId,null,original.veranstaltungsort);if(conflict)return {konflikt:conflict};
      const quote=anschlussPreis(price),id=crypto.randomUUID(),first=safeText(original.vorname,80),last=safeText(original.nachname,80);
      const baseRef=buchungsreferenz(last,first,original.datum),refs=await client.query('SELECT buchungsnummer FROM brilon_buchungen WHERE buchungsnummer=$1 OR buchungsnummer LIKE $2',[baseRef,baseRef+'-%']);
      const used=new Set(refs.rows.map(r=>r.buchungsnummer));let serial=1,reference=baseRef;while(used.has(reference)){serial++;reference=buchungsreferenz(last,first,original.datum,serial);}
      const data={...original,angebot:p.name,uhrzeit:time,dauer:duration,gesamtpreis:quote.endpreisCent/100,
        anzahlung:Math.round(quote.endpreisCent*0.25)/100,restbetrag:Math.round(quote.endpreisCent*0.75)/100,
        zahlungen:[],zahlungsgutschriftCent:0,buchungsnummer:reference,anschlussElternId:parentId,anschlussRabatt10:true,
        anschlussRabattCent:quote.rabattCent,anschlussRabattGesamtCent:quote.rabattCent,
        anschlussRabattAusstehend:!original.anschlussRabatt10,
        rabattArt:'anschlussbuchung',rabattCent:quote.rabattCent,rabattBasisCent:price,
        preisOhneAnschlussRabattCent:price,preisanpassungen:[{grund:'10 % Anschlussrabatt auf Zusatzprogramm',am:new Date().toISOString(),vonCent:price,rabattCent:quote.rabattCent,aufCent:quote.endpreisCent}]};
      delete data.empfehlung;delete data.empfehlungRabattCent;delete data.preisVorEmpfehlungsrabattCent;
      delete data.anschlussRabattVorher;
      const saved=await client.query(`INSERT INTO brilon_buchungen(id,data,status,buchungsnummer) VALUES($1,$2::jsonb,'offen',$3) RETURNING id,data`,[id,JSON.stringify(data),reference]);
      return {buchung:saved.rows[0],quote,programm:p.name};
    });
    if(result.ungueltig)return reply(res,409,{error:'Die Buchung ist nicht mehr gültig.'});
    if(result.programm===false)return reply(res,409,{error:'Dieses Programm ist nicht mehr buchbar.'});
    if(result.zeit===false)return reply(res,409,{error:'Zeit, Kapazität oder Anschluss passen nicht mehr.'});
    if(result.freigabe===false)return reply(res,409,{error:'Das Programm ist an diesem Tag nicht freigegeben.'});
    if(result.preis===false)return reply(res,409,{error:'Für diese Gruppengröße fehlt ein Preis.'});
    if(result.duplikat)return reply(res,409,{error:'Diese Anschlussbuchung wurde bereits angefragt.'});
    if(result.kapazität===false)return reply(res,409,{error:'Die Kapazität ist inzwischen ausgeschöpft.'});
    if(result.konflikt)return reply(res,409,{error:result.konflikt});
    const data=result.buchung.data,details=`Neue Buchungsnummer: ${data.buchungsnummer}\nProgramm: ${result.programm}\nDatum: ${data.datum}\nBeginn: ${data.uhrzeit} Uhr\nPreis nach 10 % Anschlussrabatt: ${(result.quote.endpreisCent/100).toFixed(2).replace('.',',')} €`;
    const mails=[brevoMail(data.email,'Deine Anschlussanfrage – Klettern & Abenteuer Brilon',`Hallo ${data.name},\n\n${details}\n\nDie Anfrage ist eingegangen und noch nicht verbindlich bestätigt. Der Rabatt auf das bereits bestätigte Programm wird nach Bestätigung dieser Zusatzbuchung berücksichtigt.\n\nGut Seil!\nKlettern & Abenteuer Brilon`)];
    if(process.env.BOOKING_NOTIFY_EMAIL)mails.push(brevoMail(process.env.BOOKING_NOTIFY_EMAIL,'Neue Anschlussbuchung',details+`\n\nKunde: ${data.name} · ${data.email}`));
    Promise.allSettled(mails).then(results=>results.forEach(r=>{if(r.status==='rejected')console.error('Anschlussbuchungs-E-Mail konnte nicht versendet werden.');}));
    return reply(res,201,{success:true,buchungsnummer:data.buchungsnummer,gesamtpreis:data.gesamtpreis,rabattCent:result.quote.rabattCent});
  }
  return reply(res,404,{error:'Nicht gefunden.'});
}

const pruefungApi=createPruefungApi({pool,admin,reply,body,sameOriginMutation,limit,brevoMail,scanForMalware});
const kundenService=createKundenbestaetigungService({pool,brevoMail});
const einsatzplanungApi=createEinsatzplanungApi({pool,admin,staffSession:pruefungApi.staffSession,reply,body,sameOriginMutation,brevoMail,kundenService});
const netzwerkpartnerApi=createNetzwerkpartnerApi({pool,admin,reply,body,sameOriginMutation,limit,brevoMail});
const kundenfeedbackApi=createKundenfeedbackApi({pool,admin,reply,body,sameOriginMutation,limit,brevoMail});
const spontangruppenApi=createSpontanGruppenApi({pool,admin,staffSession:pruefungApi.staffSession,reply,body,sameOriginMutation,limit,brevoMail});

const marketingCampaignApi=createMarketingCampaignApi({pool,admin,reply,body});
const wissensportalApi=createWissensportalApi({pool,admin,staffSession:pruefungApi.staffSession,reply,body,sameOriginMutation});
const socialLinksApi=createSocialLinksApi({pool,admin,reply,body});
async function main(req,res){
  const u=new URL(req.url,'http://localhost'),
        route=decodeURIComponent(u.pathname),
        ip=req.socket.remoteAddress||'unknown';
  try{
    if(await socialLinksApi(req,res,route))return;
    if(route==='/api/empfehlung/bestaetigen'&&req.method==='GET'){
      const token=String(u.searchParams.get('token')||'');
      if(!/^[a-f0-9]{64}$/.test(token))return reply(res,400,{error:'Der Bestätigungslink ist ungültig.'});
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      return res.end(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Empfehlung bestätigen</title><body style="font:16px system-ui,sans-serif;max-width:640px;margin:10vh auto;padding:24px;color:#173f34;background:#f3f5f3"><main style="background:white;padding:32px;border-radius:16px"><h1>Empfehlung bestätigen</h1><p>Bitte bestätige, dass du die Empfehlung für die neue Buchungsanfrage ausgesprochen hast.</p><form method="post" action="/api/empfehlung/bestaetigen?token=${token}"><button style="background:#173f34;color:white;border:0;border-radius:8px;padding:12px 18px;font:inherit;cursor:pointer">Empfehlung jetzt bestätigen</button></form></main></body></html>`);
    }
    if(route==='/api/empfehlung/bestaetigen'&&req.method==='POST'){
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      if(!sameOriginMutation(req))return reply(res,403,{error:'Anfrage abgelehnt.'});
      const token=String(u.searchParams.get('token')||'');
      if(!/^[a-f0-9]{64}$/.test(token))return reply(res,400,{error:'Der Bestätigungslink ist ungültig.'});
      const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
      const result=await reservierungsTransaktion(async client=>{
        const q=await client.query(`SELECT id,data,status,buchungsnummer FROM brilon_buchungen
          WHERE data->'empfehlung'->>'bestaetigungsTokenHash'=$1 FOR UPDATE`,[tokenHash]);
        if(!q.rowCount)return {ungueltig:true};
        const booking=q.rows[0],data=booking.data,ref=data.empfehlung;
        if(ref.bestaetigtAm)return {bereitsBestaetigt:true};
        if(!ref.bestaetigungsTokenAblauf||Date.parse(ref.bestaetigungsTokenAblauf)<Date.now())return {abgelaufen:true};
        ref.bestaetigtAm=new Date().toISOString();
        delete ref.bestaetigungsTokenHash;delete ref.bestaetigungsTokenAblauf;
        await client.query('UPDATE brilon_buchungen SET data=$1::jsonb,updated_at=NOW() WHERE id=$2',[JSON.stringify(data),booking.id]);
        return {bestaetigt:true,buchungsnummer:booking.buchungsnummer||data.buchungsnummer,ref};
      });
      if(result.ungueltig||result.abgelaufen)
        return reply(res,result.abgelaufen?410:404,{error:result.abgelaufen?'Der Bestätigungslink ist abgelaufen.':'Der Bestätigungslink ist ungültig.'});
      if(result.bestaetigt&&process.env.BOOKING_NOTIFY_EMAIL)
        brevoMail(process.env.BOOKING_NOTIFY_EMAIL,'Empfehlung bestätigt – Buchung '+(result.buchungsnummer||''),
          `Die empfehlende Person hat die Empfehlung per E-Mail bestätigt.\n\nNeue Buchung: ${result.buchungsnummer||''}\nEmpfehlungsgeber: ${result.ref.email}\nNachweis: ${result.ref.buchungsnummer||''} · ${result.ref.programm||''} am ${result.ref.veranstaltungsdatum||''}\nBestätigt am: ${new Date(result.ref.bestaetigtAm).toLocaleString('de-DE',{timeZone:'Europe/Berlin'})}`).catch(()=>{});
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      return res.end(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Empfehlung bestätigt</title><body style="font:16px system-ui,sans-serif;max-width:640px;margin:10vh auto;padding:24px;color:#173f34;background:#f3f5f3"><main style="background:white;padding:32px;border-radius:16px"><h1>Empfehlung bestätigt</h1><p>${result.bereitsBestaetigt?'Diese Empfehlung wurde bereits bestätigt.':'Danke. Deine Empfehlung wurde bestätigt. Die Verwaltung wurde informiert und kann die Buchungsanfrage jetzt bearbeiten.'}</p><a href="/">Zur Website</a></main></body></html>`);
    }
    if(route.startsWith('/api/wissensportal')||route.startsWith('/api/admin/wissensportal'))
      return await wissensportalApi(req,res,u,route);
    if(route.startsWith('/api/admin/einsatzplanung')||route.startsWith('/api/pruefung/einsatzplanung'))
      return await einsatzplanungApi(req,res,u,route);
    if(route.startsWith('/api/admin/marketing/kampagnen'))return await marketingCampaignApi(req,res,route);
    if(route.startsWith('/api/pruefung/')||route.startsWith('/api/admin/pruefung/'))
      return await pruefungApi(req,res,u,route,ip);
    if(route.startsWith('/api/spontangruppen/'))return await spontangruppenApi(req,res,u,route,ip);
    if(route.startsWith('/api/netzwerkpartner/')||route.startsWith('/api/admin/netzwerkpartner/'))
      return await netzwerkpartnerApi(req,res,u,route,ip);
    if(route==='/api/kundenfeedback'||route==='/api/admin/kundenfeedback')
      return await kundenfeedbackApi(req,res,u,route,ip);
    if(route==='/api/anschlussangebote/vorschau'||route==='/api/anschlussangebote/buchen')
      return await anschlussApi(req,res,u,route,ip);
    if(route==='/api/website-effekte'&&req.method==='GET'){
      if(!pool)return reply(res,200,{aktiv:false,aktiveId:null,eintraege:[]});
      try{
        if((await pool.query("SELECT to_regclass('public.brilon_website_effekte') AS vorhanden")).rows[0]?.vorhanden===null)
          return reply(res,200,{aktiv:false,aktiveId:null,eintraege:[]});
        const q=await pool.query('SELECT daten FROM brilon_website_effekte WHERE id=1');
        return reply(res,200,q.rows[0]?.daten||{aktiv:false,aktiveId:null,eintraege:[]});
      }catch(error){console.error('Öffentliche Website-Effekte:',error.message);return reply(res,200,{aktiv:false,aktiveId:null,eintraege:[]});}
    }
    if(route==='/api/feedback/statistik'&&req.method==='GET'){
      if(!pool)return reply(res,503,{error:'Feedback ist derzeit nicht verfügbar.'});
      const q=await pool.query(`SELECT COUNT(*)::int AS anzahl,
          ROUND(AVG(NULLIF(f.value->>'programm','')::numeric),1) AS programm,
          ROUND(AVG(NULLIF(f.value->>'mitarbeiter','')::numeric),1) AS mitarbeiter,
          ROUND(AVG(NULLIF(f.value->>'sicherheit','')::numeric),1) AS sicherheit
        FROM brilon_buchungen b CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(b.data->'feedback')='array' THEN b.data->'feedback' ELSE '[]'::jsonb END
        ) AS f(value)`);
      const row=q.rows[0],anzahl=Number(row.anzahl||0);
      return reply(res,200,{anzahl:anzahl>=3?anzahl:0,
        mittelwerte:anzahl>=3?{programm:Number(row.programm),mitarbeiter:Number(row.mitarbeiter),sicherheit:Number(row.sicherheit)}:null});
    }
    if(route==='/api/feedback'&&req.method==='POST'){
      if(!pool)return reply(res,503,{error:'Feedback ist derzeit nicht verfügbar.'});
      if(!limit('feedback:'+ip,8,3600000))return reply(res,429,{error:'Bitte später erneut versuchen.'});
      if(!sameOriginMutation(req))return reply(res,403,{error:'Anfrage abgelehnt.'});
      const d=await body(req),nummer=safeText(d?.kundennummer,40).toUpperCase();
      const rating=value=>Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=5;
      const vorschlaege=safeText(d?.vorschlaege,1500),ideen=safeText(d?.ideen,1500);
      if(!/^[A-Z0-9-]{5,40}$/.test(nummer)||!rating(d?.programm)||!rating(d?.mitarbeiter)||!rating(d?.sicherheit)||
         vorschlaege.length<3||ideen.length<3)
        return reply(res,400,{error:'Bitte Kundennummer, alle Bewertungen und beide Freitextfelder ausfüllen.'});
      const client=await pool.connect();let feedback,email,name;
      try{
        await client.query('BEGIN');
        const q=await client.query(`SELECT id,buchungsnummer,data,status FROM brilon_buchungen
          WHERE UPPER(COALESCE(buchungsnummer,data->>'buchungsnummer',''))=$1
            AND COALESCE(data->>'datum','') < to_char(NOW() AT TIME ZONE 'Europe/Berlin','YYYY-MM-DD')
            AND status='bestaetigt'
          FOR UPDATE`,[nummer]);
        if(!q.rowCount){await client.query('ROLLBACK');return reply(res,404,{error:'Zu dieser Kundennummer wurde kein abgeschlossenes Programm gefunden.'});}
        const booking=q.rows[0],data=booking.data||{},history=Array.isArray(data.feedback)?data.feedback:[];
        if(history.length){await client.query('ROLLBACK');return reply(res,409,{error:'Für diese Kundennummer wurde bereits Feedback abgegeben.'});}
        email=safeText(data.email,180).toLowerCase();name=safeText(data.name,160)||'Kunde';
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
          await client.query('ROLLBACK');return reply(res,409,{error:'Für diese Buchung ist keine gültige E-Mail-Adresse hinterlegt. Bitte melde dich direkt bei uns.'});
        }
        feedback={id:crypto.randomUUID(),abgegebenAm:new Date().toISOString(),
          programm:Number(d.programm),mitarbeiter:Number(d.mitarbeiter),sicherheit:Number(d.sicherheit),
          programmName:safeText(data.angebot,120)||'Programm',vorschlaege,ideen,
          status:'gespeichert',emailVersand:'ausstehend'};
        data.feedback=[feedback];
        await client.query('UPDATE brilon_buchungen SET data=$1::jsonb,updated_at=NOW() WHERE id=$2',[JSON.stringify(data),booking.id]);
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
      let emailVersand='angenommen';
      try{
        await brevoMail(email,'Dein Feedback – Klettern & Abenteuer',
          `Hallo ${name},\n\nDanke für dein Feedback zum Programm „${feedback.programmName}“.\n\nDeine Rückmeldung:\nProgramm: ${feedback.programm}/5\nMitarbeiter: ${feedback.mitarbeiter}/5\nSicherheit: ${feedback.sicherheit}/5\n\nVeränderungsvorschläge: ${feedback.vorschlaege}\nZusätzliche Ideen: ${feedback.ideen}\n\nDein Feedback wird nur intern ausgewertet.\n\nViele Grüße\nKlettern & Abenteuer`);
      }catch(error){emailVersand=error?.uncertain?'unklar':'fehlgeschlagen';}
      await pool.query(`UPDATE brilon_buchungen SET data=jsonb_set(data,'{feedback,0,emailVersand}',to_jsonb($1::text),true),updated_at=NOW()
        WHERE data->'feedback'->0->>'id'=$2`,[emailVersand,feedback.id]);
      return reply(res,201,{success:true,emailVersand,
        message:emailVersand==='angenommen'?'Danke! Dein Feedback wurde gespeichert. Der Versanddienst hat die Bestätigungs-E-Mail angenommen; die Zustellung ist damit nicht bestätigt.':'Danke! Dein Feedback wurde gespeichert. Der Versand der Bestätigungs-E-Mail konnte nicht bestätigt werden.'});
    }
    if(route==='/api/buchungen'&&req.method==='POST'){
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      if(!limit('booking:'+ip,6))return reply(res,429,{error:'Bitte später erneut versuchen.'});
      const d=await body(req);
      if(d.website)return reply(res,201,{success:true});
      let agbData;
      try{
        const q=await pool.query("SELECT data->>'agbText' AS text,data->>'agbAktiv' AS aktiv,data->>'agbVersion' AS version FROM brilon_rechnungsdaten WHERE id=1");
        agbData=q.rows[0];
      }catch{return reply(res,503,{error:'Geschäftsbedingungen sind noch nicht eingerichtet.'});}
      if(!agbData||agbData.aktiv!=='true'||d.agbBestaetigt!=='on')
        return reply(res,400,{error:'Bitte die aktuell veröffentlichten Geschäftsbedingungen bestätigen.'});
      if(String(d.agbVersion)!==String(agbData.version))
        return reply(res,409,{error:'Die Geschäftsbedingungen wurden aktualisiert. Bitte lade die Seite neu und bestätige die aktuelle Fassung.'});

      const vorname=safeText(d.vorname,80),
            nachname=safeText(d.nachname,80),
            name=(vorname+' '+nachname).trim(),
            email=safeText(d.email,180),
            datum=safeText(d.datum,10),
            angebot=safeText(d.angebot,120),
            angefragterStandort=safeText(d.veranstaltungsort,80),
            teilnehmer=Number(d.teilnehmer);
      const vorhandeneRechnungsadresse=['rechnungsFirma','rechnungsStrasse','rechnungsPlz','rechnungsOrt']
        .some(key=>Boolean(safeText(d[key],key==='rechnungsStrasse'?180:key==='rechnungsPlz'?12:key==='rechnungsOrt'?120:160)));
      const rechnungsadresseErforderlich=d.rechnungsadresseErforderlich==='on'||
        (!Object.prototype.hasOwnProperty.call(d,'rechnungsadresseErforderlich')&&vorhandeneRechnungsadresse);
      const rechnungsadresse={erforderlich:rechnungsadresseErforderlich,
        firma:safeText(d.rechnungsFirma,160),strasse:safeText(d.rechnungsStrasse,180),
        plz:safeText(d.rechnungsPlz,12),ort:safeText(d.rechnungsOrt,120)};
      const empfehlungAngefordert=d.empfehlungBestaetigt==='on';
      const empfehlungsgeberEmail=safeText(d.empfehlungsgeberEmail,180).toLowerCase();
      if(empfehlungAngefordert&&!/^\S+@\S+\.\S+$/.test(empfehlungsgeberEmail))
        return reply(res,400,{error:'Bitte die E-Mail-Adresse des Empfehlers korrekt eingeben.'});

      if(!vorname||!nachname||!/^\S+@\S+\.\S+$/.test(email)||
         (!gueltigesDatum(datum)||datum<heuteInBerlin())||
         !angebot||!Number.isInteger(teilnehmer)||
         teilnehmer<1||teilnehmer>150||d.datenschutz!=='on'||
         (rechnungsadresseErforderlich&&(!rechnungsadresse.strasse||!rechnungsadresse.plz||!rechnungsadresse.ort)))
        return reply(res,400,{error:'Bitte Pflichtfelder korrekt ausfüllen.'});

      let gesamtpreis = null;
      const preisAbfrage = await pool.query(
        `SELECT id,preise,kapazitaet,verfuegbare_termine,buchbar,veroeffentlicht,
                veranstaltungsort,veranstaltungsorte,buchungsmodus,mindestteilnehmer,preis_pro_person,dauer,gruppenstufen,dauer_modus
         FROM brilon_angebote
         WHERE name = $1 AND archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true
         LIMIT 1`,[angebot]
      );
      if(!preisAbfrage.rows.length)return reply(res,409,{error:'Dieses Programm ist derzeit nicht buchbar.'});
      const programm=preisAbfrage.rows[0];
      const erlaubteProgrammStandorte=Array.isArray(programm.veranstaltungsorte)&&programm.veranstaltungsorte.length
        ?programm.veranstaltungsorte:[programm.veranstaltungsort].filter(Boolean);
      const bookingSite=angefragterStandort||programm.veranstaltungsort;
      if(!erlaubteProgrammStandorte.includes(bookingSite))
        return reply(res,409,{error:'Dieses Programm ist für den ausgewählten Standort nicht freigegeben.'});
      const locationSettings=await pool.query(`SELECT partnerhaus,partnerkontakt_name,partnerkontakt_email
        FROM brilon_orte WHERE name=$1 AND aktiv=true LIMIT 1`,[bookingSite]);
      if(!locationSettings.rowCount)return reply(res,409,{error:'Dieser Standort ist derzeit nicht aktiv.'});
      const partnerhausEinstellung=locationSettings.rows[0];
      const einzelplatz=programm.buchungsmodus==='einzelplatz';
      if(einzelplatz&&teilnehmer!==1)return reply(res,400,{error:'Für dieses Angebot kannst du nur einen Einzelplatz pro Anmeldung reservieren.'});
      const dauerWunsch=d.programmdauer===undefined||d.programmdauer===null||d.programmdauer===''?
        null:Number(d.programmdauer);
      if(dauerWunsch!==null&&(!Number.isInteger(dauerWunsch)||dauerWunsch<15||dauerWunsch>1440))
        return reply(res,400,{error:'Die gewählte Programmdauer ist ungültig.'});
      const buchungsdauer=buchungsdauerFuerProgramm(teilnehmer,programm,dauerWunsch);
      if(!buchungsdauer)
        return reply(res,409,{error:'Bitte für diese Teilnehmerzahl eine angebotene Programmdauer auswählen.'});
      const verfuegbareTermine=Array.isArray(programm.verfuegbare_termine)?programm.verfuegbare_termine:[];
      if(verfuegbareTermine.length&&!verfuegbareTermine.includes(datum))
        return reply(res,409,{error:'Für dieses Programm ist an dem Datum kein Termin freigegeben.'});
      const sonderaktionId=safeText(d.sonderaktion_id,36);let exactAction=null;
      if(sonderaktionId){
        const action=await pool.query('SELECT data FROM brilon_aktionen WHERE id=$1',[sonderaktionId]);
        const special=action.rows[0]?.data||{};
        if(!aktionAmStandortFreigegeben(special,bookingSite))
          return reply(res,409,{error:'Diese Sonderaktion ist für den ausgewählten Standort nicht freigegeben.'});
        const fixed=Boolean(special.uhrzeit&&special.endzeit&&special.veranstaltungsort&&special.programm_id);
        if(fixed)exactAction=special;
        if(fixed&&(String(special.programm_id)!==String(programm.id)||special.datum!==datum||
          special.uhrzeit!==safeText(d.uhrzeit,5)||special.veranstaltungsort!==bookingSite||
          Number(special.teilnehmer)!==teilnehmer))
          return reply(res,409,{error:'Dieser Anschlusstermin ist fest an Programm, Standort, Gruppengröße und Uhrzeit gebunden.'});
      }
      if(teilnehmer>Number(programm.kapazitaet))return reply(res,409,{error:'Die Gruppengröße überschreitet die maximale Kapazität.'});
      const einzelpreisCent=Number.isFinite(Number(programm.preis_pro_person))
        ?Math.round(Number(programm.preis_pro_person)*100):null;
      const preisCent=einzelplatz
        ?(einzelpreisCent>0?einzelpreisCent:null)
        :preisFuerTeilnehmer(programm.preise,teilnehmer,programm.gruppenstufen,dauerWunsch);
      if(preisCent===null)return reply(res,409,{error:'Für diese Teilnehmerzahl ist kein Preis hinterlegt.'});
      gesamtpreis=preisCent/100;
      const istGast=d.istGast===undefined?'nein':d.istGast;
      const gastEinrichtung=safeText(d.gastEinrichtung,120);
      if(!['ja','nein'].includes(istGast)||(istGast==='ja'&&!gastEinrichtung))
        return reply(res,400,{error:'Bitte Gästeangabe und gegebenenfalls die Unterkunft angeben.'});
      const data={
       ...(partnerhausEinstellung.partnerhaus?{partnerhausAbwicklung:true,
         partnerhausKontaktName:partnerhausEinstellung.partnerkontakt_name||'',
         partnerhausKontaktEmail:partnerhausEinstellung.partnerkontakt_email}:{}),
       istGast,gastEinrichtung:istGast==='ja'?gastEinrichtung:null,
       gaesteRabattStatus:istGast==='ja'?'pruefung_offen':'nicht_beantragt',
       name,vorname,nachname,email,datum,angebot,programmId:String(programm.id),veranstaltungsort:bookingSite,teilnehmer,rechnungsadresse,
gesamtpreis,
anzahlung: einzelplatz ? 0 : Math.round(gesamtpreis * 25) / 100,
restbetrag: einzelplatz ? gesamtpreis : Math.round(gesamtpreis * 75) / 100,
buchungsmodus: einzelplatz?'einzelplatz':'gruppe',
mindestteilnehmer: einzelplatz?Number(programm.mindestteilnehmer)||5:null,
        uhrzeit:safeText(d.uhrzeit,5),
        telefon:safeText(d.telefon,40),
       nachricht:safeText(d.nachricht,2000),sonderaktion_id:safeText(d.sonderaktion_id,36)||null,
       dauer:buchungsdauer,programmdauer:buchungsdauer,
       datenschutz:'on',datenschutzBestaetigtAm:new Date().toISOString(),
       datenschutzTextVersion:BUCHUNGS_DATENSCHUTZ_VERSION,
       agbBestaetigtAm:new Date().toISOString(),agbTextVersion:Number(agbData.version),agbTextSnapshot:agbData.text
      };

      const validFixedTime=exactAction&&data.uhrzeit===exactAction.uhrzeit&&
        /^([01]\d|2[0-3]):([0-5]\d)$/.test(data.uhrzeit);
      if(!validFixedTime&&!/^(09|1[0-9]):00$/.test(data.uhrzeit))
        return reply(res,400,{
          error:'Bitte eine gültige Anfangszeit zwischen 09:00 und 19:00 Uhr auswählen.'
        });

      const fenster=buchungsfenster(data);
      if(!fenster||fenster[1]>1440)return reply(res,400,{error:'Die Programmdauer passt nicht in den gewählten Veranstaltungstag.'});
      const empfehlungsBestaetigungstoken=empfehlungAngefordert?crypto.randomBytes(32).toString('hex'):null;
      const ergebnis=await reservierungsTransaktion(async client=>{
        if(empfehlungAngefordert){
          if(empfehlungsgeberEmail===email.toLowerCase())return {empfehlungsgeberSelbst:true};
          const configQuery=await client.query('SELECT data FROM brilon_rechnungsdaten WHERE id=1 FOR SHARE');
          const config=configQuery.rows[0]?.data||{};
          const value=Number(String(config.empfehlungRabattWert||'').replace(',','.'));
          if(config.empfehlungAktiv!==true||!Number.isFinite(value)||value<=0||!['prozent','festbetrag'].includes(config.empfehlungRabattArt))
            return {empfehlungsaktionInaktiv:true};
          const referrer=await client.query(`SELECT id,buchungsnummer,data FROM brilon_buchungen
            WHERE lower(COALESCE(data->>'email',''))=lower($1) AND status='bestaetigt'
              AND data->>'programmStattgefunden'='true'
              AND COALESCE(data->>'datum','')<$2 ORDER BY data->>'datum' DESC LIMIT 1`,
            [empfehlungsgeberEmail,heuteInBerlin()]);
          if(!referrer.rowCount)return {empfehlungNichtVerifiziert:true};
          const basisRabattCent=config.empfehlungRabattArt==='prozent'
            ?Math.round(preisCent*value/100):Math.round(value*100);
          const rabattCent=Math.max(0,Math.min(preisCent-1,basisRabattCent));
          if(rabattCent<=0)return {empfehlungsaktionInaktiv:true};
          data.preisVorEmpfehlungsrabattCent=preisCent;
          data.empfehlungRabattCent=rabattCent;
          data.empfehlung={email:empfehlungsgeberEmail,buchungId:referrer.rows[0].id,
            buchungsnummer:referrer.rows[0].buchungsnummer||null,
            name:referrer.rows[0].data?.name||null,
            programm:referrer.rows[0].data?.angebot||null,
            veranstaltungsdatum:referrer.rows[0].data?.datum||null,
            stattgefundenAm:referrer.rows[0].data?.programmStattgefundenAm||null,
            bestaetigtAm:null,
            bestaetigungsTokenHash:crypto.createHash('sha256').update(empfehlungsBestaetigungstoken).digest('hex'),
            bestaetigungsTokenAblauf:new Date(Date.now()+24*60*60*1000).toISOString()};
          data.rabattArt='empfehlung';data.rabattCent=rabattCent;data.rabattBasisCent=preisCent;
          data.gesamtpreis=(preisCent-rabattCent)/100;
          data.anzahlung=einzelplatz?0:Math.round((preisCent-rabattCent)*0.25)/100;
          data.restbetrag=einzelplatz?data.gesamtpreis:Math.round((preisCent-rabattCent)*0.75)/100;
        }
        const vergangeneBuchung=await client.query(`SELECT 1 FROM brilon_buchungen
          WHERE lower(COALESCE(data->>'email',''))=lower($1)
            AND status='bestaetigt' AND COALESCE(data->>'datum','')<$2 LIMIT 1`,[email,heuteInBerlin()]);
        const wiederkehrenderKunde=vergangeneBuchung.rowCount>0;
        data.wiederkehrenderKundeHinweis=wiederkehrenderKunde;
        if(wiederkehrenderKunde)data.wiedererkanntAm=new Date().toISOString();
        // Gruppenangebote können zeitlich nacheinander ohne Tageslimit gebucht werden.
        // Bei Einzelplatzbuchungen zählt nur dieselbe konkrete Sitzung am selben Standort.
        if(einzelplatz){
          const kapazitaet=await client.query(
            `SELECT COALESCE(SUM(CASE WHEN jsonb_typeof(data->'teilnehmer')='number' THEN
              (data->>'teilnehmer')::integer ELSE 0 END),0) AS gebucht
             FROM brilon_buchungen WHERE data->>'datum'=$1 AND data->>'angebot'=$2
               AND data->>'uhrzeit'=$3 AND data->>'veranstaltungsort'=$4
               AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,
            [datum,angebot,data.uhrzeit,bookingSite]
          );
          if(Number(kapazitaet.rows[0].gebucht)+teilnehmer>Number(programm.kapazitaet))
            return {konflikt:'Die Kapazität für diesen Einzelplatztermin ist ausgeschöpft.'};
        }
        const konflikt=await pruefeBuchungskonflikt(client,datum,fenster,null,
          einzelplatz?{angebot,uhrzeit:data.uhrzeit}:null,bookingSite);
        if(konflikt)return {konflikt};
        const id=crypto.randomUUID();
        const basis=buchungsreferenz(nachname,vorname,datum);
        const vorhanden=await client.query(
          `SELECT buchungsnummer FROM brilon_buchungen WHERE buchungsnummer=$1 OR buchungsnummer LIKE $2`,
          [basis,basis+'-%']
        );
        const belegte=new Set(vorhanden.rows.map(r=>r.buchungsnummer));
        let laufnummer=1, buchungsnummer=basis;
        while(belegte.has(buchungsnummer)) {
          laufnummer++;
          buchungsnummer=buchungsreferenz(nachname,vorname,datum,laufnummer);
        }
        data.buchungsnummer=buchungsnummer;
        await client.query(
          'INSERT INTO brilon_buchungen (id,data,status,buchungsnummer) VALUES ($1,$2,$3,$4)',
          [id,JSON.stringify(data),'offen',buchungsnummer]
        );
        return {id,buchungsnummer:data.buchungsnummer,wiederkehrenderKunde};
      });

      if(ergebnis.konflikt)
        return reply(res,409,{error:ergebnis.konflikt});
      if(ergebnis.empfehlungsgeberSelbst)return reply(res,400,{error:'Die eigene E-Mail-Adresse kann nicht als Empfehlungsgeber verwendet werden.'});
      if(ergebnis.empfehlungsaktionInaktiv)return reply(res,409,{error:'Der Empfehlungsrabatt ist momentan nicht verfügbar. Bitte sende die Anfrage ohne Empfehlungsangabe.'});
      if(ergebnis.empfehlungNichtVerifiziert)return reply(res,400,{error:'Diese E-Mail-Adresse konnte keiner früheren bestätigten Buchung zugeordnet werden. Bitte prüfe die Adresse oder sende die Anfrage ohne Empfehlungsrabatt.'});

      
const dauer = fenster ? fenster[1] - fenster[0] : null;
const ende = fenster
  ? String(Math.floor(fenster[1] / 60)).padStart(2, '0') +
    ':' + String(fenster[1] % 60).padStart(2, '0')
  : 'nach Absprache';

const buchungsdetails=buchungsDetails({...data,ende:`${ende}${fenster?' Uhr':''}`,
  ...(data.partnerhausAbwicklung===true?{gesamtpreis:Number.NaN}:{})});




const benachrichtigungen=[];
const enqueueMail=(...args)=>{
  const promise=Promise.resolve().then(()=>brevoMail(...args));
  promise.catch(()=>{});
  benachrichtigungen.push(promise);
};
enqueueMail(
    email,
    'Deine Buchungsanfrage – Klettern & Abenteuer Brilon',
    `Hallo ${name},\n\n` +
    (einzelplatz?'vielen Dank für deine Anmeldung zum Individualklettern. Dein Platz ist vorläufig reserviert.\n\n':'vielen Dank für deine Buchungsanfrage.\n\n') +
    (ergebnis.wiederkehrenderKunde?'Schön, dass du wieder bei uns anfragst! Wir haben gesehen, dass du bereits früher ein Programm bei uns gebucht hast.\n\n':'') +
    (data.empfehlungRabattCent?`Freunde-werben-Freunde-Rabatt: ${(data.empfehlungRabattCent/100).toFixed(2).replace('.',',')} € wurden berücksichtigt.\n\n`:'') +
    buchungsdetails +
    (einzelplatz?`\n\nKeine Anzahlung ist erforderlich. Der Termin findet ab ${data.mindestteilnehmer} Anmeldungen statt.`:
      `\n\nDeine Anfrage ist eingegangen, aber noch nicht verbindlich bestätigt.\nDu erhältst eine gesonderte Rückmeldung.`) + `\n\n` +
    `Gut Seil!\nKlettern & Abenteuer Brilon`
  );
if(data.empfehlung&&empfehlungsBestaetigungstoken){
  const base=(process.env.PUBLIC_BASE_URL||'https://klettern-brilon-neu.onrender.com').replace(/\/$/,'');
  const link=`${base}/api/empfehlung/bestaetigen?token=${encodeURIComponent(empfehlungsBestaetigungstoken)}`;
  enqueueMail(data.empfehlung.email,'Bitte bestätige eine Empfehlung – Klettern & Abenteuer',
    `Hallo ${data.empfehlung.name||''},\n\nbei einer neuen Buchungsanfrage wurde deine E-Mail-Adresse als Empfehlungsgeber angegeben. Unser System hat eine frühere, bestätigte und als stattgefunden dokumentierte Buchung mit dieser Adresse gefunden (${data.empfehlung.buchungsnummer||'Buchung'}, ${data.empfehlung.programm||'Programm'} am ${data.empfehlung.veranstaltungsdatum||'—'}).\n\nBitte bestätige über diesen Link, dass du die Empfehlung ausgesprochen hast:\n${link}\n\nDer Link ist 24 Stunden gültig. Die Verwaltung kann die neue Buchung erst bestätigen, wenn du die Empfehlung bestätigt hast. Falls du die Empfehlung nicht ausgesprochen hast, ignoriere diese E-Mail.\n\nViele Grüße\nKlettern & Abenteuer Brilon`);
}
try{
  const standortMitarbeiter=await pool.query(`SELECT DISTINCT m.id,m.name,m.email
    FROM brilon_pruef_mitarbeitende m
    JOIN brilon_pruef_freigaben f ON f.mitarbeiter_id=m.id
    JOIN brilon_orte o ON o.id=f.ort_id
    WHERE m.aktiv=true AND m.freigabe_am IS NOT NULL AND o.aktiv=true
      AND lower(btrim(o.name))=lower(btrim($1))
    ORDER BY m.name,m.id`,[data.veranstaltungsort]);
  const mitarbeiterUrl=(process.env.PUBLIC_BASE_URL||'https://klettern-brilon-neu.onrender.com').replace(/\/$/,'')+'/mitarbeiterbereich.html?bereich=termine#staff-planning-heading';
  for(const person of standortMitarbeiter.rows){
    const adresse=safeText(person.email,180);
    if(!/^\S+@\S+\.\S+$/.test(adresse))continue;
    const anrede=safeText(person.name,120);
    enqueueMail(adresse,
      'Neue Terminanfrage am Standort '+data.veranstaltungsort+' – Bewerbung möglich',
      `Hallo${anrede?' '+anrede:''},\n\nfür deinen freigegebenen Standort ist eine neue Buchungsanfrage eingegangen.\n\nProgramm: ${data.angebot}\nTermin: ${data.datum} um ${data.uhrzeit||'Uhrzeit offen'} Uhr\nStandort: ${data.veranstaltungsort||'—'}\nTeilnehmer: ${data.teilnehmer}\nBuchungsnummer: ${data.buchungsnummer}\n\nBitte melde dich im Mitarbeiterbereich an und öffne direkt „Termine und meine Buchungen“: ${mitarbeiterUrl}\nDort kannst du dich auf die Anfrage bewerben. Eine verbindliche Zusage ist nur möglich, wenn dir die Verwaltung die besondere Freigabe erteilt hat. Die Anfrage ist noch nicht verbindlich bestätigt; die Verwaltung entscheidet über die Einteilung.\n\nViele Grüße\nKlettern & Abenteuer Brilon`
    );
  }
}catch(error){
  console.error('Mitarbeiter-Benachrichtigung zu Buchungsanfrage fehlgeschlagen:',error.message);
}
if (process.env.BOOKING_NOTIFY_EMAIL) {
  enqueueMail(
    process.env.BOOKING_NOTIFY_EMAIL,
    'Neue Buchungsanfrage – Klettern Brilon',
    (einzelplatz?'Neue Einzelplatz-Anmeldung; Platz vorläufig reserviert:\n\n':'Eine neue Buchungsanfrage ist eingegangen:\n\n') +
    buchungsdetails +
    `\n\nKunden-E-Mail: ${email}\nStatus: ${einzelplatz?'Platz reserviert':'Offen'}`
  );
}
Promise.allSettled(benachrichtigungen).then(ergebnisse => {
  ergebnisse.forEach((ergebnis, index) => {
    if (ergebnis.status === 'rejected') {
      console.error(
        'Brevo-E-Mail fehlgeschlagen:',
        index === 0 ? 'Kunde' : 'Betreiber',
        ergebnis.reason
      );
    }
  });
});


      return reply(res,201,{success:true,id:ergebnis.id,buchungsnummer:ergebnis.buchungsnummer,
        einzelplatz,mindestteilnehmer:einzelplatz?data.mindestteilnehmer:null});
    }

    if(route==='/api/belegte-zeiten'&&req.method==='GET'){
      if(!pool)return reply(res,503,{
        error:'Verfügbarkeit derzeit nicht abrufbar.'
      });

      const datum=safeText(u.searchParams.get('datum'),10);
      const gueltig=/^\d{4}-\d{2}-\d{2}$/.test(datum)&&
        !Number.isNaN(Date.parse(datum))&&
        new Date(datum).toISOString().slice(0,10)===datum;

      if(!gueltig)return reply(res,400,{
        error:'Bitte ein gültiges Datum angeben.'
      });

      const standort=safeText(u.searchParams.get('standort'),80);
      if(!standort)return reply(res,400,{error:'Bitte zuerst den Veranstaltungsort auswählen.'});
      const q=await pool.query(
        `SELECT data
         FROM brilon_buchungen
         WHERE data->>'datum'=$1
         AND (data->>'veranstaltungsort'=$2 OR data->>'veranstaltungsort' IS NULL)
         AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,
        [datum,standort]
      );

      const buchungen=q.rows.map(r=>({data:r.data,fenster:buchungsfenster(r.data)}));
      const sperrfenster=await pool.query(
        `SELECT uhrzeit::text AS uhrzeit,endzeit::text AS endzeit
         FROM brilon_kalender WHERE typ='sperrzeit'
           AND datum<=$1::date AND COALESCE(enddatum,datum)>=$1::date
           AND (COALESCE(cardinality(standorte),0)=0 OR $2=ANY(standorte))`,
         [datum,standort]
      );
      const gesperrt=fenster=>sperrfenster.rows.some(entry=>{
        const von=minuten(String(entry.uhrzeit||'').slice(0,5)),
          bis=minuten(String(entry.endzeit||'').slice(0,5));
        return von===null||bis===null||!fenster||ueberschneidung(fenster,[von,bis]);
      });

     
      const teilnehmer = Number(u.searchParams.get('teilnehmer'));

      if (!Number.isInteger(teilnehmer) ||
          teilnehmer < 1 || teilnehmer > 150) {
        return reply(res,400,{
          error:'Bitte eine gültige Teilnehmerzahl angeben.'
        });
      }

      const angebot=safeText(u.searchParams.get('angebot'),120);
      const programm=await pool.query(
        `SELECT dauer,buchungsmodus,mindestteilnehmer,kapazitaet,gruppenstufen,dauer_modus,veranstaltungsort,veranstaltungsorte
          FROM brilon_angebote WHERE name=$1 AND archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true LIMIT 1`,[angebot]
      );
      if(!programm.rowCount)return reply(res,409,{error:'Programm ist nicht verfügbar.'});
      const erlaubte=Array.isArray(programm.rows[0].veranstaltungsorte)&&programm.rows[0].veranstaltungsorte.length
        ?programm.rows[0].veranstaltungsorte:[programm.rows[0].veranstaltungsort].filter(Boolean);
      if(!erlaubte.includes(standort))return reply(res,409,{error:'Das Programm wird an diesem Standort nicht angeboten.'});
      const einzelplatz=programm.rows[0].buchungsmodus==='einzelplatz';
      const dauerWunschRaw=u.searchParams.get('programmdauer');
      const dauerWunsch=dauerWunschRaw===null||dauerWunschRaw===''?null:Number(dauerWunschRaw);
      const dauer=buchungsdauerFuerProgramm(teilnehmer,programm.rows[0],dauerWunsch);
      if(!dauer)return reply(res,409,{error:'Bitte eine gültige Programmdauer für diese Gruppengröße auswählen.'});

      const zeiten=[];

      for(let stunde=9;stunde<=19;stunde++){
        const uhrzeit=String(stunde).padStart(2,'0')+':00';
        const start=stunde*60;

        const neuesFenster=
          dauer===null ? null : [start,start+dauer];

        const sameSession=b=>b.data?.buchungsmodus==='einzelplatz'&&
          b.data?.angebot===angebot&&b.data?.uhrzeit===uhrzeit&&b.data?.veranstaltungsort===standort;
        const belegt=gesperrt(neuesFenster)||buchungen.some(b=>
          !(einzelplatz&&sameSession(b))&&ueberschneidung(neuesFenster,b.fenster)
        );
        const angemeldet=einzelplatz?buchungen.filter(sameSession)
          .reduce((sum,b)=>sum+(Number(b.data?.teilnehmer)||0),0):null;
        const freiePlaetze=einzelplatz?Math.max(0,Number(programm.rows[0].kapazitaet)-angemeldet):null;
        zeiten.push({uhrzeit,belegt:belegt||(einzelplatz&&freiePlaetze<=0),
          ...(einzelplatz?{freie_plaetze:freiePlaetze,angemeldet,
            mindestteilnehmer:Number(programm.rows[0].mindestteilnehmer)||5}: {})});
      }

      return reply(res,200,{datum,zeiten});

    }


    
    if(route==='/api/sperrzeiten'&&req.method==='GET'){
      if(!pool)return reply(res,503,{
        error:'Verfügbarkeit derzeit nicht abrufbar.'
      });
      const q=await pool.query(
        `SELECT datum::text AS datum,
                COALESCE(enddatum,datum)::text AS enddatum,
                uhrzeit::text AS uhrzeit,endzeit::text AS endzeit,
                COALESCE(standorte,'{}'::text[]) AS standorte
         FROM brilon_kalender
         WHERE typ='sperrzeit'
         ORDER BY datum ASC`
      );
      return reply(res,200,q.rows);
    }

    if(route==='/api/besuchergruppen'&&req.method==='GET'){
      if(!pool)return reply(res,200,[]);
      const vorhanden=(await pool.query("SELECT to_regclass('public.brilon_besuchergruppen') AS tabelle")).rows[0]?.tabelle;
      if(!vorhanden)return reply(res,200,[]);
      const q=await pool.query('SELECT daten FROM brilon_besuchergruppen WHERE id=1');
      return reply(res,200,Array.isArray(q.rows[0]?.daten)?q.rows[0].daten:[]);
    }

    if(route==='/api/aktionen'&&req.method==='GET'){
      if(!pool)return reply(res,200,[]);
      const q=await pool.query(
        `SELECT a.id,a.id AS sonderaktion_id,a.data->>'titel' AS titel,a.data->>'datum' AS datum,
          a.data->>'beschreibung' AS beschreibung,a.data->>'preis' AS preis,
          a.data->>'bild_url' AS bild_url,a.data->>'uhrzeit' AS uhrzeit,
          a.data->>'endzeit' AS endzeit,a.data->>'veranstaltungsort' AS veranstaltungsort,
           a.data->'veranstaltungsorte' AS veranstaltungsorte,
          a.data->>'teilnehmer' AS teilnehmer,
          p.id AS programm_id,p.name AS programm_name
         FROM brilon_aktionen a
         LEFT JOIN brilon_angebote p ON p.id::text=a.data->>'programm_id'
           AND p.archiviert=false AND p.aktiv=true AND p.buchbar=true AND p.veroeffentlicht=true
           AND (a.data->>'datum' IS NULL OR a.data->>'datum'=''
             OR jsonb_array_length(COALESCE(p.verfuegbare_termine,'[]'::jsonb))=0
             OR p.verfuegbare_termine ? (a.data->>'datum'))
         WHERE COALESCE(a.data->>'status','veroeffentlicht')='veroeffentlicht'
           AND (COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(a.data->'veranstaltungsorte')='array'
             THEN a.data->'veranstaltungsorte' ELSE '[]'::jsonb END),0)>0
             OR NULLIF(TRIM(a.data->>'veranstaltungsort'),'') IS NOT NULL)
         ORDER BY a.data->>'datum' ASC NULLS LAST,a.id DESC LIMIT 100`
      );
      return reply(res,200,q.rows);
    }

    if(route==='/api/gps/start'&&req.method==='POST'){
      if(!pool)return reply(res,503,{error:'Spiel derzeit nicht verfügbar.'});
      if(!limit('gps-start:'+ip,30,600000))return reply(res,429,{error:'Bitte kurz warten.'});
      const d=await body(req),token=safeText(d.token,120);
      if(token.length<32)return reply(res,401,{error:'Ungültiger Spielzugang.'});
      const q=await pool.query(
        `SELECT g.id,g.station_index,g.gestartet_am,g.abgeschlossen_am,g.spielzeit_sekunden,
                t.data AS tour
         FROM brilon_gps_spiele g
         JOIN brilon_gps_touren t ON t.id=g.tour_id
         JOIN brilon_buchungen b ON b.id=g.buchung_id
         WHERE g.token_hash=$1 AND g.gesperrt_am IS NULL AND t.aktiv=true AND t.data->>'buchbar'='true'
           AND b.status='bestaetigt'`,[gpsTokenHash(token)]
      );
      if(!q.rowCount)return reply(res,404,{error:'Spielzugang nicht gefunden oder nicht freigegeben.'});
      const game=q.rows[0];
      if(game.abgeschlossen_am)return reply(res,200,{abgeschlossen:true,spielzeitSekunden:game.spielzeit_sekunden});
      if(!game.gestartet_am){
        const gestartet=await pool.query(
          'UPDATE brilon_gps_spiele SET gestartet_am=NOW() WHERE id=$1 AND gestartet_am IS NULL RETURNING gestartet_am',[game.id]
        );
        game.gestartet_am=gestartet.rows[0]?.gestartet_am||new Date();
      }
      return reply(res,200,{tour:game.tour.titel,...stationFuerSpiel(game.tour,game.station_index)});
    }

    if(route==='/api/gps/pruefen'&&req.method==='POST'){
      if(!pool)return reply(res,503,{error:'Spiel derzeit nicht verfügbar.'});
      const d=await body(req),token=safeText(d.token,120);
      if(token.length<32||!limit('gps-answer:'+gpsTokenHash(token),20,600000))
        return reply(res,429,{error:'Zu viele Versuche oder ungültiger Zugang.'});
      const client=await pool.connect();
      let ergebnis;
      try{
        await client.query('BEGIN');
        const q=await client.query(
          `SELECT g.id,g.station_index,g.gestartet_am,g.abgeschlossen_am,t.data AS tour
           FROM brilon_gps_spiele g JOIN brilon_gps_touren t ON t.id=g.tour_id
           JOIN brilon_buchungen b ON b.id=g.buchung_id
           WHERE g.token_hash=$1 AND g.gesperrt_am IS NULL AND t.aktiv=true AND b.status='bestaetigt' FOR UPDATE OF g`,
          [gpsTokenHash(token)]
        );
        if(!q.rowCount){ergebnis={ungueltig:true};await client.query('ROLLBACK');}
        else{
          const game=q.rows[0];
          if(!game.gestartet_am||game.abgeschlossen_am){ergebnis={ungueltig:true};await client.query('ROLLBACK');}
          else{
            const check=stationPruefen(game.tour,{stationIndex:game.station_index,abgeschlossen:false},
              {qrId:d.qrId,kontrollcode:d.kontrollcode,antwort:d.antwort},process.env.GPS_CODE_SECRET);
            if(!check.korrekt){ergebnis={falsch:true,grund:check.grund};await client.query('ROLLBACK');}
            else{
              const abgeschlossen=check.spiel.abgeschlossen;
              const dauer=abgeschlossen?gpsSpieldauer(new Date(game.gestartet_am).getTime(),Date.now()):null;
              await client.query(
                `UPDATE brilon_gps_spiele SET station_index=$1,
                 abgeschlossen_am=CASE WHEN $2 THEN NOW() ELSE NULL END,
                 spielzeit_sekunden=CASE WHEN $2 THEN $3 ELSE NULL END WHERE id=$4`,
                [check.spiel.stationIndex,abgeschlossen,dauer,game.id]
              );
              ergebnis={korrekt:true,abgeschlossen,spielzeitSekunden:dauer,
                naechsteStation:check.naechsteStation};
              await client.query('COMMIT');
            }
          }
        }
      }catch(error){try{await client.query('ROLLBACK')}catch{};throw error;}
      finally{client.release();}
      if(ergebnis.ungueltig)return reply(res,404,{error:'Spielzugang nicht aktiv.'});
      if(ergebnis.falsch)return reply(res,422,{error:'QR-Code, Kontrollcode oder Antwort stimmen nicht.'});
      return reply(res,200,ergebnis);
    }

    if(route==='/api/gps/abschluss'&&req.method==='POST'){
      if(!pool)return reply(res,503,{error:'Gästeliste derzeit nicht verfügbar.'});
      const d=await body(req),token=safeText(d.token,120),einwilligung=d.einwilligung===true;
      if(token.length<32||!limit('gps-guest:'+ip,12,600000))return reply(res,429,{error:'Bitte kurz warten.'});
      const name=einwilligung?safeText(d.name,80):null;
      if(einwilligung&&!name)return reply(res,400,{error:'Bitte einen Namen eingeben oder nicht zustimmen.'});
      if(einwilligung&&d.einwilligungVersion!==GPS_GAESTELISTE_EINWILLIGUNG_VERSION)
        return reply(res,409,{error:'Der Einwilligungstext wurde aktualisiert. Bitte lade die Seite neu.'});
      const q=await pool.query(
        `UPDATE brilon_gps_spiele SET gast_name=$1,gast_einwilligung=$2,
           gast_einwilligung_am=CASE WHEN $2 THEN NOW() ELSE NULL END,
           gast_einwilligung_version=CASE WHEN $2 THEN $3 ELSE NULL END
         WHERE token_hash=$4 AND gesperrt_am IS NULL AND abgeschlossen_am IS NOT NULL RETURNING id`,
        [name,einwilligung,einwilligung?GPS_GAESTELISTE_EINWILLIGUNG_VERSION:null,gpsTokenHash(token)]
      );
      if(!q.rowCount)return reply(res,404,{error:'Spiel nicht abgeschlossen oder Zugang ungültig.'});
      return reply(res,200,{success:true,oeffentlich:einwilligung});
    }

    if(route==='/api/gps/gaesteliste'&&req.method==='GET'){
      if(!pool)return reply(res,200,[]);
      const tourId=safeText(u.searchParams.get('tour'),36);
      if(!/^[0-9a-f-]{36}$/i.test(tourId))return reply(res,400,{error:'Tour-ID ungültig.'});
      const q=await pool.query(
        `SELECT g.gast_name AS name,to_char(g.abgeschlossen_am,'YYYY-MM-DD') AS datum,
                g.spielzeit_sekunden AS dauer_sekunden
         FROM brilon_gps_spiele g WHERE g.tour_id=$1 AND g.gast_einwilligung=true
           AND g.gast_name IS NOT NULL AND g.abgeschlossen_am IS NOT NULL
         ORDER BY g.abgeschlossen_am DESC LIMIT 200`,[tourId]
      );
      return reply(res,200,q.rows);
    }

    if(route==='/api/agb'&&req.method==='GET'){
      if(!pool)return reply(res,503,{error:'Geschäftsbedingungen sind noch nicht verfügbar.'});
      try{
        const q=await pool.query("SELECT data->>'agbText' AS text,data->>'agbAktiv' AS aktiv,data->>'agbVersion' AS version FROM brilon_rechnungsdaten WHERE id=1");
        const row=q.rows[0];
        if(!row||row.aktiv!=='true'||!row.text)return reply(res,503,{error:'Geschäftsbedingungen sind noch nicht veröffentlicht.',aktiv:false});
        return reply(res,200,{aktiv:true,text:row.text,version:Number(row.version)});
      }catch{return reply(res,503,{error:'Geschäftsbedingungen sind noch nicht eingerichtet.',aktiv:false});}
    }

    if(route==='/api/empfehlungsaktion'&&req.method==='GET'){
      if(!pool)return reply(res,200,{aktiv:false});
      try{
        const q=await pool.query('SELECT data FROM brilon_rechnungsdaten WHERE id=1');
        const data=q.rows[0]?.data||{},wert=Number(String(data.empfehlungRabattWert||'').replace(',','.'));
        const aktiv=data.empfehlungAktiv===true&&Number.isFinite(wert)&&wert>0&&['prozent','festbetrag'].includes(data.empfehlungRabattArt);
        return reply(res,200,{aktiv,text:aktiv?safeText(data.empfehlungsText,300):''});
      }catch{return reply(res,200,{aktiv:false});}
    }

    if(route==='/api/buchung-widerruf'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Anfrage abgelehnt.'});
      if(!pool)return reply(res,503,{error:'Stornierungen sind momentan nicht verfügbar.'});
      if(!limit('booking-withdrawal:'+ip,5,3600000))return reply(res,429,{error:'Bitte später erneut versuchen.'});
      const d=await body(req),number=safeText(d.buchungsnummer,40).toUpperCase();
      const anliegen=d.anliegen==='umbuchung'?'umbuchung':'widerruf';
      const wunschdatum=safeText(d.wunschdatum,10),wunschzeit=safeText(d.wunschzeit,5);
      if(!/^[A-Z0-9-]{5,40}$/.test(number))return reply(res,400,{error:'Bitte eine gültige Buchungsnummer eingeben.'});
      if(anliegen==='umbuchung'){
        const gueltigesDatum=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(new Date(v+'T12:00:00Z').getTime())&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
        if(!gueltigesDatum(wunschdatum)||wunschdatum<heuteInBerlin()||!/^([01]\d|2[0-3]):[0-5]\d$/.test(wunschzeit))
          return reply(res,400,{error:'Bitte einen gültigen zukünftigen Wunschtermin mit Uhrzeit angeben.'});
      }
      let booking=null;
      try{
        const q=await pool.query(`SELECT id,buchungsnummer,data,status FROM brilon_buchungen
          WHERE UPPER(COALESCE(buchungsnummer,data->>'buchungsnummer',''))=$1
          LIMIT 1`,[number]);
        booking=q.rows[0]||null;
      }catch{return reply(res,503,{error:'Widerruf konnte gerade nicht bearbeitet werden.'});}
      const generic={success:true,message:'Wenn eine aktive Buchung mit dieser Buchungsnummer vorliegt, senden wir einen Bestätigungslink an die bei der Buchung hinterlegte E-Mail-Adresse. Erst nach Bestätigung wird der ausgewählte Widerruf oder die Umbuchungsanfrage weiterbearbeitet.'};
      if(!booking||['storniert','abgelehnt'].includes(booking.status)||!booking.data?.datum||booking.data.datum<heuteInBerlin())return reply(res,200,generic);
      const email=safeText(booking.data.email,180).toLowerCase(),name=safeText(booking.data.name,160);
      if(!/^\S+@\S+\.\S+$/.test(email))return reply(res,200,generic);
      let base;
      try{base=new URL(process.env.PUBLIC_BASE_URL||'');}catch{return reply(res,200,generic);}
      if(base.protocol!=='https:'||base.username||base.password)return reply(res,200,generic);
      const token=crypto.randomBytes(32).toString('hex'),requestId=crypto.randomUUID(),expires=new Date(Date.now()+24*60*60*1000);
      try{
        await pool.query(`INSERT INTO brilon_buchungswiderrufe(id,buchung_id,token_hash,ablauf,anfrage_email,anliegen,wunschdatum,wunschzeit)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[requestId,booking.id,gpsTokenHash(token),expires,email,anliegen,
            anliegen==='umbuchung'?wunschdatum:null,anliegen==='umbuchung'?wunschzeit:null]);
        const link=base.toString().replace(/\/$/,'')+`/widerruf.html?token=${token}`;
        const umbuchung=anliegen==='umbuchung';
        await brevoMail(email,umbuchung?'Bitte Umbuchungsanfrage bestätigen – Klettern & Abenteuer':'Bitte Widerruf / Stornierung bestätigen – Klettern & Abenteuer',
          `Guten Tag${name?' '+name:''},\n\nfür die Buchung ${booking.buchungsnummer||number} (${booking.data.angebot||'Programm'}, ${booking.data.datum} um ${booking.data.uhrzeit||'—'} Uhr) wurde ${umbuchung?`eine Umbuchung auf den Wunschtermin ${wunschdatum} um ${wunschzeit} Uhr angefragt`:'ein Widerruf bzw. eine Stornierung angefordert'}.\n\n${umbuchung?'Die Buchung bleibt unverändert. Die Verwaltung prüft deine Anfrage und muss einer Umbuchung ausdrücklich zustimmen.':'Die Buchung ist noch nicht storniert.'} Bitte öffne innerhalb von 24 Stunden den folgenden Link und bestätige deine Anfrage:\n${link}\n\nWenn du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren. Ohne Linkbestätigung wird sie nicht weiterbearbeitet.\n\nViele Grüße\nKlettern & Abenteuer Brilon`,{idempotencyKey:requestId});
      }catch(error){
        await pool.query("UPDATE brilon_buchungswiderrufe SET status='fehlgeschlagen' WHERE id=$1",[requestId]).catch(()=>{});
        console.error('Widerrufslink konnte nicht zugestellt werden:',error.code||'unbekannter Fehler');
      }
      return reply(res,200,generic);
    }

    const customerWithdrawal=route.match(/^\/api\/buchung-widerruf\/([a-f0-9]{64})$/i);
    if(customerWithdrawal&&req.method==='GET'){
      if(!pool)return reply(res,503,{error:'Widerruf ist momentan nicht verfügbar.'});
      try{
        const q=await pool.query(`SELECT r.status,r.ablauf,r.angefragt_am,r.anliegen,r.wunschdatum::text,r.wunschzeit::text,
            b.buchungsnummer,b.data,b.status AS buchungsstatus
          FROM brilon_buchungswiderrufe r JOIN brilon_buchungen b ON b.id=r.buchung_id
          WHERE r.token_hash=$1`,[gpsTokenHash(customerWithdrawal[1])]);
        if(!q.rowCount)return reply(res,404,{error:'Dieser Bestätigungslink ist ungültig oder wurde bereits verwendet.'});
        const row=q.rows[0];if(row.status!=='bestaetigung_ausstehend'||new Date(row.ablauf)<=new Date())return reply(res,410,{error:'Dieser Bestätigungslink ist abgelaufen oder wurde bereits verwendet.'});
        return reply(res,200,{anliegen:row.anliegen,buchungsnummer:row.buchungsnummer||row.data.buchungsnummer,
          angebot:row.data.angebot,datum:row.data.datum,uhrzeit:row.data.uhrzeit,
          wunschdatum:row.wunschdatum,wunschzeit:row.wunschzeit,angefragtAm:row.angefragt_am});
      }catch{return reply(res,503,{error:'Bestätigungslink konnte nicht geprüft werden.'});}
    }
    if(customerWithdrawal&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Anfrage abgelehnt.'});
      if(!pool)return reply(res,503,{error:'Widerruf ist momentan nicht verfügbar.'});
      const result=await reservierungsTransaktion(async client=>{
        const q=await client.query(`SELECT r.id AS request_id,r.buchung_id,r.status AS request_status,r.ablauf,r.angefragt_am,
          r.anliegen,r.wunschdatum::text,r.wunschzeit::text,
          b.buchungsnummer,b.data,b.status AS booking_status
          FROM brilon_buchungswiderrufe r JOIN brilon_buchungen b ON b.id=r.buchung_id
          WHERE r.token_hash=$1 FOR UPDATE OF r,b`,[gpsTokenHash(customerWithdrawal[1])]);
        if(!q.rowCount)return {fehlt:true};
        const row=q.rows[0];if(row.request_status!=='bestaetigung_ausstehend'||new Date(row.ablauf)<=new Date()||['storniert','abgelehnt'].includes(row.booking_status))return {abgelaufen:true};
        if(row.data.datum<heuteInBerlin())return {terminVorbei:true};
        const data=row.data;
        if(row.anliegen==='umbuchung'){
          data.umbuchung={status:'wartet_verwaltung',angefragtAm:row.angefragt_am,
            bestaetigtAm:new Date().toISOString(),wunschtermin:row.wunschdatum,wunschzeit:row.wunschzeit};
          const updated=await client.query(`UPDATE brilon_buchungen SET data=$1::jsonb,updated_at=NOW()
            WHERE id=$2 RETURNING id,buchungsnummer,data,status`,[JSON.stringify(data),row.buchung_id]);
          await client.query("UPDATE brilon_buchungswiderrufe SET status='wartet_verwaltung',bestaetigt_am=NOW() WHERE id=$1",[row.request_id]);
          return {umbuchung:true,buchung:updated.rows[0],requestId:row.request_id,wunschdatum:row.wunschdatum,wunschzeit:row.wunschzeit};
        }
        data.stornierung={status:'bestaetigt',art:'KundenwiderrufOderStornierung',angefragtAm:row.angefragt_am,
          bestaetigtAm:new Date().toISOString(),bedingungenVersion:data.agbTextVersion||null};
        const rabatt=await anschlussRabattElternZuruecknehmen(client,data,row.buchung_id);
        const updated=await client.query(`UPDATE brilon_buchungen SET status='storniert',data=$1::jsonb,updated_at=NOW()
          WHERE id=$2 RETURNING id,buchungsnummer,data,status`,[JSON.stringify(data),row.buchung_id]);
        await client.query("UPDATE brilon_buchungswiderrufe SET status='bestaetigt',bestaetigt_am=NOW(),abgeschlossen_am=NOW() WHERE id=$1",[row.request_id]);
        return {buchung:updated.rows[0],requestId:row.request_id,rabatt};
      });
      if(result.fehlt)return reply(res,404,{error:'Dieser Bestätigungslink ist ungültig oder wurde bereits verwendet.'});
      if(result.abgelaufen)return reply(res,410,{error:'Dieser Bestätigungslink ist abgelaufen oder die Buchung ist bereits beendet.'});
      if(result.terminVorbei)return reply(res,409,{error:'Der Veranstaltungstermin liegt bereits zurück. Bitte kontaktiere uns direkt.'});
      const data=result.buchung.data,bookingNumber=result.buchung.buchungsnummer||data.buchungsnummer||'';
      if(result.umbuchung){
        const text=`Guten Tag ${data.name||''},\n\nwir haben deine bestätigte Anfrage erhalten, die Buchung ${bookingNumber} auf den ${result.wunschdatum} um ${result.wunschzeit} Uhr umzubuchen. Die bestehende Buchung bleibt bis zur ausdrücklichen Freigabe durch die Verwaltung unverändert. Wir melden uns nach der Prüfung.\n\nViele Grüße\nKlettern & Abenteuer Brilon`;
        const customerEmail=safeText(data.email,180).toLowerCase();
        if(/^\S+@\S+\.\S+$/.test(customerEmail))brevoMail(customerEmail,'Umbuchungsanfrage eingegangen – Klettern & Abenteuer',text,{idempotencyKey:result.requestId}).catch(error=>console.error('Umbuchungs-Eingangsbestätigung fehlgeschlagen:',error.code||'unbekannter Fehler'));
        if(process.env.BOOKING_NOTIFY_EMAIL)brevoMail(process.env.BOOKING_NOTIFY_EMAIL,'Umbuchungsanfrage zur Freigabe',
          `Eine Umbuchungsanfrage wurde vom Kunden bestätigt und wartet auf die Freigabe durch die Verwaltung.\n\nBuchung: ${bookingNumber}\nKunde: ${data.name||''} · ${customerEmail}\nBisheriger Termin: ${data.datum||''} um ${data.uhrzeit||'—'} Uhr\nWunschtermin: ${result.wunschdatum} um ${result.wunschzeit} Uhr\nAngebot: ${data.angebot||''}\nBuchungs-ID: ${result.buchung.id}`).catch(error=>console.error('Verwaltungsbenachrichtigung zur Umbuchungsanfrage fehlgeschlagen:',error.code||'unbekannter Fehler'));
        return reply(res,200,{success:true,buchungsnummer:bookingNumber,message:'Deine Umbuchungsanfrage wurde bestätigt und an die Verwaltung weitergeleitet. Die bestehende Buchung bleibt unverändert, bis die Verwaltung die Umbuchung freigibt.'});
      }
      const cancellationText=`Die Buchung ${bookingNumber} wurde nach Bestätigung des Widerrufs / der Stornierung am ${new Date().toLocaleString('de-DE',{timeZone:'Europe/Berlin'})} auf storniert gesetzt.\n\nProgramm: ${data.angebot||''}\nTermin: ${data.datum||''} um ${data.uhrzeit||''} Uhr\n\nBereits geleistete Zahlungen werden nicht automatisch ausgezahlt. Die Abrechnung erfolgt nach den bei der Buchung bestätigten Geschäftsbedingungen. Bei einer Stornierung innerhalb des kostenfreien Zeitraums wird eine etwaige Erstattung separat bearbeitet.\n\nViele Grüße\nKlettern & Abenteuer Brilon`;
      const customerEmail=safeText(data.email,180).toLowerCase();
      if(/^\S+@\S+\.\S+$/.test(customerEmail))brevoMail(customerEmail,'Widerruf / Stornierung bestätigt – Klettern & Abenteuer',
        `Guten Tag ${data.name||''},\n\n${cancellationText}`,{idempotencyKey:result.requestId}).catch(error=>console.error('Stornierungsbestätigung konnte nicht versandt werden:',error.code||'unbekannter Fehler'));
      if(process.env.BOOKING_NOTIFY_EMAIL)brevoMail(process.env.BOOKING_NOTIFY_EMAIL,'Kundenwiderruf / Stornierung bestätigt',
        `${cancellationText}\n\nKunde: ${data.name||''} · ${customerEmail}\nBuchungs-ID: ${result.buchung.id}`).catch(error=>console.error('Verwaltungsbenachrichtigung zum Widerruf fehlgeschlagen:',error.code||'unbekannter Fehler'));
      return reply(res,200,{success:true,buchungsnummer:bookingNumber,message:'Der Widerruf / die Stornierung wurde bestätigt. Eine Bestätigungs-E-Mail wurde veranlasst.'});
    }

    if(route==='/api/admin/umbuchungsanfragen'&&req.method==='GET'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      const q=await pool.query(`SELECT r.id AS anfrage_id,r.angefragt_am,r.bestaetigt_am,
          r.wunschdatum::text AS wunschdatum,r.wunschzeit::text AS wunschzeit,
          b.id AS buchung_id,b.buchungsnummer,b.status AS buchungsstatus,b.data
        FROM brilon_buchungswiderrufe r JOIN brilon_buchungen b ON b.id=r.buchung_id
        WHERE r.anliegen='umbuchung' AND r.status='wartet_verwaltung'
        ORDER BY r.angefragt_am ASC LIMIT 200`);
      return reply(res,200,{anfragen:q.rows});
    }
    const rescheduleDecision=route.match(/^\/api\/admin\/umbuchungsanfragen\/([0-9a-f-]{36})$/i);
    if(rescheduleDecision&&req.method==='PATCH'){
      if(!await admin(req,res))return;
      if(!sameOriginMutation(req))return reply(res,403,{error:'Anfrage abgelehnt.'});
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      const d=await body(req);
      if(!['freigegeben','abgelehnt'].includes(d?.status))return reply(res,400,{error:'Bitte freigeben oder ablehnen.'});
      const result=await reservierungsTransaktion(async client=>{
        const q=await client.query(`SELECT r.id AS anfrage_id,r.buchung_id,r.status AS anfrage_status,
            r.anliegen,r.wunschdatum::text,r.wunschzeit::text,b.status AS buchungsstatus,b.data,b.buchungsnummer
          FROM brilon_buchungswiderrufe r JOIN brilon_buchungen b ON b.id=r.buchung_id
          WHERE r.id=$1 FOR UPDATE OF r,b`,[rescheduleDecision[1]]);
        if(!q.rowCount)return {fehlt:true};
        const row=q.rows[0];
        if(row.anliegen!=='umbuchung'||row.anfrage_status!=='wartet_verwaltung')return {erledigt:true};
        if(['storniert','abgelehnt'].includes(row.buchungsstatus))return {buchungBeendet:true};
        const data=row.data||{},altDatum=data.datum,altUhrzeit=data.uhrzeit||'';
        if(d.status==='freigegeben'){
          if(row.wunschdatum<heuteInBerlin())return {wunschAbgelaufen:true};
          const shifted={...data,datum:row.wunschdatum,uhrzeit:row.wunschzeit};
          const conflict=await pruefeBuchungskonflikt(client,shifted.datum,buchungsfenster(shifted),row.buchung_id,
            shifted.buchungsmodus==='einzelplatz'?{angebot:shifted.angebot,uhrzeit:shifted.uhrzeit}:null,shifted.veranstaltungsort);
          if(conflict)return {konflikt:conflict};
          if(shifted.buchungsmodus==='einzelplatz'){
            const programm=await client.query('SELECT kapazitaet FROM brilon_angebote WHERE name=$1 LIMIT 1',[shifted.angebot]);
            if(!programm.rowCount)return {konflikt:'Die Kapazität dieses Einzelplatzangebots kann nicht geprüft werden.'};
            const belegung=await client.query(`SELECT COALESCE(SUM(CASE WHEN data->>'teilnehmer' ~ '^[0-9]+$' THEN (data->>'teilnehmer')::integer ELSE 0 END),0) AS gebucht
              FROM brilon_buchungen WHERE id<>$1 AND data->>'datum'=$2 AND data->>'angebot'=$3 AND data->>'uhrzeit'=$4
                AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,[row.buchung_id,shifted.datum,shifted.angebot,shifted.uhrzeit]);
            if(Number(belegung.rows[0].gebucht)+Number(shifted.teilnehmer||1)>Number(programm.rows[0].kapazitaet))
              return {konflikt:'Die Kapazität für diesen Einzelplatztermin ist ausgeschöpft.'};
          }
          shifted.umbuchung={status:'freigegeben',altDatum,altUhrzeit,wunschtermin:row.wunschdatum,
            wunschzeit:row.wunschzeit,freigegebenAm:new Date().toISOString()};
          await client.query('UPDATE brilon_buchungen SET data=$1::jsonb,updated_at=NOW() WHERE id=$2',[JSON.stringify(shifted),row.buchung_id]);
        }else{
          data.umbuchung={status:'abgelehnt',altDatum,altUhrzeit,wunschtermin:row.wunschdatum,
            wunschzeit:row.wunschzeit,abgelehntAm:new Date().toISOString()};
          await client.query('UPDATE brilon_buchungen SET data=$1::jsonb,updated_at=NOW() WHERE id=$2',[JSON.stringify(data),row.buchung_id]);
        }
        await client.query('UPDATE brilon_buchungswiderrufe SET status=$1,abgeschlossen_am=NOW() WHERE id=$2',
          [d.status,row.anfrage_id]);
        return {status:d.status,buchungsnummer:row.buchungsnummer||data.buchungsnummer,data:d.status==='freigegeben'?{...data,datum:row.wunschdatum,uhrzeit:row.wunschzeit}:data};
      });
      if(result.fehlt)return reply(res,404,{error:'Umbuchungsanfrage nicht gefunden.'});
      if(result.erledigt)return reply(res,409,{error:'Diese Umbuchungsanfrage wurde bereits bearbeitet.'});
      if(result.buchungBeendet)return reply(res,409,{error:'Die Buchung wurde inzwischen beendet.'});
      if(result.wunschAbgelaufen)return reply(res,409,{error:'Der gewünschte Termin liegt inzwischen in der Vergangenheit.'});
      if(result.konflikt)return reply(res,409,{error:result.konflikt});
      const data=result.data||{},email=safeText(data.email,180).toLowerCase();
      if(/^\S+@\S+\.\S+$/.test(email)){
        const approved=result.status==='freigegeben';
        const text=approved
          ?`Guten Tag ${data.name||''},\n\ndeine Umbuchungsanfrage für die Buchung ${result.buchungsnummer||''} wurde freigegeben. Der Termin ist jetzt auf ${data.datum} um ${data.uhrzeit||'—'} Uhr geändert.\n\nViele Grüße\nKlettern & Abenteuer Brilon`
          :`Guten Tag ${data.name||''},\n\nleider können wir deine Umbuchungsanfrage für die Buchung ${result.buchungsnummer||''} auf ${data.umbuchung?.wunschtermin||''} um ${data.umbuchung?.wunschzeit||'—'} Uhr nicht freigeben. Deine ursprüngliche Buchung bleibt bestehen: ${data.datum} um ${data.uhrzeit||'—'} Uhr.\n\nViele Grüße\nKlettern & Abenteuer Brilon`;
        brevoMail(email,approved?'Umbuchung freigegeben – Klettern & Abenteuer':'Umbuchungsanfrage – Entscheidung der Verwaltung',text)
          .catch(error=>console.error('Entscheidungs-E-Mail zur Umbuchung fehlgeschlagen:',error.code||'unbekannter Fehler'));
      }
      return reply(res,200,{success:true,status:result.status});
    }

    if(route==='/api/admin/rechnungsdaten'&&req.method==='GET'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      try{
        const q=await pool.query('SELECT data,naechste_nummer FROM brilon_rechnungsdaten WHERE id=1');
        return reply(res,200,{...(q.rows[0]?.data||{}),naechsteNummer:q.rows[0]?.naechste_nummer||1});
      }catch{return reply(res,503,{error:'Rechnungs- und AGB-Schema ist noch nicht eingerichtet.'});}
    }

    if(route==='/api/admin/rechnungsdaten'&&req.method==='PUT'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      const d=await body(req,30000),text=safeText(d.agbText,12000);
      const fields=['firma','name','strasse','plz','ort','email','telefon','steuernummer','ustIdNr','steuerhinweis',
        'bankname','iban','bic','rechnungshinweis','rechnungsPraefix','empfehlungRabattArt','empfehlungsText'];
      const values={};for(const key of fields)values[key]=safeText(d[key],key==='rechnungshinweis'||key==='steuerhinweis'?1000:200);
      values.empfehlungsText=safeText(d.empfehlungsText,300)||'Freunde werben Freunde! Empfiehl uns gerne weiter. So können Freunde und Bekannte ebenfalls von deinen positiven Erfahrungen profitieren. Wenn sie bei ihrer Anfrage deine Kontakt-E-Mail-Adresse als Empfehlungsgeber angeben und eine frühere bestätigte Buchung zu dieser E-Mail-Adresse vorliegt, das Programm in der Verwaltung als stattgefunden dokumentiert wurde und der Empfehlungsgeber die Bestätigungs-E-Mail bestätigt, erhalten sie den aktuell in der Verwaltung festgelegten Rabatt.';
      values.empfehlungAktiv=d.empfehlungAktiv===true;
      values.empfehlungRabattArt=['prozent','festbetrag'].includes(d.empfehlungRabattArt)?d.empfehlungRabattArt:'prozent';
      const referralValueText=String(d.empfehlungRabattWert??'').trim().replace(',','.');
      if(referralValueText&&!/^\d{1,7}(?:\.\d{1,2})?$/.test(referralValueText))return reply(res,400,{error:'Bitte einen gültigen Empfehlungsrabatt eingeben.'});
      const referralValue=Number(referralValueText||0);
      if(values.empfehlungAktiv&&(!Number.isFinite(referralValue)||referralValue<=0||
         (values.empfehlungRabattArt==='prozent'&&referralValue>100)||
         (values.empfehlungRabattArt==='festbetrag'&&referralValue>10000)||values.empfehlungsText.length<40))
        return reply(res,400,{error:'Zum Aktivieren der Empfehlungsaktion braucht es einen gültigen Rabattwert und einen Werbetext.'});
      values.empfehlungRabattWert=referralValueText;
      values.agbText=text;values.agbAktiv=d.agbAktiv===true;
      if(values.agbAktiv&&text.length<100)return reply(res,400,{error:'Bitte hinterlege mindestens 100 Zeichen AGB-Text, bevor du ihn veröffentlichst.'});
      if(!values.rechnungsPraefix)values.rechnungsPraefix='KA-';
      if(!/^[A-Za-z0-9_-]{1,20}$/.test(values.rechnungsPraefix))return reply(res,400,{error:'Das Rechnungsnummern-Präfix darf nur Buchstaben, Zahlen, Bindestriche und Unterstriche enthalten.'});
      try{
        const client=await pool.connect();let row;
        try{
          await client.query('BEGIN');
          const current=await client.query('SELECT data FROM brilon_rechnungsdaten WHERE id=1 FOR UPDATE');
          if(!current.rowCount){await client.query('ROLLBACK');return reply(res,503,{error:'Rechnungs- und AGB-Schema ist noch nicht eingerichtet.'});}
          const old=current.rows[0].data||{};
          values.agbVersion=(Number(old.agbVersion)||0)+(old.agbText===text?0:1);
          await client.query("UPDATE brilon_rechnungsdaten SET data=COALESCE(data,'{}'::jsonb)||$1::jsonb,aktualisiert_am=NOW() WHERE id=1",[JSON.stringify(values)]);
          row=values;await client.query('COMMIT');
        }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
        return reply(res,200,{success:true,data:row});
      }catch{return reply(res,503,{error:'Rechnungsdaten konnten nicht gespeichert werden.'});}
    }

    if(route==='/api/admin/rechnungen/ausstehend'&&req.method==='POST'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      try{
        const q=await pool.query(`SELECT b.id,b.data FROM brilon_buchungen b
          LEFT JOIN brilon_rechnungen r ON r.buchung_id=b.id WHERE r.id IS NULL ORDER BY b.created_at LIMIT 250`);
        const ready=q.rows.filter(row=>{
          const data=row.data||{},payments=Array.isArray(data.zahlungen)?data.zahlungen:[],total=Math.round(Number(data.gesamtpreis||0)*100);
          return total>0&&zahlungsstand(total,payments).offenCent===0;
        });
        const results=[];
        for(const row of ready)results.push(await rechnungSichernUndVersenden(row.id));
        return reply(res,200,{success:true,verarbeitet:results.length,ergebnisse:results});
      }catch(error){return reply(res,503,{error:'Vollständig bezahlte Buchungen konnten nicht nachverarbeitet werden.'});}
    }

    if(route==='/api/admin/rechnungen'&&req.method==='GET'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      try{
        const q=await pool.query(`SELECT r.id,r.rechnungsnummer,r.data,r.email_status,r.email_fehler,r.erstellt_am,r.versandt_am,
          b.data->>'name' AS kunde,b.data->>'email' AS email FROM brilon_rechnungen r
          JOIN brilon_buchungen b ON b.id=r.buchung_id ORDER BY r.erstellt_am DESC LIMIT 100`);
        return reply(res,200,{rechnungen:q.rows});
      }catch{return reply(res,503,{error:'Rechnungsübersicht konnte nicht geladen werden.'});}
    }

    const rechnungRoute=route.match(/^\/api\/admin\/rechnungen\/([0-9a-f-]{36})(?:\.(pdf)|\/(versenden))?$/i);
    if(rechnungRoute&&(req.method==='GET'||req.method==='POST')){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      const id=rechnungRoute[1];
      let q;
      try{q=await pool.query(`SELECT r.id,r.rechnungsnummer,r.data,r.pdf,r.email_status,b.data->>'email' AS email
        FROM brilon_rechnungen r JOIN brilon_buchungen b ON b.id=r.buchung_id WHERE r.id=$1`,[id]);}
      catch{return reply(res,503,{error:'Rechnungsspeicher ist noch nicht eingerichtet.'});}
      if(!q.rowCount)return reply(res,404,{error:'Rechnung nicht gefunden.'});
      if(req.method==='GET'&&rechnungRoute[2]){
        res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="Rechnung-${q.rows[0].rechnungsnummer}.pdf"`,'Cache-Control':'no-store',...securityHeaders});
        return res.end(q.rows[0].pdf);
      }
      if(req.method==='POST'&&rechnungRoute[3]){
        const row=q.rows[0];
        if(!row.email)return reply(res,409,{error:'Für die Buchung ist keine Kunden-E-Mail hinterlegt.'});
        try{
          await brevoMail(row.email,'Deine Rechnung – Klettern & Abenteuer Brilon',
            `Guten Tag,\n\nanbei erhältst du deine Rechnung ${row.rechnungsnummer} als PDF.\n\nViele Grüße\nKlettern & Abenteuer Brilon`,
            {idempotencyKey:id,attachments:[{name:`Rechnung-${row.rechnungsnummer}.pdf`,content:Buffer.from(row.pdf).toString('base64')}]});
          await pool.query("UPDATE brilon_rechnungen SET email_status='angenommen',email_fehler=NULL,versandt_am=NOW() WHERE id=$1",[id]);
          return reply(res,200,{success:true,status:'angenommen'});
        }catch(error){
          const state=error?.uncertain?'unklar':'fehlgeschlagen';
          await pool.query('UPDATE brilon_rechnungen SET email_status=$1,email_fehler=$2 WHERE id=$3',[state,safeText(error.message,250),id]);
          return reply(res,503,{error:'Rechnungs-E-Mail konnte nicht bestätigt werden.',status:state});
        }
      }
    }

    if(route==='/api/admin/login'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Admin-Anfragen müssen von derselben Website stammen.'});
      const kontoId=gpsTokenHash(process.env.ADMIN_USER||'unconfigured');
      if(!adminLoginErlauben(rateLimiter,ip,kontoId))
        return reply(res,429,{error:'Zu viele Versuche.'});
      const d=await body(req),
            username=process.env.ADMIN_USER,
            password=process.env.ADMIN_PASSWORD;
      if(!username||!password)
        return reply(res,503,{error:'Admin-Zugang nicht eingerichtet.'});
      const a=Buffer.from(String(d.username||'')),
            b=Buffer.from(username),
            c=Buffer.from(String(d.password||'')),
            e=Buffer.from(password);
      if(a.length!==b.length||c.length!==e.length||
         !crypto.timingSafeEqual(a,b)||!crypto.timingSafeEqual(c,e))
        return reply(res,401,{error:'Zugangsdaten nicht korrekt.'});

      const token=crypto.randomBytes(32).toString('hex');
      const ablauf=new Date(Date.now()+8*3600000);
      if(pool){
        try{
          await pool.query('DELETE FROM brilon_admin_sessions WHERE expires_at<=NOW()');
          await pool.query('INSERT INTO brilon_admin_sessions(token_hash,expires_at) VALUES($1,$2)',
            [gpsTokenHash(token),ablauf]);
        }catch{return reply(res,503,{error:'Admin-Sitzungsspeicher ist nicht initialisiert.'});}
      }else{
        abgelaufeneEintraegeEntfernen(sessions);
        sessions.set(token,ablauf.getTime());
      }
      return reply(res,200,{success:true,csrfToken:adminCsrfToken(token)},{
        'Set-Cookie':`${cookieName}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`
      });
    }

    if(route==='/api/admin/csrf'&&req.method==='GET'){
      if(!await admin(req,res))return;
      const token=(req.headers.cookie||'').match(/(?:^|;\s*)brilon_session=([a-f0-9]{64})/)?.[1];
      return reply(res,200,{csrfToken:adminCsrfToken(token)});
    }

    // Nur Vorschau: keine Buchung und kein Zahlungssaldo wird veraendert.
    if(route==='/api/admin/anschlussrabatt/vorschau'&&req.method==='POST'){
      if(!await admin(req,res))return;
      const d=await body(req);
      if(!d||!Array.isArray(d.programme)||d.programme.length<2||d.programme.length>20)
        return reply(res,400,{error:'Bitte 2 bis 20 Programme angeben.'});
      try{
        const positionen=anschlussrabatte(d.programme);
        return reply(res,200,{
          positionen,
          rabattGesamtCent:positionen.reduce((sum,p)=>sum+p.rabattCent,0),
          endpreisGesamtCent:positionen.reduce((sum,p)=>sum+p.endpreisCent,0)
        });
      }catch(fehler){
        return reply(res,400,{error:fehler.message});
      }
    }

    if(route==='/api/admin/anschlussrabatt/anwenden'&&req.method==='POST'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});

      const d=await body(req),ids=Array.isArray(d?.buchungsIds)?[...new Set(d.buchungsIds)]:[];
      if(ids.length<2||ids.length>20||ids.some(id=>typeof id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)))
        return reply(res,400,{error:'Bitte 2 bis 20 gültige Buchungen auswählen.'});
      const ergebnis=await reservierungsTransaktion(async client=>{
        const q=await client.query(
          `SELECT id,status,data FROM brilon_buchungen WHERE id=ANY($1::uuid[]) FOR UPDATE`,[ids]
        );
        if(q.rowCount!==ids.length)return {ungueltig:true};
        if(q.rows.some(b=>b.status!=='bestaetigt'))return {nichtBestaetigt:true};
        const datum=q.rows[0].data.datum;
        if(q.rows.some(b=>b.data.datum!==datum))return {verschiedeneTage:true};
        if(q.rows.some(b=>b.data.anschlussRabatt10||Number(b.data.anschlussRabattCent)>0))
          return {bereitsRabattiert:true};
        const programme=q.rows.map(b=>{
          const fenster=buchungsfenster(b.data);
          if(!fenster||!Number.isFinite(Number(b.data.gesamtpreis)))throw new Error('Preis oder Zeitfenster fehlt.');
          const start=new Date(datum+'T00:00:00Z').getTime()+fenster[0]*60000;
          const ende=new Date(datum+'T00:00:00Z').getTime()+fenster[1]*60000;
          return {id:b.id,start:new Date(start).toISOString(),ende:new Date(ende).toISOString(),
            preisCent:Math.round(Number(b.data.gesamtpreis)*100)};
        });
        let positionen;
        try{positionen=anschlussrabatte(programme);}catch(error){return {ungueltig:true,fehler:error.message};}
        const nachPosition=new Map(positionen.map(p=>[p.id,p]));
        const updates=[];
        for(const buchung of q.rows){
          const position=nachPosition.get(buchung.id);
          if(!position?.rabattCent)continue;
          const data=buchung.data,alterCent=position.originalCent;
          const basisCent=Number.isSafeInteger(data.preisVorEmpfehlungsrabattCent)
            ?data.preisVorEmpfehlungsrabattCent:alterCent;
          const bisherigerRabattCent=Math.max(0,Number(data.rabattCent??data.empfehlungRabattCent)||0);
          const gesamtrabattCent=Math.max(bisherigerRabattCent,Math.round(basisCent*.1));
          const neuerCent=Math.max(0,basisCent-gesamtrabattCent);
          const tatsaechlicherRabattCent=Math.max(0,alterCent-neuerCent);
          if(!tatsaechlicherRabattCent)continue;
          const payments=Array.isArray(data.zahlungen)?data.zahlungen:[];
          const stand=preisNachAnschlussrabatt(alterCent,tatsaechlicherRabattCent,payments);
          data.anschlussRabattVorher={art:data.rabattArt|| (data.empfehlung?'empfehlung':null),
            cent:Number(data.rabattCent??data.empfehlungRabattCent)||0,basisCent:Number(data.rabattBasisCent)||basisCent};
          const anpassung={grund:'Anschlussrabatt 10 %; höherer Rabatt bleibt bestehen, Rabatte werden nicht addiert',am:new Date().toISOString(),vonCent:alterCent,
            rabattCent:tatsaechlicherRabattCent,aufCent:neuerCent};
          data.preisanpassungen=[...(Array.isArray(data.preisanpassungen)?data.preisanpassungen:[]),anpassung];
          data.gesamtpreis=neuerCent/100;
          data.anschlussRabattCent=tatsaechlicherRabattCent;
          data.anschlussRabattGesamtCent=gesamtrabattCent;
          data.anschlussRabatt10=true;
          if(gesamtrabattCent>bisherigerRabattCent)data.rabattArt='anschlussbuchung';
          data.rabattCent=gesamtrabattCent;data.rabattBasisCent=basisCent;
          data.restbetrag=stand.offenCent/100;
          data.zahlungsgutschriftCent=stand.gutschriftCent;
          const saved=await client.query(
            'UPDATE brilon_buchungen SET data=$1::jsonb,updated_at=NOW() WHERE id=$2 RETURNING id,buchungsnummer,status,data',
            [JSON.stringify(data),buchung.id]
          );
          updates.push({buchung:saved.rows[0],rabattCent:tatsaechlicherRabattCent,stand});
        }
        if(!updates.length)return {keineAnschluesse:true};
        return {updates};
      });
      if(ergebnis.ungueltig)return reply(res,400,{error:ergebnis.fehler||'Ausgewählte Buchungen sind ungültig.'});
      if(ergebnis.nichtBestaetigt)return reply(res,409,{error:'Nur bestätigte Buchungen können rabattiert werden.'});
      if(ergebnis.verschiedeneTage)return reply(res,409,{error:'Alle Buchungen müssen am selben Tag stattfinden.'});
      if(ergebnis.bereitsRabattiert)return reply(res,409,{error:'Mindestens eine Buchung hat bereits einen Anschlussrabatt erhalten.'});
      if(ergebnis.keineAnschluesse)return reply(res,409,{error:'Keine direkt anschließenden Programmzeiten gefunden.'});
      for(const item of ergebnis.updates){
        const data=item.buchung.data;
        if(data.email)Promise.allSettled([brevoMail(data.email,
          'Dein Anschlussrabatt – Klettern & Abenteuer Brilon',
          `Für Buchung ${data.buchungsnummer||''} wurde ein einmaliger Anschlussrabatt von 10 % erfasst.\n`+
          `Neuer Gesamtpreis: ${Number(data.gesamtpreis).toFixed(2).replace('.',',')} €\n`+
          `Eingegangen: ${(item.stand.erhaltenCent/100).toFixed(2).replace('.',',')} €\n`+
          `Noch offen: ${(item.stand.offenCent/100).toFixed(2).replace('.',',')} €\n`+
          (data.zahlungsgutschriftCent?`Zahlungsgutschrift: ${(data.zahlungsgutschriftCent/100).toFixed(2).replace('.',',')} € – bitte manuell ausgleichen.\n`:'')+
          `\nBei Fragen melde dich bitte bei uns.`)]).then(results=>results.forEach(r=>{
            if(r.status==='rejected')console.error('Anschlussrabatt-E-Mail konnte nicht versendet werden.');
          }));
      }
      return reply(res,200,{success:true,updates:ergebnis.updates.map(x=>({
        id:x.buchung.id,buchungsnummer:x.buchung.buchungsnummer,rabattCent:x.rabattCent,
        gesamtpreis:x.buchung.data.gesamtpreis,restbetrag:x.stand.offenCent/100,
        zahlungsgutschriftCent:x.buchung.data.zahlungsgutschriftCent
      }))});
    }

    if(route==='/api/admin/logout'&&req.method==='POST'){
      const match=(req.headers.cookie||'').match(/brilon_session=([a-f0-9]{64})/);
      if(!await admin(req,res))return;
      if(match){
        if(pool){
          try{await pool.query('DELETE FROM brilon_admin_sessions WHERE token_hash=$1',[gpsTokenHash(match[1])]);}
          catch{return reply(res,503,{error:'Admin-Sitzung konnte nicht beendet werden.'});}
        }else sessions.delete(match[1]);
      }
      return reply(res,200,{success:true},{
        'Set-Cookie':`${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
      });
    }

    const kontaktRoute=route.match(/^\/api\/admin\/buchungen\/([0-9a-fA-F-]{36})\/kontakt$/);
    if(kontaktRoute&&req.method==='POST'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht verfügbar.'});
      if(!limit('admin-kontakt:'+kontaktRoute[1],10,600000))
        return reply(res,429,{error:'Bitte mit weiteren E-Mails kurz warten.'});
      const d=await body(req,6000);
      const nachricht=typeof d?.nachricht==='string'?d.nachricht.trim():'';
      if(nachricht.length<3||nachricht.length>3000)
        return reply(res,400,{error:'Bitte eine Nachricht mit 3 bis 3.000 Zeichen eingeben.'});
      const buchungAbfrage=await pool.query(
        'SELECT id,data,buchungsnummer FROM brilon_buchungen WHERE id=$1',
        [kontaktRoute[1]]
      );
      if(!buchungAbfrage.rowCount)return reply(res,404,{error:'Buchungsanfrage nicht gefunden.'});
      const buchung=buchungAbfrage.rows[0],kunde=buchung.data||{};
      const email=safeText(kunde.email,180);
      if(!/^\S+@\S+\.\S+$/.test(email))
        return reply(res,400,{error:'Für diese Buchung ist keine gültige Kunden-E-Mail hinterlegt.'});
      const name=safeText(kunde.name,120)||'';
      const betreff='Rückfrage zu deiner Buchung'+(buchung.buchungsnummer?' '+safeText(buchung.buchungsnummer,40):'')+' – Klettern & Abenteuer Brilon';
      const inhalt=(name?'Hallo '+name+',':'Hallo,')+'\n\n'+nachricht+'\n\nGut Seil!\nKlettern & Abenteuer Brilon';
      const buchungsId=kontaktRoute[1];
      const kontaktEintrag={id:crypto.randomUUID(),empfaenger:email,betreff,inhalt,
        versuchtAm:new Date().toISOString(),status:'wird_versendet'};

      const protokollAktualisieren=update=>reservierungsTransaktion(async client=>{
        const aktuell=await client.query(
          'SELECT data FROM brilon_buchungen WHERE id=$1 FOR UPDATE',[buchungsId]
        );
        if(!aktuell.rowCount)return null;
        const data=aktuell.rows[0].data&&typeof aktuell.rows[0].data==='object'&&!Array.isArray(aktuell.rows[0].data)
          ?{...aktuell.rows[0].data}:{};
        const historie=Array.isArray(data.kundenkontakt)?data.kundenkontakt:[];
        const index=historie.findIndex(eintrag=>eintrag?.id===kontaktEintrag.id);
        if(index<0)historie.push({...kontaktEintrag,...update});
        else historie[index]={...historie[index],...update};
        data.kundenkontakt=historie;
        await client.query(
          'UPDATE brilon_buchungen SET data=$2::jsonb,updated_at=NOW() WHERE id=$1',
          [buchungsId,JSON.stringify(data)]
        );
        return historie;
      });

      try{
        const vorgemerkt=await protokollAktualisieren({});
        if(!vorgemerkt)return reply(res,404,{error:'Buchungsanfrage nicht gefunden.'});
      }catch(fehler){
        console.error('Kunden-E-Mail konnte nicht protokolliert werden; Versand abgebrochen:',fehler?.message||'unbekannter Fehler');
        return reply(res,503,{error:'Die Nachricht konnte nicht sicher vorgemerkt werden. Es wurde keine E-Mail versendet.'});
      }

      try{
        await brevoMail(email,betreff,inhalt);
      }catch(fehler){
        console.error('Direkte Kunden-E-Mail fehlgeschlagen:',fehler?.message||'unbekannter Fehler');
        const fehlgeschlagenAm=new Date().toISOString();
        let eintrag={...kontaktEintrag,status:'fehlgeschlagen',fehlgeschlagenAm};
        try{
          const historie=await protokollAktualisieren({status:'fehlgeschlagen',fehlgeschlagenAm});
          eintrag=historie?.find(item=>item.id===kontaktEintrag.id)||eintrag;
        }catch(protokollFehler){
          console.error('Fehlerstatus der Kunden-E-Mail konnte nicht gespeichert werden:',protokollFehler?.message||'unbekannter Fehler');
        }
        return reply(res,502,{error:'Die E-Mail konnte nicht versendet werden.',eintrag});
      }

      const angenommenAm=new Date().toISOString();
      let eintrag={...kontaktEintrag,status:'angenommen',angenommenAm};
      try{
        const historie=await protokollAktualisieren({status:'angenommen',angenommenAm});
        eintrag=historie?.find(item=>item.id===kontaktEintrag.id)||eintrag;
      }catch(protokollFehler){
        console.error('Versand angenommen, Abschluss des E-Mail-Protokolls fehlgeschlagen:',protokollFehler?.message||'unbekannter Fehler');
        eintrag={...eintrag,status:'ungeklaert',protokollHinweis:'Der Versanddienst hat die Nachricht angenommen; der Abschlussstatus konnte nicht gespeichert werden.'};
      }
      return reply(res,200,{success:true,empfaenger:email,eintrag,
        message:eintrag.status==='angenommen'
          ?'Der Versanddienst hat die E-Mail angenommen. Die Zustellung im Postfach ist damit nicht bestätigt.'
          :'Der Versanddienst hat die E-Mail angenommen, aber der Abschlussstatus konnte nicht im Verlauf gespeichert werden.'});
    }

    const zahlungenRoute = route.match(/^\/api\/admin\/buchungen\/([0-9a-fA-F-]{36})\/zahlungen$/);
    if(zahlungenRoute&&req.method==='POST'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      const d=await body(req);
      const betragText=typeof d.betrag==='string'?d.betrag:String(d.betrag??'');
      if(!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(betragText))
        return reply(res,400,{error:'Bitte einen gültigen Zahlbetrag eingeben.'});
      const betragCent=Math.round(Number(betragText.replace(',','.'))*100);
      if(!Number.isSafeInteger(betragCent)||betragCent<=0)
        return reply(res,400,{error:'Der Zahlbetrag muss größer als 0 € sein.'});
      const eingangsdatum=safeText(d.eingangsdatum,10);
      if(!gueltigesDatum(eingangsdatum)||eingangsdatum>heuteInBerlin())
        return reply(res,400,{error:'Bitte ein gültiges Buchungsdatum bis einschließlich heute angeben.'});
      const methode=safeText(d.methode,24);
      if(!['ueberweisung','bar','karte','sonstiges'].includes(methode))
        return reply(res,400,{error:'Bitte eine gültige Zahlungsart auswählen.'});
      const ergebnis=await reservierungsTransaktion(async client=>{
        const q=await client.query(
          'SELECT id,data,status FROM brilon_buchungen WHERE id=$1 FOR UPDATE',
          [zahlungenRoute[1]]
        );
        if(!q.rowCount)return {fehlt:true};
        const data=q.rows[0].data;
        if(data.partnerhausAbwicklung===true)return {partnerhaus:true};
        if(['abgelehnt','storniert'].includes(q.rows[0].status))return {buchungInaktiv:true};
        if(typeof data.gesamtpreis!=='number'||!Number.isFinite(data.gesamtpreis)||data.gesamtpreis<0)
          return {keinPreis:true};
        const zahlungen=Array.isArray(data.zahlungen)?data.zahlungen:[];
        const gesamtCent=Math.round(Number(data.gesamtpreis)*100);
        let zahlungsErgebnis;
        try { zahlungsErgebnis=zahlungErgaenzen(gesamtCent,zahlungen,betragCent,methode); }
        catch(error){
          if(error.message.includes('offenen Rest'))
            return {ueberzahlung:true,offenCent:zahlungsstand(gesamtCent,zahlungen).offenCent};
          throw error;
        }
        const zahlung={
          id:crypto.randomUUID(),
          betragCent,
          methode,
          eingangsdatum,
          erhaltenAm:new Date().toISOString(),
          notiz:safeText(d.notiz,300),
          erfasstVon:safeText(process.env.ADMIN_USER,100)||'admin'
        };
        data.zahlungen=[...zahlungen,zahlung];
        const neuerStand=zahlungsstand(Math.round(Number(data.gesamtpreis)*100),data.zahlungen);
        // Eine Zahlung allein bestätigt keinen Termin ohne verfügbare Trainer.
        const einsatz=await client.query(`SELECT COUNT(*) FILTER (WHERE status='bestaetigt')::int AS zugesagt,
          COUNT(*) FILTER (WHERE status='eingeteilt')::int AS ausstehend
          FROM brilon_einsaetze WHERE buchung_id=$1`,[q.rows[0].id]);
        const trainerBereit=Number(einsatz.rows[0]?.zugesagt||0)>0&&Number(einsatz.rows[0]?.ausstehend||0)===0;
        const neuerStatus=neuerStand.anzahlungErreicht&&trainerBereit&&q.rows[0].status==='offen'
          ?'bestaetigt':q.rows[0].status;
        const elternRabatt=neuerStatus==='bestaetigt'
          ?await anschlussRabattElternAnwenden(client,data,q.rows[0].id):{angewendet:false};
        if(elternRabatt.ungueltig)return {anschlussElternUngueltig:true};
        const gespeichert=await client.query(
          `UPDATE brilon_buchungen SET data=$1::jsonb,status=$2,updated_at=NOW()
           WHERE id=$3 RETURNING id,data,status`,
          [JSON.stringify(data),neuerStatus,q.rows[0].id]
        );
        return {
          buchung:gespeichert.rows[0],zahlung,stand:neuerStand,
          bestaetigtJetzt:neuerStatus!==q.rows[0].status,elternRabatt
        };
      });
      if(ergebnis.anschlussElternUngueltig)return reply(res,409,{error:'Die Ursprungsbuchung ist nicht mehr bestätigt.'});
      if(ergebnis.fehlt)return reply(res,404,{error:'Buchung nicht gefunden.'});
      if(ergebnis.partnerhaus)return reply(res,409,{error:'Diese Buchung wird direkt vom Partnerhaus abgerechnet. Keine eigene Zahlung erfassen.'});
      if(ergebnis.buchungInaktiv)return reply(res,409,{error:'Für abgelehnte oder stornierte Buchungen dürfen keine neuen Zahlungen erfasst werden.'});
      if(ergebnis.keinPreis)return reply(res,409,{error:'Für diese Buchung ist kein Gesamtpreis hinterlegt.'});
      if(ergebnis.ueberzahlung)return reply(res,409,{
        error:'Der Betrag übersteigt den noch offenen Betrag.',
        offenCent:ergebnis.offenCent
      });
      if(ergebnis.bestaetigtJetzt){
        const data=ergebnis.buchung.data;
        const bestaetigungsText=`Deine Buchung ${data.buchungsnummer || ''} ist verbindlich bestätigt.\n`+
          `Gesamtpreis: ${(ergebnis.stand.gesamtCent/100).toFixed(2).replace('.',',')} €\n`+
          `Anzahlung (25 %): ${(ergebnis.stand.anzahlungCent/100).toFixed(2).replace('.',',')} €\n`+
          `Tatsächlich erfasst: ${(ergebnis.stand.erhaltenCent/100).toFixed(2).replace('.',',')} €\n`+
          `Offener Restbetrag: ${(ergebnis.stand.offenCent/100).toFixed(2).replace('.',',')} €\n\n`+
          `Termin: ${data.datum} um ${data.uhrzeit} Uhr`+
          (ergebnis.elternRabatt?.angewendet?'\nDer 10-%-Anschlussrabatt wurde auch auf deine ursprüngliche Buchung angewendet.':
            ergebnis.elternRabatt?.hoehererRabattBestand?'\nDein bereits bestehender höherer Rabatt bleibt erhalten. Empfehlungs- und Anschlussrabatte werden nicht addiert.':'');
        let followups=null;
        try{followups=await sonderangebotVorschlaege(pool,ergebnis.buchung.id);}
        catch(error){console.error('Anschlussangebote nach Zahlung konnten nicht vorbereitet werden:',error.message);}
        const offerLink=followups?.ok?anschlussLink(ergebnis.buchung.id):null;
        const angeboteText=offerLink?`\n\nPassende Anschlussprogramme mit 10 % Rabatt findest du hier:\n${offerLink}`:'';
        ergebnis.buchung.data.bestaetigungsEmail=await buchungsbestaetigungsEmail({
          buchungId:ergebnis.buchung.id,email:data.email,
          betreff:'Deine Buchung ist bestätigt – Klettern & Abenteuer Brilon',
          text:'Hallo '+(data.name||'')+',\n\n'+bestaetigungsText+angeboteText+'\n\nGut Seil!\nKlettern & Abenteuer Brilon'});
        if(process.env.BOOKING_NOTIFY_EMAIL)brevoMail(
          process.env.BOOKING_NOTIFY_EMAIL,'Buchung bestätigt – Zahlungseingang erfasst',
          bestaetigungsText+'\n\nKundin/Kunde: '+(data.name||'')+' · '+(data.email||'')
        ).catch(fehler=>console.error('Betreiberhinweis nach Bestätigung fehlgeschlagen:',fehler.message));
      }
      if(ergebnis.stand.offenCent===0){
        try{ergebnis.rechnung=await rechnungSichernUndVersenden(ergebnis.buchung.id);}
        catch(error){console.error('Rechnungserstellung nach vollständigem Zahlungseingang fehlgeschlagen:',error.message);ergebnis.rechnung={status:'fehlgeschlagen'};}
      }
      return reply(res,201,ergebnis);
    }

    if(route.match(/^\/api\/admin\/buchungen\/[0-9a-f-]{36}$/)&&req.method==='PATCH'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});

      const id=route.split('/').pop(),d=await body(req);
      if(!d||typeof d!=='object'||Array.isArray(d))
        return reply(res,400,{error:'Ungültige Eingabe.'});

      if(d.zahlungsstatus!==undefined)
        return reply(res,400,{error:'Zahlungen müssen mit Betrag und Zahlungsart einzeln erfasst werden.'});

      let status = d.status,
      notiz = safeText(d.bearbeitungsnotiz, 2000);
      const programmStattgefunden=d.programmStattgefunden;
      if(!['offen','bestaetigt','abgelehnt','storniert'].includes(status))
        return reply(res,400,{error:'Ungültiger Buchungsstatus.'});

      const aenderungen=d.aenderungen;
      if(aenderungen!==undefined){
        if(!aenderungen||typeof aenderungen!=='object'||Array.isArray(aenderungen)||
           Object.keys(aenderungen).some(key=>!['datum','uhrzeit','dauer'].includes(key)))
          return reply(res,400,{error:'Ungültige Terminanpassung.'});
        if(aenderungen.datum!==undefined&&
           (typeof aenderungen.datum!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(aenderungen.datum)||!gueltigesDatum(aenderungen.datum)))
          return reply(res,400,{error:'Bitte ein gültiges Veranstaltungsdatum eingeben.'});
        if(aenderungen.uhrzeit!==undefined&&
           (typeof aenderungen.uhrzeit!=='string'||(aenderungen.uhrzeit!==''&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(aenderungen.uhrzeit))))
          return reply(res,400,{error:'Bitte eine gültige Uhrzeit eingeben.'});
        if(aenderungen.dauer!==undefined&&
           (!Number.isInteger(Number(aenderungen.dauer))||Number(aenderungen.dauer)<15||Number(aenderungen.dauer)>720))
          return reply(res,400,{error:'Die Dauer muss zwischen 15 und 720 Minuten liegen.'});
      }

      const ergebnis=await reservierungsTransaktion(async client=>{
        
const alt=await client.query(
  'SELECT id,data,status FROM brilon_buchungen WHERE id=$1',
  [id]
);

        if(!alt.rowCount)return {fehlt:true};
        
const alterStatus = alt.rows[0].status;
    const buchungsdaten = alt.rows[0].data;
        if(aenderungen)Object.assign(buchungsdaten,aenderungen);

        if(status==='bestaetigt'&&buchungsdaten.empfehlung&&!buchungsdaten.empfehlung.bestaetigtAm)
          return {empfehlungWartetAufBestaetigung:true};
        if(status==='bestaetigt'&&alterStatus!=='bestaetigt'&&buchungsdaten.partnerhausAbwicklung!==true){
          if(buchungsdaten.buchungsmodus!=='einzelplatz'){
            const gesamt=Math.round(Number(buchungsdaten.gesamtpreis)*100);
            if(!Number.isSafeInteger(gesamt)||gesamt<=0||
               !zahlungsstand(gesamt,Array.isArray(buchungsdaten.zahlungen)?buchungsdaten.zahlungen:[]).anzahlungErreicht)
              return {anzahlungFehlt:true};
          }
          const einsatz=await client.query(`SELECT COUNT(*) FILTER (WHERE status='bestaetigt')::int AS zugesagt,
            COUNT(*) FILTER (WHERE status='eingeteilt')::int AS ausstehend
            FROM brilon_einsaetze WHERE buchung_id=$1`,[id]);
          if(Number(einsatz.rows[0]?.zugesagt||0)<1||Number(einsatz.rows[0]?.ausstehend||0)>0)
            return {trainerZusageFehlt:true};
        }

        if(programmStattgefunden!==undefined){
          if(typeof programmStattgefunden!=='boolean')return {ungueltigeDurchfuehrung:true};
          if(programmStattgefunden&&(alterStatus!=='bestaetigt'||
             !gueltigesDatum(buchungsdaten.datum)||buchungsdaten.datum>heuteInBerlin()))
            return {durchfuehrungNichtZulaessig:true};
          if(programmStattgefunden){
            buchungsdaten.programmStattgefunden=true;
            buchungsdaten.programmStattgefundenAm=new Date().toISOString();
          }else{
            delete buchungsdaten.programmStattgefunden;
            delete buchungsdaten.programmStattgefundenAm;
          }
        }


        if(status==='offen'||status==='bestaetigt'){
          const data=alt.rows[0].data;
          const konflikt=await pruefeBuchungskonflikt(
            client,data.datum,buchungsfenster(data),id,
            data.buchungsmodus==='einzelplatz'?{angebot:data.angebot,uhrzeit:data.uhrzeit}:null,
            data.veranstaltungsort
          );
          if(konflikt)return {konflikt};
          if(data.buchungsmodus==='einzelplatz'){
            const programm=await client.query('SELECT kapazitaet FROM brilon_angebote WHERE name=$1 LIMIT 1',[data.angebot]);
            if(!programm.rowCount)return {konflikt:'Die Kapazität dieses Einzelplatzangebots kann nicht geprüft werden.'};
            const belegung=await client.query(
              `SELECT COALESCE(SUM(CASE WHEN data->>'teilnehmer' ~ '^[0-9]+$' THEN (data->>'teilnehmer')::integer ELSE 0 END),0) AS gebucht
               FROM brilon_buchungen WHERE id<>$1 AND data->>'datum'=$2 AND data->>'angebot'=$3 AND data->>'uhrzeit'=$4
                 AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,
              [id,data.datum,data.angebot,data.uhrzeit]
            );
            if(Number(belegung.rows[0].gebucht)+Number(data.teilnehmer||1)>Number(programm.rows[0].kapazitaet))
              return {konflikt:'Die Kapazität für diesen Einzelplatztermin ist ausgeschöpft.'};
          }
        }
        const elternRabatt=status==='bestaetigt'
          ?await anschlussRabattElternAnwenden(client,buchungsdaten,id):{angewendet:false};
        if(elternRabatt.ungueltig)return {anschlussElternUngueltig:true};
        const elternRabattZurueck=status!=='bestaetigt'&&alterStatus==='bestaetigt'&&
          ['storniert','abgelehnt'].includes(status)
          ?await anschlussRabattElternZuruecknehmen(client,buchungsdaten,id):{zurueckgenommen:false};

       const q = await client.query(
  `UPDATE brilon_buchungen
   SET status=$1,
       bearbeitungsnotiz=$2,
       data=$3::jsonb,
       updated_at=NOW()
   WHERE id=$4
   RETURNING id,status,data`,
  [status, notiz, JSON.stringify(buchungsdaten), id]
);
       
return {
  buchung: q.rows[0],
  alterStatus,
  kundenDaten: buchungsdaten,
  elternRabatt,
  elternRabattZurueck
};

      });

      if(ergebnis.fehlt)
        return reply(res,404,{error:'Buchung nicht gefunden.'});
      if(ergebnis.konflikt)
        return reply(res,409,{error:ergebnis.konflikt});
      if(ergebnis.anschlussElternUngueltig)
        return reply(res,409,{error:'Die Ursprungsbuchung ist nicht mehr bestätigt.'});
      if(ergebnis.ungueltigeDurchfuehrung)
        return reply(res,400,{error:'Ungültige Angabe zum Stattfinden des Programms.'});
      if(ergebnis.durchfuehrungNichtZulaessig)
        return reply(res,409,{error:'Nur bestätigte Programme mit einem vergangenen Veranstaltungstag können als stattgefunden dokumentiert werden.'});
      if(ergebnis.empfehlungWartetAufBestaetigung)
        return reply(res,409,{error:'Die Empfehlung muss zuerst über den Bestätigungslink in der E-Mail bestätigt werden.'});
      if(ergebnis.anzahlungFehlt)
        return reply(res,409,{error:'Eine verbindliche Gruppenbuchung erfordert zuerst die verbuchte 25-%-Anzahlung. Eine Partnerhaus-Anfrage wird separat geprüft.'});
      if(ergebnis.trainerZusageFehlt)
        return reply(res,409,{error:'Vor der verbindlichen Bestätigung muss mindestens ein eingeteilter Mitarbeiter zugesagt haben und alle offenen Einteilungen müssen geklärt sein.'});

      
if (
  ergebnis.alterStatus !== status && status !== 'offen'
) {
  const kunde = ergebnis.kundenDaten;
  let followups=null;
  if(status==='bestaetigt'&&kunde?.partnerhausAbwicklung!==true){
    try{followups=await sonderangebotVorschlaege(pool,ergebnis.buchung.id);}
    catch(error){console.error('Anschlussangebote nach Bestätigung konnten nicht vorbereitet werden:',error.message);}
  }
  const empfaenger = kunde?.email;
  const gesamtCent = Number.isFinite(Number(kunde.gesamtpreis))
    ? Math.round(Number(kunde.gesamtpreis) * 100) : null;
  const stand = gesamtCent === null ? null : zahlungsstand(
    gesamtCent, Array.isArray(kunde.zahlungen) ? kunde.zahlungen : []
  );

  const nachricht=kunde?.partnerhausAbwicklung===true&&status==='bestaetigt'
    ?{betreff:`Deine Anfrage bei ${kunde.veranstaltungsort||'deinem Partnerhaus'} ist möglich – nächster Schritt zur Buchung`,
      text:`Die Verfügbarkeit deines Programms wurde geprüft und der Termin ist am Standort möglich. Die verbindliche Buchung sowie die gesamte Abrechnung erfolgen im nächsten Schritt direkt über ${kunde.veranstaltungsort||'das Partnerhaus'}. Die auf unserer Website angezeigte Preisangabe dient nur zur Orientierung. Kontakt: ${kunde.partnerhausKontaktEmail||'Standortkontakt'}.`}
    :buchungsstatusNachricht(status,kunde,stand);

  if (empfaenger && nachricht) {
    const inhalt =
      `Hallo ${kunde.name || ''},\n\n` +
      `${nachricht.text}\n\n` +
      `Datum: ${kunde.datum || 'Nicht angegeben'}\n` +
      `Beginn: ${kunde.uhrzeit || 'Nach Absprache'} Uhr\n` +
      `Teilnehmer: ${kunde.teilnehmer || 'Nicht angegeben'}\n\n` +
      (kunde.partnerhausAbwicklung!==true&&status==='bestaetigt'&&followups?.ok&&anschlussLink(ergebnis.buchung.id)
        ?`Passende Anschlussprogramme mit 10 % Rabatt: ${anschlussLink(ergebnis.buchung.id)}\n\n`:'' )+
      (kunde.partnerhausAbwicklung===true&&status==='bestaetigt'
        ?`Anfrage geprüft und an den Standortkontakt weitergeleitet: ${kunde.partnerhausKontaktEmail||''}\nStandortkontakt anschreiben: mailto:${kunde.partnerhausKontaktEmail||''}?subject=${encodeURIComponent('Rückfrage zu '+(kunde.angebot||'deiner Buchung')+' · '+(kunde.buchungsnummer||''))}\n\n`:'' )+
      (ergebnis.elternRabatt?.angewendet?'Der Anschlussrabatt wurde auch auf die ursprüngliche Buchung angewendet.\n\n':
        ergebnis.elternRabatt?.hoehererRabattBestand?'Der bereits bestehende höhere Rabatt bleibt erhalten. Empfehlungs- und Anschlussrabatte werden nicht addiert.\n\n':'')+
      (ergebnis.elternRabattZurueck?.zurueckgenommen
        ?`Der Rabatt auf die ursprüngliche Buchung wurde nach dem Storno zurückgenommen. Neuer Preis: ${(ergebnis.elternRabattZurueck.buchung.data.gesamtpreis).toFixed(2).replace('.',',')} €, offen: ${(ergebnis.elternRabattZurueck.stand.offenCent/100).toFixed(2).replace('.',',')} €.\n\n`:'' )+
      `Bei Fragen antworte bitte auf diese E-Mail.\n\n` +
      `Gut Seil!\nKlettern & Abenteuer Brilon`;

    if(status==='bestaetigt'){
      ergebnis.buchung.data.bestaetigungsEmail=await buchungsbestaetigungsEmail({
        buchungId:ergebnis.buchung.id,email:empfaenger,betreff:nachricht.betreff,text:inhalt});
      if(kunde.partnerhausAbwicklung===true&&/^\S+@\S+\.\S+$/.test(kunde.partnerhausKontaktEmail||'')){
        const partnerText=`Guten Tag${kunde.partnerhausKontaktName?' '+kunde.partnerhausKontaktName:''},\n\ndie Verwaltung hat die Verfügbarkeit der folgenden Anfrage geprüft. Der Termin ist am Standort möglich. Bitte übernehmen Sie die verbindliche Buchung und Abrechnung direkt mit dem Anfragenden.\n\nProgramm: ${kunde.angebot||'—'}\nTermin: ${kunde.datum||'—'}${kunde.uhrzeit?' um '+kunde.uhrzeit+' Uhr':''}\nTeilnehmende: ${kunde.teilnehmer||'—'}\nAnfragende Person: ${kunde.name||'—'}\nE-Mail: ${kunde.email||'—'}\nBuchungsnummer: ${kunde.buchungsnummer||'—'}\n\nBitte stimmen Sie die Buchung und Zahlungsfragen direkt mit dem Gast ab. Die Website führt keine Abrechnung für dieses Partnerhaus durch.\nAnfragenden anschreiben: mailto:${kunde.email||''}?subject=${encodeURIComponent('Buchung '+(kunde.buchungsnummer||''))}\n\nViele Grüße\nKlettern & Abenteuer Brilon`;
        brevoMail(kunde.partnerhausKontaktEmail,`Verfügbarkeit geprüft: ${kunde.angebot||'Programm'} am ${kunde.datum||'Termin'}`,partnerText)
          .catch(error=>console.error('Partnerhaus-Hinweis fehlgeschlagen:',error.message));
      }
    }else{
      brevoMail(empfaenger,nachricht.betreff,inhalt)
        .catch(fehler=>console.error('Status-E-Mail fehlgeschlagen:',fehler.message));
    }
  }
}

      return reply(res,200,ergebnis.buchung);
    }

    if (route.match(/^\/api\/admin\/buchungen\/[0-9a-f-]{36}\/zahlung$/)
    && req.method === 'POST') {

  if (!await admin(req, res)) return;
  if (!pool) {
    return reply(res, 503, {
      error: 'Datenbank nicht verfügbar.'
    });
  }

    const buchungsId = route.split('/')[4];

const buchungAbfrage = await pool.query(
  `SELECT id, data, status, buchungsnummer
   FROM brilon_buchungen
   WHERE id = $1`,
  [buchungsId]
);

if (!buchungAbfrage.rows.length) {
  return reply(res, 404, {
    error: 'Buchungsanfrage nicht gefunden.'
  });
}

const buchung = buchungAbfrage.rows[0];
const kunde = buchung.data;
if(kunde.partnerhausAbwicklung===true)
  return reply(res,409,{error:'Das Partnerhaus stellt dem Gast Rechnung. Eigene Zahlungsaufforderungen sind gesperrt.'});
if(kunde.buchungsmodus==='einzelplatz')
  return reply(res,409,{error:'Für Einzelplatzreservierungen werden keine Anzahlungsinformationen versendet.'});

if (
  typeof kunde.gesamtpreis !== 'number' ||
  !Number.isFinite(kunde.gesamtpreis) ||
  kunde.gesamtpreis < 0
) {
  return reply(res, 400, {
    error: 'Für diese Buchung ist kein gültiger Gesamtpreis hinterlegt.'
  });
}  
     let rechnungsEinstellungen={};
     try{
       const x=await pool.query('SELECT data FROM brilon_rechnungsdaten WHERE id=1');
       rechnungsEinstellungen=x.rows[0]?.data||{};
     }catch(error){console.error('Zahlungsdaten nicht abrufbar:',error.message);}
     const bankName=safeText(rechnungsEinstellungen.bankname,120)||process.env.BANK_NAME||'';
     const bankIban=safeText(rechnungsEinstellungen.iban,60)||process.env.BANK_IBAN||'';
     if(!bankName||!bankIban)
       return reply(res,503,{error:'Bankverbindung in Rechnungen & AGB ist noch nicht vollständig eingerichtet.'});
     const zahlungstext=zahlungsinformationenText(kunde,{
       bankName,iban:bankIban,bookingId:buchung.buchungsnummer||buchungsId
     });
  if (!kunde.email) {
  return reply(res, 400, {
    error: 'Für diese Buchung ist keine Kunden-E-Mail hinterlegt.'
  });
}

try {
  await brevoMail(
    kunde.email,
    'Zahlungsinformationen – Klettern & Abenteuer Brilon',
    zahlungstext
  );
  
const versandProtokoll=await pool.query(
  `UPDATE brilon_buchungen
   SET zahlungsinfo_gesendet_am = NOW()
   WHERE id = $1
   RETURNING zahlungsinfo_gesendet_am`,
  [buchungsId]
);
if(!versandProtokoll.rowCount)
  return reply(res,404,{error:'Buchungsanfrage nicht gefunden.'});

  return reply(res, 200, {
    success: true,
    message: 'Zahlungsinformationen wurden versendet und der Versandzeitpunkt gespeichert.',
    zahlungsinfoGesendetAm:versandProtokoll.rows[0].zahlungsinfo_gesendet_am
  });
} catch (fehler) {
  console.error('Zahlungs-E-Mail fehlgeschlagen:', fehler);

  return reply(res, 502, {
    error: 'Die Zahlungs-E-Mail konnte nicht versendet werden.'
  });
}
}
    const connectionOptionsRoute=route.match(/^\/api\/admin\/kalender\/([0-9a-f-]{36})\/anschluss-optionen$/i);
    if(connectionOptionsRoute&&req.method==='GET'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      const event=await pool.query("SELECT id,titel,datum::text AS datum,uhrzeit::text AS uhrzeit,endzeit::text AS endzeit,COALESCE(standorte,'{}'::text[]) AS standorte FROM brilon_kalender WHERE id=$1 AND typ='termin'",[connectionOptionsRoute[1]]);
      if(!event.rowCount)return reply(res,404,{error:'Kalendereintrag nicht gefunden.'});
      const row=event.rows[0],place=row.standorte?.length===1?row.standorte[0]:'';
      const [programs,staff,requests]=await Promise.all([
        place?pool.query(`SELECT id,name,dauer,kapazitaet,preise,veranstaltungsort
          FROM brilon_angebote WHERE archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true
            AND veranstaltungsort=$1 ORDER BY sortierung,name,id`,[place]):Promise.resolve({rows:[]}),
        place?pool.query(`SELECT DISTINCT m.id,m.name,m.email FROM brilon_pruef_mitarbeitende m
          JOIN brilon_pruef_freigaben f ON f.mitarbeiter_id=m.id
          JOIN brilon_orte o ON o.id=f.ort_id AND o.aktiv=true AND o.name=$1
          WHERE m.aktiv=true AND m.registriert_am IS NOT NULL AND m.freigabe_am IS NOT NULL
            AND m.name<>'Gelöschtes Mitarbeiterkonto' ORDER BY m.name`,[place]):Promise.resolve({rows:[]}),
        pool.query(`SELECT id,titel,datum::text AS datum,uhrzeit::text AS uhrzeit,endzeit::text AS endzeit,
            anschluss,COALESCE((SELECT m.name FROM brilon_kalender_einsaetze e JOIN brilon_pruef_mitarbeitende m
              ON m.id=e.mitarbeiter_id WHERE e.kalender_id=k.id ORDER BY e.zugewiesen_am DESC LIMIT 1),'') AS mitarbeiter
          FROM brilon_kalender k WHERE k.anschluss->>'anchorId'=$1 ORDER BY k.datum,k.uhrzeit`,[connectionOptionsRoute[1]])
      ]);
      return reply(res,200,{event:row,programme:programs.rows,mitarbeiter:staff.rows,anschlussanfragen:requests.rows});
    }

    const createConnectionRoute=route.match(/^\/api\/admin\/kalender\/([0-9a-f-]{36})\/anschlussanfrage$/i);
    if(createConnectionRoute&&req.method==='POST'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
      const d=await body(req),anchorId=createConnectionRoute[1];
      const programId=String(d?.programmId||''),staffId=String(d?.mitarbeiterId||'');
      const directions=Array.isArray(d?.richtungen)?[...new Set(d.richtungen)]:[];
      const participants=Number(d?.teilnehmer);
      const booking=Boolean(d?.anschlussbuchung),discount=Boolean(d?.anschlussrabatt);
      if(!/^[1-9]\d{0,17}$/.test(programId)||! /^[0-9a-f-]{36}$/i.test(staffId)||
         !directions.length||directions.some(x=>!['davor','danach'].includes(x))||
         !Number.isInteger(participants)||participants<1||participants>150||(!booking&&!discount))
        return reply(res,400,{error:'Bitte Programm, Trainer, Gruppengröße, mindestens eine Richtung und Anschlussart auswählen.'});
      const client=await pool.connect();let created=[],person,source,anchorEvent;
      try{
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(7112026)');
        const anchor=await client.query("SELECT id,titel,datum::text AS datum,uhrzeit::text AS uhrzeit,endzeit::text AS endzeit,COALESCE(standorte,'{}'::text[]) AS standorte FROM brilon_kalender WHERE id=$1 AND typ='termin' FOR UPDATE",[anchorId]);
        if(!anchor.rowCount){await client.query('ROLLBACK');return reply(res,404,{error:'Der Bezugstermin ist nicht mehr vorhanden.'});}
        const base=anchor.rows[0];anchorEvent=base;const place=base.standorte?.length===1?base.standorte[0]:'';
        const toMinutes=value=>{const match=String(value||'').match(/^([01]\d|2[0-3]):([0-5]\d)/);return match?Number(match[1])*60+Number(match[2]):null;};
        const anchorStart=toMinutes(base.uhrzeit),anchorEnd=toMinutes(base.endzeit);
        if(!place||anchorStart===null||anchorEnd===null||anchorEnd<=anchorStart){
          await client.query('ROLLBACK');return reply(res,409,{error:'Der Bezugstermin benötigt genau einen Standort sowie eine feste Anfangs- und Endzeit.'});
        }
        const offer=await client.query(`SELECT id,name,beschreibung,dauer,preise,kapazitaet,veranstaltungsort,gruppenstufen,dauer_modus
          FROM brilon_angebote WHERE id=$1 AND archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true FOR SHARE`,[programId]);
        if(!offer.rowCount||offer.rows[0].veranstaltungsort!==place){
          await client.query('ROLLBACK');return reply(res,409,{error:'Das ausgewählte Programm ist an diesem Standort nicht buchbar.'});
        }
        source=offer.rows[0];
        if(participants>Number(source.kapazitaet)){
          await client.query('ROLLBACK');return reply(res,409,{error:'Die Gruppengröße überschreitet die Kapazität des Programms.'});
        }
        if(!source.preise||typeof source.preise!=='object'||!Object.keys(source.preise).length||
           preisFuerTeilnehmer(source.preise,participants,source.gruppenstufen)===null){
          await client.query('ROLLBACK');return reply(res,409,{error:'Für dieses Programm ist für die gewählte Gruppengröße kein Preis hinterlegt.'});
        }
        const duration=buchungsdauerFuerProgramm(participants,source);
        if(!duration){await client.query('ROLLBACK');return reply(res,409,{error:'Die Dauer des Anschlussprogramms kann für diese Gruppengröße nicht berechnet werden.'});}
        const staffRow=await client.query(`SELECT m.id,m.name,m.email FROM brilon_pruef_mitarbeitende m
          WHERE m.id=$1 AND m.aktiv=true AND m.registriert_am IS NOT NULL AND m.freigabe_am IS NOT NULL
            AND EXISTS(SELECT 1 FROM brilon_pruef_freigaben f JOIN brilon_orte o ON o.id=f.ort_id AND o.aktiv=true
              WHERE f.mitarbeiter_id=m.id AND o.name=$2) FOR UPDATE`,[staffId,place]);
        if(!staffRow.rowCount){await client.query('ROLLBACK');return reply(res,409,{error:'Der ausgewählte Mitarbeiter ist für diesen Standort nicht freigegeben.'});}
        person=staffRow.rows[0];
        const occupied=await client.query(`SELECT id,uhrzeit::text AS uhrzeit,endzeit::text AS endzeit,typ,
            COALESCE(standorte,'{}'::text[]) AS standorte FROM brilon_kalender
          WHERE datum=$1::date AND id<>$2 AND (typ='sperrzeit' OR COALESCE(cardinality(standorte),0)=0 OR $3=ANY(standorte))`,
          [base.datum,anchorId,place]);
        const bookings=await client.query(`SELECT id,data FROM brilon_buchungen WHERE data->>'datum'=$1
          AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,[base.datum]);
        const slots=[];
        for(const row of occupied.rows){
          const a=toMinutes(row.uhrzeit),b=toMinutes(row.endzeit);
          if(row.typ==='sperrzeit'||a===null)slots.push([0,1440]);
          else if(b!==null&&b>a)slots.push([a,b]);
        }
        for(const row of bookings.rows){
          const item=row.data||{},where=String(item.veranstaltungsort||'').toLowerCase();
          if(where&&where!==place.toLowerCase())continue;
          const a=toMinutes(item.uhrzeit),len=Number(item.dauer);
          if(a!==null&&Number.isInteger(len)&&len>0)slots.push([a,a+len]);
          else slots.push([0,1440]);
        }
        for(const direction of directions){
          const start=direction==='davor'?anchorStart-15-duration:anchorEnd+15;
          const end=start+duration;
          if(start<0||end>1440){await client.query('ROLLBACK');return reply(res,409,{error:'Für '+(direction==='davor'?'den Termin davor':'den Termin danach')+' reicht der verfügbare Tageszeitraum nicht aus.'});}
          if(slots.some(([a,b])=>start<b&&a<end)){
            await client.query('ROLLBACK');return reply(res,409,{error:'Das berechnete Anschlusszeitfenster überschneidet sich mit einem bestehenden Termin oder einer Sperrzeit.'});
          }
          const time=value=>String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
          const details={anchorId,sourceOfferId:source.id,sourceOfferName:source.name,mitarbeiterId:person.id,
            mitarbeiterName:person.name,anschlussbuchung:booking,anschlussrabatt:discount,richtung:direction,
            teilnehmer:participants,dauer:duration,status:'angefragt',angefragtAm:new Date().toISOString()};
          const description=`Bitte bestätige, ob du „${source.name}“ als Anschlussprogramm am ${base.datum} von ${time(start)} bis ${time(end)} Uhr übernehmen kannst. Bei Zusage wird das passende Angebot für ${place} mit ${participants} Teilnehmenden automatisch veröffentlicht${discount?' und mit 10 % Anschlussrabatt versehen':''}. Bei Ablehnung erhält die Verwaltung eine Rückfrage.`;
          const entry=await client.query(`INSERT INTO brilon_kalender
            (titel,datum,uhrzeit,endzeit,typ,beschreibung,standorte,bewerbung_oeffentlich_ab,anschluss)
            VALUES($1,$2::date,$3::time,$4::time,'termin',$5,$6::text[],NOW(),$7::jsonb) RETURNING id`,
            ['Traineranfrage · '+source.name,base.datum,time(start),time(end),description,[place],JSON.stringify(details)]);
          await client.query(`INSERT INTO brilon_kalender_einsaetze
            (kalender_id,mitarbeiter_id,status,zugewiesen_am,aktualisiert_am)
            VALUES($1,$2,'eingeteilt',NOW(),NOW())
            ON CONFLICT(kalender_id,mitarbeiter_id) DO UPDATE SET status='eingeteilt',zugewiesen_am=NOW(),aktualisiert_am=NOW()`,
            [entry.rows[0].id,person.id]);
          created.push({id:entry.rows[0].id,direction,start:time(start),end:time(end)});
          slots.push([start,end]);
        }
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK');console.error('Anschlussanfrage konnte nicht angelegt werden:',error.message);return reply(res,500,{error:'Die Anschlussanfrage konnte nicht gespeichert werden.'});}
      finally{client.release();}
      let emailVersand='keine_adresse';
      if(person?.email){
        try{
          await brevoMail(person.email,'Anschlussprogramm prüfen: '+source.name,
            `Hallo ${person.name},\n\nbitte prüfe im Mitarbeiterbereich, ob du das Anschlussprogramm „${source.name}“ übernehmen kannst. Termin: ${anchorEvent.datum}, ${created.map(x=>x.start+'–'+x.end+' Uhr').join(' sowie ')}. Die Termine stehen dort unter „Termine und meine Buchungen“. Mit deiner verbindlichen Zusage wird das Angebot automatisch für den Standort veröffentlicht.\n\nKlettern & Abenteuer`);
          emailVersand='gesendet';
        }catch(error){console.error('Anschlussanfrage: Mitarbeiter-E-Mail fehlgeschlagen:',error.message);emailVersand='fehlgeschlagen';}
      }
      return reply(res,201,{success:true,termine:created,emailVersand,message:emailVersand==='gesendet'?'Die Anschlussanfrage wurde angelegt und der Trainer per E-Mail informiert.':'Die Anschlussanfrage wurde angelegt. Bitte den Trainer zusätzlich direkt informieren.'});
    }

    if(route==='/api/admin/kalender'&&req.method==='GET'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      const q=await pool.query(
        "SELECT k.id,k.titel,k.datum::text AS datum,k.enddatum::text AS enddatum,k.uhrzeit::text AS uhrzeit,k.endzeit::text AS endzeit,k.typ,k.beschreibung,COALESCE(k.standorte,'{}'::text[]) AS standorte,k.anschluss,COALESCE((SELECT json_agg(json_build_object('mitarbeiter_id',m.id,'name',m.name,'status',e.status) ORDER BY m.name) FROM brilon_kalender_einsaetze e JOIN brilon_pruef_mitarbeitende m ON m.id=e.mitarbeiter_id WHERE e.kalender_id=k.id),'[]'::json) AS staff FROM brilon_kalender k ORDER BY k.datum,k.uhrzeit NULLS LAST LIMIT 1000"
      );
      return reply(res,200,q.rows);
    }

    if(route==='/api/admin/kalender'&&req.method==='POST'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});

      const d=await body(req);
      if(!d||typeof d!=='object'||Array.isArray(d))
        return reply(res,400,{error:'Ungültige Eingabe.'});

      const titel=safeText(d.titel,120);
      const datum=safeText(d.datum,10);
      const enddatum=safeText(d.enddatum,10)||null;
      const uhrzeit=safeText(d.uhrzeit,5)||null;
      const endzeit=safeText(d.endzeit,5)||null;
      const typ=safeText(d.typ,20);
      const beschreibung=safeText(d.beschreibung,1000),
preis=safeText(d.preis,50);
      const standorte=Array.isArray(d.standorte)?[...new Set(d.standorte.map(value=>safeText(value,80)).filter(Boolean))]:[];

      const gueltigesDatum=v=>{
        if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
        const t=new Date(v+'T12:00:00Z');
        return !Number.isNaN(t.getTime())&&
          t.toISOString().slice(0,10)===v;
      };

      if(!titel||!gueltigesDatum(datum)||
         (enddatum&&(!gueltigesDatum(enddatum)||enddatum<datum))||
         (uhrzeit&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(uhrzeit))||
         (endzeit&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(endzeit))||
         !['termin','sperrzeit'].includes(typ)||standorte.length>50)
        return reply(res,400,{error:'Ungültige Kalenderdaten.'});

      if(standorte.length){
        const places=await pool.query('SELECT name FROM brilon_orte WHERE aktiv=true AND name=ANY($1::text[])',[standorte]);
        if(places.rowCount!==standorte.length)return reply(res,400,{error:'Mindestens ein gewählter Standort ist inaktiv oder nicht vorhanden.'});
      }
      const q=await pool.query(
        'INSERT INTO brilon_kalender(titel,datum,enddatum,uhrzeit,endzeit,typ,beschreibung,standorte) VALUES($1,$2,$3,$4,$5,$6,$7,$8::text[]) RETURNING id',
        [titel,datum,enddatum,uhrzeit,endzeit,typ,beschreibung,standorte]
      );
      return reply(res,201,{id:q.rows[0].id});
    }

    if(/^\/api\/admin\/kalender\/[0-9a-fA-F-]{36}$/.test(route)&&req.method==='DELETE'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});

      const id=route.split('/').pop();
      const q=await pool.query(
        'DELETE FROM brilon_kalender WHERE id=$1 RETURNING id',[id]
      );
      if(!q.rowCount)
        return reply(res,404,{error:'Kalendereintrag nicht gefunden.'});
      return reply(res,200,{success:true});
    }

    if(/^\/api\/admin\/kalender\/[0-9a-fA-F-]{36}$/.test(route)&&req.method==='PATCH'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});

      const id=route.split('/').pop();
      const d=await body(req);
      if(!d||typeof d!=='object'||Array.isArray(d))
        return reply(res,400,{error:'Ungültige Eingabe.'});

      const titel=safeText(d.titel,120);
      const datum=safeText(d.datum,10);
      const enddatum=safeText(d.enddatum,10)||null;
      const uhrzeit=safeText(d.uhrzeit,5)||null;
      const endzeit=safeText(d.endzeit,5)||null;
      const typ=safeText(d.typ,20);
      const beschreibung=safeText(d.beschreibung,1000);
      const standorte=Array.isArray(d.standorte)?[...new Set(d.standorte.map(value=>safeText(value,80)).filter(Boolean))]:[];

      const gueltigesDatum=v=>{
        if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
        const t=new Date(v+'T12:00:00Z');
        return !Number.isNaN(t.getTime())&&t.toISOString().slice(0,10)===v;
      };

      if(!titel||!gueltigesDatum(datum)||
         (enddatum&&(!gueltigesDatum(enddatum)||enddatum<datum))||
         (uhrzeit&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(uhrzeit))||
         (endzeit&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(endzeit))||
         !['termin','sperrzeit'].includes(typ)||standorte.length>50)
        return reply(res,400,{error:'Ungültige Kalenderdaten.'});

      if(standorte.length){
        const places=await pool.query('SELECT name FROM brilon_orte WHERE aktiv=true AND name=ANY($1::text[])',[standorte]);
        if(places.rowCount!==standorte.length)return reply(res,400,{error:'Mindestens ein gewählter Standort ist inaktiv oder nicht vorhanden.'});
      }
      const q=await pool.query(
        'UPDATE brilon_kalender SET titel=$1,datum=$2,enddatum=$3,uhrzeit=$4,endzeit=$5,typ=$6,beschreibung=$7,standorte=$8::text[] WHERE id=$9 RETURNING id',
        [titel,datum,enddatum,uhrzeit,endzeit,typ,beschreibung,standorte,id]
      );
      if(!q.rowCount)
        return reply(res,404,{error:'Kalendereintrag nicht gefunden.'});
      return reply(res,200,{success:true,id:q.rows[0].id});
    }

    if(route.startsWith('/api/admin/')){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});

      if(route==='/api/admin/feedback'&&req.method==='GET'){
        const q=await pool.query(`SELECT COALESCE(b.buchungsnummer,b.data->>'buchungsnummer') AS kundennummer,
            b.data->>'name' AS name,b.data->>'email' AS email,b.data->>'angebot' AS programm,
            f.value AS feedback
          FROM brilon_buchungen b CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(b.data->'feedback')='array' THEN b.data->'feedback' ELSE '[]'::jsonb END
          ) AS f(value) ORDER BY f.value->>'abgegebenAm' DESC LIMIT 500`);
        return reply(res,200,q.rows);
      }

      if(route==='/api/admin/gps/gaesteliste'&&req.method==='GET'){
        const tourId=safeText(u.searchParams.get('tour'),36)||null;
        if(tourId&&!/^[0-9a-f-]{36}$/i.test(tourId))
          return reply(res,400,{error:'Tour-ID ungültig.'});
        const q=await pool.query(
          `SELECT g.id,g.gast_name AS name,to_char(g.abgeschlossen_am,'YYYY-MM-DD') AS datum,
                  g.gast_einwilligung_am AS einwilligung_am,
                  g.gast_einwilligung_version AS einwilligung_version,
                  g.spielzeit_sekunden AS dauer_sekunden,t.data->>'titel' AS tour
           FROM brilon_gps_spiele g JOIN brilon_gps_touren t ON t.id=g.tour_id
           WHERE g.gast_einwilligung=true AND g.gast_name IS NOT NULL
             AND g.abgeschlossen_am IS NOT NULL AND ($1::uuid IS NULL OR g.tour_id=$1::uuid)
           ORDER BY g.abgeschlossen_am DESC LIMIT 500`,[tourId]
        );
        return reply(res,200,q.rows);
      }

      // Dienstplanung: nur die Verwaltung darf Mitarbeiter für Buchungen einteilen.
      if(route==='/api/admin/kalender-mitarbeitende'&&req.method==='GET'){
        const q=await pool.query(`SELECT id,name,email FROM brilon_pruef_mitarbeitende
          WHERE aktiv=true AND registriert_am IS NOT NULL AND freigabe_am IS NOT NULL
          ORDER BY name,id`);
        return reply(res,200,q.rows);
      }
      const planung=route.match(/^\/api\/admin\/kalenderzuweisung\/([0-9a-f-]{36})$/i);
      if(planung&&req.method==='PATCH')return reply(res,410,{error:'Bitte den neuen Einsatzplanungsbereich verwenden; dort werden Arbeitszeit- und Verdienstgrenzen geprüft.'});
      if(false&&planung&&req.method==='PATCH'){
        const d=await body(req);
        if(!d||typeof d!=='object'||Array.isArray(d)||
            !Array.isArray(d.mitarbeiterIds)||d.mitarbeiterIds.length>30||
            d.mitarbeiterIds.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)))
          return reply(res,400,{error:'Ungültige Mitarbeiterzuweisung.'});
        const ids=[...new Set(d.mitarbeiterIds)];
        if(ids.length){
          const staff=await pool.query(`SELECT id FROM brilon_pruef_mitarbeitende
            WHERE id=ANY($1::uuid[]) AND aktiv=true AND registriert_am IS NOT NULL
              AND freigabe_am IS NOT NULL`,[ids]);
          if(staff.rows.length!==ids.length)
            return reply(res,409,{error:'Mindestens ein Mitarbeiter ist nicht freigegeben oder nicht aktiv.'});
        }
        const q=await pool.query(`UPDATE brilon_buchungen SET
          data=jsonb_set(data,'{mitarbeiterZuweisungen}',$1::jsonb,true),
          updated_at=NOW()
          WHERE id=$2 AND COALESCE(status,'offen') IN ('offen','bestaetigt')
          RETURNING id,data->'mitarbeiterZuweisungen' AS mitarbeiter_ids`,
          [JSON.stringify(ids),planung[1]]);
        if(!q.rowCount)return reply(res,404,{error:'Aktive Buchung nicht gefunden.'});
        return reply(res,200,{id:q.rows[0].id,mitarbeiterIds:q.rows[0].mitarbeiter_ids});
      }

      if(route==='/api/admin/kalenderbuchungen'&&req.method==='GET'){
        const monat=safeText(u.searchParams.get('monat'),7);
        const match=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(monat);
        if(!match||Number(match[1])<1900||Number(match[1])>9998)
          return reply(res,400,{error:'Ungültiger Kalendermonat.'});
        const start=monat+'-01';
        const endDate=new Date(Date.UTC(Number(match[1]),Number(match[2]),1));
        const ende=endDate.toISOString().slice(0,10);
        const q=await pool.query(
          `SELECT id,data,status,bearbeitungsnotiz,created_at
           FROM brilon_buchungen
           WHERE data->>'datum'>=$1 AND data->>'datum'<$2
             AND COALESCE(status,'offen') IN ('offen','bestaetigt')
           ORDER BY data->>'datum',data->>'uhrzeit',created_at`,[start,ende]
        );
        return reply(res,200,q.rows);
      }

      if(route==='/api/admin/zahlungsuebersicht'&&req.method==='GET'){
        const seiteText=u.searchParams.get('seite')||'1',seite=Number(seiteText),proSeite=50;
        const filter=safeText(u.searchParams.get('filter'),20)||'alle';
        const erlaubteFilter=['alle','offen','teilzahlung','vollstaendig','gutschrift'];
        if(!/^\d+$/.test(seiteText)||!Number.isSafeInteger(seite)||seite<1||seite>100000)
          return reply(res,400,{error:'Ungültige Zahlungsseite.'});
        if(!erlaubteFilter.includes(filter))return reply(res,400,{error:'Ungültiger Zahlungsfilter.'});
        const q=await pool.query(
          `SELECT id,status,buchungsnummer,
             jsonb_build_object(
               'buchungsnummer',data->'buchungsnummer','name',data->'name','angebot',data->'angebot',
               'datum',data->'datum','gesamtpreis',data->'gesamtpreis','zahlungen',data->'zahlungen',
               'zahlungsgutschriftCent',data->'zahlungsgutschriftCent'
             ) AS data
           FROM brilon_buchungen ORDER BY created_at DESC,id DESC`
        );
        const totals=zahlungenSummieren(q.rows);
        const gefiltert=totals.eintraege.filter(e=>{
          if(filter==='offen')return e.offenCent>0;
          if(filter==='teilzahlung')return e.eingegangenCent>0&&e.offenCent>0;
          if(filter==='vollstaendig')return e.gesamtpreisCent!==null&&e.gesamtpreisCent>0&&e.eingegangenCent>=e.gesamtpreisCent;
          if(filter==='gutschrift')return e.gutschriftCent>0;
          return true;
        });
        return reply(res,200,{
          eintraege:gefiltert.slice((seite-1)*proSeite,seite*proSeite),anzahl:gefiltert.length,
          seite,proSeite,summen:{eingegangenCent:totals.eingegangenCent,offenCent:totals.offenCent,
            gutschriftCent:totals.gutschriftCent,zahlungseingaenge:totals.zahlungseingaenge}
        });
      }

      const guestbookEntry=route.match(/^\/api\/admin\/gps\/gaesteliste\/([0-9a-f-]{36})$/i);
      if(guestbookEntry&&req.method==='DELETE'){
        const q=await pool.query(
          `UPDATE brilon_gps_spiele SET gast_name=NULL,gast_einwilligung=false,gast_einwilligung_am=NULL,
             gast_einwilligung_version=NULL
           WHERE id=$1 AND gast_einwilligung=true RETURNING id`,[guestbookEntry[1]]
        );
        if(!q.rowCount)return reply(res,404,{error:'Freigegebener Gästelisteneintrag nicht gefunden.'});
        return reply(res,200,{success:true});
      }

      if(route==='/api/admin/gps/touren'&&req.method==='GET'){
        const q=await pool.query('SELECT id,data,aktiv,erstellt_am,aktualisiert_am FROM brilon_gps_touren ORDER BY erstellt_am DESC');
        return reply(res,200,q.rows.map(r=>({id:r.id,...gpsTourAdminAnsicht(r.data),aktiv:r.aktiv,
          erstelltAm:r.erstellt_am,aktualisiertAm:r.aktualisiert_am})));
      }

      if(route==='/api/admin/gps/touren'&&req.method==='POST'){
        const d=await body(req);
        let data;
        try{data=gpsTourSpeichern(d,null,process.env.GPS_CODE_SECRET);}catch(error){return reply(res,400,{error:error.message});}
        const id=crypto.randomUUID(),aktiv=d.aktiv===true&&data.buchbar;
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          const offer=await client.query(
            `INSERT INTO brilon_angebote(name,beschreibung,dauer,preise,aktiv)
             VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id`,
            [data.angebotName,data.beschreibung,data.dauer,
              JSON.stringify({'1-4':data.preis,'5-10':data.preis,'11-15':data.preis,'16-20':data.preis,'21-150':data.preis}),aktiv]
          );
          await client.query('INSERT INTO brilon_gps_touren(id,angebot_id,data,aktiv) VALUES($1,$2,$3::jsonb,$4)',
            [id,offer.rows[0].id,JSON.stringify(data),aktiv]);
          await client.query('COMMIT');
        }catch(error){try{await client.query('ROLLBACK')}catch{};throw error;}
        finally{client.release();}
        return reply(res,201,{id,aktiv,angebotName:data.angebotName});
      }

      const tourRoute=route.match(/^\/api\/admin\/gps\/touren\/([0-9a-fA-F-]{36})$/);
      if(tourRoute&&req.method==='PATCH'){
        const d=await body(req);
        if(typeof d.aktiv==='boolean'&&d.stationen===undefined){
          const status=await pool.query(
            'UPDATE brilon_gps_touren SET aktiv=$1,aktualisiert_am=NOW() WHERE id=$2 RETURNING id,aktiv',
            [d.aktiv,tourRoute[1]]
          );
          if(!status.rowCount)return reply(res,404,{error:'GPS-Tour nicht gefunden.'});
          const offerId=await pool.query('SELECT angebot_id,data FROM brilon_gps_touren WHERE id=$1',[tourRoute[1]]);
          if(offerId.rows[0].angebot_id)await pool.query('UPDATE brilon_angebote SET aktiv=$1 WHERE id=$2',
            [d.aktiv&&offerId.rows[0].data.buchbar,offerId.rows[0].angebot_id]);
          return reply(res,200,status.rows[0]);
        }
        const aktuell=await pool.query('SELECT data,angebot_id FROM brilon_gps_touren WHERE id=$1',[tourRoute[1]]);
        if(!aktuell.rowCount)return reply(res,404,{error:'GPS-Tour nicht gefunden.'});
        let data;
        try{data=gpsTourSpeichern(d,aktuell.rows[0].data,process.env.GPS_CODE_SECRET);}catch(error){return reply(res,400,{error:error.message});}
        const aktiv=typeof d.aktiv==='boolean'?d.aktiv:null;
        const q=await pool.query(
          'UPDATE brilon_gps_touren SET data=$1::jsonb,aktiv=COALESCE($2,aktiv),aktualisiert_am=NOW() WHERE id=$3 RETURNING id,aktiv',
          [JSON.stringify(data),aktiv===true&&!data.buchbar?false:aktiv,tourRoute[1]]
        );
        if(aktuell.rows[0].angebot_id)await pool.query(
          `UPDATE brilon_angebote SET name=$1,beschreibung=$2,dauer=$3,preise=$4::jsonb,aktiv=$5 WHERE id=$6`,
          [data.angebotName,data.beschreibung,data.dauer,
            JSON.stringify({'1-4':data.preis,'5-10':data.preis,'11-15':data.preis,'16-20':data.preis,'21-150':data.preis}),
            q.rows[0].aktiv&&data.buchbar,aktuell.rows[0].angebot_id]
        );
        return reply(res,200,{id:q.rows[0].id,aktiv:q.rows[0].aktiv});
      }

      // Suche und Seitenwahl fuer GPS-Zugaenge - unabhaengig von der gekuerzten Admin-Buchungsliste.
      // Es werden nur die minimalen Angaben zu bestaetigten, tourberechtigten Buchungen geliefert.
      if(route==='/api/admin/gps/buchungen'&&req.method==='GET'){
        const seiteText=u.searchParams.get('seite')||'1',seite=Number(seiteText),proSeite=30;
        const suche=safeText(u.searchParams.get('suche'),120);
        const tourId=u.searchParams.get('tourId')||'';
        if(!/^\d+$/.test(seiteText)||!Number.isSafeInteger(seite)||seite<1||seite>100000)
          return reply(res,400,{error:'Ungültige GPS-Buchungsseite.'});
        if(tourId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tourId))
          return reply(res,400,{error:'Ungültige GPS-Tour.'});
        const params=[suche,tourId||null];
        const where=`WHERE b.status='bestaetigt'
          AND ($1::text='' OR concat_ws(' ',b.buchungsnummer,b.data->>'buchungsnummer',
            b.data->>'name',b.data->>'datum',b.data->>'angebot') ILIKE '%' || $1 || '%')
          AND ($2::uuid IS NULL OR EXISTS (
            SELECT 1 FROM brilon_gps_touren t WHERE t.id=$2::uuid
              AND t.aktiv=true AND t.data->>'buchbar'='true'
              AND b.data->>'angebot'=t.data->>'angebotName'
          ))`;
        const count=await pool.query(`SELECT COUNT(*)::text AS anzahl FROM brilon_buchungen b ${where}`,params);
        const q=await pool.query(
          `SELECT b.id,COALESCE(b.buchungsnummer,b.data->>'buchungsnummer') AS buchungsnummer,
             b.data->>'name' AS name,b.data->>'datum' AS datum,b.data->>'angebot' AS angebot
           FROM brilon_buchungen b ${where}
           ORDER BY b.created_at DESC,b.id DESC LIMIT $3 OFFSET $4`,
          [...params,proSeite,(seite-1)*proSeite]
        );
        return reply(res,200,{buchungen:q.rows,anzahl:Number(count.rows[0]?.anzahl||0),seite,proSeite});
      }

      // Nur Metadaten: Die geheimen GPS-Tokens und ihre Hashwerte werden nie ausgeliefert.
      if(route==='/api/admin/gps/spiele'&&req.method==='GET'){
        const seiteText=u.searchParams.get('seite')||'1',seite=Number(seiteText),proSeite=30;
        const tourId=u.searchParams.get('tourId')||'';
        if(!/^\d+$/.test(seiteText)||!Number.isSafeInteger(seite)||seite<1||seite>100000)
          return reply(res,400,{error:'Ungültige GPS-Zugangsseite.'});
        if(tourId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tourId))
          return reply(res,400,{error:'Ungültige GPS-Tour.'});
        const params=[tourId||null];
        const where='WHERE ($1::uuid IS NULL OR g.tour_id=$1::uuid)';
        const count=await pool.query(
          `SELECT COUNT(*)::text AS anzahl FROM brilon_gps_spiele g ${where}`,params);
        const q=await pool.query(
          `SELECT g.id,g.tour_id AS "tourId",g.buchung_id AS "buchungId",
             g.erstellt_am AS "erstelltAm",g.gestartet_am AS "gestartetAm",
             g.abgeschlossen_am AS "abgeschlossenAm",g.gesperrt_am AS "gesperrtAm",
             g.station_index AS "stationIndex",g.spielzeit_sekunden AS "spielzeitSekunden",
             t.data->>'titel' AS tour,
             COALESCE(b.buchungsnummer,b.data->>'buchungsnummer') AS buchungsnummer,
             b.data->>'name' AS name,b.data->>'datum' AS datum,
             CASE
               WHEN g.gesperrt_am IS NOT NULL THEN 'gesperrt'
               WHEN g.abgeschlossen_am IS NOT NULL THEN 'abgeschlossen'
               WHEN t.aktiv=false OR t.data->>'buchbar'<>'true' OR b.status<>'bestaetigt'
                 THEN 'nicht_freigegeben'
               WHEN g.gestartet_am IS NOT NULL THEN 'gestartet'
               ELSE 'ausgestellt'
             END AS status
           FROM brilon_gps_spiele g
           JOIN brilon_gps_touren t ON t.id=g.tour_id
           JOIN brilon_buchungen b ON b.id=g.buchung_id ${where}
           ORDER BY g.erstellt_am DESC,g.id DESC LIMIT $2 OFFSET $3`,
          [...params,proSeite,(seite-1)*proSeite]
        );
        return reply(res,200,{spiele:q.rows,anzahl:Number(count.rows[0]?.anzahl||0),seite,proSeite});
      }

      const sperrenGps=route.match(/^\/api\/admin\/gps\/spiele\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/sperren$/i);
      if(sperrenGps&&req.method==='PATCH'){
        const q=await pool.query(
          'UPDATE brilon_gps_spiele SET gesperrt_am=COALESCE(gesperrt_am,NOW()) WHERE id=$1 RETURNING id,gesperrt_am AS "gesperrtAm"',
          [sperrenGps[1]]
        );
        if(!q.rowCount)return reply(res,404,{error:'GPS-Spielzugang nicht gefunden.'});
        return reply(res,200,{success:true,...q.rows[0]});
      }

      if(route==='/api/admin/gps/spiele'&&req.method==='POST'){
        const d=await body(req),tourId=safeText(d.tourId,36),buchungId=safeText(d.buchungId,36);
        if(!/^[0-9a-f-]{36}$/i.test(tourId)||!/^[0-9a-f-]{36}$/i.test(buchungId))
          return reply(res,400,{error:'Tour und bestätigte Buchung auswählen.'});
        const zulassung=await pool.query(
          `SELECT t.id FROM brilon_gps_touren t JOIN brilon_buchungen b ON b.id=$2
           WHERE t.id=$1 AND t.aktiv=true AND t.data->>'buchbar'='true'
             AND b.status='bestaetigt' AND b.data->>'angebot'=t.data->>'angebotName'`,
          [tourId,buchungId]
        );
        if(!zulassung.rowCount)return reply(res,409,{error:'Tour oder Buchung ist nicht freigegeben.'});
        const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID();
        await pool.query(
          'INSERT INTO brilon_gps_spiele(id,token_hash,tour_id,buchung_id) VALUES($1,$2,$3,$4)',
          [id,gpsTokenHash(token),tourId,buchungId]
        );
        return reply(res,201,{id,zugangslink:`/gps.html?zugang=${encodeURIComponent(token)}`});
      }

      // Lesende Anschlussübersicht für bestätigte Buchungen der kommenden drei Monate.
      if(route==='/api/admin/anschlussrabatt/termine'&&req.method==='GET'){
        const q=await pool.query(`
          SELECT b.id,b.buchungsnummer,b.data,
            COALESCE(jsonb_agg(jsonb_build_object('name',m.name,'anschlussOption',e.anschluss_option)
              ORDER BY m.name) FILTER (WHERE e.status='bestaetigt'), '[]'::jsonb) AS trainer,
            EXISTS(SELECT 1 FROM brilon_aktionen a
              WHERE a.data->>'quelle_buchung_id'=b.id::text
                AND COALESCE(a.data->>'status','veroeffentlicht')='veroeffentlicht') AS anschluss_veroeffentlicht,
            CASE
              WHEN EXISTS(SELECT 1 FROM brilon_aktionen a WHERE a.data->>'quelle_buchung_id'=b.id::text
                AND COALESCE(a.data->>'status','veroeffentlicht')='veroeffentlicht') THEN 'gruen'
              WHEN EXISTS(SELECT 1 FROM brilon_einsaetze e WHERE e.buchung_id=b.id AND e.status='bestaetigt'
                AND e.anschluss_option IN ('keine','davor','danach','beides')) THEN 'rot'
              WHEN EXISTS(SELECT 1 FROM brilon_einsaetze e WHERE e.buchung_id=b.id AND e.status='eingeteilt') THEN 'gelb'
              ELSE 'grau'
            END AS anschluss_status
          FROM brilon_buchungen b
          LEFT JOIN brilon_einsaetze e ON e.buchung_id=b.id
          LEFT JOIN brilon_pruef_mitarbeitende m ON m.id=e.mitarbeiter_id
          WHERE b.status='bestaetigt'
            AND b.data->>'datum'>=CURRENT_DATE::text
            AND b.data->>'datum'<=(CURRENT_DATE+INTERVAL '3 months')::date::text
          GROUP BY b.id
          ORDER BY b.data->>'datum',b.data->>'uhrzeit',b.created_at
        `);
        const termine=q.rows.map(row=>{
          const data=row.data||{};
          const status=row.anschluss_status;
          return {
            id:row.id,buchungsnummer:row.buchungsnummer||data.buchungsnummer||null,
            datum:data.datum||'',uhrzeit:data.uhrzeit||'',angebot:data.angebot||'Programm',
            standort:data.veranstaltungsort||'',trainer:row.trainer||[],
            anschlussStatus:status,
            anschlussHinweis:status==='gruen'?'Anschlussprogramm veröffentlicht':
              status==='rot'?'Angefragt, aber nicht möglich':
              status==='gelb'?'Trainerantwort steht noch aus':'Noch kein Trainer bestätigt'
          };
        });
        return reply(res,200,{termine,monate:3});
      }

      // Lesende Uebersicht: angrenzende bestaetigte Buchungen am selben Tag.
      // Keine automatische Rabattberechtigung und keine Preisveraenderung.
      if(route==='/api/admin/anschlussrabatt/kandidaten'&&req.method==='GET'){
        const datum=u.searchParams.get('datum')||'';
        if(!/^\d{4}-\d{2}-\d{2}$/.test(datum))
          return reply(res,400,{error:'Datum im Format YYYY-MM-DD erforderlich.'});
        const q=await pool.query(
          `SELECT id,buchungsnummer,data FROM brilon_buchungen
           WHERE data->>'datum'=$1 AND status='bestaetigt'
           ORDER BY data->>'uhrzeit',created_at`,
          [datum]
        );
        const kandidaten=q.rows.map(b=>{
          const fenster=buchungsfenster(b.data);
          return {
            id:b.id,
            buchungsnummer:b.buchungsnummer||b.data.buchungsnummer||null,
            angebot:b.data.angebot,
            uhrzeit:b.data.uhrzeit,
            beginnMinuten:fenster?fenster[0]:null,
            endeMinuten:fenster?fenster[1]:null,
            preisCent:Number.isFinite(Number(b.data.gesamtpreis))
              &&b.data.gesamtpreis!==null
              ?Math.round(Number(b.data.gesamtpreis)*100):null
          };
        });
        return reply(res,200,{datum,kandidaten,hinweis:
          'Nur Zeituebersicht. Rabatte, Kapazitaet und Zahlungen muessen gesondert geprueft werden.'});
      }

      if(route==='/api/admin/buchungen'&&req.method==='GET'){
        const statusFilter=safeText(u.searchParams.get('status'),20)||'alle';
        const allowedStatus=['alle','offen','bestaetigt','abgelehnt','storniert'];
        if(!allowedStatus.includes(statusFilter))return reply(res,400,{error:'Ungültiger Statusfilter.'});
        const suchtext=safeText(u.searchParams.get('suche'),120);
        if(u.searchParams.has('seite')){
          const seiteText=u.searchParams.get('seite'),seite=Number(seiteText),proSeite=50;
          if(!/^\d+$/.test(seiteText)||!Number.isSafeInteger(seite)||seite<1||seite>100000)
            return reply(res,400,{error:'Ungültige Buchungsseite.'});
          const filterParams=[statusFilter,suchtext];
          const where=`WHERE ($1::text='alle' OR COALESCE(status,'offen')=$1)
             AND ($2::text='' OR concat_ws(' ',data->>'name',buchungsnummer,data->>'buchungsnummer',
               data->>'email',data->>'angebot') ILIKE '%' || $2 || '%')`;
          const count=await pool.query(`SELECT COUNT(*)::text AS anzahl FROM brilon_buchungen ${where}`,filterParams);
          const q=await pool.query(
            `SELECT id,data,status,bearbeitungsnotiz,created_at,updated_at,zahlungsinfo_gesendet_am
             FROM brilon_buchungen ${where}
             ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`,
            [...filterParams,proSeite,(seite-1)*proSeite]
          );
          return reply(res,200,{buchungen:q.rows,anzahl:Number(count.rows[0]?.anzahl||0),seite,proSeite});
        }
        const q=await pool.query(
          `SELECT id,data,status,bearbeitungsnotiz,created_at,updated_at,zahlungsinfo_gesendet_am
           FROM brilon_buchungen
           WHERE ($1::text='alle' OR COALESCE(status,'offen')=$1)
             AND ($2::text='' OR concat_ws(' ',data->>'name',buchungsnummer,data->>'buchungsnummer',
               data->>'email',data->>'angebot') ILIKE '%' || $2 || '%')
           ORDER BY created_at DESC,id DESC LIMIT 250`,[statusFilter,suchtext]
        );
        return reply(res,200,q.rows);
      }

      const buchungsExport=route.match(/^\/api\/admin\/buchungen\/([0-9a-fA-F-]{36})\/export$/);
      if(buchungsExport&&req.method==='GET'){
        const q=await pool.query(
          `SELECT id,data,status,created_at,updated_at,zahlungsinfo_gesendet_am
           FROM brilon_buchungen WHERE id=$1`,[buchungsExport[1]]
        );
        if(!q.rowCount)return reply(res,404,{error:'Buchungsanfrage nicht gefunden.'});
        const selected=q.rows[0],selectedData=selected.data||{};
        const kontaktEmail=typeof selectedData.email==='string'?selectedData.email.trim():'';
        const kundenBuchungen=kontaktEmail
          ?await pool.query(
            `SELECT id,data,status,buchungsnummer,created_at,updated_at,zahlungsinfo_gesendet_am
             FROM brilon_buchungen
             WHERE LOWER(BTRIM(data->>'email'))=LOWER($1)
             ORDER BY created_at,id`,[kontaktEmail]
          )
          :{rows:[selected]};
        const buchungsIds=kundenBuchungen.rows.map(row=>row.id);
        const gps=await pool.query(
          `SELECT t.data->>'titel' AS tour,g.gestartet_am AS gestartet_am,
                  g.abgeschlossen_am AS abgeschlossen_am,g.spielzeit_sekunden AS spielzeit_sekunden,
                  g.station_index AS station_index,g.gast_name AS gast_name,
                  g.gast_einwilligung AS gast_einwilligung,
                  g.gast_einwilligung_am AS einwilligung_am,
                  g.gast_einwilligung_version AS einwilligung_version
           FROM brilon_gps_spiele g JOIN brilon_gps_touren t ON t.id=g.tour_id
           WHERE g.buchung_id=ANY($1::uuid[]) ORDER BY g.erstellt_am`,[buchungsIds]
        );
        const exportDatensatz={
          exportformat:'klettern-abenteuer-kundendaten-v2',exportiertAm:new Date().toISOString(),
          kontaktEmail:kontaktEmail||null,
          buchungen:kundenBuchungen.rows.map(row=>{
            const data=row.data||{};
            return {
              kunde:{vorname:data.vorname||null,nachname:data.nachname||null,name:data.name||null,
                email:data.email||null,telefon:data.telefon||null},
              buchung:{referenz:row.buchungsnummer||data.buchungsnummer||null,status:row.status||'offen',
                angebot:data.angebot||null,datum:data.datum||null,uhrzeit:data.uhrzeit||null,
                teilnehmer:data.teilnehmer??null,dauer:data.dauer??null,nachricht:data.nachricht||null,
                erstelltAm:row.created_at||null,aktualisiertAm:row.updated_at||null,
                zahlungsinformationenGesendetAm:row.zahlungsinfo_gesendet_am||null},
              zahlung:{gesamtpreis:data.gesamtpreis??null,anzahlung:data.anzahlung??null,restbetrag:data.restbetrag??null,
                zahlungsgutschriftCent:data.zahlungsgutschriftCent??0,
                zahlungen:(Array.isArray(data.zahlungen)?data.zahlungen:[])
                  .filter(z=>Number.isSafeInteger(z?.betragCent)&&z.betragCent>0)
                  .map(z=>({betragCent:z.betragCent,methode:z.methode||null,erhaltenAm:z.erhaltenAm||null})),
                preisanpassungen:Array.isArray(data.preisanpassungen)?data.preisanpassungen:[]},
              datenschutzangabe:data.datenschutz||null,
              datenschutznachweis:data.datenschutz==='on'?{
                bestaetigtAm:data.datenschutzBestaetigtAm||null,
                textVersion:data.datenschutzTextVersion||null
              }:null,
              gpsSpiele:gps.rows.filter(spiel=>spiel.buchung_id===row.id)
                .map(spiel=>({tour:spiel.tour||null,gestartetAm:spiel.gestartet_am||null,
                  abgeschlossenAm:spiel.abgeschlossen_am||null,spielzeitSekunden:spiel.spielzeit_sekunden??null,
                  erreichteStation:spiel.station_index??null,
                  gaestelistenName:spiel.gast_einwilligung===true?spiel.gast_name||null:null,
                  oeffentlicheEinwilligung:spiel.gast_einwilligung===true,
                  einwilligungAm:spiel.einwilligung_am||null,einwilligungVersion:spiel.einwilligung_version||null}))
            };
          })
        };
        return reply(res,200,exportDatensatz,{'Content-Disposition':`attachment; filename="buchung-${buchungsExport[1]}.json"`});
      }

      const buchungLoeschen=route.match(
        /^\/api\/admin\/buchungen\/([0-9a-fA-F-]{36})$/
      );
      if(buchungLoeschen&&req.method==='DELETE'){
        if(!await admin(req,res))return;
        if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
        const id=buchungLoeschen[1];
        const loeschung=await reservierungsTransaktion(async client=>{
          const buchung=await client.query('SELECT id,data FROM brilon_buchungen WHERE id=$1 FOR UPDATE',[id]);
          if(!buchung.rowCount)return {nichtGefunden:true};
          const data=buchung.rows[0].data||{};
          const kindBuchung=await client.query(
            `SELECT id FROM brilon_buchungen WHERE data->>'anschlussElternId'=$1 LIMIT 1`,[id]
          );
          if(data.anschlussElternId||data.anschlussRabattQuelleId||kindBuchung.rowCount)
            return {anschlussVerknuepft:true};
          const gpsTabelle=await client.query("SELECT to_regclass('brilon_gps_spiele') AS relation");
          const gps=gpsTabelle.rows[0]?.relation
            ?await client.query('DELETE FROM brilon_gps_spiele WHERE buchung_id=$1',[id])
            :{rowCount:0};
          const entfernt=await client.query('DELETE FROM brilon_buchungen WHERE id=$1 RETURNING id',[id]);
          return {geloescht:entfernt.rowCount===1,gpsSpieleGeloescht:gps.rowCount};
        });
        if(loeschung.nichtGefunden)
          return reply(res,404,{error:'Buchungsanfrage nicht gefunden.'});
        if(loeschung.anschlussVerknuepft)
          return reply(res,409,{error:'Diese Buchung ist mit einem Anschlussrabatt verknüpft. Bitte stornieren, damit Zahlungs- und Rabattverlauf erhalten bleiben.'});
        if(!loeschung.geloescht)return reply(res,409,{error:'Buchung konnte nicht gelöscht werden.'});
        return reply(res,200,{success:true,gpsSpieleGeloescht:loeschung.gpsSpieleGeloescht});
      }

      if(route==='/api/admin/aktionen'&&req.method==='GET'){
        const q=await pool.query(
          `SELECT id,data->>'titel' AS titel,data->>'datum' AS datum,
            data->>'beschreibung' AS beschreibung,data->>'preis' AS preis,
            data->>'bild_url' AS bild_url,data->>'programm_id' AS programm_id,data->'veranstaltungsorte' AS veranstaltungsorte,data->>'veranstaltungsort' AS veranstaltungsort
           FROM brilon_aktionen ORDER BY data->>'datum' ASC NULLS LAST,id DESC LIMIT 100`);
        return reply(res,200,q.rows);
      }

      if(route==='/api/admin/aktionen'&&req.method==='POST'){
        const d=await body(req),
          titel=safeText(d.titel,120),
          datum=safeText(d.datum,10)||null,
          beschreibung=safeText(d.beschreibung,1000),
          preis=safeText(d.preis,50),
          programmId=String(d.programm_id||'').trim();
        if(!titel||datum&&!/^\d{4}-\d{2}-\d{2}$/.test(datum)||
          programmId&&!/^[1-9]\d{0,15}$/.test(programmId))
          return reply(res,400,{error:'Ungültiger Aktionstitel, Termin oder Programmbezug.'});
        if(programmId){
          const selected=await pool.query(
            'SELECT id,verfuegbare_termine FROM brilon_angebote WHERE id=$1 AND archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true',
            [programmId]);
          if(!selected.rowCount)
            return reply(res,400,{error:'Verknüpftes Programm ist nicht veröffentlicht und buchbar.'});
          const days=selected.rows[0].verfuegbare_termine;
          if(datum&&Array.isArray(days)&&days.length&&!days.includes(datum))
            return reply(res,400,{error:'Aktionstag ist für das verknüpfte Programm nicht freigegeben.'});
        }
        const selectedLocations=d.veranstaltungsorte;
        if(!Array.isArray(selectedLocations)||!selectedLocations.length||selectedLocations.length>50||
           selectedLocations.some(x=>typeof x!=='string'||!x.trim()||x.length>80)||
           new Set(selectedLocations).size!==selectedLocations.length)
          return reply(res,400,{error:'Bitte mindestens einen gültigen Standort auswählen.'});
        const allowed=await pool.query('SELECT name FROM brilon_orte WHERE aktiv=true AND name=ANY($1::text[])',[selectedLocations]);
        if(allowed.rowCount!==selectedLocations.length)
          return reply(res,400,{error:'Mindestens ein gewählter Standort ist nicht aktiv oder nicht vorhanden.'});
        const q=await pool.query(
          'INSERT INTO brilon_aktionen(id,data) VALUES ($1,$2) RETURNING id',
          [crypto.randomUUID(),JSON.stringify({titel,datum,beschreibung,preis,veranstaltungsorte:selectedLocations,
            veranstaltungsort:selectedLocations[0],...(programmId?{programm_id:programmId}:{})})]
        );
        return reply(res,201,{id:q.rows[0].id});
      }

      const actionLocations=route.match(/^\/api\/admin\/aktionen\/([0-9a-fA-F-]{36})\/standorte$/);
      if(actionLocations&&req.method==='PATCH'){
        const d=await body(req,8000);
        const selected=d.veranstaltungsorte;
        if(!Array.isArray(selected)||!selected.length||selected.length>50||
           selected.some(x=>typeof x!=='string'||!x.trim()||x.length>80)||
           new Set(selected).size!==selected.length)
          return reply(res,400,{error:'Bitte mindestens einen gültigen Standort auswählen.'});
        const valid=await pool.query('SELECT name FROM brilon_orte WHERE aktiv=true AND name=ANY($1::text[])',[selected]);
        if(valid.rowCount!==selected.length)return reply(res,400,{error:'Ein ausgewählter Standort ist nicht mehr aktiv.'});
        const q=await pool.query(`UPDATE brilon_aktionen SET data=
          jsonb_set(jsonb_set(data,'{veranstaltungsorte}',$2::jsonb,true),
          '{veranstaltungsort}',to_jsonb($3::text),true)
          WHERE id=$1 RETURNING id,data->'veranstaltungsorte' AS veranstaltungsorte`,
          [actionLocations[1],JSON.stringify(selected),selected[0]]);
        if(!q.rowCount)return reply(res,404,{error:'Sonderangebot nicht gefunden.'});
        return reply(res,200,{success:true,...q.rows[0]});
      }

      const specialProgramme=route.match(/^\/api\/admin\/aktionen\/([0-9a-fA-F-]{36})\/programm$/);
      if(specialProgramme&&req.method==='PATCH'){
        const d=await body(req);
        const programmId=String(d.programm_id||'').trim();
        if(programmId&&!/^[1-9]\d{0,15}$/.test(programmId))
          return reply(res,400,{error:'Ungültige Programm-ID.'});
        const action=await pool.query(
          "SELECT id,data->>'datum' AS datum FROM brilon_aktionen WHERE id=$1",
          [specialProgramme[1]]);
        if(!action.rowCount)return reply(res,404,{error:'Sonderaktion nicht gefunden.'});
        if(programmId){
          const p=await pool.query(
            'SELECT verfuegbare_termine FROM brilon_angebote WHERE id=$1 AND archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true',
            [programmId]);
          if(!p.rowCount)return reply(res,400,{error:'Das Programm ist nicht veröffentlicht und buchbar.'});
          const dates=p.rows[0].verfuegbare_termine;
          if(action.rows[0].datum&&Array.isArray(dates)&&dates.length&&!dates.includes(action.rows[0].datum))
            return reply(res,400,{error:'Der Aktionstag ist für das verknüpfte Programm nicht freigegeben.'});
        }
        const q=await pool.query(
          "UPDATE brilon_aktionen SET data=CASE WHEN $2::text='' THEN data-'programm_id' ELSE jsonb_set(data,'{programm_id}',to_jsonb($2::text),true) END WHERE id=$1 RETURNING id,data->>'programm_id' AS programm_id",
          [specialProgramme[1],programmId]);
        return reply(res,200,q.rows[0]);
      }

      const m=route.match(/^\/api\/admin\/aktionen\/([0-9a-fA-F-]{36})$/);
      if(m&&req.method==='DELETE'){
        await pool.query('DELETE FROM brilon_aktionen WHERE id=$1',[m[1]]);
        return reply(res,200,{success:true});
      }
     
  
if(route==='/api/admin/orte'&&req.method==='GET'){
  const q=await pool.query('SELECT id,name,aktiv,partnerhaus,partnerkontakt_name,partnerkontakt_email FROM brilon_orte ORDER BY name');
  return reply(res,200,q.rows);
}
if(route==='/api/admin/orte'&&req.method==='POST'){
  const d=await body(req),name=safeText(d.name,80),partnerhaus=d.partnerhaus===true,
    partnerkontaktName=safeText(d.partnerkontakt_name,120),partnerkontaktEmail=safeText(d.partnerkontakt_email,180).toLowerCase();
  if(!name)return reply(res,400,{error:'Ort ist erforderlich.'});
  if(partnerhaus&&!/^\S+@\S+\.\S+$/.test(partnerkontaktEmail))return reply(res,400,{error:'Für ein Partnerhaus bitte die E-Mail-Adresse des Standortkontakts hinterlegen.'});
  if(partnerkontaktEmail&&!/^\S+@\S+\.\S+$/.test(partnerkontaktEmail))return reply(res,400,{error:'Bitte eine gültige E-Mail-Adresse für den Standortkontakt eingeben.'});
  const q=await pool.query(
    `INSERT INTO brilon_orte(name,partnerhaus,partnerkontakt_name,partnerkontakt_email) VALUES($1,$2,$3,$4)
      ON CONFLICT(name) DO UPDATE SET aktiv=true
      RETURNING id,name,aktiv,partnerhaus,partnerkontakt_name,partnerkontakt_email`,
    [name,partnerhaus,partnerkontaktName,partnerkontaktEmail]
  );
  return reply(res,201,q.rows[0]);
}
const placeRoute=route.match(/^\/api\/admin\/orte\/(\d+)$/);
if(placeRoute&&req.method==='PATCH'){
  const d=await body(req),name=d.name===undefined?null:safeText(d.name,80),aktiv=d.aktiv===undefined?null:d.aktiv,
    partnerhaus=d.partnerhaus===undefined?null:d.partnerhaus,
    partnerkontaktName=d.partnerkontakt_name===undefined?null:safeText(d.partnerkontakt_name,120),
    partnerkontaktEmail=d.partnerkontakt_email===undefined?null:safeText(d.partnerkontakt_email,180).toLowerCase();
  if(aktiv!==null&&typeof aktiv!=='boolean')return reply(res,400,{error:'Der Aktiv-Status muss Ja oder Nein sein.'});
  if(partnerhaus!==null&&typeof partnerhaus!=='boolean')return reply(res,400,{error:'Die Partnerhaus-Einstellung ist ungültig.'});
  if(partnerkontaktEmail!==null&&partnerkontaktEmail!==''&&!/^\S+@\S+\.\S+$/.test(partnerkontaktEmail))
    return reply(res,400,{error:'Bitte eine gültige E-Mail-Adresse für den Standortkontakt eingeben.'});
  if(name!==null&&!name)return reply(res,400,{error:'Die Standortbezeichnung darf nicht leer sein.'});
  if(name===null&&aktiv===null&&partnerhaus===null&&partnerkontaktName===null&&partnerkontaktEmail===null)
    return reply(res,400,{error:'Bitte Standortdaten ändern.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const current=await client.query('SELECT id,name,aktiv,partnerhaus,partnerkontakt_name,partnerkontakt_email FROM brilon_orte WHERE id=$1 FOR UPDATE',[placeRoute[1]]);
    if(!current.rowCount){await client.query('ROLLBACK');return reply(res,404,{error:'Standort nicht gefunden.'});}
    const oldName=current.rows[0].name,newName=name||oldName;
    const nextPartnerhaus=partnerhaus===null?current.rows[0].partnerhaus:partnerhaus;
    const nextPartnerEmail=partnerkontaktEmail===null?current.rows[0].partnerkontakt_email:partnerkontaktEmail;
    if(nextPartnerhaus&&(!nextPartnerEmail||!/^\S+@\S+\.\S+$/.test(nextPartnerEmail))){
      await client.query('ROLLBACK');return reply(res,400,{error:'Für ein Partnerhaus bitte die E-Mail-Adresse des Standortkontakts hinterlegen.'});
    }
    if(name&&name!==oldName){
      const duplicate=await client.query('SELECT 1 FROM brilon_orte WHERE lower(name)=lower($1) AND id<>$2',[name,placeRoute[1]]);
      if(duplicate.rowCount){await client.query('ROLLBACK');return reply(res,409,{error:'Diese Standortbezeichnung ist bereits vergeben.'});}
    }
    const saved=await client.query(`UPDATE brilon_orte SET name=$1,aktiv=COALESCE($2,aktiv),
      partnerhaus=COALESCE($3,partnerhaus),partnerkontakt_name=COALESCE($4,partnerkontakt_name),
      partnerkontakt_email=CASE WHEN $5::text IS NULL THEN partnerkontakt_email ELSE COALESCE(NULLIF($5,''),'') END
      WHERE id=$6 RETURNING id,name,aktiv,partnerhaus,partnerkontakt_name,partnerkontakt_email`,
      [newName,aktiv,partnerhaus,partnerkontaktName,partnerkontaktEmail,placeRoute[1]]);
    if(newName!==oldName){
      await client.query('UPDATE brilon_angebote SET veranstaltungsort=$1 WHERE veranstaltungsort=$2',[newName,oldName]);
      for(const key of ['veranstaltungsort','ort','standort']){
        await client.query(`UPDATE brilon_buchungen SET data=jsonb_set(data,'{${key}}',to_jsonb($1::text),true) WHERE data->>'${key}'=$2`,[newName,oldName]);
      }
    }
    await client.query('COMMIT');
    return reply(res,200,saved.rows[0]);
  }catch(error){
    try{await client.query('ROLLBACK');}catch{}
    if(error?.code==='23505')return reply(res,409,{error:'Diese Standortbezeichnung ist bereits vergeben.'});
    throw error;
  }finally{client.release();}
}
if(placeRoute&&req.method==='DELETE'){
  const place=await pool.query('SELECT id,name FROM brilon_orte WHERE id=$1',[placeRoute[1]]);
  if(!place.rowCount)return reply(res,404,{error:'Standort nicht gefunden.'});
  const usage=await pool.query(`SELECT
    (SELECT COUNT(*) FROM brilon_angebote WHERE veranstaltungsort=$1)+
    (SELECT COUNT(*) FROM brilon_pruef_stationen WHERE ort_id=$2)+
    (SELECT COUNT(*) FROM brilon_pruef_freigaben WHERE ort_id=$2)+
    (SELECT COUNT(*) FROM brilon_buchungen WHERE data->>'veranstaltungsort'=$1) AS anzahl`,
    [place.rows[0].name,placeRoute[1]]);
  if(Number(usage.rows[0]?.anzahl||0)>0)
    return reply(res,409,{error:'Dieser Standort ist noch mit Programmen, Buchungsanfragen oder Stationsfreigaben verknüpft. Deaktiviere ihn stattdessen; bestehende Daten bleiben erhalten.'});
  await pool.query('DELETE FROM brilon_orte WHERE id=$1',[placeRoute[1]]);
  return reply(res,200,{success:true});
}

if(route==='/api/admin/mitarbeiterbereiche'&&req.method==='GET'){
  const q=await pool.query(`SELECT a.id,a.titel,a.inhalt,a.aktiv,a.sortierung,a.art,a.aktualisiert_am,
      COALESCE((SELECT json_agg(json_build_object('id',o.id,'name',o.name) ORDER BY o.name)
        FROM brilon_mitarbeiterbereich_orte ao JOIN brilon_orte o ON o.id=ao.ort_id
        WHERE ao.bereich_id=a.id),'[]'::json) AS standorte
    FROM brilon_mitarbeiterbereiche a ORDER BY a.sortierung,a.titel,a.id`);
  return reply(res,200,q.rows);
}
if(route==='/api/admin/mitarbeiterbereiche'&&req.method==='POST'){
  const d=await body(req);
  if(!d||typeof d!=='object'||Array.isArray(d))
    return reply(res,400,{error:'Bereichsdaten sind ungültig.'});
  const titel=typeof d.titel==='string'?d.titel.trim():'',
    inhalt=typeof d.inhalt==='string'?d.inhalt.trim():'',
    art=typeof d.art==='string'?d.art:'allgemein',
    standorte=Array.isArray(d.standorte)?[...new Set(d.standorte.map(Number))]:[];
  if(!titel||titel.length>100||!inhalt||inhalt.length>20000||typeof d.aktiv!=='boolean'||
     !['allgemein','standort','partner','programm'].includes(art)||standorte.length>50||
     standorte.some(id=>!Number.isSafeInteger(id)||id<1)||
     (['standort','programm'].includes(art)&&!standorte.length)||
     (art==='allgemein'&&standorte.length))
    return reply(res,400,{error:'Bitte Titel, Inhalt, Bereichsart und passende Standorte angeben.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    if(standorte.length){
      const places=await client.query('SELECT id FROM brilon_orte WHERE id=ANY($1::bigint[]) AND aktiv=true',[standorte]);
      if(places.rowCount!==standorte.length){await client.query('ROLLBACK');return reply(res,400,{error:'Mindestens ein gewählter Standort ist inaktiv oder nicht vorhanden.'});}
    }
    const id=crypto.randomUUID();
    const q=await client.query(`INSERT INTO brilon_mitarbeiterbereiche(id,titel,inhalt,aktiv,sortierung,art)
      VALUES($1,$2,$3,$4,COALESCE((SELECT MAX(sortierung)+1 FROM brilon_mitarbeiterbereiche),0),$5)
      RETURNING id,titel,inhalt,aktiv,sortierung,art,aktualisiert_am`,[id,titel,inhalt,d.aktiv,art]);
    for(const ortId of standorte)await client.query(
      'INSERT INTO brilon_mitarbeiterbereich_orte(bereich_id,ort_id) VALUES($1,$2)',[id,ortId]);
    await client.query('COMMIT');
    const places=await pool.query('SELECT id,name FROM brilon_orte WHERE id=ANY($1::bigint[]) ORDER BY name',[standorte]);
    return reply(res,201,{...q.rows[0],standorte:places.rows});
  }catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}
const staffArea=route.match(/^\/api\/admin\/mitarbeiterbereiche\/([0-9a-f-]{36})$/i);
if(staffArea&&req.method==='PATCH'){
  const d=await body(req);
  if(!d||typeof d!=='object'||Array.isArray(d))
    return reply(res,400,{error:'Änderungen sind ungültig.'});
  const titel=typeof d.titel==='string'?d.titel.trim():null,
    inhalt=typeof d.inhalt==='string'?d.inhalt.trim():null,
    art=typeof d.art==='string'?d.art:null,
    standorte=Array.isArray(d.standorte)?[...new Set(d.standorte.map(Number))]:null;
  if(titel!==null&&(!titel||titel.length>100)||inhalt!==null&&(!inhalt||inhalt.length>20000)||
     d.aktiv!==undefined&&typeof d.aktiv!=='boolean'||art!==null&&!['allgemein','standort','partner','programm'].includes(art)||
     standorte&& (standorte.length>50||standorte.some(id=>!Number.isSafeInteger(id)||id<1))||
     art===null&&standorte===null&&titel===null&&inhalt===null&&d.aktiv===undefined)
    return reply(res,400,{error:'Änderungen sind ungültig.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const current=await client.query('SELECT art FROM brilon_mitarbeiterbereiche WHERE id=$1 FOR UPDATE',[staffArea[1]]);
    if(!current.rowCount){await client.query('ROLLBACK');return reply(res,404,{error:'Mitarbeiterbereich nicht gefunden.'});}
    const nextArt=art||current.rows[0].art;
    const existingPlaces=await client.query('SELECT ort_id FROM brilon_mitarbeiterbereich_orte WHERE bereich_id=$1',[staffArea[1]]);
    const nextPlaces=nextArt==='allgemein'?[]:standorte===null?existingPlaces.rows.map(row=>Number(row.ort_id)):standorte;
    if((['standort','programm'].includes(nextArt)&&!nextPlaces.length)||
       (standorte!==null&&nextArt==='allgemein'&&standorte.length)){
      await client.query('ROLLBACK');return reply(res,400,{error:'Für Standort- und Programmbereiche ist eine passende Standortauswahl erforderlich.'});
    }
    if(nextPlaces.length){
      const places=await client.query('SELECT id FROM brilon_orte WHERE id=ANY($1::bigint[]) AND aktiv=true',[nextPlaces]);
      if(places.rowCount!==nextPlaces.length){await client.query('ROLLBACK');return reply(res,400,{error:'Mindestens ein gewählter Standort ist inaktiv oder nicht vorhanden.'});}
    }
    const q=await client.query(`UPDATE brilon_mitarbeiterbereiche SET
      titel=COALESCE($2,titel),inhalt=COALESCE($3,inhalt),aktiv=COALESCE($4,aktiv),art=$5,
      aktualisiert_am=NOW() WHERE id=$1
      RETURNING id,titel,inhalt,aktiv,sortierung,art,aktualisiert_am`,
    [staffArea[1],titel,inhalt,d.aktiv===undefined?null:d.aktiv,nextArt]);
    if(standorte!==null||nextArt==='allgemein'){
      await client.query('DELETE FROM brilon_mitarbeiterbereich_orte WHERE bereich_id=$1',[staffArea[1]]);
      for(const ortId of nextPlaces)await client.query(
        'INSERT INTO brilon_mitarbeiterbereich_orte(bereich_id,ort_id) VALUES($1,$2)',[staffArea[1],ortId]);
    }
    await client.query('COMMIT');
    const places=await pool.query(`SELECT o.id,o.name FROM brilon_mitarbeiterbereich_orte ao
      JOIN brilon_orte o ON o.id=ao.ort_id WHERE ao.bereich_id=$1 ORDER BY o.name`,[staffArea[1]]);
    return reply(res,200,{...q.rows[0],standorte:places.rows});
  }catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}
if(staffArea&&req.method==='DELETE'){
  const q=await pool.query('DELETE FROM brilon_mitarbeiterbereiche WHERE id=$1 RETURNING id',[staffArea[1]]);
  if(!q.rowCount)return reply(res,404,{error:'Mitarbeiterbereich nicht gefunden.'});
  return reply(res,200,{success:true});
}


// Speichert die Zuordnung neuer oder bearbeiteter Programme direkt in der
// vorhandenen Besuchergruppen-Liste. Andere Gruppendaten bleiben unverändert.
async function programmBesuchergruppenSynchronisieren(programmId,gewahlteIds){
  if(!Array.isArray(gewahlteIds))return true;
  if(gewahlteIds.length>30||gewahlteIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(id)))
    return false;
  const auswahl=new Set(gewahlteIds);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const q=await client.query('SELECT daten FROM brilon_besuchergruppen WHERE id=1 FOR UPDATE');
    if(!q.rowCount||!Array.isArray(q.rows[0].daten)){
      await client.query('ROLLBACK');
      return false;
    }
    const vorher=q.rows[0].daten;
    const aktualisiert=vorher.map(group=>{
      if(!group||typeof group!=='object')return group;
      const ids=Array.isArray(group.programmIds)?group.programmIds:[];
      const sauber=[...new Set(ids.map(Number).filter(x=>Number.isSafeInteger(x)&&x>0))];
      const ohne=sauber.filter(id=>id!==Number(programmId));
      if(auswahl.has(group.id))ohne.push(Number(programmId));
      return {...group,programmIds:ohne};
    });
    await client.query('UPDATE brilon_besuchergruppen SET daten=$1::jsonb,aktualisiert_am=NOW() WHERE id=1',[JSON.stringify(aktualisiert)]);
    await client.query('COMMIT');
    return true;
  }catch(error){
    await client.query('ROLLBACK');
    console.error('Programm-Besuchergruppen-Zuordnung fehlgeschlagen:',error.code||error.message);
    return false;
  }finally{client.release();}
}

/* Besuchergruppen: zentrale öffentliche Daten und persistente Verwaltungsbearbeitung. */
if(route==='/api/admin/besuchergruppen'&&(req.method==='GET'||req.method==='PUT')){
  if(!await admin(req,res))return;
  if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
  await pool.query(`CREATE TABLE IF NOT EXISTS brilon_besuchergruppen(
    id INTEGER PRIMARY KEY CHECK(id=1),daten JSONB NOT NULL,aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const defaults=[
    {id:'familien',titel:'Familien',icon:'👨‍👩‍👧‍👦',farbe:'#599f47',beschreibung:'Gemeinsam Abenteuer erleben, Neues ausprobieren und als Familie zusammenwachsen.',punkte:['Erlebnisse für Groß und Klein','Begleitete Aktivitäten','Gemeinsame Erinnerungen'],bild:'/fotos/kletterheldin-helm.jpg',iconBild:'',programmIds:[],aktiv:true},
    {id:'kindergeburtstage',titel:'Kindergeburtstage',icon:'🎂',farbe:'#bf4e7b',beschreibung:'Ein besonderer Geburtstag mit Bewegung, Mut, Teamgeist und ganz viel Spaß.',punkte:['Abwechslungsreiche Erlebnisse','Altersgerechte Betreuung','Gemeinsam feiern und staunen'],bild:'/fotos/halle.jpg',iconBild:'',programmIds:[],aktiv:true},
    {id:'schulen',titel:'Schulen',icon:'🎓',farbe:'#578fce',beschreibung:'Erlebnispädagogische Programme, die Klassengemeinschaft und Vertrauen stärken.',punkte:['Klassen- und Projekttage','Kooperation und Zusammenhalt','Gemeinsame Herausforderungen'],bild:'/fotos/abseilen.jpg',iconBild:'',programmIds:[],aktiv:true},
    {id:'vereine',titel:'Vereine',icon:'🛡️',farbe:'#7553b5',beschreibung:'Gemeinsame Herausforderungen und sportliche Erlebnisse für euren Verein.',punkte:['Teamgeist stärken','Sportlich und kreativ','Für verschiedene Vereinsgruppen'],bild:'/fotos/halle.jpg',iconBild:'',programmIds:[],aktiv:true},
    {id:'jugendgruppen',titel:'Jugendgruppen',icon:'🧭',farbe:'#e18a24',beschreibung:'Abenteuer für Jugendverbände, Freizeiten und andere Gruppen.',punkte:['Natur und Bewegung','Altersgerechte Herausforderungen','Gemeinsam etwas erreichen'],bild:'/fotos/kletterheldin-helm.jpg',iconBild:'',programmIds:[],aktiv:true},
    {id:'unternehmen',titel:'Unternehmen',icon:'💼',farbe:'#21989c',beschreibung:'Teamerlebnisse für mehr Vertrauen, Kommunikation und ein starkes Miteinander.',punkte:['Zusammenarbeit fördern','Gemeinsam Herausforderungen meistern','Individuell planbare Aktionen'],bild:'/fotos/abseilen.jpg',iconBild:'',programmIds:[],aktiv:true}
  ];
  if(req.method==='GET'){
    await pool.query('INSERT INTO brilon_besuchergruppen(id,daten) VALUES(1,$1::jsonb) ON CONFLICT(id) DO NOTHING',[JSON.stringify(defaults)]);
    const q=await pool.query('SELECT daten FROM brilon_besuchergruppen WHERE id=1');
    return reply(res,200,Array.isArray(q.rows[0]?.daten)?q.rows[0].daten:defaults);
  }
  const gesendet=await body(req,160000);
  const eingabe=Array.isArray(gesendet)?gesendet:gesendet?.gruppen;
  if(!Array.isArray(eingabe)||eingabe.length>30)return reply(res,400,{error:'Ungültige Gruppenliste.'});
  const ids=new Set();
  const gruppen=eingabe.map(g=>{
    const id=safeText(g?.id,80),titel=safeText(g?.titel,55),icon=safeText(g?.icon,16);
    const farbe=/^#[0-9a-f]{6}$/i.test(String(g?.farbe||''))?String(g.farbe):'#267c50';
    const beschreibung=safeText(g?.beschreibung,650);
    const bild=safeText(g?.bild,1000),iconBild=safeText(g?.iconBild,1000);
    const punkte=Array.isArray(g?.punkte)?g.punkte.slice(0,3).map(x=>safeText(x,160)).filter(Boolean):[];
    const programmIds=Array.isArray(g?.programmIds)?[...new Set(g.programmIds.map(Number).filter(x=>Number.isSafeInteger(x)&&x>0))].slice(0,500):[];
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||ids.has(id)||!titel||[...icon].length<1||[...icon].length>8||beschreibung.length>650)
      return null;
    ids.add(id);
    return {id,titel,icon,farbe,beschreibung,punkte,bild,iconBild,programmIds,aktiv:g.aktiv===true};
  });
  if(gruppen.some(g=>!g))return reply(res,400,{error:'Bitte Gruppenname, Symbol und Beschreibung überprüfen.'});
  await pool.query(`INSERT INTO brilon_besuchergruppen(id,daten,aktualisiert_am) VALUES(1,$1::jsonb,NOW())
    ON CONFLICT(id) DO UPDATE SET daten=EXCLUDED.daten,aktualisiert_am=NOW()`,[JSON.stringify(gruppen)]);
  return reply(res,200,{success:true,gruppen});
}

/* Medienbibliothek: authentifizierte Verwaltung, persistente Supabase-Dateien. */
if(route==='/api/admin/medien'){
  if(!await admin(req,res))return;
  if(!supabase)return reply(res,503,{error:'Bildspeicher ist nicht konfiguriert.'});
  const bucket=supabase.storage.from('angebotsbilder');
  if(req.method==='GET'){
    const bilder=[];
    const referenzen=await pool.query(`SELECT bild_url AS url FROM brilon_angebote WHERE bild_url IS NOT NULL
      UNION SELECT data->>'bild_url' AS url FROM brilon_aktionen WHERE data->>'bild_url' IS NOT NULL`);
    const verwendeteUrls=new Set(referenzen.rows.map(eintrag=>eintrag.url));
    async function einlesen(ordner='',tiefe=0){
      if(tiefe>3||bilder.length>=500)return;
      const {data,error}=await bucket.list(ordner,{limit:500,sortBy:{column:'created_at',order:'desc'}});
      if(error)throw error;
      for(const item of data||[]){
        const pfad=ordner?ordner+'/'+item.name:item.name;
        if(item.id===null&&!item.metadata){await einlesen(pfad,tiefe+1);continue;}
        if(!/\.(png|jpe?g|webp|gif)$/i.test(item.name))continue;
        const url=bucket.getPublicUrl(pfad).data.publicUrl;
        bilder.push({name:item.name,pfad,url,groesse:item.metadata?.size||0,verwendet:verwendeteUrls.has(url)});
      }
    }
    try{await einlesen();return reply(res,200,{bilder:bilder.slice(0,500)});}
    catch(err){console.error('Medienliste:',err.message);return reply(res,502,{error:'Bilder konnten nicht geladen werden: '+err.message});}
  }
  if(req.method==='POST'){
    if(!limit('medien-upload:'+ip,20,600000))return reply(res,429,{error:'Zu viele Uploads. Bitte später erneut versuchen.'});
    const typ=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
    if(!['image/jpeg','image/png','image/webp','image/gif'].includes(typ))
      return reply(res,400,{error:'Nur JPEG, PNG, WebP oder statische GIF-Dateien erlaubt.'});
    const chunks=[];let groesse=0;
    for await(const chunk of req){groesse+=chunk.length;if(groesse>5*1024*1024)return reply(res,413,{error:'Maximal 5 MB pro Bild.'});chunks.push(chunk);}
    if(!groesse)return reply(res,400,{error:'Keine Bilddatei empfangen.'});
    let bild,format=typ,ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'png'}[typ];
    try{
      const input=Buffer.concat(chunks);
      if(typ==='image/gif'){
        const sharp=require('sharp'),metadata=await sharp(input,{animated:true,limitInputPixels:40_000_000}).metadata();
        if(metadata.format!=='gif'||metadata.pages!==1)throw Error('Nur unbewegte GIF-Dateien sind erlaubt.');
        bild=await sharp(input,{animated:false,limitInputPixels:40_000_000}).png().toBuffer();
        format='image/png';
        bild=await bereinigeBild(bild,format);
      }else bild=await bereinigeBild(input,typ);
    }catch(error){return reply(res,400,{error:'Bilddatei konnte nicht verarbeitet werden: '+error.message});}
    try{await pruefeNeuCodiertesAdminBild(bild,format);}
    catch(error){return malwareScanReply(res,error);}
    const dateiname='medien/'+crypto.randomUUID()+'.'+ext;
    const {error}=await bucket.upload(dateiname,bild,{contentType:format,upsert:false});
    if(error){console.error('Medien-Upload:',error.message);return reply(res,502,{error:'Datei konnte nicht im Bildspeicher gespeichert werden: '+error.message});}
    return reply(res,201,{success:true,bild:{name:dateiname.split('/').at(-1),pfad:dateiname,url:bucket.getPublicUrl(dateiname).data.publicUrl}});
  }
  if(req.method==='PUT'){
    if(!limit('medien-ersetzen:'+ip,20,600000))return reply(res,429,{error:'Zu viele Bildaustausche. Bitte später erneut versuchen.'});
    const pfad=safeText(new URL(req.url,'http://localhost').searchParams.get('pfad'),240);
    if(!/^(?:[a-zA-Z0-9_-]+\/){0,4}[a-zA-Z0-9._-]+\.(?:png|jpe?g|webp|gif)$/i.test(pfad)||pfad.includes('..'))return reply(res,400,{error:'Ungültiger Medienpfad.'});
    const vorhanden=await bucket.download(pfad);
    if(vorhanden.error)return reply(res,404,{error:'Das zu ersetzende Bild wurde in der Mediathek nicht gefunden.'});
    const typ=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
    if(!['image/jpeg','image/png','image/webp','image/gif'].includes(typ))return reply(res,400,{error:'Nur JPEG, PNG, WebP oder statische GIF-Dateien erlaubt.'});
    const chunks=[];let groesse=0;
    for await(const chunk of req){groesse+=chunk.length;if(groesse>5*1024*1024)return reply(res,413,{error:'Maximal 5 MB pro Bild.'});chunks.push(chunk);}
    if(!groesse)return reply(res,400,{error:'Keine Bilddatei empfangen.'});
    const zielExt=pfad.split('.').at(-1).toLowerCase();
    let bild,format;
    try{
      const input=Buffer.concat(chunks),sharp=require('sharp');
      let basis;
      if(typ==='image/gif'){
        const meta=await sharp(input,{animated:true,limitInputPixels:40_000_000}).metadata();
        if(meta.format!=='gif'||meta.pages!==1)throw Error('Nur unbewegte GIF-Dateien sind erlaubt.');
        basis=await sharp(input,{animated:false,limitInputPixels:40_000_000}).png().toBuffer();
      }else basis=await bereinigeBild(input,typ);
      if(zielExt==='gif'){
        bild=await sharp(basis,{animated:false,limitInputPixels:40_000_000}).gif({effort:7}).toBuffer();
        const meta=await sharp(bild,{animated:true,limitInputPixels:40_000_000}).metadata();
        if(meta.format!=='gif'||meta.pages!==1)throw Error('Das Bild konnte nicht sicher als statisches GIF gespeichert werden.');
        format='image/gif';
        if(process.env.CLAMD_HOST?.trim()){
          const verdict=await scanForMalware(bild);
          if(verdict?.sauber!==true)throw Object.assign(new Error('Bildprüfung fehlgeschlagen.'),{code:verdict?.code||'MALWARE_SCAN_ERROR'});
        }
      }else{
        const mimeType={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'}[zielExt];
        if(!mimeType)throw Error('Das gespeicherte Bildformat wird nicht unterstützt.');
        const sharpFormat={ 'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'}[mimeType];
        const encoded=await sharp(basis,{animated:false,limitInputPixels:40_000_000}).toFormat(sharpFormat).toBuffer();
        bild=await bereinigeBild(encoded,mimeType);format=mimeType;
        await pruefeNeuCodiertesAdminBild(bild,format);
      }
    }catch(error){
      if(error?.code==='MALWARE_FOUND'||error?.code==='MALWARE_SCAN_ERROR')return malwareScanReply(res,error);
      return reply(res,400,{error:'Bilddatei konnte nicht verarbeitet werden: '+error.message});
    }
    const url=bucket.getPublicUrl(pfad).data.publicUrl;
    const {error}=await bucket.upload(pfad,bild,{contentType:format,upsert:true,cacheControl:'0'});
    if(error){console.error('Medien-Austausch:',error.message);return reply(res,502,{error:'Bild konnte unter der bestehenden Adresse nicht ersetzt werden: '+error.message});}
    console.info('Medienbibliothek: Bildinhalt bei bestehender Adresse ersetzt:',pfad);
    return reply(res,200,{success:true,bild:{name:pfad.split('/').at(-1),pfad,url,groesse:bild.length,verwendet:true}});
  }
  if(req.method==='PATCH'||req.method==='DELETE'){
    const daten=await body(req,2048),pfad=safeText(daten?.pfad,240);
    if(!/^(?:[a-zA-Z0-9_-]+\/){0,4}[a-zA-Z0-9._-]+\.(?:png|jpe?g|webp|gif)$/i.test(pfad)||pfad.includes('..'))return reply(res,400,{error:'Ungültiger Medienpfad.'});
    const url=bucket.getPublicUrl(pfad).data.publicUrl;
    const verwendet=await pool.query(`SELECT
      EXISTS(SELECT 1 FROM brilon_angebote WHERE bild_url=$1) AS programme,
      EXISTS(SELECT 1 FROM brilon_aktionen WHERE data->>'bild_url'=$1) AS aktionen`,[url]);
    if(verwendet.rows[0]?.programme||verwendet.rows[0]?.aktionen)
      return reply(res,409,{error:'Das Bild wird noch verwendet. Bitte zuerst die Programm- bzw. Aktionszuordnung ändern.'});
    if(req.method==='DELETE'){
      const {error}=await bucket.remove([pfad]);
      if(error)return reply(res,502,{error:'Löschen fehlgeschlagen: '+error.message});
      console.info('Medienbibliothek: Bild dauerhaft entfernt:',pfad);
      return reply(res,200,{success:true,freigegebenBytes:Number(daten?.groesse)||null});
    }
    const basename=safeText(daten?.name,80).replace(/[^a-zA-Z0-9_-]/g,'-').replace(/^-+|-+$/g,'');
    if(!basename)return reply(res,400,{error:'Bitte einen gültigen Namen eingeben.'});
    const neuerPfad=pfad.slice(0,pfad.lastIndexOf('/')+1)+basename+'-'+crypto.randomUUID().slice(0,8)+'.'+pfad.split('.').at(-1);
    const {error}=await bucket.move(pfad,neuerPfad);
    if(error)return reply(res,502,{error:'Umbenennen fehlgeschlagen: '+error.message});
    return reply(res,200,{success:true,pfad:neuerPfad,url:bucket.getPublicUrl(neuerPfad).data.publicUrl});
  }
}
if(route==='/api/admin/website-effekte'&&(req.method==='GET'||req.method==='PUT')){
  await pool.query('CREATE TABLE IF NOT EXISTS brilon_website_effekte (id INTEGER PRIMARY KEY, daten JSONB NOT NULL)');
  const standard={aktiv:false,aktiveId:null,eintraege:[]};
  if(req.method==='GET'){
    const result=await pool.query('SELECT daten FROM brilon_website_effekte WHERE id=1');
    return reply(res,200,result.rows[0]?.daten||standard);
  }
  const daten=await body(req,16000);
  if(!daten||typeof daten!=='object'||!Array.isArray(daten.eintraege)||daten.eintraege.length>30)return reply(res,400,{error:'Ungültige Effekteinstellungen.'});
  const eintraege=daten.eintraege.map(e=>({
    id:safeText(e.id,80),name:safeText(e.name,80),symbol:safeText(e.symbol,20),
    anzahl:Number(e.anzahl),dauerSekunden:Number(e.dauerSekunden)
  }));
  if(eintraege.some(e=>!e.id||!e.name||!e.symbol||!Number.isInteger(e.anzahl)||e.anzahl<1||e.anzahl>20||
     !Number.isInteger(e.dauerSekunden)||e.dauerSekunden<8||e.dauerSekunden>90))
    return reply(res,400,{error:'Bitte die Effektangaben überprüfen.'});
  const aktiveId=safeText(daten.aktiveId,80)||null;
  if(aktiveId&&!eintraege.some(e=>e.id===aktiveId))return reply(res,400,{error:'Der ausgewählte Effekt existiert nicht.'});
  const gespeichert={aktiv:daten.aktiv===true,aktiveId,eintraege};
  await pool.query('INSERT INTO brilon_website_effekte(id,daten) VALUES (1,$1::jsonb) ON CONFLICT(id) DO UPDATE SET daten=EXCLUDED.daten',[JSON.stringify(gespeichert)]);
  return reply(res,200,gespeichert);
}

if(route==='/api/admin/angebote/bilder'&&req.method==='GET'){
  if(!supabase)return reply(res,503,{error:'Bildspeicher ist nicht konfiguriert.'});
  const storage=supabase.storage.from('angebotsbilder'),bilder=[];
  async function bilderLaden(ordner='',tiefe=0){
    if(tiefe>3)return;
    const {data,error}=await storage.list(ordner,{limit:100,sortBy:{column:'created_at',order:'desc'}});
    if(error)throw error;
    for(const item of data||[]){
      const pfad=ordner?ordner+'/'+item.name:item.name;
      if(item.id===null&&!item.metadata){await bilderLaden(pfad,tiefe+1);continue;}
      const {data:publicData}=storage.getPublicUrl(pfad);
      if(publicData?.publicUrl)bilder.push({name:item.name,url:publicData.publicUrl});
    }
  }
  try{await bilderLaden();return reply(res,200,bilder.slice(0,200));}
  catch{return reply(res,502,{error:'Gespeicherte Angebotsbilder konnten nicht geladen werden.'});}
}

if (route === '/api/admin/angebote' && req.method === 'GET') {
  const q = await pool.query(
    `SELECT id,name,beschreibung,mitarbeiterbeschreibung,dauer,preise,aktiv,bild_url,kategorie,zielgruppe,
            veranstaltungsort,veranstaltungsorte,kapazitaet,verfuegbare_termine,hinweise,buchbar,veroeffentlicht,
            buchungsmodus,mindestteilnehmer,preis_pro_person,sortierung,archiviert,gruppenstufen,dauer_modus
     FROM brilon_angebote
     ORDER BY archiviert ASC,sortierung ASC,id DESC`
  );

  return reply(res, 200, q.rows);
}

if(route==='/api/admin/angebote/reihenfolge'&&req.method==='PATCH'){
  const d=await body(req),ids=d?.ids;
  if(!Array.isArray(ids)||ids.length>500||ids.some(id=>!Number.isSafeInteger(Number(id))||Number(id)<1)||
     new Set(ids.map(Number)).size!==ids.length)
    return reply(res,400,{error:'Ungültige Angebotsreihenfolge.'});
  const q=await pool.query(
    `UPDATE brilon_angebote AS angebot SET sortierung=(sort.ord-1)::integer
     FROM unnest($1::bigint[]) WITH ORDINALITY AS sort(id,ord)
     WHERE angebot.id=sort.id AND angebot.archiviert=false RETURNING angebot.id`,
    [ids.map(Number)]
  );
  if(q.rowCount!==ids.length)return reply(res,409,{error:'Die Angebotsliste wurde zwischenzeitlich geändert. Bitte neu laden.'});
  return reply(res,200,{success:true});
}

// Dauerhaftes Löschen: nur nicht verwendete Programme entfernen.
// Buchungen, Rechnungen und verknüpfte GPS-Touren bleiben geschützt.
const angebotLoeschenRoute=route.match(/^\/api\/admin\/angebote\/([0-9]+)$/);
if(angebotLoeschenRoute&&req.method==='DELETE'){
  const angebotId=angebotLoeschenRoute[1];
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const angebot=await client.query('SELECT id,name FROM brilon_angebote WHERE id=$1 FOR UPDATE',[angebotId]);
    if(!angebot.rowCount){
      await client.query('ROLLBACK');
      return reply(res,404,{error:'Programm nicht gefunden. Bitte Programmliste neu laden.'});
    }
    const buchungen=await client.query(`SELECT 1 FROM brilon_buchungen
      WHERE data->>'angebot'=$1 OR data->>'programmId'=$2 OR data->>'programm_id'=$2
      LIMIT 1`,[angebot.rows[0].name,String(angebotId)]);
    if(buchungen.rowCount){
      await client.query('ROLLBACK');
      return reply(res,409,{error:'Zu diesem Programm gibt es Buchungen. Bitte archivieren, damit Buchungen und Rechnungen erhalten bleiben.'});
    }
    const gpsTabelle=await client.query("SELECT to_regclass('brilon_gps_touren') AS name");
    if(gpsTabelle.rows[0]?.name){
      const touren=await client.query('SELECT 1 FROM brilon_gps_touren WHERE angebot_id=$1 LIMIT 1',[angebotId]);
      if(touren.rowCount){
        await client.query('ROLLBACK');
        return reply(res,409,{error:'Das Programm wird von einer GPS-Tour verwendet. Bitte GPS-Tour zuerst entfernen oder Programm archivieren.'});
      }
    }
    const deleted=await client.query('DELETE FROM brilon_angebote WHERE id=$1 RETURNING id',[angebotId]);
    await client.query('COMMIT');
    return reply(res,200,{success:true,id:Number(deleted.rows[0].id)});
  }catch(error){
    await client.query('ROLLBACK');
    if(error.code==='23503')return reply(res,409,{error:'Das Programm wird noch an anderer Stelle verwendet. Bitte stattdessen archivieren.'});
    throw error;
  }finally{client.release();}
}

const archivRoute=route.match(/^\/api\/admin\/angebote\/([0-9]+)\/archivieren$/);
if(archivRoute&&req.method==='PATCH'){
  const d=await body(req);
  if(typeof d?.archiviert!=='boolean')return reply(res,400,{error:'Archivstatus fehlt.'});
  if(d.archiviert){
    const aktiveTour=await pool.query('SELECT id FROM brilon_gps_touren WHERE angebot_id=$1 AND aktiv=true LIMIT 1',[archivRoute[1]]);
    if(aktiveTour.rowCount)return reply(res,409,{error:'Bitte die verknüpfte GPS-Tour zuerst deaktivieren.'});
  }
  const q=await pool.query('UPDATE brilon_angebote SET archiviert=$1 WHERE id=$2 RETURNING id,archiviert',[d.archiviert,archivRoute[1]]);
  if(!q.rowCount)return reply(res,404,{error:'Angebot nicht gefunden.'});
  return reply(res,200,q.rows[0]);
}
  
// Mehrere Standorte werden unabhängig von Preis- und Teilnehmerstaffeln gepflegt.
function programmStandorteValidieren(auswahl, fallback=[]){
  const liste=auswahl===undefined?fallback:auswahl;
  if(!Array.isArray(liste)||liste.length===0||liste.length>50||
      liste.some(x=>typeof x!=='string'||!x.trim()||x!==x.trim()||x.length>80)||
      new Set(liste).size!==liste.length)
    return {error:'Bitte mindestens einen gültigen Standort auswählen (keine Duplikate).'};
  return {standorte:liste};
}
async function programmStandorteAktivPruefen(standorte){
  const q=await pool.query('SELECT name FROM brilon_orte WHERE aktiv=true AND name=ANY($1::text[])',[standorte]);
  return q.rowCount===standorte.length;
}

function pruefeProgrammstufen(raw,kapazitaet,modus,basisdauer,dauerModus){
  if(modus==='einzelplatz')return {stufen:[]};
  if(!Array.isArray(raw)||!raw.length||raw.length>100)return {error:'Bitte mindestens eine vollständige Teilnehmerstufe angeben.'};
  const stufen=raw.map(v=>({min:Number(v.min),max:Number(v.max),preis:v.preis==null||v.preis===''?NaN:Number(v.preis),
    dauer:dauerModus==='fest'?basisdauer:Number(v.dauer)})).sort((a,b)=>a.min-b.min);
  for(let i=0;i<stufen.length;i++){
    const v=stufen[i],nummer=i+1;
    if(!Number.isInteger(v.min)||v.min<1||!Number.isInteger(v.max)||v.max<v.min)
      return {error:'Teilnehmerstufe '+nummer+': Bitte gültige Teilnehmerzahlen von/bis eingeben.'};
    if(v.max>kapazitaet)
      return {error:'Teilnehmerstufe '+nummer+': Die Obergrenze '+v.max+' überschreitet die Programmkapazität '+kapazitaet+'.'};
    if(!Number.isFinite(v.preis)||v.preis<0)
      return {error:'Teilnehmerstufe '+nummer+': Der Gruppenpreis fehlt oder ist ungültig.'};
    if(!Number.isInteger(v.dauer)||v.dauer<15||v.dauer>1440)
      return {error:'Teilnehmerstufe '+nummer+': Die Dauer muss zwischen 15 und 1440 Minuten liegen.'};
    const konflikt=stufen.slice(0,i).find(a=>a.dauer===v.dauer&&v.min<=a.max&&a.min<=v.max);
    if(konflikt)
      return {error:'Teilnehmerstufe '+nummer+': Überschneidung mit '+konflikt.min+'–'+konflikt.max+
        ' Personen bei derselben Dauer ('+v.dauer+' Minuten). Abweichende Dauern sind zulässig.'};
  }
  return {stufen};
}
// Alte Preisabfragen kennen nur die Gruppengrenze. Dort als Kompatibilitätswert
// die kürzeste Dauer ablegen; alle Varianten bleiben vollständig in gruppenstufen.
const preiseAusStufen=stufen=>{
  const map=new Map();
  for(const v of [...stufen].sort((a,b)=>a.dauer-b.dauer)){
    const key=v.min+'-'+v.max;
    if(!map.has(key))map.set(key,v.preis);
  }
  return Object.fromEntries(map);
};
if (route === '/api/admin/angebote' && req.method === 'POST') {
  const d = await body(req);

  const name = safeText(d.name, 120);
  const beschreibung = safeText(d.beschreibung, 1000);
  const dauer = Number(d.dauer);
  const kategorie=safeText(d.kategorie,60)||'Klettern';
  const zielgruppe=safeText(d.zielgruppe,120);
  const standortPruefung=programmStandorteValidieren(d.veranstaltungsorte,
    [safeText(d.veranstaltungsort,80)].filter(Boolean));
  if(standortPruefung.error)return reply(res,400,{error:standortPruefung.error});
  const veranstaltungsorte=standortPruefung.standorte;
  const veranstaltungsort=veranstaltungsorte[0];
  const kapazitaet=Number(d.kapazitaet||20);
  const hinweise=safeText(d.hinweise,1000);
  const termine=Array.isArray(d.verfuegbare_termine)?d.verfuegbare_termine:[];
  const buchungsmodus=d.buchungsmodus==='einzelplatz'?'einzelplatz':'gruppe';
  const mindestteilnehmer=Number(d.mindestteilnehmer??5);
  const preisProPerson=Number(d.preis_pro_person??0);
  const bildUrl=safeText(d.bild_url,1000);
  const mitarbeiterbeschreibung=safeText(d.mitarbeiterbeschreibung,20000);
  const dauerModus=d.dauer_modus==='fest'?'fest':'gruppenstufe';
  const validStufen=pruefeProgrammstufen(d.gruppenstufen,kapazitaet,buchungsmodus,dauer,dauerModus);
  if(validStufen.error)return reply(res,400,{error:validStufen.error});

  if(!name)return reply(res,400,{error:'Bitte einen Namen für das Angebot eingeben.'});
  if(!Number.isInteger(dauer)||dauer<15||dauer>1440)
    return reply(res,400,{error:'Bitte eine Dauer zwischen 15 und 1440 Minuten eingeben.'});
  if(!Number.isInteger(kapazitaet)||kapazitaet<1||kapazitaet>500)
    return reply(res,400,{error:'Bitte eine Kapazität zwischen 1 und 500 Teilnehmenden eingeben.'});
  if(termine.some(t=>!gueltigesDatum(t)))
    return reply(res,400,{error:'Bitte nur gültige Termine im Format JJJJ-MM-TT eingeben.'});
  if(buchungsmodus==='einzelplatz'&&(kapazitaet<5||kapazitaet>12||
     !Number.isInteger(mindestteilnehmer)||mindestteilnehmer<5||mindestteilnehmer>kapazitaet||
     !Number.isFinite(preisProPerson)||preisProPerson<=0))
    return reply(res,400,{error:'Bei Einzelplätzen müssen Kapazität und Mindestanmeldungen zwischen 5 und 12 liegen. Der Preis pro Person muss größer als 0 € sein.'});

  if(!await programmStandorteAktivPruefen(veranstaltungsorte))
    return reply(res,400,{error:'Mindestens ein ausgewählter Standort ist nicht angelegt oder nicht aktiv.'});

  const q = await pool.query(
    `INSERT INTO brilon_angebote
      (name,beschreibung,dauer,preise,aktiv,kategorie,zielgruppe,veranstaltungsort,kapazitaet,
       verfuegbare_termine,hinweise,buchbar,veroeffentlicht,buchungsmodus,mindestteilnehmer,preis_pro_person,bild_url,sortierung,archiviert,gruppenstufen,dauer_modus,mitarbeiterbeschreibung,veranstaltungsorte)
     VALUES ($1,$2,$3,$16::jsonb,false,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,
       (SELECT COALESCE(MAX(sortierung),0)+1 FROM brilon_angebote),false,$17::jsonb,$18,$19,$20::jsonb)
     RETURNING id,veranstaltungsort,veranstaltungsorte`,
    [name,beschreibung,dauer,kategorie,zielgruppe,veranstaltungsort,kapazitaet,
      JSON.stringify(termine),hinweise,d.buchbar===true,d.veroeffentlicht===true,
      buchungsmodus,buchungsmodus==='einzelplatz'?mindestteilnehmer:1,
      buchungsmodus==='einzelplatz'?preisProPerson:0,bildUrl||null,
       JSON.stringify(preiseAusStufen(validStufen.stufen)),JSON.stringify(validStufen.stufen),dauerModus,mitarbeiterbeschreibung,JSON.stringify(veranstaltungsorte)]
  );

  const gruppenZuordnungGespeichert=await programmBesuchergruppenSynchronisieren(q.rows[0].id,d.besuchergruppen);
  return reply(res, 201, {
    success: true,
    id: q.rows[0].id,
    veranstaltungsort:q.rows[0].veranstaltungsort,
    veranstaltungsorte:q.rows[0].veranstaltungsorte,
    gruppenZuordnungGespeichert
  });
}

     
// Separater Speicherweg: Standortwechsel darf nie Preisstaffeln oder Inhalte überschreiben.
const programmStandortRoute=route.match(/^\/api\/admin\/angebote\/([0-9]+)\/standorte$/);
if(programmStandortRoute&&req.method==='PATCH'){
  const d=await body(req,8000);
  const valid=programmStandorteValidieren(d.veranstaltungsorte);
  if(valid.error)return reply(res,400,{error:valid.error});
  if(!await programmStandorteAktivPruefen(valid.standorte))
    return reply(res,400,{error:'Mindestens ein Standort ist nicht angelegt oder nicht aktiv.'});
  const primary=valid.standorte.includes(d.veranstaltungsort)?d.veranstaltungsort:valid.standorte[0];
  const q=await pool.query(
    'UPDATE brilon_angebote SET veranstaltungsorte=$2::jsonb,veranstaltungsort=$3 WHERE id=$1 RETURNING id,veranstaltungsort,veranstaltungsorte',
    [programmStandortRoute[1],JSON.stringify(valid.standorte),primary]
  );
  if(!q.rowCount)return reply(res,404,{error:'Programm nicht gefunden.'});
  return reply(res,200,{success:true,...q.rows[0]});
}

const preisRoute = route.match(/^\/api\/admin\/angebote\/([0-9]+)$/);

if (preisRoute && req.method === 'PATCH') {
  const d = await body(req);
  const bisher=await pool.query(
    `SELECT * FROM brilon_angebote WHERE id=$1`,[preisRoute[1]]
  );
  if(!bisher.rowCount)return reply(res,404,{error:'Angebot nicht gefunden.'});
  const alt=bisher.rows[0];
  // A selected library image must be independently saveable, without rewriting
  // prices, participant tiers or the rest of the program.
  if(Object.prototype.hasOwnProperty.call(d,'bild_url')){
    if(typeof d.bild_url!=='string')return reply(res,400,{error:'Ungültige Bildadresse.'});
    const candidate=d.bild_url.trim();
    let safe=false;
    if(candidate==='')safe=true;
    else if(/^\/(?:fotos|images|bilder|assets)\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp|gif)$/i.test(candidate)&&!candidate.includes('..'))safe=true;
    else {
      try {
        const parsed=new URL(candidate);
        const configured=process.env.SUPABASE_URL?new URL(process.env.SUPABASE_URL).hostname:'';
        safe=parsed.protocol==='https:'&&!!configured&&parsed.hostname===configured&&
          parsed.pathname.startsWith('/storage/v1/object/public/angebotsbilder/')&&
          !parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&
          !parsed.pathname.includes('..');
      }catch{}
    }
    if(!safe||candidate.length>1000)return reply(res,400,{error:'Das Bild muss aus der Medienbibliothek oder aus den freigegebenen Website-Bildern stammen.'});
    if(Object.keys(d).length===1){
      const updated=await pool.query('UPDATE brilon_angebote SET bild_url=$1 WHERE id=$2 RETURNING id,bild_url',[candidate||null,preisRoute[1]]);
      return reply(res,200,{...updated.rows[0],success:true});
    }
  }
const aktiv = typeof d.aktiv === 'boolean' ? d.aktiv : null;
const name=d.name===undefined?alt.name:safeText(d.name,120);
const beschreibung = d.beschreibung===undefined?alt.beschreibung:safeText(d.beschreibung,1000);
const kategorie=d.kategorie===undefined?alt.kategorie:safeText(d.kategorie,60);
const zielgruppe=d.zielgruppe===undefined?alt.zielgruppe:safeText(d.zielgruppe,120);
const bisherigeStandorte=Array.isArray(alt.veranstaltungsorte)&&alt.veranstaltungsorte.length
  ?alt.veranstaltungsorte:[alt.veranstaltungsort].filter(Boolean);
const standortPruefung=programmStandorteValidieren(d.veranstaltungsorte,bisherigeStandorte);
if(standortPruefung.error)return reply(res,400,{error:standortPruefung.error});
const veranstaltungsorte=standortPruefung.standorte;
const veranstaltungsort=veranstaltungsorte.includes(d.veranstaltungsort)?d.veranstaltungsort:
  veranstaltungsorte.includes(alt.veranstaltungsort)?alt.veranstaltungsort:veranstaltungsorte[0];
const dauer=Number(d.dauer??alt.dauer);
const kapazitaet=Number(d.kapazitaet??alt.kapazitaet);
const hinweise=d.hinweise===undefined?alt.hinweise:safeText(d.hinweise,1000);
const mitarbeiterbeschreibung=d.mitarbeiterbeschreibung===undefined?(alt.mitarbeiterbeschreibung||''):safeText(d.mitarbeiterbeschreibung,20000);
const termine=Array.isArray(d.verfuegbare_termine)?d.verfuegbare_termine:alt.verfuegbare_termine;
const buchbar=typeof d.buchbar==='boolean'?d.buchbar:alt.buchbar;
const veroeffentlicht=typeof d.veroeffentlicht==='boolean'?d.veroeffentlicht:alt.veroeffentlicht;
const buchungsmodus=d.buchungsmodus===undefined?(alt.buchungsmodus||'gruppe'):
  d.buchungsmodus==='einzelplatz'?'einzelplatz':'gruppe';
const mindestteilnehmer=Number(d.mindestteilnehmer??alt.mindestteilnehmer??5);
const preisProPerson=Number(d.preis_pro_person??alt.preis_pro_person??0);
const dauerModus=d.dauer_modus===undefined?(alt.dauer_modus||'gruppenstufe'):(d.dauer_modus==='fest'?'fest':'gruppenstufe');
const legacy=Object.entries(alt.preise||{}).map(([range,preis])=>{
  const m=/^(\d+)-(\d+)$/.exec(range);
  return m?{min:Number(m[1]),max:Number(m[2]),preis:Number(preis),dauer:Number(alt.dauer)}:null;
}).filter(Boolean);
const rawStufen=d.gruppenstufen===undefined
  ?(Array.isArray(alt.gruppenstufen)&&alt.gruppenstufen.length?alt.gruppenstufen:legacy)
  :d.gruppenstufen;
const validStufen=pruefeProgrammstufen(rawStufen,kapazitaet,buchungsmodus,dauer,dauerModus);
if(validStufen.error)return reply(res,400,{error:validStufen.error});
const neuePreise=preiseAusStufen(validStufen.stufen);

if(!name||!kategorie||!veranstaltungsort||!Number.isInteger(dauer)||dauer<15||dauer>1440||
   !Number.isInteger(kapazitaet)||kapazitaet<1||kapazitaet>500||termine.some(t=>!gueltigesDatum(t))||
   (buchungsmodus==='einzelplatz'&&(!Number.isInteger(kapazitaet)||kapazitaet<5||kapazitaet>12||
     !Number.isInteger(mindestteilnehmer)||mindestteilnehmer<5||mindestteilnehmer>kapazitaet||
     !Number.isFinite(preisProPerson)||preisProPerson<=0)))
  return reply(res,400,{error:'Dauer, Kapazität oder verfügbare Termine sind ungültig.'});
if(!await programmStandorteAktivPruefen(veranstaltungsorte))
  return reply(res,400,{error:'Mindestens ein ausgewählter Standort ist nicht angelegt oder nicht aktiv.'});

const q = await pool.query(
  `UPDATE brilon_angebote
   SET preise = $1::jsonb,
       aktiv = COALESCE($3, aktiv),
       name=$4,beschreibung = $5,
       kategorie=$6,zielgruppe=$7,veranstaltungsort=$8,kapazitaet=$9,
       verfuegbare_termine=$10::jsonb,hinweise=$11,buchbar=$12,veroeffentlicht=$13,dauer=$14,
       buchungsmodus=$15,mindestteilnehmer=$16,preis_pro_person=$17,gruppenstufen=$18::jsonb,dauer_modus=$19,bild_url=COALESCE($20,bild_url),
       mitarbeiterbeschreibung=$21,veranstaltungsorte=$22::jsonb
   WHERE id = $2
   RETURNING id,preise,aktiv,name,beschreibung,mitarbeiterbeschreibung,dauer,kategorie,zielgruppe,veranstaltungsort,veranstaltungsorte,
             kapazitaet,verfuegbare_termine,hinweise,buchbar,veroeffentlicht,
             buchungsmodus,mindestteilnehmer,preis_pro_person,sortierung,archiviert,gruppenstufen,dauer_modus,bild_url`,
  [
    JSON.stringify(neuePreise),
    preisRoute[1],
    aktiv,
    name,beschreibung,kategorie,zielgruppe,veranstaltungsort,kapazitaet,
    JSON.stringify(termine),hinweise,buchbar,veroeffentlicht,dauer,
    buchungsmodus,buchungsmodus==='einzelplatz'?mindestteilnehmer:1,
    buchungsmodus==='einzelplatz'?preisProPerson:0,
    JSON.stringify(validStufen.stufen),dauerModus,
    Object.prototype.hasOwnProperty.call(d,'bild_url')?d.bild_url.trim()||null:null,
    mitarbeiterbeschreibung,JSON.stringify(veranstaltungsorte)
  ]
);


  if (!q.rowCount) {
    return reply(res, 404, {
      error: 'Angebot nicht gefunden.'
    });
  }

  const gruppenZuordnungGespeichert=await programmBesuchergruppenSynchronisieren(q.rows[0].id,d.besuchergruppen);
  return reply(res, 200, {...q.rows[0],gruppenZuordnungGespeichert});
}
     const bildRoute = route.match(
  /^\/api\/admin\/angebote\/([0-9]+)\/bild$/
);

if (bildRoute && req.method === 'POST') {
  if(!limit('image-upload:'+ip,20,600000))
    return reply(res,429,{error:'Zu viele Bild-Uploads. Bitte später erneut versuchen.'});
  const angebotId = Number(bildRoute[1]);

  const erlaubteTypen = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };

  const dateityp = (req.headers['content-type'] || '')
    .split(';')[0]
    .toLowerCase();

  const endung = erlaubteTypen[dateityp];

  if (!endung) {
    return reply(res, 400, {
      error: 'Nur JPG, PNG und WebP erlaubt.'
    });
  }

  const teile = [];
  let groesse = 0;

  for await (const teil of req) {
    groesse += teil.length;

    if (groesse > 5 * 1024 * 1024) {
      return reply(res, 413, {
        error: 'Das Bild darf maximal 5 MB groß sein.'
      });
    }

    teile.push(teil);
  }

  if (!groesse) {
    return reply(res, 400, {
      error: 'Keine Bilddatei empfangen.'
    });
  }

  let bild = Buffer.concat(teile);

  try{bild=await bereinigeBild(bild,dateityp);}catch{
    return reply(res, 400, {
      error: 'Ungültige oder zu große Bilddatei. Erlaubt sind vollständige JPG-, PNG- und WebP-Bilder bis 40 Megapixel.'
    });
  }

  try{await pruefeNeuCodiertesAdminBild(bild,dateityp);}
  catch(error){return malwareScanReply(res,error);}

  const vorhanden = await pool.query(
    'SELECT id FROM brilon_angebote WHERE id = $1',
    [angebotId]
  );

  if (!vorhanden.rowCount) {
    return reply(res, 404, {
      error: 'Angebot nicht gefunden.'
    });
  }

  const dateiname =
    angebotId + '/' + crypto.randomUUID() + '.' + endung;

      if (!supabase) return reply(res,503,{error:'Bildspeicher ist nicht konfiguriert.'});
      const { error } = await supabase.storage
    .from('angebotsbilder')
    .upload(dateiname, bild, {
      contentType: dateityp,
      upsert: false
    });

  if (error) {
    console.error('Bildupload fehlgeschlagen:', error);
    return reply(res, 502, {
      error: 'Bild konnte nicht gespeichert werden.'
    });
  }

  const { data } = supabase.storage
    .from('angebotsbilder')
    .getPublicUrl(dateiname);

  const speicherung = await pool.query(
  'UPDATE brilon_angebote SET bild_url = $1 WHERE id = $2 RETURNING id, bild_url',
  [data.publicUrl, angebotId]
);

if (speicherung.rowCount !== 1) {
  console.error('Bildadresse nicht gespeichert. Angebots-ID:', angebotId);
  return reply(res, 500, {
    error: 'Bild hochgeladen, aber Bildadresse nicht gespeichert.'
  });
}

  return reply(res, 200, {
    success: true,
    bild_url: data.publicUrl
  });
}
const aktionMedienBildRoute=route.match(/^\/api\/admin\/aktionen\/([0-9a-fA-F-]{36})\/medienbild$/);
if(aktionMedienBildRoute&&req.method==='PATCH'){
  const d=await body(req,4000);
  if(typeof d?.bild_url!=='string')return reply(res,400,{error:'Bitte eine gültige Bildadresse auswählen.'});
  const bildUrl=d.bild_url.trim();
  let valid=false;
  if(bildUrl&&bildUrl.length<=1000&&!bildUrl.includes('..')){
    if(/^\/(?:fotos|images|bilder|assets)\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp|gif)$/i.test(bildUrl))valid=true;
    else try{
      const url=new URL(bildUrl);
      const hostname=process.env.SUPABASE_URL?new URL(process.env.SUPABASE_URL).hostname:'';
      valid=Boolean(hostname)&&url.protocol==='https:'&&url.hostname===hostname&&
        url.pathname.startsWith('/storage/v1/object/public/angebotsbilder/')&&
        !url.username&&!url.password&&!url.search&&!url.hash;
    }catch{}
  }
  if(!valid)return reply(res,400,{error:'Bitte ein Bild aus der zentralen Medienbibliothek auswählen.'});
  const q=await pool.query("UPDATE brilon_aktionen SET data=jsonb_set(data,'{bild_url}',to_jsonb($1::text),true) WHERE id=$2 RETURNING id,data->>'bild_url' AS bild_url",[bildUrl,aktionMedienBildRoute[1]]);
  if(!q.rowCount)return reply(res,404,{error:'Sonderangebot nicht gefunden.'});
  return reply(res,200,{success:true,id:q.rows[0].id,bild_url:q.rows[0].bild_url});
}
 const aktionsBildRoute = route.match(
  /^\/api\/admin\/aktionen\/([0-9a-fA-F-]{36})\/bild$/
);

if (aktionsBildRoute && req.method === 'POST') {
  if(!limit('image-upload:'+ip,20,600000))
    return reply(res,429,{error:'Zu viele Bild-Uploads. Bitte später erneut versuchen.'});
  const aktionsId = aktionsBildRoute[1];

  const erlaubteTypen = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };

  const dateityp = (req.headers['content-type'] || '')
    .split(';')[0].toLowerCase();
  const endung = erlaubteTypen[dateityp];

  if (!endung) {
    return reply(res, 400, {
      error: 'Nur JPG, PNG und WebP erlaubt.'
    });
  }

  const teile = [];
  let groesse = 0;

  for await (const teil of req) {
    groesse += teil.length;

    if (groesse > 5 * 1024 * 1024) {
      return reply(res, 413, {
        error: 'Das Bild darf maximal 5 MB groß sein.'
      });
    }

    teile.push(teil);
  }

  if (!groesse) {
    return reply(res, 400, {
      error: 'Keine Bilddatei empfangen.'
    });
  }

  let bild = Buffer.concat(teile);

  try{bild=await bereinigeBild(bild,dateityp);}catch{
    return reply(res, 400, {
      error: 'Ungültige oder zu große Bilddatei. Erlaubt sind vollständige JPG-, PNG- und WebP-Bilder bis 40 Megapixel.'
    });
  }

  try{await pruefeNeuCodiertesAdminBild(bild,dateityp);}
  catch(error){return malwareScanReply(res,error);}

  const vorhanden = await pool.query(
    'SELECT id FROM brilon_aktionen WHERE id = $1',
    [aktionsId]
  );

  if (!vorhanden.rowCount) {
    return reply(res, 404, {
      error: 'Sonderangebot nicht gefunden.'
    });
  }

  const dateiname =
    'sonderaktionen/' + aktionsId + '/' +
    crypto.randomUUID() + '.' + endung;

  if (!supabase) return reply(res,503,{error:'Bildspeicher ist nicht konfiguriert.'});
  const { error } = await supabase.storage
    .from('angebotsbilder')
    .upload(dateiname, bild, {
      contentType: dateityp,
      upsert: false
    });

  if (error) {
    console.error('Aktionsbild-Upload fehlgeschlagen:', error);
    return reply(res, 502, {
      error: 'Bild konnte nicht gespeichert werden.'
    });
  }

  const { data } = supabase.storage
    .from('angebotsbilder')
    .getPublicUrl(dateiname);

 const speicherung = await pool.query(
  `UPDATE brilon_aktionen
   SET data = jsonb_set(data, '{bild_url}', to_jsonb($1::text))
   WHERE id = $2
   RETURNING id`,
  [data.publicUrl, aktionsId]
);

if (speicherung.rowCount !== 1) {
  return reply(res, 500, {
    error: 'Bildadresse konnte nicht gespeichert werden.'
  });
}

  return reply(res, 200, {
    success: true,
    bild_url: data.publicUrl
  });
}
      return reply(res,404,{error:'Nicht gefunden.'});
    }

    


   
if (route === '/api/orte' && req.method === 'GET') {
  if (!pool) return reply(res,503,{error:'Veranstaltungsorte derzeit nicht verfügbar.'});
  const q=await pool.query('SELECT id,name FROM brilon_orte WHERE aktiv=true ORDER BY name');
  return reply(res,200,q.rows);
}

if (route === '/api/angebote' && req.method === 'GET') {
  if (!pool) {
    return reply(res, 503, {
      error: 'Angebote derzeit nicht verfügbar.'
    });
  }

  const q = await pool.query(
 `SELECT id,name,beschreibung,dauer,preise,bild_url,kategorie,zielgruppe,
        veranstaltungsort,veranstaltungsorte,kapazitaet,verfuegbare_termine,hinweise,
        buchungsmodus,mindestteilnehmer,preis_pro_person,sortierung,archiviert,gruppenstufen,dauer_modus,
        (SELECT COALESCE(jsonb_agg(o.name), '[]'::jsonb) FROM brilon_orte o
          WHERE o.partnerhaus=true AND (o.name=brilon_angebote.veranstaltungsort
            OR brilon_angebote.veranstaltungsorte ? o.name)) AS partnerhaus_standorte
     FROM brilon_angebote
     WHERE archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true
     ORDER BY sortierung ASC,name ASC`
  );

  return reply(res, 200, q.rows);
}

    if(route.startsWith('/api/'))
      
      return reply(res,404,{error:'Nicht gefunden.'});

    if(req.method!=='GET'&&req.method!=='HEAD')
      return reply(res,405,{error:'Methode nicht erlaubt.'});

    const file=route==='/'?'/index.html':route;
    const target=path.resolve(ROOT,'.'+file);
    if(!target.startsWith(ROOT+path.sep))
      return reply(res,403,{error:'Nicht erlaubt.'});

    fs.readFile(target,(err,data)=>{
      if(err){
        res.writeHead(404,securityHeaders);
        return res.end('Nicht gefunden');
      }
      res.writeHead(200,{
        'Content-Type':mime[path.extname(target)]||'application/octet-stream',
        ...securityHeaders,
        'Content-Security-Policy':"default-src 'self'; img-src 'self' blob: https://fssjruvxkdqeltjdrlfo.supabase.co; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'self'; frame-ancestors 'none'"
      });
      res.end(req.method==='HEAD'?undefined:data);
    });
  }catch(e){
    console.error('Anfragefehler:',e.message);
    const placesSchemaMissing=route==='/api/admin/orte'&&e.code==='42P01';
    const partnerFeedbackSchemaMissing=(route.startsWith('/api/netzwerkpartner/')||
      route.startsWith('/api/admin/netzwerkpartner/')||route==='/api/kundenfeedback'||
      route==='/api/admin/kundenfeedback')&&e.code==='42P01';
    const statusCode=e.message==='Ungültiges JSON'||e.message==='Anfrage zu groß'?400:
      placesSchemaMissing||partnerFeedbackSchemaMissing?503:500;
    reply(res,statusCode,{
      error:e.message==='Ungültiges JSON'||e.message==='Anfrage zu groß'?
        e.message:placesSchemaMissing?
          'Die Veranstaltungsort-Tabelle fehlt. Einmalig RUN_PLACES_MIGRATION=true setzen und den Server neu starten.':
          partnerFeedbackSchemaMissing?
            'Dieser Bereich wird gerade eingerichtet. Bitte später erneut versuchen.':
          'Interner Serverfehler.'
    });
  }
}

async function migrateEinsatzplanung(){
    const einsatzSchema=await pool.query(`SELECT to_regclass('public.brilon_buchungen') AS buchungen,
      to_regclass('public.brilon_pruef_mitarbeitende') AS mitarbeitende`);
    if(einsatzSchema.rows[0]?.buchungen&&einsatzSchema.rows[0]?.mitarbeitende){
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_beschaeftigung (
  mitarbeiter_id UUID PRIMARY KEY REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE CASCADE,
  art TEXT NOT NULL DEFAULT 'nicht_hinterlegt' CHECK (art IN ('nicht_hinterlegt','minijob','teilzeit','vollzeit','honorar')),
  stundenlohn_cent INTEGER CHECK(stundenlohn_cent IS NULL OR stundenlohn_cent BETWEEN 0 AND 100000),
  wochenstunden NUMERIC(6,2) CHECK(wochenstunden IS NULL OR wochenstunden BETWEEN 0 AND 80),
  monatsstunden NUMERIC(7,2) CHECK(monatsstunden IS NULL OR monatsstunden BETWEEN 0 AND 350),
  minijob_grenze_cent INTEGER CHECK(minijob_grenze_cent IS NULL OR minijob_grenze_cent BETWEEN 0 AND 1000000),
  gueltig_ab DATE,
  gueltig_bis DATE,
  aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(gueltig_bis IS NULL OR gueltig_ab IS NULL OR gueltig_bis>=gueltig_ab)
)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_einsaetze (
  buchung_id UUID NOT NULL REFERENCES brilon_buchungen(id) ON DELETE CASCADE,
  mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('beworben','eingeteilt','bestaetigt','abgelehnt','abgeschlossen')),
  arbeitsminuten INTEGER CHECK(arbeitsminuten IS NULL OR arbeitsminuten BETWEEN 1 AND 1440),
  ist_minuten INTEGER CHECK(ist_minuten IS NULL OR ist_minuten BETWEEN 0 AND 1440),
  bewerbung_am TIMESTAMPTZ,
  zugewiesen_am TIMESTAMPTZ,
  bestaetigt_am TIMESTAMPTZ,
  abgeschlossen_am TIMESTAMPTZ,
  aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(buchung_id,mitarbeiter_id)
)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS brilon_einsaetze_mitarbeiter_idx ON brilon_einsaetze(mitarbeiter_id,status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS brilon_einsaetze_buchung_idx ON brilon_einsaetze(buchung_id)`);
      await pool.query('ALTER TABLE brilon_beschaeftigung ADD COLUMN IF NOT EXISTS vertrauensperson BOOLEAN NOT NULL DEFAULT false');
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_kundenbestaetigungen (
  buchung_id UUID PRIMARY KEY REFERENCES brilon_buchungen(id) ON DELETE CASCADE,
  anlass_mitarbeiter_id UUID REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE SET NULL,
  faellig_ab TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'geplant'
    CHECK(status IN ('geplant','versand_laeuft','gesendet','abgebrochen','fehler')),
  erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  versendet_am TIMESTAMPTZ,
  fehler TEXT
)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS brilon_kundenbestaetigungen_faellig_idx
  ON brilon_kundenbestaetigungen(faellig_ab) WHERE status='geplant'`);
      console.log('Einsatzplanungsschema geprüft');
    }else{
      console.warn('Einsatzplanungsschema zurückgestellt: Grundtabellen noch nicht vorhanden.');
    }

}

async function start(){
  if(pool){
    await pool.query('SELECT 1');
    if(process.env.RUN_INVOICE_MIGRATION==='true'){
      const sql=fs.readFileSync(path.join(__dirname,'db/migrations/2026-11-06-rechnungen-agb.sql'),'utf8');
      await pool.query(sql);
      console.log('Rechnungs- und AGB-Schema geprüft (RUN_INVOICE_MIGRATION=true)');
    }
    // Idempotente, eng begrenzte Einsatzplanungs-Migration nach Freigabe.
    // Nur ausführen, wenn die bestehenden Buchungs- und Mitarbeitertabellen vorhanden sind.
    if(process.env.RUN_MARKETING_MIGRATION==='true'){
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_marketing_kampagnen (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      console.log('Marketing-Kampagnentabelle geprüft');
    }
    // Explicit, narrow opt-in used only to initialize the admin session store.
    if(process.env.RUN_ADMIN_SESSION_MIGRATION==='true'){
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_admin_sessions (
        token_hash CHAR(64) PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS brilon_admin_sessions_expires_at_idx ON brilon_admin_sessions(expires_at)');
      console.log('Admin-Sitzungstabelle geprüft (RUN_ADMIN_SESSION_MIGRATION=true)');
    }
    if(process.env.RUN_ANSCHLUSSANFRAGE_MIGRATION==='true'){
      await pool.query('ALTER TABLE brilon_kalender ADD COLUMN IF NOT EXISTS anschluss JSONB');
      console.log('Anschlussanfrage-Spalte geprüft (RUN_ANSCHLUSSANFRAGE_MIGRATION=true)');
    }
    // Separate, explicit one-time opt-in for the venue settings table.
    // This stays independent of both session initialization and broad schema migrations.
    if(process.env.RUN_PLACES_MIGRATION==='true'){
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_orte(
        id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL UNIQUE,aktiv BOOLEAN NOT NULL DEFAULT true,
        erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      await pool.query(`ALTER TABLE brilon_orte
        ADD COLUMN IF NOT EXISTS partnerhaus BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS partnerkontakt_name TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS partnerkontakt_email TEXT NOT NULL DEFAULT ''`);
      await pool.query(`INSERT INTO brilon_orte(name) VALUES('Brilon') ON CONFLICT(name) DO NOTHING`);
      console.log('Veranstaltungsort-Tabelle geprüft (RUN_PLACES_MIGRATION=true)');
    }
    // Targeted opt-in: only columns needed by the admin dashboard's first queries.
    if(process.env.RUN_ADMIN_DASHBOARD_MIGRATION==='true'){
      await pool.query('ALTER TABLE brilon_buchungen ADD COLUMN IF NOT EXISTS buchungsnummer TEXT');
      await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS brilon_buchungen_buchungsnummer_unique ON brilon_buchungen (buchungsnummer)');
      await pool.query(`ALTER TABLE brilon_angebote
        ADD COLUMN IF NOT EXISTS kategorie TEXT NOT NULL DEFAULT 'Klettern',
        ADD COLUMN IF NOT EXISTS archiviert BOOLEAN NOT NULL DEFAULT false`);
      console.log('Admin-Dashboard-Spalten geprüft (RUN_ADMIN_DASHBOARD_MIGRATION=true)');
    }
    // Narrow, one-time opt-in for columns used by offer administration and booking.
    // It is separate from the broad schema migration to avoid changing unrelated tables.
    if(process.env.RUN_PROGRAM_FIELDS_MIGRATION==='true'){
      await pool.query(`ALTER TABLE brilon_angebote
        ADD COLUMN IF NOT EXISTS bild_url TEXT,
        ADD COLUMN IF NOT EXISTS kategorie TEXT NOT NULL DEFAULT 'Klettern',
        ADD COLUMN IF NOT EXISTS zielgruppe TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS veranstaltungsort TEXT NOT NULL DEFAULT 'Brilon',
        ADD COLUMN IF NOT EXISTS veranstaltungsorte JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS kapazitaet INTEGER NOT NULL DEFAULT 20,
        ADD COLUMN IF NOT EXISTS verfuegbare_termine JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS hinweise TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS buchbar BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS veroeffentlicht BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS buchungsmodus TEXT NOT NULL DEFAULT 'gruppe',
        ADD COLUMN IF NOT EXISTS mindestteilnehmer INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS preis_pro_person NUMERIC(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS sortierung INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS archiviert BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS mitarbeiterbeschreibung TEXT NOT NULL DEFAULT ''`);
      await pool.query(`UPDATE brilon_angebote SET veranstaltungsorte=jsonb_build_array(veranstaltungsort)
        WHERE veranstaltungsorte='[]'::jsonb AND NULLIF(TRIM(veranstaltungsort),'') IS NOT NULL`);
      console.log('Angebotsfelder und Programmstandorte geprüft (RUN_PROGRAM_FIELDS_MIGRATION=true)');
    }
    // One-time, narrowly scoped migration for the employee and station-inspection area.
    // This does not run the booking, offers, or GPS schema migrations.
    if(process.env.RUN_PRUEF_SCHEMA_MIGRATION==='true'){
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_orte(
        id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL UNIQUE,aktiv BOOLEAN NOT NULL DEFAULT true,
        erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      await pool.query('ALTER TABLE brilon_orte ADD COLUMN IF NOT EXISTS aktiv BOOLEAN NOT NULL DEFAULT true');
      await pool.query(`ALTER TABLE brilon_orte
        ADD COLUMN IF NOT EXISTS partnerhaus BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS partnerkontakt_name TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS partnerkontakt_email TEXT NOT NULL DEFAULT ''`);

      await pool.query(`INSERT INTO brilon_orte(name) VALUES('Brilon') ON CONFLICT(name) DO NOTHING`);
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_admin_sessions (
        token_hash CHAR(64) PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS brilon_admin_sessions_expires_at_idx ON brilon_admin_sessions(expires_at)');
    // Stations-Prüfprotokoll: gezielte Migration für den Mitarbeiter- und Prüfbereich.
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_mitarbeitende (
      id UUID PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,
      passwort_hash TEXT NOT NULL,aktiv BOOLEAN NOT NULL DEFAULT true,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query('ALTER TABLE brilon_pruef_mitarbeitende ADD COLUMN IF NOT EXISTS telefon TEXT');
    await pool.query('ALTER TABLE brilon_pruef_mitarbeitende ADD COLUMN IF NOT EXISTS strasse TEXT');
    await pool.query('ALTER TABLE brilon_pruef_mitarbeitende ADD COLUMN IF NOT EXISTS plz TEXT');
    await pool.query('ALTER TABLE brilon_pruef_mitarbeitende ADD COLUMN IF NOT EXISTS wohnort TEXT');
    await pool.query('ALTER TABLE brilon_pruef_mitarbeitende ADD COLUMN IF NOT EXISTS qualifikationen TEXT');
    await pool.query('ALTER TABLE brilon_pruef_mitarbeitende ADD COLUMN IF NOT EXISTS registriert_am TIMESTAMPTZ');
    await pool.query('ALTER TABLE brilon_pruef_mitarbeitende ADD COLUMN IF NOT EXISTS freigabe_am TIMESTAMPTZ');
    await pool.query('ALTER TABLE brilon_pruef_mitarbeitende ADD COLUMN IF NOT EXISTS verwaltungszugang BOOLEAN NOT NULL DEFAULT false');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_personaldokumente (
      id UUID PRIMARY KEY,
      mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE CASCADE,
      bezeichnung TEXT NOT NULL,dateiname TEXT NOT NULL,mime_type TEXT NOT NULL CHECK(mime_type='image/jpeg'),
      daten BYTEA NOT NULL,bytegroesse INTEGER NOT NULL CHECK(bytegroesse>0 AND bytegroesse<=512000),
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_personaldokumente_mitarbeiter_idx ON brilon_pruef_personaldokumente(mitarbeiter_id,erstellt_am)');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_freigaben (
      id UUID PRIMARY KEY,
      mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE CASCADE,
      ort_id BIGINT NOT NULL REFERENCES brilon_orte(id),
      qualifikation TEXT NOT NULL,erstellt_von TEXT NOT NULL,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(mitarbeiter_id,ort_id,qualifikation))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_einladungen (
      id UUID PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,ablauf TIMESTAMPTZ NOT NULL,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),verwendet_am TIMESTAMPTZ,
      widerrufen_am TIMESTAMPTZ)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS brilon_pruef_einladungen_offen_email_idx
      ON brilon_pruef_einladungen(email) WHERE verwendet_am IS NULL AND widerrufen_am IS NULL`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_stationen (
      id UUID PRIMARY KEY,name TEXT NOT NULL,aktiv BOOLEAN NOT NULL DEFAULT true,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query('ALTER TABLE brilon_pruef_stationen ADD COLUMN IF NOT EXISTS ort_id BIGINT REFERENCES brilon_orte(id)');
    await pool.query("ALTER TABLE brilon_pruef_stationen ADD COLUMN IF NOT EXISTS qualifikation TEXT NOT NULL DEFAULT ''");
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_sessions (
      token_hash CHAR(64) PRIMARY KEY,mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id),
      ablauf TIMESTAMPTZ NOT NULL,entsperrt_bis TIMESTAMPTZ)`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_sessions_ablauf_idx ON brilon_pruef_sessions(ablauf)');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_admin_sessions (
      token_hash CHAR(64) PRIMARY KEY,mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE CASCADE,
      ablauf TIMESTAMPTZ NOT NULL)`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_admin_sessions_ablauf_idx ON brilon_pruef_admin_sessions(ablauf)');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_login_fehler (
      email_hash CHAR(64) PRIMARY KEY,versuche INTEGER NOT NULL DEFAULT 0,fenster_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_passwort_resets (
      token_hash CHAR(64) PRIMARY KEY,mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE CASCADE,
      ablauf TIMESTAMPTZ NOT NULL,verwendet_am TIMESTAMPTZ,erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_passwort_resets_expiry_idx ON brilon_pruef_passwort_resets(ablauf)');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_codes (
      id UUID PRIMARY KEY,code_hash CHAR(64) NOT NULL,ablauf TIMESTAMPTZ NOT NULL,
      verbraucht_am TIMESTAMPTZ,erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_berichte (
      id UUID PRIMARY KEY,mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id),
      programm TEXT NOT NULL,beginn TEXT NOT NULL,pruefungen JSONB NOT NULL,
      hat_mangel BOOLEAN NOT NULL,erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    // Sperren bleiben bis zu einer gesondert protokollierten fachlichen Freigabe bestehen.
    await pool.query('ALTER TABLE brilon_pruef_stationen ADD COLUMN IF NOT EXISTS gesperrt_am TIMESTAMPTZ');
    await pool.query('ALTER TABLE brilon_pruef_stationen ADD COLUMN IF NOT EXISTS sperrgrund TEXT');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_stationsereignisse (
      id UUID PRIMARY KEY,
      station_id UUID NOT NULL REFERENCES brilon_pruef_stationen(id),
      bericht_id UUID REFERENCES brilon_pruef_berichte(id),
      art TEXT NOT NULL CHECK(art IN ('mangel','freigabe')),
      notiz TEXT NOT NULL,
      verantwortlich TEXT NOT NULL,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_stationsereignisse_station_idx ON brilon_pruef_stationsereignisse(station_id,erstellt_am DESC)');
    // Administrative station changes do not alter the historic defect/release log.
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_stationsstatus (
      id UUID PRIMARY KEY,
      station_id UUID NOT NULL REFERENCES brilon_pruef_stationen(id),
      art TEXT NOT NULL CHECK(art IN ('deaktiviert','reaktiviert')),
      begruendung TEXT NOT NULL,
      verantwortlich TEXT NOT NULL,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_stationsstatus_station_idx ON brilon_pruef_stationsstatus(station_id,erstellt_am DESC)');
    await pool.query('ALTER TABLE brilon_pruef_berichte ADD COLUMN IF NOT EXISTS hat_hinweis BOOLEAN NOT NULL DEFAULT false');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_hinweise(
      id UUID PRIMARY KEY,station_id UUID NOT NULL REFERENCES brilon_pruef_stationen(id),
      bericht_id UUID NOT NULL REFERENCES brilon_pruef_berichte(id),
      beschreibung TEXT NOT NULL,erstellt_von TEXT NOT NULL,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      erledigt_am TIMESTAMPTZ,erledigt_von TEXT,erledigt_notiz TEXT,
      UNIQUE(bericht_id,station_id))`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_hinweise_offen_idx ON brilon_pruef_hinweise(erstellt_am DESC) WHERE erledigt_am IS NULL');

    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_meldungen (
      bericht_id UUID PRIMARY KEY REFERENCES brilon_pruef_berichte(id),
      status TEXT NOT NULL DEFAULT 'ausstehend'
        CHECK(status IN ('ausstehend','sendet','angenommen','fehlgeschlagen','nicht_konfiguriert')),
      versuche INTEGER NOT NULL DEFAULT 0 CHECK(versuche>=0),
      letzter_versuch TIMESTAMPTZ,angenommen_am TIMESTAMPTZ,
      letzter_fehler TEXT,erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_meldungen_status_idx ON brilon_pruef_meldungen(status,erstellt_am DESC)');
    await pool.query('ALTER TABLE brilon_pruef_codes ADD COLUMN IF NOT EXISTS code_verschluesselt TEXT');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_tablet_kopplungen(
      id UUID PRIMARY KEY,code_hash CHAR(64) NOT NULL,
      ablauf TIMESTAMPTZ NOT NULL,verwendet_am TIMESTAMPTZ,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_tablets(
      id UUID PRIMARY KEY,name TEXT NOT NULL,token_hash CHAR(64) NOT NULL UNIQUE,
      aktiv BOOLEAN NOT NULL DEFAULT true,gekoppelt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_tablets_aktiv_idx ON brilon_pruef_tablets(aktiv)');
    // Letztes Lebenszeichen dient ausschließlich der aktuellen Verbindungserkennung.
    await pool.query('ALTER TABLE brilon_pruef_tablets ADD COLUMN IF NOT EXISTS zuletzt_gesehen_am TIMESTAMPTZ');
    // Pro Prüfstandort ist genau ein Administrations-Tablet als Codeanzeige ausgewählt.
    await pool.query('ALTER TABLE brilon_pruef_tablets ADD COLUMN IF NOT EXISTS pruefdisplay BOOLEAN NOT NULL DEFAULT false');
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS brilon_pruef_tablets_ein_display_idx ON brilon_pruef_tablets((1)) WHERE pruefdisplay=true');
    await pool.query('ALTER TABLE brilon_pruef_codes ADD COLUMN IF NOT EXISTS tablet_id UUID REFERENCES brilon_pruef_tablets(id)');
      console.log('Mitarbeiter- und Stationsschema geprüft (RUN_PRUEF_SCHEMA_MIGRATION=true)');
    }
    // Optional employee portal content; independent from staff and inspection tables.
    if(process.env.RUN_EMPLOYEE_AREAS_MIGRATION==='true'){
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_mitarbeiterbereiche(
        id UUID PRIMARY KEY,titel TEXT NOT NULL CHECK(length(titel) BETWEEN 1 AND 100),
        inhalt TEXT NOT NULL CHECK(length(inhalt) BETWEEN 1 AND 20000),
        aktiv BOOLEAN NOT NULL DEFAULT false,sortierung INTEGER NOT NULL DEFAULT 0,
        art TEXT NOT NULL DEFAULT 'allgemein' CHECK(art IN ('allgemein','standort','partner','programm')),
        erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      await pool.query(`ALTER TABLE brilon_mitarbeiterbereiche ADD COLUMN IF NOT EXISTS art TEXT NOT NULL DEFAULT 'allgemein'`);
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_mitarbeiterbereich_orte(
        bereich_id UUID NOT NULL REFERENCES brilon_mitarbeiterbereiche(id) ON DELETE CASCADE,
        ort_id BIGINT NOT NULL REFERENCES brilon_orte(id) ON DELETE RESTRICT,
        PRIMARY KEY(bereich_id,ort_id))`);
      await pool.query('CREATE INDEX IF NOT EXISTS brilon_mitarbeiterbereich_orte_ort_idx ON brilon_mitarbeiterbereich_orte(ort_id,bereich_id)');
      console.log('Mitarbeiterbereiche-Tabelle geprüft (RUN_EMPLOYEE_AREAS_MIGRATION=true)');
    }
    // Eigenständiges internes Wissensportal – erst nach ausdrücklicher Freigabe opt-in migrieren.
    if(process.env.RUN_WISSENSPORTAL_MIGRATION==='true'){
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_wissensportal_artikel(
        id UUID PRIMARY KEY,
        titel TEXT NOT NULL CHECK(length(titel) BETWEEN 1 AND 120),
        kurztext TEXT NOT NULL DEFAULT '' CHECK(length(kurztext)<=500),
        inhalt TEXT NOT NULL CHECK(length(inhalt) BETWEEN 1 AND 20000),
        kategorie TEXT NOT NULL CHECK(kategorie IN ('allgemein','programm','standort','sicherheit','ablauf','notfall')),
        standorte BIGINT[] NOT NULL DEFAULT '{}',
        dokument_url TEXT CHECK(dokument_url IS NULL OR length(dokument_url)<=1000),
        veroeffentlicht BOOLEAN NOT NULL DEFAULT false,
        version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
        erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query("ALTER TABLE brilon_wissensportal_artikel ADD COLUMN IF NOT EXISTS bild_url TEXT");
      await pool.query("ALTER TABLE brilon_wissensportal_artikel ADD COLUMN IF NOT EXISTS anhaenge JSONB NOT NULL DEFAULT '[]'::jsonb");
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_wissensportal_versionen (
        artikel_id UUID NOT NULL REFERENCES brilon_wissensportal_artikel(id) ON DELETE CASCADE,
        version INTEGER NOT NULL CHECK(version>=1),
        inhalt JSONB NOT NULL,
        erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(artikel_id,version)
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS brilon_wissensportal_veroeffentlicht_idx ON brilon_wissensportal_artikel(veroeffentlicht,kategorie,titel)');
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_wissensportal_bestaetigungen(
        artikel_id UUID NOT NULL REFERENCES brilon_wissensportal_artikel(id) ON DELETE CASCADE,
        mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE CASCADE,
        version INTEGER NOT NULL CHECK(version>=1),
        bestaetigt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(artikel_id,mitarbeiter_id)
      )`);
      console.log('Wissensportal-Schema geprüft (RUN_WISSENSPORTAL_MIGRATION=true)');
    }
    // Separate opt-in schema for network partners; never changes employee or admin accounts.
    if(process.env.RUN_NETWORK_PARTNER_MIGRATION==='true'){
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_netzwerkpartner(
        id UUID PRIMARY KEY,unternehmen TEXT NOT NULL CHECK(length(unternehmen) BETWEEN 2 AND 180),
        ansprechpartner TEXT NOT NULL CHECK(length(ansprechpartner) BETWEEN 2 AND 120),
        email TEXT NOT NULL UNIQUE,telefon TEXT,strasse TEXT,plz TEXT,ort TEXT,weitere_angaben TEXT,
        passwort_hash TEXT NOT NULL,aktiv BOOLEAN NOT NULL DEFAULT false,
        erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),freigabe_am TIMESTAMPTZ)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_netzwerkpartner_einladungen(
        id UUID PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,token_hash CHAR(64) NOT NULL UNIQUE,
        ablauf TIMESTAMPTZ NOT NULL,erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        verwendet_am TIMESTAMPTZ,widerrufen_am TIMESTAMPTZ)`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS brilon_netzwerkpartner_einladungen_offen_email_idx
        ON brilon_netzwerkpartner_einladungen(email) WHERE verwendet_am IS NULL AND widerrufen_am IS NULL`);
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_netzwerkpartner_sessions(
        token_hash CHAR(64) PRIMARY KEY,
        netzwerkpartner_id UUID NOT NULL REFERENCES brilon_netzwerkpartner(id) ON DELETE CASCADE,
        ablauf TIMESTAMPTZ NOT NULL)`);
      await pool.query('CREATE INDEX IF NOT EXISTS brilon_netzwerkpartner_sessions_ablauf_idx ON brilon_netzwerkpartner_sessions(ablauf)');
      console.log('Getrenntes Netzwerkpartnerschema geprüft (RUN_NETWORK_PARTNER_MIGRATION=true)');
    }
    // Assign each network partner to an existing venue. This idempotent upgrade
    // preserves existing partner accounts and leaves assignment optional until admin review.
    await pool.query(`DO $migration$
    BEGIN
      IF to_regclass('public.brilon_netzwerkpartner') IS NOT NULL
         AND to_regclass('public.brilon_orte') IS NOT NULL THEN
        ALTER TABLE brilon_netzwerkpartner
          ADD COLUMN IF NOT EXISTS standort_id BIGINT
          REFERENCES brilon_orte(id) ON DELETE SET NULL;
      END IF;
    END;
    $migration$`);
    // Persist explicitly selected notification staff for each network partner.
    await pool.query(`DO $migration$
    BEGIN
      IF to_regclass('public.brilon_netzwerkpartner') IS NOT NULL THEN
        ALTER TABLE brilon_netzwerkpartner
          ADD COLUMN IF NOT EXISTS mitarbeiter_ids UUID[] NOT NULL DEFAULT '{}';
      END IF;
      IF to_regclass('public.brilon_partner_terminanfragen') IS NOT NULL THEN
        ALTER TABLE brilon_partner_terminanfragen
          ADD COLUMN IF NOT EXISTS reaktion_token_hash CHAR(64),
          ADD COLUMN IF NOT EXISTS reaktion_token_ablauf TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS reaktion_status TEXT,
          ADD COLUMN IF NOT EXISTS reaktion_am TIMESTAMPTZ;
      END IF;
    END;
    $migration$`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_spontan_sessions(
      id UUID PRIMARY KEY,standort_id BIGINT NOT NULL REFERENCES brilon_orte(id) ON DELETE CASCADE,
      code TEXT NOT NULL,code_hash CHAR(64) NOT NULL,code_ablauf TIMESTAMPTZ NOT NULL,
      ablauf TIMESTAMPTZ NOT NULL,aktiv BOOLEAN NOT NULL DEFAULT true,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS brilon_spontan_one_active_idx ON brilon_spontan_sessions(standort_id) WHERE aktiv=true');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_spontan_einstellungen(
      standort_id BIGINT PRIMARY KEY REFERENCES brilon_orte(id) ON DELETE CASCADE,
      preis_pro_person_cent INTEGER CHECK(preis_pro_person_cent>=0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`ALTER TABLE brilon_spontan_einstellungen
      ADD COLUMN IF NOT EXISTS netzwerkpartner_id UUID REFERENCES brilon_netzwerkpartner(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS abzug_typ TEXT,
      ADD COLUMN IF NOT EXISTS abzug_wert NUMERIC(10,2) NOT NULL DEFAULT 0`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_spontan_teilnahmen(
      session_id UUID NOT NULL REFERENCES brilon_spontan_sessions(id) ON DELETE CASCADE,
      teilnahme_id UUID NOT NULL,interesse BOOLEAN NOT NULL,personen INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(session_id,teilnahme_id))`);
    await pool.query(`ALTER TABLE brilon_spontan_teilnahmen
      ADD COLUMN IF NOT EXISTS gast_name TEXT,
      ADD COLUMN IF NOT EXISTS gast_email TEXT,
      ADD COLUMN IF NOT EXISTS anwesend BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS anwesend_personen INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS geprueft_am TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS geprueft_von UUID`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_spontan_zeiten(
      id UUID PRIMARY KEY,session_id UUID NOT NULL REFERENCES brilon_spontan_sessions(id) ON DELETE CASCADE,
      datum DATE NOT NULL,uhrzeit TIME NOT NULL,erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(session_id,datum,uhrzeit))`);
    await pool.query(`ALTER TABLE brilon_spontan_zeiten
      ADD COLUMN IF NOT EXISTS gruppe_bestaetigt_am TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS mail_status TEXT`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_spontan_zeitstimmen(
      zeit_id UUID NOT NULL REFERENCES brilon_spontan_zeiten(id) ON DELETE CASCADE,
      teilnahme_id UUID NOT NULL,erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(zeit_id,teilnahme_id))`);
    await pool.query(`ALTER TABLE brilon_spontan_zeiten
      ADD COLUMN IF NOT EXISTS abgeschlossen_am TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS abgeschlossen_von UUID`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_netzwerkpartner_abrechnungen(
      id UUID PRIMARY KEY,zeit_id UUID NOT NULL UNIQUE REFERENCES brilon_spontan_zeiten(id) ON DELETE CASCADE,
      netzwerkpartner_id UUID NOT NULL REFERENCES brilon_netzwerkpartner(id),
      rechnungsnummer TEXT NOT NULL UNIQUE,data JSONB NOT NULL,pdf BYTEA NOT NULL,
      email_status TEXT NOT NULL DEFAULT 'ausstehend',email_fehler TEXT,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),versandt_am TIMESTAMPTZ)`);
    // Customer feedback is private to the admin API and linked to one existing booking.
    if(process.env.RUN_CUSTOMER_FEEDBACK_MIGRATION==='true'){
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_kundenfeedback(
        id UUID PRIMARY KEY,buchung_id UUID NOT NULL REFERENCES brilon_buchungen(id) ON DELETE CASCADE,
        buchungsnummer TEXT NOT NULL,programm_bewertung SMALLINT NOT NULL CHECK(programm_bewertung BETWEEN 1 AND 5),
        mitarbeiter_bewertung SMALLINT NOT NULL CHECK(mitarbeiter_bewertung BETWEEN 1 AND 5),
        sicherheits_bewertung SMALLINT NOT NULL CHECK(sicherheits_bewertung BETWEEN 1 AND 5),
        veraenderungen TEXT,ideen TEXT,einwilligung_am TIMESTAMPTZ NOT NULL,
        einwilligung_version TEXT NOT NULL,erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(buchung_id))`);
      await pool.query('CREATE INDEX IF NOT EXISTS brilon_kundenfeedback_erstellt_idx ON brilon_kundenfeedback(erstellt_am DESC)');
      console.log('Kundenfeedbackschema geprüft (RUN_CUSTOMER_FEEDBACK_MIGRATION=true)');
    }
    // Schema changes are opt-in. A normal server start must not alter a live database.
    if(process.env.RUN_SCHEMA_MIGRATIONS==='true'){
    await pool.query(
      'CREATE TABLE IF NOT EXISTS brilon_buchungen (id UUID PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
    );
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_admin_sessions (
      token_hash CHAR(64) PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_admin_sessions_expires_at_idx ON brilon_admin_sessions(expires_at)');
    await pool.query(
      "ALTER TABLE brilon_buchungen ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'offen'"
    );
    await pool.query(
      'ALTER TABLE brilon_buchungen ADD COLUMN IF NOT EXISTS bearbeitungsnotiz TEXT'
    );
    await pool.query(
      'ALTER TABLE brilon_buchungen ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ'
    );
    
await pool.query(
  'ALTER TABLE brilon_buchungen ADD COLUMN IF NOT EXISTS zahlungsinfo_gesendet_am TIMESTAMPTZ'
);
await pool.query('ALTER TABLE brilon_buchungen ADD COLUMN IF NOT EXISTS buchungsnummer TEXT');
await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS brilon_buchungen_buchungsnummer_unique ON brilon_buchungen (buchungsnummer)');

    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_aktionen(
      id UUID PRIMARY KEY,data JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_kalender(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),titel TEXT NOT NULL,datum DATE NOT NULL,
      enddatum DATE,uhrzeit TIME,endzeit TIME,typ TEXT NOT NULL CHECK(typ IN ('termin','sperrzeit')),
      beschreibung TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query("ALTER TABLE brilon_kalender ADD COLUMN IF NOT EXISTS standorte TEXT[] NOT NULL DEFAULT '{}'");
    
await pool.query(`
  CREATE TABLE IF NOT EXISTS brilon_angebote (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    beschreibung TEXT DEFAULT '',
    dauer INTEGER,
    preise JSONB NOT NULL DEFAULT '{}'::jsonb,
    aktiv BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
    await pool.query(`ALTER TABLE brilon_angebote
      ADD COLUMN IF NOT EXISTS bild_url TEXT,
      ADD COLUMN IF NOT EXISTS kategorie TEXT NOT NULL DEFAULT 'Klettern',
      ADD COLUMN IF NOT EXISTS zielgruppe TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS veranstaltungsort TEXT NOT NULL DEFAULT 'Brilon',
      ADD COLUMN IF NOT EXISTS veranstaltungsorte JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS kapazitaet INTEGER NOT NULL DEFAULT 20,
      ADD COLUMN IF NOT EXISTS verfuegbare_termine JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS hinweise TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS buchbar BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS veroeffentlicht BOOLEAN NOT NULL DEFAULT true`);
    await pool.query(`ALTER TABLE brilon_angebote
      ADD COLUMN IF NOT EXISTS buchungsmodus TEXT NOT NULL DEFAULT 'gruppe',
      ADD COLUMN IF NOT EXISTS mindestteilnehmer INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS preis_pro_person NUMERIC(10,2) NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE brilon_angebote
      ADD COLUMN IF NOT EXISTS sortierung INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS archiviert BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE brilon_angebote
      ADD COLUMN IF NOT EXISTS gruppenstufen JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS dauer_modus TEXT NOT NULL DEFAULT 'gruppenstufe'`);
    await pool.query(`UPDATE brilon_angebote SET veranstaltungsorte=jsonb_build_array(veranstaltungsort)
      WHERE veranstaltungsorte='[]'::jsonb AND NULLIF(TRIM(veranstaltungsort),'') IS NOT NULL`);

    await pool.query(`WITH sortiert AS (
      SELECT id,row_number() OVER(ORDER BY name ASC,id ASC)::integer AS position
      FROM brilon_angebote
    ) UPDATE brilon_angebote AS angebot SET sortierung=sortiert.position
      FROM sortiert WHERE angebot.id=sortiert.id AND angebot.sortierung=0`);
    await pool.query(`DO $$ BEGIN
      ALTER TABLE brilon_angebote ADD CONSTRAINT brilon_angebote_buchungsmodus_check
        CHECK (buchungsmodus IN ('gruppe','einzelplatz'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_orte(
      id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL UNIQUE,aktiv BOOLEAN NOT NULL DEFAULT true,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`ALTER TABLE brilon_orte
      ADD COLUMN IF NOT EXISTS partnerhaus BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS partnerkontakt_name TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS partnerkontakt_email TEXT NOT NULL DEFAULT ''`);
    await pool.query(`INSERT INTO brilon_orte(name) VALUES('Brilon'),('Rüthen'),('Soest'),('Sundern') ON CONFLICT(name) DO NOTHING`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS brilon_gps_touren (
        id UUID PRIMARY KEY,
        angebot_id BIGINT REFERENCES brilon_angebote(id),
        data JSONB NOT NULL,
        aktiv BOOLEAN NOT NULL DEFAULT false,
        erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query('ALTER TABLE brilon_gps_touren ADD COLUMN IF NOT EXISTS angebot_id BIGINT REFERENCES brilon_angebote(id)');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS brilon_gps_spiele (
        id UUID PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        tour_id UUID NOT NULL REFERENCES brilon_gps_touren(id),
        buchung_id UUID NOT NULL REFERENCES brilon_buchungen(id),
        station_index INTEGER NOT NULL DEFAULT 0,
        gestartet_am TIMESTAMPTZ,
        abgeschlossen_am TIMESTAMPTZ,
        spielzeit_sekunden INTEGER,
        gast_name TEXT,
        gast_einwilligung BOOLEAN NOT NULL DEFAULT false,
        gast_einwilligung_am TIMESTAMPTZ,
        gast_einwilligung_version TEXT,
        gesperrt_am TIMESTAMPTZ,
        erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query('ALTER TABLE brilon_gps_spiele ADD COLUMN IF NOT EXISTS gast_einwilligung_am TIMESTAMPTZ');
    await pool.query('ALTER TABLE brilon_gps_spiele ADD COLUMN IF NOT EXISTS gast_einwilligung_version TEXT');
    await pool.query('ALTER TABLE brilon_gps_spiele ADD COLUMN IF NOT EXISTS gesperrt_am TIMESTAMPTZ');
    // Stations-Prüfprotokoll: nur bei expliziter Freigabe der Testmigrationen.
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_mitarbeitende (
      id UUID PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,
      passwort_hash TEXT NOT NULL,aktiv BOOLEAN NOT NULL DEFAULT true,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query('ALTER TABLE brilon_pruef_mitarbeitende ADD COLUMN IF NOT EXISTS telefon TEXT');
    await pool.query('ALTER TABLE brilon_pruef_mitarbeitende ADD COLUMN IF NOT EXISTS strasse TEXT');
    await pool.query('ALTER TABLE brilon_pruef_mitarbeitende ADD COLUMN IF NOT EXISTS plz TEXT');
    await pool.query('ALTER TABLE brilon_pruef_mitarbeitende ADD COLUMN IF NOT EXISTS wohnort TEXT');
    await pool.query('ALTER TABLE brilon_pruef_mitarbeitende ADD COLUMN IF NOT EXISTS qualifikationen TEXT');
    await pool.query('ALTER TABLE brilon_pruef_mitarbeitende ADD COLUMN IF NOT EXISTS registriert_am TIMESTAMPTZ');
    await pool.query('ALTER TABLE brilon_pruef_mitarbeitende ADD COLUMN IF NOT EXISTS freigabe_am TIMESTAMPTZ');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_personaldokumente (
      id UUID PRIMARY KEY,
      mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE CASCADE,
      bezeichnung TEXT NOT NULL,dateiname TEXT NOT NULL,mime_type TEXT NOT NULL CHECK(mime_type='image/jpeg'),
      daten BYTEA NOT NULL,bytegroesse INTEGER NOT NULL CHECK(bytegroesse>0 AND bytegroesse<=512000),
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_personaldokumente_mitarbeiter_idx ON brilon_pruef_personaldokumente(mitarbeiter_id,erstellt_am)');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_freigaben (
      id UUID PRIMARY KEY,
      mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE CASCADE,
      ort_id BIGINT NOT NULL REFERENCES brilon_orte(id),
      qualifikation TEXT NOT NULL,erstellt_von TEXT NOT NULL,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(mitarbeiter_id,ort_id,qualifikation))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_einladungen (
      id UUID PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,ablauf TIMESTAMPTZ NOT NULL,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),verwendet_am TIMESTAMPTZ,
      widerrufen_am TIMESTAMPTZ)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS brilon_pruef_einladungen_offen_email_idx
      ON brilon_pruef_einladungen(email) WHERE verwendet_am IS NULL AND widerrufen_am IS NULL`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_stationen (
      id UUID PRIMARY KEY,name TEXT NOT NULL,aktiv BOOLEAN NOT NULL DEFAULT true,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query('ALTER TABLE brilon_pruef_stationen ADD COLUMN IF NOT EXISTS ort_id BIGINT REFERENCES brilon_orte(id)');
    await pool.query("ALTER TABLE brilon_pruef_stationen ADD COLUMN IF NOT EXISTS qualifikation TEXT NOT NULL DEFAULT ''");
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_sessions (
      token_hash CHAR(64) PRIMARY KEY,mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id),
      ablauf TIMESTAMPTZ NOT NULL,entsperrt_bis TIMESTAMPTZ)`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_sessions_ablauf_idx ON brilon_pruef_sessions(ablauf)');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_codes (
      id UUID PRIMARY KEY,code_hash CHAR(64) NOT NULL,ablauf TIMESTAMPTZ NOT NULL,
      verbraucht_am TIMESTAMPTZ,erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_berichte (
      id UUID PRIMARY KEY,mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id),
      programm TEXT NOT NULL,beginn TEXT NOT NULL,pruefungen JSONB NOT NULL,
      hat_mangel BOOLEAN NOT NULL,erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    // Sperren bleiben bis zu einer gesondert protokollierten fachlichen Freigabe bestehen.
    await pool.query('ALTER TABLE brilon_pruef_stationen ADD COLUMN IF NOT EXISTS gesperrt_am TIMESTAMPTZ');
    await pool.query('ALTER TABLE brilon_pruef_stationen ADD COLUMN IF NOT EXISTS sperrgrund TEXT');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_stationsereignisse (
      id UUID PRIMARY KEY,
      station_id UUID NOT NULL REFERENCES brilon_pruef_stationen(id),
      bericht_id UUID REFERENCES brilon_pruef_berichte(id),
      art TEXT NOT NULL CHECK(art IN ('mangel','freigabe')),
      notiz TEXT NOT NULL,
      verantwortlich TEXT NOT NULL,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_stationsereignisse_station_idx ON brilon_pruef_stationsereignisse(station_id,erstellt_am DESC)');
    // Administrative station changes do not alter the historic defect/release log.
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_stationsstatus (
      id UUID PRIMARY KEY,
      station_id UUID NOT NULL REFERENCES brilon_pruef_stationen(id),
      art TEXT NOT NULL CHECK(art IN ('deaktiviert','reaktiviert')),
      begruendung TEXT NOT NULL,
      verantwortlich TEXT NOT NULL,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_stationsstatus_station_idx ON brilon_pruef_stationsstatus(station_id,erstellt_am DESC)');
    await pool.query('ALTER TABLE brilon_pruef_berichte ADD COLUMN IF NOT EXISTS hat_hinweis BOOLEAN NOT NULL DEFAULT false');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_hinweise(
      id UUID PRIMARY KEY,station_id UUID NOT NULL REFERENCES brilon_pruef_stationen(id),
      bericht_id UUID NOT NULL REFERENCES brilon_pruef_berichte(id),
      beschreibung TEXT NOT NULL,erstellt_von TEXT NOT NULL,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      erledigt_am TIMESTAMPTZ,erledigt_von TEXT,erledigt_notiz TEXT,
      UNIQUE(bericht_id,station_id))`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_hinweise_offen_idx ON brilon_pruef_hinweise(erstellt_am DESC) WHERE erledigt_am IS NULL');

    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_meldungen (
      bericht_id UUID PRIMARY KEY REFERENCES brilon_pruef_berichte(id),
      status TEXT NOT NULL DEFAULT 'ausstehend'
        CHECK(status IN ('ausstehend','sendet','angenommen','fehlgeschlagen','nicht_konfiguriert')),
      versuche INTEGER NOT NULL DEFAULT 0 CHECK(versuche>=0),
      letzter_versuch TIMESTAMPTZ,angenommen_am TIMESTAMPTZ,
      letzter_fehler TEXT,erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_meldungen_status_idx ON brilon_pruef_meldungen(status,erstellt_am DESC)');
    await pool.query('ALTER TABLE brilon_pruef_codes ADD COLUMN IF NOT EXISTS code_verschluesselt TEXT');
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_tablet_kopplungen(
      id UUID PRIMARY KEY,code_hash CHAR(64) NOT NULL,
      ablauf TIMESTAMPTZ NOT NULL,verwendet_am TIMESTAMPTZ,
      erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_pruef_tablets(
      id UUID PRIMARY KEY,name TEXT NOT NULL,token_hash CHAR(64) NOT NULL UNIQUE,
      aktiv BOOLEAN NOT NULL DEFAULT true,gekoppelt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_tablets_aktiv_idx ON brilon_pruef_tablets(aktiv)');
    // Letztes Lebenszeichen dient ausschließlich der aktuellen Verbindungserkennung.
    await pool.query('ALTER TABLE brilon_pruef_tablets ADD COLUMN IF NOT EXISTS zuletzt_gesehen_am TIMESTAMPTZ');
    // Pro Prüfstandort ist genau ein Administrations-Tablet als Codeanzeige ausgewählt.
    await pool.query('ALTER TABLE brilon_pruef_tablets ADD COLUMN IF NOT EXISTS pruefdisplay BOOLEAN NOT NULL DEFAULT false');
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS brilon_pruef_tablets_ein_display_idx ON brilon_pruef_tablets((1)) WHERE pruefdisplay=true');
    await pool.query('ALTER TABLE brilon_pruef_codes ADD COLUMN IF NOT EXISTS tablet_id UUID REFERENCES brilon_pruef_tablets(id)');
    } else {
      console.log('Schemaänderungen übersprungen (RUN_SCHEMA_MIGRATIONS ist nicht true)');
    }
    if(process.env.RUN_SCHEMA_MIGRATIONS==='true'||process.env.RUN_STAFFING_MIGRATION==='true')
      await migrateEinsatzplanung();
    if(process.env.MOCK_PG!=='1'){
      try{
        await pool.query('SELECT buchung_id FROM brilon_kundenbestaetigungen LIMIT 0');
        const confirmationTimer=setInterval(()=>{
          kundenService.processQueue().catch(error=>console.error('Kundenbestätigungen prüfen:',error.message));
        },60_000);
        confirmationTimer.unref();
        kundenService.processQueue().catch(error=>console.error('Kundenbestätigungen bei Start:',error.message));
      }catch(error){console.warn('Automatische Kundenbestätigung nicht gestartet: Versandtabelle fehlt.',error.message);}
    }
    if(process.env.MOCK_PG!=='1'){
      try{
        await pool.query('SELECT bericht_id FROM brilon_pruef_meldungen LIMIT 0');
        const rateLimitRetryTimer=setInterval(()=>{
          pruefungApi.retryRateLimited().catch(error=>
            console.error('Zeitgesteuerter Mängelmail-Wiederholungsversuch fehlgeschlagen:',error.message));
        },60_000);
        rateLimitRetryTimer.unref();
      }catch(error){
        console.warn('Zeitgesteuerter Mängelmail-Wiederholungsversuch nicht gestartet:',error.message);
      }
      try{
        await pool.query('SELECT ablauf FROM brilon_pruef_sessions LIMIT 0');
        await pool.query('SELECT id FROM brilon_pruef_codes LIMIT 0');
        await pool.query('SELECT verwendet_am FROM brilon_pruef_tablet_kopplungen LIMIT 0');
        const credentialCleanupTimer=setInterval(()=>{
          pruefungApi.bereinigeAbgelaufeneZugaenge().catch(error=>
            console.error('Bereinigung abgelaufener Prüfsitzungen und Codes fehlgeschlagen:',error.message));
        },60_000);
        credentialCleanupTimer.unref();
      }catch(error){
        console.warn('Bereinigung abgelaufener Prüfsitzungen und Codes nicht gestartet:',error.message);
      }
    }
    console.log('PostgreSQL verbunden');
  }else{
    console.warn('DATABASE_URL fehlt: Datenbankfunktionen nicht verfügbar');
  }
  http.createServer(main).listen(PORT,'0.0.0.0',()=>{
    console.log('Server auf Port '+PORT);
  });
}
start().catch(e=>{
  console.error('Datenbank-Start fehlgeschlagen:',e.message);
  process.exit(1);
});
