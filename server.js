
// Klettern & Abenteuer Brilon – Node.js / PostgreSQL
'use strict';
const {DEFAULT_VISITOR_GROUPS,prepareVisitorGroups,validateVisitorGroups}=require('./visitor-groups');
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const net=require('node:net');const {Pool}=require('pg');
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
const { leseWebsiteEffekte,pruefeWebsiteEffekte } = require('./lib/website-effekte');
const { standard:standardSocialLinks, normalisiereGespeichert, validiereAenderung, fuerWebsite } = require('./lib/social-links');
const { createPdf: erstelleRechnungsPdf, formatDate: rechnungsDatumFormatieren } = require('./lib/rechnung');
const { createBuchungsbestaetigungsMailer } = require('./lib/buchungsbestaetigungs-email');
const { createPruefungApi } = require('./lib/stationspruefung-api');
const { createEinsatzplanungApi } = require('./lib/einsatzplanung-api');
const { createKundenbestaetigungService } = require('./lib/kundenbestaetigung-service');
const { createNetzwerkpartnerApi } = require('./lib/netzwerkpartner-api');
const { createKundenfeedbackApi } = require('./lib/kundenfeedback-api');
const { createMarketingCampaignApi } = require('./lib/marketing-kampagnen-api');
const { createWissensportalApi } = require('./lib/wissensportal-api');
const { buchungsDetails, buchungsstatusNachricht, zahlungsinformationenText } = require('./lib/buchungs-email');
const { bereinigeBild } = require('./lib/bilddatei');
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
function demoRedact(value){
  if(Array.isArray(value))return value.map(demoRedact);
  if(!value||typeof value!=='object')return value;
  const keys=Object.keys(value);
  const hasPerson=keys.some(key=>/^(email|emailadresse|telefon|telefonnummer|phone|vorname|nachname|mitarbeiter_id|kunde_id|kontakt_id|ansprechpartner)$/i.test(key));
  const result={};
  for(const [key,item] of Object.entries(value)){
    if(/^(email|emailadresse|mailadresse)$/i.test(key)||/^(recipient|empfaenger_email)$/i.test(key))result[key]='demo@example.invalid';
    else if(/(telefon|telefonnummer|mobile|mobilnummer|phone|adresse|strasse|street|plz|postcode|geburtsdatum|bankverbindung|iban|buchungsnummer)/i.test(key)||(hasPerson&&/(bild|foto|avatar|dokument|datei|profilbild)/i.test(key)))result[key]='[Im Demo-Zugang ausgeblendet]';
    else if(/^(name|vorname|nachname|kunde|kontaktperson|ansprechpartner)$/i.test(key)&&hasPerson)result[key]='Beispielperson';
    else if(/(nachricht|notiz|intern|kommentar|freitext|bemerkung)/i.test(key)||(hasPerson&&/(beschreibung|hinweis)/i.test(key)))result[key]='[Interne Angaben im Demo-Zugang ausgeblendet]';
    else result[key]=demoRedact(item);
  }
  return result;
}
function reply(res,status,data,headers={}){
  if(res.adminDemoReadOnly)data=demoRedact(data);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...securityHeaders,...headers});
  res.end(JSON.stringify(data));
}
// Free mode is intentionally limited to authenticated admin image uploads.
// This performs strict decode/re-encode in bereinigeBild, but is NOT antivirus scanning.
const imageUploadSecurityMode=process.env.IMAGE_UPLOAD_SECURITY_MODE==='sanitized_images'
  ?'sanitized_images':'clamav_required';
async function pruefeBereinigtenBildUpload(bild){
  if(imageUploadSecurityMode==='sanitized_images')return {sauber:true,modus:'bild_neucodierung_ohne_virenscanner'};
  const verdict=await scanForMalware(bild);
  if(verdict?.sauber!==true)throw Object.assign(new Error('Ungültige Scannerantwort.'),{code:'MALWARE_SCAN_ERROR'});
  return verdict;
}
function gueltigeMedienBildUrl(value){
  if(typeof value!=='string'||!value)return false;
  const base=safeText(process.env.SUPABASE_URL,500).replace(/\/+$/,'');
  return Boolean(base&&value.startsWith(base+'/storage/v1/object/public/angebotsbilder/'));
}
function malwareScanReply(res,error){
  const code=error?.code||'MALWARE_SCAN_ERROR';
  const detected=code==='MALWARE_FOUND';
  const messages={
    MALWARE_FOUND:'Die Bilddatei wurde als Schadsoftware erkannt und abgewiesen.',
    MALWARE_SCAN_NOT_CONFIGURED:'Der Virenscanner ist auf dem Server nicht eingerichtet. Bitte die Scanner-Verbindung in Render konfigurieren.',
    MALWARE_SCAN_UNAVAILABLE:'Der Virenscanner ist derzeit nicht erreichbar. Die Bilddatei wurde nicht gespeichert.',
    MALWARE_SCAN_BUSY:'Der Virenscanner ist ausgelastet. Bitte den Upload später erneut versuchen.',
    MALWARE_SCAN_INVALID_INPUT:'Die Bilddatei ist für die Sicherheitsprüfung nicht zulässig.'
  };
  console.error('Bildprüfung abgebrochen:',code);
  return reply(res,detected||code==='MALWARE_SCAN_INVALID_INPUT'?422:503,{
    error:messages[code]||'Die Sicherheitsprüfung konnte nicht abgeschlossen werden. Die Bilddatei wurde nicht gespeichert.',
    code
  });
}
async function body(req,maxBytes=16000){const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>maxBytes)throw Error('Anfrage zu groß');chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Error('Ungültiges JSON')}}
function limit(key,max=12,window=600000){return rateLimiter.erlauben(key,max,window)}
function safeText(v,n=200){return typeof v==='string'?v.trim().slice(0,n):''}
function tagesangebotPasstZurQuellbuchung(action,source){
  if(!action?.quelle_buchung_id)return true;
  if(!source||!['offen','bestaetigt'].includes(source.status))return false;
  const data=source.data||{},duration=Number(data.dauer),participants=Number(data.teilnehmer);
  if(data.datum!==action.datum||data.angebot!==action.quellprogramm||
     safeText(data.veranstaltungsort,80)!==safeText(action.veranstaltungsort,80)||
     participants!==Number(action.teilnehmer)||duration!==Number(action.dauer)||
     !/^\d{2}:\d{2}$/.test(String(data.uhrzeit||'')))return false;
  const mainStart=Number(data.uhrzeit.slice(0,2))*60+Number(data.uhrzeit.slice(3,5));
  const mainEnd=mainStart+duration;
  const offerStart=action.vorschlagsrichtung==='davor'?mainStart-duration:mainEnd;
  const offerEnd=action.vorschlagsrichtung==='davor'?mainStart:mainEnd+duration;
  const fmt=value=>String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  return ['davor','danach'].includes(action.vorschlagsrichtung)&&
    action.uhrzeit===fmt(offerStart)&&action.endzeit===fmt(offerEnd);
}
function programmStufenPruefen(input){
  if(!Array.isArray(input)||input.length>100)return {ok:false,fehler:'Bitte gültige Teilnehmerstufen angeben.'};
  if(input.some(item=>item?.preis===null||item?.preis===undefined||item?.preis===''))
    return {ok:false,fehler:'Bitte für jede Teilnehmerstufe einen Gruppenpreis eintragen.'};
  const stufen=input.map(item=>({min:Number(item?.min),max:Number(item?.max),preis:Number(item?.preis),dauer:Number(item?.dauer)}))
    .sort((a,b)=>a.min-b.min||a.max-b.max);
  for(let index=0;index<stufen.length;index++){
    const stufe=stufen[index];
    if(!Number.isInteger(stufe.min)||!Number.isInteger(stufe.max)||stufe.min<1||stufe.max<stufe.min||stufe.max>1000||
       !Number.isFinite(stufe.preis)||stufe.preis<0||!Number.isInteger(stufe.dauer)||stufe.dauer<15||stufe.dauer>1440)
      return {ok:false,fehler:'Teilnehmerstufen benötigen gültige Grenzen, Gruppenpreise und Dauern (15–1440 Minuten).'};
    if(index&&stufe.min<=stufen[index-1].max)return {ok:false,fehler:'Teilnehmerstufen dürfen sich nicht überschneiden.'};
  }
  return {ok:true,stufen};
}
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
  const client=await pool.connect();let pdf,invoice,email,invoiceId;
  try{
    await client.query('BEGIN');
    const b=await client.query('SELECT id,data,status FROM brilon_buchungen WHERE id=$1 FOR UPDATE',[buchungId]);
    if(!b.rowCount){await client.query('ROLLBACK');return {status:'buchung_fehlt'};}
    const already=await client.query('SELECT id,rechnungsnummer,email_status FROM brilon_rechnungen WHERE buchung_id=$1',[buchungId]);
    if(already.rowCount){await client.query('COMMIT');return {status:already.rows[0].email_status, id:already.rows[0].id, nummer:already.rows[0].rechnungsnummer};}
    const settings=await client.query('SELECT data,naechste_nummer FROM brilon_rechnungsdaten WHERE id=1 FOR UPDATE');
    if(!settings.rowCount){await client.query('ROLLBACK');return {status:'rechnungsdaten_fehlen'};}
    const config=settings.rows[0].data||{};const booking=b.rows[0].data||{};
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
    const invoiceData={
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
function demoSessionToken(expiresAt=Math.floor(Date.now()/1000)+8*3600){
  const expiry=Number(expiresAt).toString(16).padStart(12,'0');
  const signature=crypto.createHmac('sha256',process.env.ADMIN_DEMO_PASSWORD||'')
    .update('brilon-admin-demo-v1:'+expiry).digest('hex').slice(0,52);
  return expiry+signature;
}
function demoSessionValid(token){
  if(!process.env.ADMIN_DEMO_PASSWORD||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return false;
  const expiry=token.slice(0,12),signature=token.slice(12);
  const expected=crypto.createHmac('sha256',process.env.ADMIN_DEMO_PASSWORD)
    .update('brilon-admin-demo-v1:'+expiry).digest('hex').slice(0,52);
  const a=Buffer.from(signature),b=Buffer.from(expected);
  return a.length===b.length&&crypto.timingSafeEqual(a,b)&&parseInt(expiry,16)>Math.floor(Date.now()/1000);
}
function credentialMatches(input,configured){
  if(typeof configured!=='string'||!configured)return false;
  const a=Buffer.from(String(input||'')),b=Buffer.from(configured);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
async function session(req){
  const jetzt=Date.now();
  const match=(req.headers.cookie||'').match(/(?:^|;\s*)brilon_session=([a-f0-9]{64})/);
  const token=match?.[1];
  if(!token)return {valid:false};
  if(demoSessionValid(token))return {valid:true,readOnly:true};
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
  if(auth.readOnly)res.adminDemoReadOnly=true;
  const method=String(req.method||'').toUpperCase();
  const path=new URL(req.url,'http://localhost').pathname;
  if(auth.readOnly&&!['GET','HEAD','OPTIONS'].includes(method)&&path!=='/api/admin/logout'){
    reply(res,403,{error:'Der Demo-Zugang ist nur lesend. Änderungen sind hier gesperrt.'});return false;
  }
  if(auth.readOnly&&(/\.(pdf|csv|xlsx|zip)$/i.test(path)||/(export|download)/i.test(path))){
    reply(res,403,{error:'Dateidownloads sind im Demo-Zugang gesperrt.'});return false;
  }
  if(!sameOriginMutation(req)){reply(res,403,{error:'Admin-Anfragen müssen von derselben Website stammen.'});return false}
  if(!['GET','HEAD','OPTIONS'].includes(method)&&!adminCsrfValid(req)){
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
    buchungsdauerBerechnen(n,1000);
  // Alte Buchungen ohne Startzeit oder individuelle Angebote belegen vorsichtshalber den ganzen Tag.
  return start===null||dauer===null?null:[start,start+dauer];
}
function ueberschneidung(a,b){
  return !a||!b||a[0]<b[1]&&b[0]<a[1];
}
async function pruefeBuchungskonflikt(client,datum,fenster,ausnahmeId=null,gleicheSitzung=null,standort=null){
  const sperrung=await client.query(
    `SELECT id FROM brilon_kalender
     WHERE typ IN ('sperrzeit','termin')
     AND datum <= $1::date
     AND COALESCE(enddatum,datum) >= $1::date
     AND (COALESCE(cardinality(standorte),0)=0 OR ($2::text IS NOT NULL AND $2=ANY(standorte)))
     LIMIT 1`,[datum,standort]
  );
  if(sperrung.rowCount)
    return 'Dieser Tag ist leider gesperrt. Bitte wähle ein anderes Datum.';

  const q=await client.query(
    `SELECT id,data FROM brilon_buchungen
     WHERE data->>'datum'=$1
     AND COALESCE(status,'offen') IN ('offen','bestaetigt')
     AND ($2::uuid IS NULL OR id<>$2::uuid)`,
    [datum,ausnahmeId]
  );
  if(q.rows.some(r=>{
    const same=gleicheSitzung&&r.data?.buchungsmodus==='einzelplatz'&&
      r.data?.angebot===gleicheSitzung.angebot&&r.data?.uhrzeit===gleicheSitzung.uhrzeit;
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
      pool.query(`SELECT id,name,beschreibung,dauer,dauer_modus,gruppenstufen,preise,kapazitaet,verfuegbare_termine,veranstaltungsort FROM brilon_angebote WHERE archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true ORDER BY sortierung,name`),
      pool.query(`SELECT id,data FROM brilon_buchungen WHERE data->>'datum'=$1 AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,[base.datum]),
      pool.query(`SELECT COALESCE(standorte,'{}'::text[]) AS standorte FROM brilon_kalender WHERE typ IN ('sperrzeit','termin') AND datum<=$1::date AND COALESCE(enddatum,datum)>=$1::date`,[base.datum])
    ]);
    const participants=Number(base.teilnehmer);
    if(!Number.isInteger(participants)||participants<1||participants>1000)
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
      const pQuery=await client.query(`SELECT id,name,beschreibung,dauer,dauer_modus,gruppenstufen,preise,kapazitaet,verfuegbare_termine FROM brilon_angebote WHERE id=$1 AND archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true`,[programId]);
      if(!pQuery.rowCount)return {programm:false};
      const p=pQuery.rows[0],duration=buchungsdauerFuerProgramm(participants,p),start=Number(time.slice(0,2))*60;
      if(!oldWindow||!gueltigesDatum(original.datum)||original.datum<heuteInBerlin()||!Number.isInteger(participants)||participants<1||participants>1000||p.name===original.angebot||!Number.isInteger(duration)||participants>Number(p.kapazitaet)||
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

const marketingCampaignApi=createMarketingCampaignApi({pool,admin,reply,body});
const wissensportalApi=createWissensportalApi({pool,admin,staffSession:pruefungApi.staffSession,reply,body,sameOriginMutation});
async function main(req,res){
  const u=new URL(req.url,'http://localhost'),
        route=decodeURIComponent(u.pathname),
        forwardedFor=req.headers['x-forwarded-for'],
        forwardedClient=typeof forwardedFor==='string'?forwardedFor.split(',')[0].trim():'',
        ip=net.isIP(forwardedClient)?forwardedClient:(req.socket.remoteAddress||'unknown');
  try{
    // Kanalweise Sichtbarkeit: öffentlich sind nur freigeschaltete Links verfügbar.
    // Die Administration speichert Links und Status dauerhaft im vorhandenen Website-Konfigurationsdatensatz.
    if(route==='/api/social-links'&&req.method==='GET'){
      if(!pool)return reply(res,200,{kanäle:fuerWebsite(standardSocialLinks())});
      try{
        const q=await pool.query("SELECT data->'socialLinks' AS links FROM brilon_rechnungsdaten WHERE id=1");
        return reply(res,200,{kanäle:fuerWebsite(normalisiereGespeichert(q.rows[0]?.links))});
      }catch(error){
        console.error('Öffentliche Social-Media-Konfiguration nicht abrufbar:',error.message);
        return reply(res,503,{error:'Social-Media-Links vorübergehend nicht verfügbar.'});
      }
    }
    if(route==='/api/admin/social-links'&&(req.method==='GET'||req.method==='PUT')){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      if(req.method==='GET'){
        try{
          const q=await pool.query("SELECT data->'socialLinks' AS links FROM brilon_rechnungsdaten WHERE id=1");
          if(!q.rowCount)return reply(res,503,{error:'Website-Einstellungen noch nicht verfügbar.'});
          return reply(res,200,{kanäle:normalisiereGespeichert(q.rows[0].links)});
        }catch(error){
          console.error('Social-Media-Einstellungen konnten nicht geladen werden:',error.message);
          return reply(res,503,{error:'Social-Media-Einstellungen vorübergehend nicht verfügbar.'});
        }
      }
      const input=await body(req,12000);
      let kanäle;
      try{kanäle=validiereAenderung(input);}
      catch(error){return reply(res,400,{error:error.message});}
      try{
        const q=await pool.query(`UPDATE brilon_rechnungsdaten
          SET data=jsonb_set(COALESCE(data,'{}'::jsonb),'{socialLinks}',$1::jsonb,true),
            aktualisiert_am=NOW() WHERE id=1 RETURNING id`,[JSON.stringify(kanäle)]);
        if(!q.rowCount)return reply(res,503,{error:'Website-Einstellungen noch nicht verfügbar.'});
        return reply(res,200,{success:true,kanäle});
      }catch(error){
        console.error('Social-Media-Einstellungen konnten nicht gespeichert werden:',error.message);
        return reply(res,503,{error:'Social-Media-Einstellungen konnten nicht gespeichert werden.'});
      }
    }
    // Nur freigegebene grafische Einstellungen, keinerlei Verwaltungs- oder Kundendaten.
    if(route==='/api/website-effekte'&&req.method==='GET'){
      if(!pool)return reply(res,200,leseWebsiteEffekte(null));
      try{
        const q=await pool.query('SELECT data FROM brilon_rechnungsdaten WHERE id=1');
        return reply(res,200,leseWebsiteEffekte(q.rows[0]?.data?.hintergrundEffekte));
      }catch{return reply(res,200,leseWebsiteEffekte(null));}
    }
    if(route==='/api/admin/website-effekte'&&(req.method==='GET'||req.method==='PUT')){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      if(req.method==='GET'){
        try{
          const q=await pool.query('SELECT data FROM brilon_rechnungsdaten WHERE id=1');
          return reply(res,200,leseWebsiteEffekte(q.rows[0]?.data?.hintergrundEffekte));
        }catch{return reply(res,503,{error:'Verwaltungseinstellungen noch nicht verfügbar.'});}
      }
      const input=await body(req,12000);
      let config;
      try{config=pruefeWebsiteEffekte(input);}
      catch(error){return reply(res,400,{error:error.message});}
      try{
        const q=await pool.query(`UPDATE brilon_rechnungsdaten
          SET data=jsonb_set(COALESCE(data,'{}'::jsonb),'{hintergrundEffekte}',$1::jsonb,true),
            aktualisiert_am=NOW() WHERE id=1 RETURNING id`,[JSON.stringify(config)]);
        if(!q.rowCount)return reply(res,503,{error:'Verwaltungseinstellungen noch nicht verfügbar.'});
        return reply(res,200,{success:true,...config});
      }catch{return reply(res,503,{error:'Website-Effekte konnten nicht gespeichert werden.'});}
    }
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
    if(route.startsWith('/api/netzwerkpartner/')||route.startsWith('/api/admin/netzwerkpartner/'))
      return await netzwerkpartnerApi(req,res,u,route,ip);
    if(route==='/api/kundenfeedback'||route==='/api/admin/kundenfeedback')
      return await kundenfeedbackApi(req,res,u,route,ip);
    if(route==='/api/anschlussangebote/vorschau'||route==='/api/anschlussangebote/buchen')
      return await anschlussApi(req,res,u,route,ip);
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
         teilnehmer<1||teilnehmer>1000||d.datenschutz!=='on'||
         (rechnungsadresseErforderlich&&(!rechnungsadresse.strasse||!rechnungsadresse.plz||!rechnungsadresse.ort)))
        return reply(res,400,{error:'Bitte Pflichtfelder korrekt ausfüllen.'});

      let gesamtpreis = null,sonderaktionData=null;
      const preisAbfrage = await pool.query(
        `SELECT id,preise,kapazitaet,verfuegbare_termine,buchbar,veroeffentlicht,
                veranstaltungsort,veranstaltungsorte,buchungsmodus,mindestteilnehmer,preis_pro_person,dauer,dauer_modus,gruppenstufen
         FROM brilon_angebote
         WHERE name = $1 AND archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true
         LIMIT 1`,[angebot]
      );
      if(!preisAbfrage.rows.length)return reply(res,409,{error:'Dieses Programm ist derzeit nicht buchbar.'});
      const programm=preisAbfrage.rows[0];
      const offerSites=Array.isArray(programm.veranstaltungsorte)&&programm.veranstaltungsorte.length
        ?programm.veranstaltungsorte:[programm.veranstaltungsort];
      const bookingSite=angefragterStandort||offerSites[0];
      if(!offerSites.includes(bookingSite))
        return reply(res,409,{error:'Das ausgewählte Angebot gehört nicht zum gewählten Veranstaltungsort.'});
      const sonderaktionId=safeText(d.sonderaktion_id,36);
      if(sonderaktionId){
        const action=await pool.query('SELECT data FROM brilon_aktionen WHERE id=$1',[sonderaktionId]);
        sonderaktionData=action.rows[0]?.data||null;
        if(sonderaktionData?.quelle_buchung_id){
          const source=await pool.query('SELECT data,status FROM brilon_buchungen WHERE id=$1',[sonderaktionData.quelle_buchung_id]);
          if(!tagesangebotPasstZurQuellbuchung(sonderaktionData,source.rows[0]))
            return reply(res,409,{error:'Das Tagesangebot ist nicht mehr aktuell, weil sich die zugehörige Buchung geändert hat oder storniert wurde.'});
        }
        if(!sonderaktionData||sonderaktionData.status!=='freigegeben'||sonderaktionData.datum!==datum||
           sonderaktionData.uhrzeit!==safeText(d.uhrzeit,5)||safeText(sonderaktionData.veranstaltungsort,80)!==bookingSite||
           String(sonderaktionData.programm_id)!==String(preisAbfrage.rows[0].id)||
           (Number.isInteger(Number(sonderaktionData.teilnehmer))&&Number(sonderaktionData.teilnehmer)!==teilnehmer)||
           (Number.isInteger(Number(sonderaktionData.dauer))&&Number(sonderaktionData.dauer)!==buchungsdauerFuerProgramm(teilnehmer,programm)))
          return reply(res,409,{error:'Das ausgewählte Tagesangebot ist für diesen Termin nicht mehr freigegeben.'});
      }
      const einzelplatz=programm.buchungsmodus==='einzelplatz';
      if(einzelplatz&&teilnehmer!==1)return reply(res,400,{error:'Für dieses Angebot kannst du nur einen Einzelplatz pro Anmeldung reservieren.'});
      const verfuegbareTermine=Array.isArray(programm.verfuegbare_termine)?programm.verfuegbare_termine:[];
      if(verfuegbareTermine.length&&!verfuegbareTermine.includes(datum))
        return reply(res,409,{error:'Für dieses Programm ist an dem Datum kein Termin freigegeben.'});
      if(teilnehmer>Number(programm.kapazitaet))return reply(res,409,{error:'Die Gruppengröße überschreitet die maximale Kapazität.'});
      const einzelpreisCent=Number.isFinite(Number(programm.preis_pro_person))
        ?Math.round(Number(programm.preis_pro_person)*100):null;
      const gruppenPreisCent=einzelplatz
        ?(einzelpreisCent>0?einzelpreisCent:null)
        :preisFuerTeilnehmer(programm.preise,teilnehmer,programm.gruppenstufen);
      if(gruppenPreisCent===null)return reply(res,409,{error:'Für diese Teilnehmerzahl ist kein Preis hinterlegt.'});
      const sonderaktionsPreis=sonderaktionData?Number(String(sonderaktionData.preis??'').replace(',','.')):null;
      if(sonderaktionData&&(!Number.isFinite(sonderaktionsPreis)||sonderaktionsPreis<0))
        return reply(res,409,{error:'Für dieses Tagesangebot ist noch kein gültiger Aktionspreis hinterlegt.'});
      const preisCent=sonderaktionData?Math.round(sonderaktionsPreis*100):gruppenPreisCent;
      gesamtpreis=preisCent/100;
      const istGast=d.istGast===undefined?'nein':d.istGast;
      const gastEinrichtung=safeText(d.gastEinrichtung,120);
      if(!['ja','nein'].includes(istGast)||(istGast==='ja'&&!gastEinrichtung))
        return reply(res,400,{error:'Bitte Gästeangabe und gegebenenfalls die Unterkunft angeben.'});
      const data={
       istGast,gastEinrichtung:istGast==='ja'?gastEinrichtung:null,
       gaesteRabattStatus:istGast==='ja'?'pruefung_offen':'nicht_beantragt',
       name,vorname,nachname,email,datum,angebot,veranstaltungsort:bookingSite,teilnehmer,rechnungsadresse,
gesamtpreis,
anzahlung: einzelplatz ? 0 : Math.round(gesamtpreis * 25) / 100,
restbetrag: einzelplatz ? gesamtpreis : Math.round(gesamtpreis * 75) / 100,
buchungsmodus: einzelplatz?'einzelplatz':'gruppe',
mindestteilnehmer: einzelplatz?Number(programm.mindestteilnehmer)||5:null,
        uhrzeit:safeText(d.uhrzeit,5),
        telefon:safeText(d.telefon,40),
       nachricht:safeText(d.nachricht,2000),dauer:buchungsdauerFuerProgramm(teilnehmer,programm),
       ...(sonderaktionData?{sonderaktionId,sonderaktionTitel:safeText(sonderaktionData.titel,120),
         sonderaktionsPreisCent:preisCent,sonderaktionsBasisPreisCent:gruppenPreisCent,
         sonderaktionsBereitschaft:sonderaktionData.vorschlagsmitarbeiter||[],
         sonderaktionsRichtung:sonderaktionData.vorschlagsrichtung}:{}),
       datenschutz:'on',datenschutzBestaetigtAm:new Date().toISOString(),
       datenschutzTextVersion:BUCHUNGS_DATENSCHUTZ_VERSION,
       agbBestaetigtAm:new Date().toISOString(),agbTextVersion:Number(agbData.version),agbTextSnapshot:agbData.text
      };

      if(!/^(?:09:(?:00|15|30|45)|1[0-8]:(?:00|15|30|45)|19:00)$/.test(data.uhrzeit))
        return reply(res,400,{
          error:'Bitte eine gültige Anfangszeit zwischen 09:00 und 19:00 Uhr in 15-Minuten-Schritten auswählen.'
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
        const kapazitaet=await client.query(
          `SELECT COALESCE(SUM(CASE WHEN data->>'teilnehmer' ~ '^[0-9]+$' THEN (data->>'teilnehmer')::integer ELSE 0 END),0) AS gebucht
           FROM brilon_buchungen WHERE data->>'datum'=$1 AND data->>'angebot'=$2
             AND ($3::text IS NULL OR data->>'uhrzeit'=$3)
             AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,
          [datum,angebot,einzelplatz?data.uhrzeit:null]
        );
        if(Number(kapazitaet.rows[0].gebucht)+teilnehmer>Number(programm.kapazitaet))
          return {konflikt:'Die Kapazität für dieses Programm ist am gewählten Tag ausgeschöpft.'};
        const konflikt=await pruefeBuchungskonflikt(client,datum,fenster,null,
          einzelplatz?{angebot,uhrzeit:data.uhrzeit}:null,programm.veranstaltungsort);
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

const buchungsdetails=buchungsDetails({...data,ende:`${ende}${fenster?' Uhr':''}`});




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
  const mitarbeiterUrl=(process.env.PUBLIC_BASE_URL||'https://klettern-brilon-neu.onrender.com').replace(/\/$/,'')+'/mitarbeiterbereich.html';
  for(const person of standortMitarbeiter.rows){
    const adresse=safeText(person.email,180);
    if(!/^\S+@\S+\.\S+$/.test(adresse))continue;
    const anrede=safeText(person.name,120);
    const kontaktperson=safeText(data.name||[data.vorname,data.nachname].filter(Boolean).join(' '),160)||'Nicht angegeben';
    const besonderheiten=safeText(data.nachricht,2000).trim();
    enqueueMail(adresse,
      'Neue Terminanfrage am Standort '+data.veranstaltungsort+' – Bewerbung möglich',
      `Hallo${anrede?' '+anrede:''},\n\nfür deinen freigegebenen Standort ist eine neue Buchungsanfrage eingegangen.\n\nProgramm: ${data.angebot}\nTermin: ${data.datum} um ${data.uhrzeit||'Uhrzeit offen'} Uhr\nStandort: ${data.veranstaltungsort||'—'}\nTeilnehmer: ${data.teilnehmer}\nBuchung erfolgte über: ${kontaktperson}`+
      (besonderheiten?`\n\nBesondere Hinweise des Buchers:\n${besonderheiten}`:'')+
      `\n\nBitte melde dich im Mitarbeiterbereich an und öffne den Termin unter „Termine und meine Bewerbungen“: ${mitarbeiterUrl}\nDort kannst du dich auf die Anfrage bewerben. Die Anfrage ist noch nicht verbindlich bestätigt; die Verwaltung entscheidet über die Einteilung.\n\nViele Grüße\nKlettern & Abenteuer Brilon`
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

      const q=await pool.query(
        `SELECT data
         FROM brilon_buchungen
         WHERE data->>'datum'=$1
         AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,
        [datum]
      );

      const buchungen=q.rows.map(r=>({data:r.data,fenster:buchungsfenster(r.data)}));

     
      const teilnehmer = Number(u.searchParams.get('teilnehmer'));

      if (!Number.isInteger(teilnehmer) ||
          teilnehmer < 1 || teilnehmer > 1000) {
        return reply(res,400,{
          error:'Bitte eine gültige Teilnehmerzahl angeben.'
        });
      }

      const angebot=safeText(u.searchParams.get('angebot'),120);
      const programm=await pool.query(
        `SELECT id,dauer,dauer_modus,gruppenstufen,preise,buchungsmodus,mindestteilnehmer,kapazitaet FROM brilon_angebote WHERE name=$1 AND archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true LIMIT 1`,[angebot]
      );
      if(!programm.rowCount)return reply(res,409,{error:'Programm ist nicht verfügbar.'});
      const einzelplatz=programm.rows[0].buchungsmodus==='einzelplatz';
      if(teilnehmer>Number(programm.rows[0].kapazitaet))return reply(res,409,{error:'Die Gruppengröße überschreitet die maximale Kapazität.'});
      if(!einzelplatz&&preisFuerTeilnehmer(programm.rows[0].preise,teilnehmer,programm.rows[0].gruppenstufen)===null)
        return reply(res,409,{error:'Für diese Teilnehmerzahl ist keine Preisstufe hinterlegt.'});
      const dauer=buchungsdauerFuerProgramm(teilnehmer,programm.rows[0]);
      if(!dauer)return reply(res,409,{error:'Für diese Gruppengröße konnte die Programmdauer nicht berechnet werden.'});

      const specialId=safeText(u.searchParams.get('sonderaktion_id'),36);
      let requestedTimes=null;
      if(specialId){
        const action=await pool.query('SELECT data FROM brilon_aktionen WHERE id=$1',[specialId]);
        const special=action.rows[0]?.data||{};
        if(special.quelle_buchung_id){
          const source=await pool.query('SELECT data,status FROM brilon_buchungen WHERE id=$1',[special.quelle_buchung_id]);
          if(!tagesangebotPasstZurQuellbuchung(special,source.rows[0]))
            return reply(res,409,{error:'Dieses Tagesangebot ist nicht mehr aktuell, weil sich die zugehörige Buchung geändert hat oder storniert wurde.'});
        }
        const standort=safeText(u.searchParams.get('standort'),80);
        if(!action.rowCount||special.status!=='freigegeben'||special.datum!==datum||
           String(special.programm_id)!==String(programm.rows[0].id)||safeText(special.quellprogramm,120)!==angebot||
           (standort&&safeText(special.veranstaltungsort,80)!==standort)||
           (Number.isInteger(Number(special.teilnehmer))&&Number(special.teilnehmer)!==teilnehmer)||
           (Number.isInteger(Number(special.dauer))&&Number(special.dauer)!==dauer))
          return reply(res,409,{error:'Dieses Tagesangebot ist nicht mehr für diese Auswahl freigegeben.'});
        requestedTimes=[safeText(special.uhrzeit,5)];
      }
      const zeiten=[];
      const timeSlots=requestedTimes||Array.from({length:11},(_,hour)=>String(hour+9).padStart(2,'0')+':00');

      for(const uhrzeit of timeSlots){
        if(!/^(?:09:(?:00|15|30|45)|1[0-8]:(?:00|15|30|45)|19:00)$/.test(uhrzeit))continue;
        const start=Number(uhrzeit.slice(0,2))*60+Number(uhrzeit.slice(3,5));

        const neuesFenster=
          dauer===null ? null : [start,start+dauer];

        const sameSession=b=>b.data?.buchungsmodus==='einzelplatz'&&
          b.data?.angebot===angebot&&b.data?.uhrzeit===uhrzeit;
        const belegt=buchungen.some(b=>
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
                COALESCE(standorte,'{}'::text[]) AS standorte
         FROM brilon_kalender
         WHERE typ IN ('sperrzeit','termin')
         ORDER BY datum ASC`
      );
      return reply(res,200,q.rows);
    }

    if(route==='/api/aktionen'&&req.method==='GET'){
      if(!pool)return reply(res,200,[]);
      const q=await pool.query(
        `SELECT a.id,a.data AS aktionsdaten,a.data->>'titel' AS titel,a.data->>'datum' AS datum,
          a.data->>'beschreibung' AS beschreibung,a.data->>'preis' AS preis,
          a.data->>'uhrzeit' AS uhrzeit,a.data->>'endzeit' AS endzeit,
          a.data->>'veranstaltungsort' AS veranstaltungsort,
          a.data->>'teilnehmer' AS teilnehmer,a.id::text AS sonderaktion_id,
          a.data->>'bild_url' AS bild_url,
          p.id AS programm_id,p.name AS programm_name
         FROM brilon_aktionen a
         LEFT JOIN brilon_angebote p ON p.id::text=a.data->>'programm_id'
           AND p.archiviert=false AND p.aktiv=true AND p.buchbar=true AND p.veroeffentlicht=true
           AND (a.data->>'datum' IS NULL OR a.data->>'datum'=''
             OR jsonb_array_length(COALESCE(p.verfuegbare_termine,'[]'::jsonb))=0
             OR p.verfuegbare_termine ? (a.data->>'datum'))
         WHERE COALESCE(a.data->>'status','freigegeben')='freigegeben'
           AND (a.data->>'uhrzeit' IS NULL OR p.id IS NOT NULL)
         ORDER BY a.data->>'datum' ASC NULLS LAST,a.id DESC LIMIT 100`
      );
      const current=await Promise.all(q.rows.map(async row=>{
        const action=row.aktionsdaten||{};
        if(!action.quelle_buchung_id)return row;
        const source=await pool.query('SELECT data,status FROM brilon_buchungen WHERE id=$1',[action.quelle_buchung_id]);
        return tagesangebotPasstZurQuellbuchung(action,source.rows[0])?row:null;
      }));
      return reply(res,200,current.filter(Boolean).map(({aktionsdaten,...row})=>row));
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

    // Besuchergruppen verwenden vorhandene JSONB-Einstellungen, ohne eigene Migration.
    if(route==='/api/besuchergruppen'&&req.method==='GET'){
      if(!pool)return reply(res,200,DEFAULT_VISITOR_GROUPS);
      try{
        const q=await pool.query("SELECT data->'besuchergruppen' AS gruppen FROM brilon_rechnungsdaten WHERE id=1");
        return reply(res,200,prepareVisitorGroups(q.rows[0]?.gruppen));
      }catch(error){
        console.error('Besuchergruppen konnten nicht gelesen werden:',error.code||error.message);
        return reply(res,200,DEFAULT_VISITOR_GROUPS);
      }
    }
    if(route==='/api/admin/besuchergruppen'&&['GET','PUT'].includes(req.method)){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank ist nicht konfiguriert.'});
      if(req.method==='GET'){
        try{
          const q=await pool.query("SELECT data->'besuchergruppen' AS gruppen FROM brilon_rechnungsdaten WHERE id=1");
          if(!q.rowCount)return reply(res,503,{error:'Website-Einstellungen sind noch nicht eingerichtet.'});
          return reply(res,200,prepareVisitorGroups(q.rows[0]?.gruppen));
        }catch(error){return reply(res,503,{error:'Besuchergruppen konnten nicht geladen werden.'});}
      }
      const data=await body(req,50000);
      const checked=validateVisitorGroups(data?.gruppen);
      if(checked.error)return reply(res,400,{error:checked.error});
      try{
        const result=await pool.query(
          "UPDATE brilon_rechnungsdaten SET data=jsonb_set(COALESCE(data,'{}'::jsonb),'{besuchergruppen}',$1::jsonb,true),aktualisiert_am=NOW() WHERE id=1 RETURNING id",
          [JSON.stringify(checked.gruppen)]);
        if(!result.rowCount)return reply(res,503,{error:'Website-Einstellungen sind noch nicht eingerichtet.'});
        return reply(res,200,{success:true,gruppen:checked.gruppen});
      }catch(error){
        console.error('Besuchergruppen-Speicherung fehlgeschlagen:',error.code||error.message);
        return reply(res,503,{error:'Besuchergruppen konnten nicht gespeichert werden.'});
      }
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

    if(route==='/api/demo-vorschlag'&&req.method==='POST'){
      const auth=await session(req);
      if(!auth.valid||!auth.readOnly)return reply(res,401,{error:'Bitte mit dem Demo-Zugang anmelden.'});
      if(!sameOriginMutation(req)||!adminCsrfValid(req))return reply(res,403,{error:'Anfrage abgelehnt.'});
      if(!limit('demo-vorschlag:'+ip,4,3600000))return reply(res,429,{error:'Zu viele Vorschläge. Bitte später erneut versuchen.'});
      const d=await body(req),message=safeText(d?.message,2000).trim();
      if(message.length<8)return reply(res,400,{error:'Bitte einen Vorschlag mit mindestens 8 Zeichen eingeben.'});
      if(!process.env.BOOKING_NOTIFY_EMAIL)return reply(res,503,{error:'Die Verwaltungsadresse ist derzeit nicht eingerichtet.'});
      try{
        await brevoMail(process.env.BOOKING_NOTIFY_EMAIL,'Hinweis aus dem Verwaltungs-Demo-Zugang',
          'Eine Person hat im Demo-Zugang einen Hinweis oder Verbesserungsvorschlag eingereicht.\\n\\n'+message+'\\n\\nDer Vorschlag wurde nicht automatisch in der Website umgesetzt.');
        return reply(res,200,{success:true,message:'Vielen Dank. Der Vorschlag wurde an die Verwaltung weitergeleitet.'});
      }catch(error){
        console.error('Demo-Vorschlag konnte nicht versendet werden:',error.message);
        return reply(res,502,{error:'Der Vorschlag konnte gerade nicht zugestellt werden.'});
      }
    }

    if(route==='/api/admin/login'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Admin-Anfragen müssen von derselben Website stammen.'});
      const d=await body(req),
            username=process.env.ADMIN_USER,
            password=process.env.ADMIN_PASSWORD;
      const demoUser=process.env.ADMIN_DEMO_USER,demoPassword=process.env.ADMIN_DEMO_PASSWORD;
      if(demoUser&&credentialMatches(d.username,demoUser)){
        if(!rateLimiter.erlauben('admin-demo-ip:'+ip,12,600000))
          return reply(res,429,{error:'Zu viele Demo-Anmeldeversuche. Bitte später erneut versuchen.'});
        if(!credentialMatches(d.password,demoPassword))
          return reply(res,401,{error:'Demo-Zugangsdaten nicht korrekt.'});
        const token=demoSessionToken();
        return reply(res,200,{success:true,readOnly:true,csrfToken:adminCsrfToken(token)},{
          'Set-Cookie':cookieName+'='+token+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800'
        });
      }
      if(!username||!password)
        return reply(res,503,{error:'Admin-Zugang nicht eingerichtet.'});
      const a=Buffer.from(String(d.username||'')),
            b=Buffer.from(username),
            c=Buffer.from(String(d.password||'')),
            e=Buffer.from(password);
      if(a.length!==b.length||c.length!==e.length||
         !crypto.timingSafeEqual(a,b)||!crypto.timingSafeEqual(c,e)){
        const kontoId=gpsTokenHash(process.env.ADMIN_USER||'unconfigured');
        if(!adminLoginErlauben(rateLimiter,ip,kontoId))
          return reply(res,429,{error:'Zu viele Versuche. Bitte zehn Minuten warten.'});
        return reply(res,401,{error:'Zugangsdaten nicht korrekt.'});
      }
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
        const neuerStatus=neuerStand.anzahlungErreicht&&q.rows[0].status==='offen'
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
        const offerLink=anschlussLink(ergebnis.buchung.id);
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

      
if (
  ergebnis.alterStatus !== status && status !== 'offen'
) {
  const kunde = ergebnis.kundenDaten;
  const empfaenger = kunde?.email;
  const gesamtCent = Number.isFinite(Number(kunde.gesamtpreis))
    ? Math.round(Number(kunde.gesamtpreis) * 100) : null;
  const stand = gesamtCent === null ? null : zahlungsstand(
    gesamtCent, Array.isArray(kunde.zahlungen) ? kunde.zahlungen : []
  );

  const nachricht=buchungsstatusNachricht(status,kunde,stand);

  if (empfaenger && nachricht) {
    const inhalt =
      `Hallo ${kunde.name || ''},\n\n` +
      `${nachricht.text}\n\n` +
      `Datum: ${kunde.datum || 'Nicht angegeben'}\n` +
      `Beginn: ${kunde.uhrzeit || 'Nach Absprache'} Uhr\n` +
      `Teilnehmer: ${kunde.teilnehmer || 'Nicht angegeben'}\n\n` +
      (status==='bestaetigt'&&anschlussLink(ergebnis.buchung.id)
        ?`Passende Anschlussprogramme mit 10 % Rabatt: ${anschlussLink(ergebnis.buchung.id)}\n\n`:'' )+
      (ergebnis.elternRabatt?.angewendet?'Der Anschlussrabatt wurde auch auf die ursprüngliche Buchung angewendet.\n\n':
        ergebnis.elternRabatt?.hoehererRabattBestand?'Der bereits bestehende höhere Rabatt bleibt erhalten. Empfehlungs- und Anschlussrabatte werden nicht addiert.\n\n':'')+
      (ergebnis.elternRabattZurueck?.zurueckgenommen
        ?`Der Rabatt auf die ursprüngliche Buchung wurde nach dem Storno zurückgenommen. Neuer Preis: ${(ergebnis.elternRabattZurueck.buchung.data.gesamtpreis).toFixed(2).replace('.',',')} €, offen: ${(ergebnis.elternRabattZurueck.stand.offenCent/100).toFixed(2).replace('.',',')} €.\n\n`:'' )+
      `Bei Fragen antworte bitte auf diese E-Mail.\n\n` +
      `Gut Seil!\nKlettern & Abenteuer Brilon`;

    if(status==='bestaetigt'){
      ergebnis.buchung.data.bestaetigungsEmail=await buchungsbestaetigungsEmail({
        buchungId:ergebnis.buchung.id,email:empfaenger,betreff:nachricht.betreff,text:inhalt});
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
     if (!process.env.BANK_NAME || !process.env.BANK_IBAN) {
  return reply(res, 503, {
    error: 'Bankverbindung ist noch nicht vollständig eingerichtet.'
  });
} 
     const zahlungstext=zahlungsinformationenText(kunde,{
       bankName:process.env.BANK_NAME,iban:process.env.BANK_IBAN,
       bookingId:buchung.buchungsnummer||buchungsId
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
    if(route==='/api/admin/kalender'&&req.method==='GET'){
      if(!await admin(req,res))return;
      if(!pool)return reply(res,503,{error:'Datenbank nicht konfiguriert.'});
      const q=await pool.query(
        "SELECT k.id,k.titel,k.datum::text AS datum,k.enddatum::text AS enddatum,k.uhrzeit::text AS uhrzeit,k.endzeit::text AS endzeit,k.typ,k.beschreibung,COALESCE(k.standorte,'{}'::text[]) AS standorte,COALESCE((SELECT json_agg(json_build_object('mitarbeiter_id',e.mitarbeiter_id,'name',m.name,'status',e.status) ORDER BY m.name) FROM brilon_kalender_einsaetze e JOIN brilon_pruef_mitarbeitende m ON m.id=e.mitarbeiter_id WHERE e.kalender_id=k.id AND e.status IN ('eingeteilt','bestaetigt','abgeschlossen')),'[]'::json) AS staff FROM brilon_kalender k ORDER BY k.datum,k.uhrzeit NULLS LAST LIMIT 1000"
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

      if(route==='/api/admin/medien'&&req.method==='GET'){
        if(!supabase)return reply(res,503,{error:'Bildspeicher ist nicht konfiguriert.'});
        try{
          const [programme,aktionen,storage]=await Promise.all([
            pool.query("SELECT name AS titel,bild_url FROM brilon_angebote WHERE bild_url IS NOT NULL AND bild_url<>''"),
            pool.query("SELECT data->>'titel' AS titel,data->>'bild_url' AS bild_url FROM brilon_aktionen WHERE data->>'bild_url' IS NOT NULL AND data->>'bild_url'<>''"),
            supabase.storage.from('angebotsbilder').list('medien',{limit:1000,sortBy:{column:'created_at',order:'desc'}})
          ]);
          if(storage.error)throw storage.error;
          const images=new Map();
          for(const row of [...programme.rows,...aktionen.rows]){
            if(row.bild_url&&gueltigeMedienBildUrl(row.bild_url))
              images.set(row.bild_url,{url:row.bild_url,name:safeText(row.titel,120)||'Gespeichertes Programmbild',date:null});
          }
          for(const file of storage.data||[]){
            if(!/\.(jpe?g|png|webp|gif)$/i.test(file.name)||!file.id)continue;
            const {data}=supabase.storage.from('angebotsbilder').getPublicUrl('medien/'+file.name);
            images.set(data.publicUrl,{url:data.publicUrl,name:safeText(file.metadata?.originalName,120)||file.name,
              date:file.created_at||file.updated_at||null});
          }
          return reply(res,200,{bilder:[...images.values()]});
        }catch(error){
          console.error('Medienbibliothek konnte nicht geladen werden:',error?.message||'Speicherfehler');
          return reply(res,503,{error:'Bilder konnten nicht geladen werden.'});
        }
      }
      if(route==='/api/admin/medien'&&req.method==='POST'){
        if(!limit('image-upload:'+ip,20,600000))return reply(res,429,{error:'Zu viele Bild-Uploads. Bitte später erneut versuchen.'});
        if(!supabase)return reply(res,503,{error:'Bildspeicher ist nicht konfiguriert.'});
        const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
        const contentType=(req.headers['content-type']||'').split(';')[0].toLowerCase();
        const extension=types[contentType];
        if(!extension)return reply(res,400,{error:'Erlaubt sind JPG/JPEG, PNG, WebP und GIF.'});
        const chunks=[];let size=0;const maxSize=extension==='gif'?3*1024*1024:5*1024*1024;
        for await(const chunk of req){
          size+=chunk.length;
          if(size>maxSize)return reply(res,413,{error:extension==='gif'?'GIF-Animationen dürfen maximal 3 MB groß sein.':'Das Bild darf maximal 5 MB groß sein.'});
          chunks.push(chunk);
        }
        if(!size)return reply(res,400,{error:'Keine Bilddatei empfangen.'});
        let image=Buffer.concat(chunks);
        if(contentType==='image/gif'){
          const signature=image.subarray(0,6).toString('ascii');
          if(!['GIF87a','GIF89a'].includes(signature)||image.length<13)
            return reply(res,400,{error:'Die Datei ist kein gültiges GIF.'});
          const width=image.readUInt16LE(6),height=image.readUInt16LE(8);
          if(!width||!height||width>1200||height>1200)
            return reply(res,400,{error:'GIF-Icons dürfen höchstens 1200 × 1200 Pixel groß sein.'});
        }else{
          try{image=await bereinigeBild(image,contentType);}
          catch{return reply(res,400,{error:'Ungültiges oder zu großes Bild. JPG/JPEG, PNG und WebP bis 40 Megapixel sind erlaubt.'});}
        }
        try{await pruefeBereinigtenBildUpload(image);}catch(error){return malwareScanReply(res,error);}
        const originalName=safeText(req.headers['x-original-filename'],120)||'Bild';
        const filePath='medien/'+crypto.randomUUID()+'.'+extension;
        const {error}=await supabase.storage.from('angebotsbilder').upload(filePath,image,{
          contentType,upsert:false,metadata:{originalName}
        });
        if(error){
          console.error('Medienbild konnte nicht gespeichert werden:',error?.message||'Speicherfehler');
          return reply(res,502,{error:'Bild konnte nicht dauerhaft gespeichert werden.'});
        }
        const {data}=supabase.storage.from('angebotsbilder').getPublicUrl(filePath);
        return reply(res,201,{success:true,bild_url:data.publicUrl,name:originalName});
      }

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
          `SELECT id,data,status,created_at
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

      // Lesende Uebersicht: angrenzende bestaetigte Buchungen am selben Tag.
      // Keine automatische Rabattberechtigung und keine Preisveraenderung.
      if(route==='/api/admin/anschlussrabatt/kandidaten'&&req.method==='GET'){
        const datum=u.searchParams.get('datum')||'';
        if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(datum))
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
            data->>'bild_url' AS bild_url,data->>'programm_id' AS programm_id,
            COALESCE(data->>'status','freigegeben') AS status,
            data->>'uhrzeit' AS uhrzeit,data->>'endzeit' AS endzeit,
            data->>'veranstaltungsort' AS veranstaltungsort,
            data->>'vorschlagsrichtung' AS vorschlagsrichtung,
            data->'vorschlagsmitarbeiter' AS vorschlagsmitarbeiter,
            data->>'quellprogramm' AS quellprogramm
           FROM brilon_aktionen ORDER BY data->>'datum' ASC NULLS LAST,id DESC LIMIT 100`);
        return reply(res,200,q.rows);
      }

      if(route==='/api/admin/aktionen/vorschlaege'&&req.method==='POST'){
        const d=await body(req),bookingId=safeText(d.buchung_id,36);
        if(!/^[0-9a-f-]{36}$/i.test(bookingId))return reply(res,400,{error:'Buchungsbezug fehlt.'});
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          const bookingQuery=await client.query('SELECT id,data,status FROM brilon_buchungen WHERE id=$1 FOR UPDATE',[bookingId]);
          if(!bookingQuery.rowCount){await client.query('ROLLBACK');return reply(res,404,{error:'Buchung nicht gefunden.'});}
          const booking=bookingQuery.rows[0],data=booking.data||{};
          const date=data.datum,time=String(data.uhrzeit||''),duration=Number(data.dauer),participants=Number(data.teilnehmer);
          if(!['offen','bestaetigt'].includes(booking.status)||!/^\d{4}-\d\d-\d\d$/.test(date||'')||
             !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)||!Number.isInteger(duration)||duration<15||duration>1440||
             !Number.isInteger(participants)||participants<1||participants>1000){
            await client.query('ROLLBACK');return reply(res,409,{error:'Die Buchung hat keine gültige Zeit oder Programmdauer für einen automatischen Vorschlag.'});
          }
          const programQuery=await client.query(`SELECT id,name,veranstaltungsort,veranstaltungsorte,preise,gruppenstufen,kapazitaet
            FROM brilon_angebote WHERE name=$1 AND archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true LIMIT 1`,[safeText(data.angebot,120)]);
          if(!programQuery.rowCount){await client.query('ROLLBACK');return reply(res,409,{error:'Das gebuchte Programm ist nicht mehr buchbar; ein Angebot kann nicht automatisch zugeordnet werden.'});}
          const program=programQuery.rows[0],sites=Array.isArray(program.veranstaltungsorte)&&program.veranstaltungsorte.length
            ?program.veranstaltungsorte:[program.veranstaltungsort];
          const site=safeText(data.veranstaltungsort||program.veranstaltungsort,80);
          if(!sites.includes(site)){await client.query('ROLLBACK');return reply(res,409,{error:'Der Buchungsstandort ist für das Programm nicht mehr freigegeben.'});}
          const staffQuery=await client.query(`SELECT e.mitarbeiter_id,e.anschluss_option,m.name
            FROM brilon_einsaetze e JOIN brilon_pruef_mitarbeitende m ON m.id=e.mitarbeiter_id
            WHERE e.buchung_id=$1 AND e.status='bestaetigt'
              AND e.anschluss_option IN ('davor','danach','beides')
              AND m.aktiv=true AND m.freigabe_am IS NOT NULL
            ORDER BY m.name,e.mitarbeiter_id`,[bookingId]);
          if(!staffQuery.rowCount){await client.query('ROLLBACK');return reply(res,409,{error:'Für diese Buchung liegt noch keine bestätigte Mitarbeiterbereitschaft für davor oder danach vor.'});}
          const startOfMain=Number(time.slice(0,2))*60+Number(time.slice(3,5)),endOfMain=startOfMain+duration;
          const timeText=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
          const candidates=[];
          for(const direction of ['davor','danach']){
            const eligible=staffQuery.rows.filter(person=>person.anschluss_option===direction||person.anschluss_option==='beides');
            if(!eligible.length)continue;
            const start=direction==='davor'?startOfMain-duration:endOfMain;
            const end=direction==='davor'?startOfMain:endOfMain+duration;
            // Tagesangebote bleiben in den regulären Buchungszeiten. Bei „davor“ endet der Zusatztermin
            // exakt mit dem Haupttermin; „danach“ beginnt exakt an dessen Ende.
            if(start<9*60||start>19*60||end>24*60||start%15!==0||end%15!==0)continue;
            candidates.push({direction,start,end,staff:eligible.map(person=>({id:person.mitarbeiter_id,name:person.name}))});
          }
          if(!candidates.length){
            await client.query('ROLLBACK');return reply(res,409,{error:'Die Bereitschaft ist gespeichert, aber die direkt angrenzenden Zeitfenster liegen außerhalb der Buchungszeiten oder lassen sich nicht exakt in 15-Minuten-Schritten anbieten.'});
          }
          let defaultPrice=null;
          try{const cents=preisFuerTeilnehmer(program.preise,participants,program.gruppenstufen);if(cents!==null)defaultPrice=(cents/100).toFixed(2);}
          catch{}
          const created=[];
          for(const candidate of candidates){
            const start=timeText(candidate.start),end=timeText(candidate.end);
            const prior=await client.query(`SELECT id FROM brilon_aktionen WHERE data->>'quelle_buchung_id'=$1
              AND data->>'vorschlagsrichtung'=$2 AND data->>'datum'=$3 AND data->>'uhrzeit'=$4 LIMIT 1`,
              [bookingId,candidate.direction,date,start]);
            if(prior.rowCount){created.push(prior.rows[0].id);continue;}
            const actionId=crypto.randomUUID();
            const directionLabel=candidate.direction==='davor'?'davor':'danach';
            const action={status:'vorschlag',titel:`Tagesangebot ${candidate.direction==='davor'?'vor':'nach'} ${data.angebot}`,
              datum:date,uhrzeit:start,endzeit:end,veranstaltungsort:site,preis:defaultPrice||'',programm_id:String(program.id),
              beschreibung:`Automatisch vorgeschlagenes Zusatzprogramm direkt ${directionLabel} der Buchung ${safeText(data.buchungsnummer,80)||bookingId}.`,
              vorschlagsrichtung:candidate.direction,quelle_buchung_id:bookingId,quellprogramm:safeText(data.angebot,120),
              vorschlagsmitarbeiter:candidate.staff,teilnehmer:participants,dauer:duration};
            await client.query('INSERT INTO brilon_aktionen(id,data) VALUES($1,$2::jsonb)',[actionId,JSON.stringify(action)]);
            created.push(actionId);
          }
          await client.query('COMMIT');
          return reply(res,201,{success:true,ids:created,anzahl:created.length,nachricht:`${created.length} automatisch berechnete Zusatzangebot(e) liegen der Verwaltung zur Prüfung vor.`});
        }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
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
        const q=await pool.query(
          'INSERT INTO brilon_aktionen(id,data) VALUES ($1,$2) RETURNING id',
          [crypto.randomUUID(),JSON.stringify({titel,datum,beschreibung,preis,
            status:'freigegeben',
            ...(programmId?{programm_id:programmId}:{})})]
        );
        return reply(res,201,{id:q.rows[0].id});
      }

      const publishProposal=route.match(/^\/api\/admin\/aktionen\/([0-9a-fA-F-]{36})\/freigeben$/);
      if(publishProposal&&req.method==='POST'){
        const d=await body(req),title=safeText(d.titel,120),description=safeText(d.beschreibung,1000),price=Number(String(d.preis??'').replace(',','.')),
          programId=String(d.programm_id||'').trim();
        if(!title||!Number.isFinite(price)||price<0||!/^\d{1,16}$/.test(programId))
          return reply(res,400,{error:'Bitte Titel, gültigen Preis und ein buchbares Programm ergänzen.'});
        const current=await pool.query('SELECT data FROM brilon_aktionen WHERE id=$1',[publishProposal[1]]);
        if(!current.rowCount)return reply(res,404,{error:'Vorschlag nicht gefunden.'});
        const action=current.rows[0].data||{};
        if(action.status!=='vorschlag')return reply(res,409,{error:'Dieser Eintrag ist kein offener Verwaltungsvorschlag.'});
        const selected=await pool.query(`SELECT id,name,dauer,dauer_modus,gruppenstufen,veranstaltungsort,veranstaltungsorte,verfuegbare_termine
          FROM brilon_angebote WHERE id=$1 AND archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true`,[programId]);
        if(!selected.rowCount)return reply(res,400,{error:'Das verknüpfte Programm ist nicht veröffentlicht und buchbar.'});
        const program=selected.rows[0],sites=Array.isArray(program.veranstaltungsorte)&&program.veranstaltungsorte.length
          ?program.veranstaltungsorte:[program.veranstaltungsort];
        if(!sites.includes(action.veranstaltungsort)||program.name!==action.quellprogramm)
          return reply(res,400,{error:'Das Programm muss zum vorgeschlagenen Standort und zur gebuchten Programmart passen.'});
        if(buchungsdauerFuerProgramm(Number(action.teilnehmer),program)!==Number(action.dauer))
          return reply(res,409,{error:'Die Programmdauer hat sich seit dem Vorschlag geändert. Bitte den Kalender aktualisieren und einen neuen Zeitvorschlag berechnen lassen.'});
        const source=await pool.query('SELECT data,status FROM brilon_buchungen WHERE id=$1',[action.quelle_buchung_id]);
        if(!source.rowCount||!tagesangebotPasstZurQuellbuchung(action,source.rows[0]))
          return reply(res,409,{error:'Die zugehörige Buchung wurde inzwischen geändert oder storniert. Der Vorschlag kann nicht mehr freigegeben werden.'});
        if(Array.isArray(program.verfuegbare_termine)&&program.verfuegbare_termine.length&&!program.verfuegbare_termine.includes(action.datum))
          return reply(res,400,{error:'Das Programm ist für den vorgeschlagenen Tag nicht freigegeben.'});
        const q=await pool.query(`UPDATE brilon_aktionen SET data=$2::jsonb WHERE id=$1
          RETURNING id,data->>'status' AS status`,[publishProposal[1],JSON.stringify({...action,titel:title,beschreibung,preis:price.toFixed(2),programm_id:programId,status:'freigegeben',freigegebenAm:new Date().toISOString()})]);
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
  const q=await pool.query('SELECT id,name,aktiv FROM brilon_orte ORDER BY name');
  return reply(res,200,q.rows);
}
if(route==='/api/admin/orte'&&req.method==='POST'){
  const d=await body(req),name=safeText(d.name,80);
  if(!name)return reply(res,400,{error:'Ort ist erforderlich.'});
  const q=await pool.query(
    `INSERT INTO brilon_orte(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET aktiv=true RETURNING id,name,aktiv`,[name]
  );
  return reply(res,201,q.rows[0]);
}
const placeRoute=route.match(/^\/api\/admin\/orte\/(\d+)$/);
if(placeRoute&&req.method==='PATCH'){
  const d=await body(req);
  const name=d.name===undefined?null:safeText(d.name,80);
  const aktiv=d.aktiv===undefined?null:d.aktiv;
  if(aktiv!==null&&typeof aktiv!=='boolean')return reply(res,400,{error:'Der Aktiv-Status muss Ja oder Nein sein.'});
  if(name!==null&&!name)return reply(res,400,{error:'Die Standortbezeichnung darf nicht leer sein.'});
  if(name===null&&aktiv===null)return reply(res,400,{error:'Bitte eine Standortbezeichnung oder den Aktiv-Status ändern.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const current=await client.query('SELECT id,name,aktiv FROM brilon_orte WHERE id=$1 FOR UPDATE',[placeRoute[1]]);
    if(!current.rowCount){await client.query('ROLLBACK');return reply(res,404,{error:'Standort nicht gefunden.'});}
    const oldName=current.rows[0].name,newName=name||oldName;
    if(name&&name!==oldName){
      const duplicate=await client.query('SELECT 1 FROM brilon_orte WHERE lower(name)=lower($1) AND id<>$2',[name,placeRoute[1]]);
      if(duplicate.rowCount){await client.query('ROLLBACK');return reply(res,409,{error:'Ein Standort mit dieser Bezeichnung ist bereits vorhanden.'});}
    }
    const updated=await client.query(`UPDATE brilon_orte SET name=$1,aktiv=COALESCE($2,aktiv)
      WHERE id=$3 RETURNING id,name,aktiv`,[newName,aktiv,placeRoute[1]]);
    if(name&&name!==oldName){
      await client.query(`UPDATE brilon_angebote SET veranstaltungsort=CASE WHEN veranstaltungsort=$2 THEN $1 ELSE veranstaltungsort END,
        veranstaltungsorte=(SELECT COALESCE(jsonb_agg(DISTINCT to_jsonb(CASE WHEN value=$2 THEN $1 ELSE value END)),jsonb_build_array($1::text))
          FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(veranstaltungsorte)='array' AND jsonb_array_length(veranstaltungsorte)>0 THEN veranstaltungsorte ELSE jsonb_build_array(veranstaltungsort) END) AS x(value))
        WHERE veranstaltungsort=$2 OR COALESCE(veranstaltungsorte,'[]'::jsonb) ? $2`,[newName,oldName]);
      await client.query(`UPDATE brilon_buchungen SET data=jsonb_set(data,'{veranstaltungsort}',to_jsonb($1::text),true)
        WHERE status IN ('offen','bestaetigt') AND data->>'veranstaltungsort'=$2
          AND data->>'datum'>=CURRENT_DATE::text`,[newName,oldName]);
    }
    await client.query('COMMIT');
    return reply(res,200,updated.rows[0]);
  }catch(error){
    await client.query('ROLLBACK');
    if(error.code==='23505')return reply(res,409,{error:'Ein Standort mit dieser Bezeichnung ist bereits vorhanden.'});
    throw error;
  }finally{client.release();}
}
if(placeRoute&&req.method==='DELETE'){
  const place=await pool.query('SELECT id,name FROM brilon_orte WHERE id=$1',[placeRoute[1]]);
  if(!place.rowCount)return reply(res,404,{error:'Standort nicht gefunden.'});
  const usage=await pool.query(`SELECT
    (SELECT COUNT(*) FROM brilon_angebote WHERE veranstaltungsort=$1)+
    (SELECT COUNT(*) FROM brilon_pruef_stationen WHERE ort_id=$2)+
    (SELECT COUNT(*) FROM brilon_pruef_freigaben WHERE ort_id=$2) AS anzahl`,
    [place.rows[0].name,placeRoute[1]]);
  if(Number(usage.rows[0]?.anzahl||0)>0)
    return reply(res,409,{error:'Dieser Standort wird noch von Programmen oder Stationsfreigaben verwendet. Deaktiviere ihn stattdessen, damit bestehende Zuordnungen und Buchungen erhalten bleiben.'});
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

if (route === '/api/admin/angebote' && req.method === 'GET') {
  const q = await pool.query(
    `SELECT id,name,beschreibung,dauer,preise,aktiv,bild_url,kategorie,zielgruppe,besuchergruppen,
            veranstaltungsort,veranstaltungsorte,kapazitaet,verfuegbare_termine,hinweise,buchbar,veroeffentlicht,
            buchungsmodus,mindestteilnehmer,preis_pro_person,dauer_modus,gruppenstufen,sortierung,archiviert
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

const angebotLoeschenRoute=route.match(/^\/api\/admin\/angebote\/([0-9]+)$/);
if(angebotLoeschenRoute&&req.method==='DELETE'){
  const angebotId=angebotLoeschenRoute[1];
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const angebot=await client.query('SELECT id,name FROM brilon_angebote WHERE id=$1 FOR UPDATE',[angebotId]);
    if(!angebot.rowCount){
      await client.query('ROLLBACK');
      return reply(res,404,{error:'Programm nicht gefunden.'});
    }
    // Buchungsbelege und Buchungsverlauf dürfen niemals mit dem Programm gelöscht werden.
    const buchungen=await client.query(`SELECT 1 FROM brilon_buchungen
      WHERE data->>'angebot'=$1
         OR data->>'programmId'=$2
         OR data->>'programm_id'=$2
      LIMIT 1`,[angebot.rows[0].name,String(angebotId)]);
    if(buchungen.rowCount){
      await client.query('ROLLBACK');
      return reply(res,409,{error:'Zu diesem Programm gibt es bereits Buchungen. Bitte stattdessen archivieren, damit Rechnungen und Buchungsverläufe erhalten bleiben.'});
    }
    // GPS tables are optional until their migration is installed.
    // Guard against missing tables instead of returning HTTP 500.
    const gpsTabelle=await client.query("SELECT to_regclass('brilon_gps_touren') AS tabellenname");
    if(gpsTabelle.rows[0]?.tabellenname){
      const touren=await client.query('SELECT 1 FROM brilon_gps_touren WHERE angebot_id=$1 LIMIT 1',[angebotId]);
      if(touren.rowCount){
        await client.query('ROLLBACK');
        return reply(res,409,{error:'Das Programm ist mit einer GPS-Tour verbunden. Bitte zunächst die GPS-Tour entfernen oder das Programm archivieren.'});
      }
    }
    await client.query('DELETE FROM brilon_angebote WHERE id=$1',[angebotId]);
    await client.query('COMMIT');
    return reply(res,200,{success:true,id:Number(angebotId)});
  }catch(error){
    await client.query('ROLLBACK');
    if(error.code==='23503')return reply(res,409,{error:'Das Programm wird noch in anderen Bereichen verwendet. Bitte stattdessen archivieren.'});
    throw error;
  }finally{
    client.release();
  }
}

const archivRoute=route.match(/^\/api\/admin\/angebote\/([0-9]+)\/archivieren$/);
if(archivRoute&&req.method==='PATCH'){
  const d=await body(req);
  if(typeof d?.archiviert!=='boolean')return reply(res,400,{error:'Archivstatus fehlt.'});
  if(d.archiviert){
    // The GPS tour table can be absent before the optional migration is run.
    const gpsTabelle=await pool.query("SELECT to_regclass('brilon_gps_touren') AS tabellenname");
    if(gpsTabelle.rows[0]?.tabellenname){
      const aktiveTour=await pool.query('SELECT id FROM brilon_gps_touren WHERE angebot_id=$1 AND aktiv=true LIMIT 1',[archivRoute[1]]);
      if(aktiveTour.rowCount)return reply(res,409,{error:'Bitte die verknüpfte GPS-Tour zuerst deaktivieren.'});
    }
  }
  const q=await pool.query('UPDATE brilon_angebote SET archiviert=$1 WHERE id=$2 RETURNING id,archiviert',[d.archiviert,archivRoute[1]]);
  if(!q.rowCount)return reply(res,404,{error:'Angebot nicht gefunden.'});
  return reply(res,200,q.rows[0]);
}
  
if (route === '/api/admin/angebote' && req.method === 'POST') {
  const d = await body(req);

  const name = safeText(d.name, 120);
  const beschreibung = safeText(d.beschreibung, 1000);
  const dauer = Number(d.dauer);
  const dauerModus=d.dauer_modus==='fest'?'fest':'gruppenstufe';
  const kategorie=safeText(d.kategorie,60)||'Klettern';
  const zielgruppe=safeText(d.zielgruppe,120);
  const rawBesuchergruppen=Array.isArray(d.besuchergruppen)?d.besuchergruppen:[];
  if(rawBesuchergruppen.length>30||rawBesuchergruppen.some(id=>typeof id!=='string'||!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id)))
    return reply(res,400,{error:'Ungültige Besuchergruppenzuordnung.'});
  const besuchergruppen=[...new Set(rawBesuchergruppen)];
  const veranstaltungsort=safeText(d.veranstaltungsort,80)||'Brilon';
  const requestedSites=Array.isArray(d.veranstaltungsorte)?[...new Set(d.veranstaltungsorte.map(name=>safeText(name,80)).filter(Boolean))]:[veranstaltungsort];
  const kapazitaet=Number(d.kapazitaet||20);
  const hinweise=safeText(d.hinweise,1000);
  const termine=Array.isArray(d.verfuegbare_termine)?d.verfuegbare_termine:[];
  const buchungsmodus=d.buchungsmodus==='einzelplatz'?'einzelplatz':'gruppe';
  const mindestteilnehmer=Number(d.mindestteilnehmer??5);
  const preisProPerson=Number(d.preis_pro_person??0);
  const stufenErgebnis=programmStufenPruefen(d.gruppenstufen||[]);

  if(!name)return reply(res,400,{error:'Bitte einen Namen für das Angebot eingeben.'});
  if(!Number.isInteger(dauer)||dauer<15||dauer>1440)
    return reply(res,400,{error:'Bitte eine Dauer zwischen 15 und 1440 Minuten eingeben.'});
  if(buchungsmodus!=='einzelplatz'&&(!stufenErgebnis.ok||!stufenErgebnis.stufen.length))
    return reply(res,400,{error:stufenErgebnis.fehler||'Bitte mindestens eine Teilnehmerstufe mit Gruppenpreis und Dauer hinterlegen.'});
  if(!Number.isInteger(kapazitaet)||kapazitaet<1||kapazitaet>1000)
    return reply(res,400,{error:'Bitte eine Kapazität zwischen 1 und 1000 Teilnehmenden eingeben.'});
  if(!requestedSites.length)return reply(res,400,{error:'Bitte mindestens einen Veranstaltungsort auswählen.'});
  if(termine.some(t=>!gueltigesDatum(t)))
    return reply(res,400,{error:'Bitte nur gültige Termine im Format JJJJ-MM-TT eingeben.'});
  if(buchungsmodus==='einzelplatz'&&(kapazitaet<5||kapazitaet>12||
     !Number.isInteger(mindestteilnehmer)||mindestteilnehmer<5||mindestteilnehmer>kapazitaet||
     !Number.isFinite(preisProPerson)||preisProPerson<=0))
    return reply(res,400,{error:'Bei Einzelplätzen müssen Kapazität und Mindestanmeldungen zwischen 5 und 12 liegen. Der Preis pro Person muss größer als 0 € sein.'});

  const place=await pool.query('SELECT name FROM brilon_orte WHERE name=ANY($1::text[]) AND aktiv=true',[requestedSites]);
  if(place.rowCount!==requestedSites.length)return reply(res,400,{error:'Mindestens ein gewählter Veranstaltungsort ist nicht aktiv oder nicht angelegt.'});
  const gruppenstufen=buchungsmodus==='einzelplatz'?[]:stufenErgebnis.stufen;
  const gruppenPreise=Object.fromEntries(gruppenstufen.map(item=>[`${item.min}-${item.max}`,item.preis]));

  const q = await pool.query(
    `INSERT INTO brilon_angebote
      (name,beschreibung,dauer,dauer_modus,gruppenstufen,preise,aktiv,kategorie,zielgruppe,veranstaltungsort,veranstaltungsorte,kapazitaet,
       verfuegbare_termine,hinweise,buchbar,veroeffentlicht,buchungsmodus,mindestteilnehmer,preis_pro_person,besuchergruppen,sortierung,archiviert)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,false,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19::jsonb,
       (SELECT COALESCE(MAX(sortierung),0)+1 FROM brilon_angebote),false)
     RETURNING id`,
    [name,beschreibung,dauer,dauerModus,JSON.stringify(gruppenstufen),JSON.stringify(gruppenPreise),kategorie,zielgruppe,
      requestedSites[0],JSON.stringify(requestedSites),kapazitaet,JSON.stringify(termine),hinweise,
      d.buchbar===true,d.veroeffentlicht===true,buchungsmodus,buchungsmodus==='einzelplatz'?mindestteilnehmer:1,
      buchungsmodus==='einzelplatz'?preisProPerson:0,JSON.stringify(besuchergruppen)]
  );

  return reply(res, 201, {
    success: true,
    id: q.rows[0].id
  });
}

     
const preisRoute = route.match(/^\/api\/admin\/angebote\/([0-9]+)$/);

if (preisRoute && req.method === 'PATCH') {
  const d = await body(req);
  const bisher=await pool.query(
    `SELECT * FROM brilon_angebote WHERE id=$1`,[preisRoute[1]]
  );
  if(!bisher.rowCount)return reply(res,404,{error:'Angebot nicht gefunden.'});
  const alt=bisher.rows[0];
  const preise = d.preise;
  if(preise!==undefined&&(!preise||typeof preise!=='object'||Array.isArray(preise))) {
    return reply(res, 400, {
      error: 'Ungültige Preisangaben.'
    });
  }
  const neueStufen=Array.isArray(d.gruppenstufen)?programmStufenPruefen(d.gruppenstufen):
    programmStufenPruefen(alt.gruppenstufen||[]);
  if(Array.isArray(d.gruppenstufen)&&(!neueStufen.ok||(!d.gruppenstufen.length&&d.buchungsmodus!=='einzelplatz')))
    return reply(res,400,{error:neueStufen.fehler||'Gruppenangebote benötigen mindestens eine Teilnehmerstufe.'});
  const gruppenstufen=neueStufen.ok?neueStufen.stufen:(alt.gruppenstufen||[]);
  const neuePreise=Array.isArray(d.gruppenstufen)
    ?Object.fromEntries(gruppenstufen.map(item=>[`${item.min}-${item.max}`,item.preis]))
    :preise===undefined?(alt.preise||{}):Object.fromEntries(Object.entries(preise).filter(([key,value])=>{
      if(!/^[1-9]\d{0,3}-[1-9]\d{0,3}$/.test(key))return false;
      if(value===''||value==null)return false;
      const match=key.split('-').map(Number),amount=Number(value);
      return match[0]>=1&&match[1]>=match[0]&&match[1]<=1000&&Number.isFinite(amount)&&amount>=0;
    }).map(([key,value])=>[key,Number(value)]));

  
const aktiv = typeof d.aktiv === 'boolean' ? d.aktiv : null;
const name=d.name===undefined?alt.name:safeText(d.name,120);
const bildUrl=d.bild_url===undefined?alt.bild_url:(d.bild_url===null||d.bild_url===''?null:safeText(d.bild_url,1000));
if(d.bild_url!==undefined&&bildUrl&&!gueltigeMedienBildUrl(bildUrl))return reply(res,400,{error:'Bitte ein Bild aus der Medienbibliothek auswählen.'});
const beschreibung = d.beschreibung===undefined?alt.beschreibung:safeText(d.beschreibung,1000);
const kategorie=d.kategorie===undefined?alt.kategorie:safeText(d.kategorie,60);
const zielgruppe=d.zielgruppe===undefined?alt.zielgruppe:safeText(d.zielgruppe,120);
const rawBesuchergruppen=d.besuchergruppen===undefined?(Array.isArray(alt.besuchergruppen)?alt.besuchergruppen:[]):d.besuchergruppen;
if(!Array.isArray(rawBesuchergruppen)||rawBesuchergruppen.length>30||rawBesuchergruppen.some(id=>typeof id!=='string'||!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id)))return reply(res,400,{error:'Ungültige Besuchergruppenzuordnung.'});
const besuchergruppen=[...new Set(rawBesuchergruppen)];
const veranstaltungsort=d.veranstaltungsort===undefined?alt.veranstaltungsort:safeText(d.veranstaltungsort,80);
const requestedSites=Array.isArray(d.veranstaltungsorte)?[...new Set(d.veranstaltungsorte.map(name=>safeText(name,80)).filter(Boolean))]:
  (alt.veranstaltungsorte?.length?alt.veranstaltungsorte:[veranstaltungsort]);
const dauer=Number(d.dauer??alt.dauer);
const dauerModus=d.dauer_modus===undefined?(alt.dauer_modus||'gruppenstufe'):d.dauer_modus==='fest'?'fest':'gruppenstufe';
const kapazitaet=Number(d.kapazitaet??alt.kapazitaet);
const hinweise=d.hinweise===undefined?alt.hinweise:safeText(d.hinweise,1000);
const termine=Array.isArray(d.verfuegbare_termine)?d.verfuegbare_termine:alt.verfuegbare_termine;
const buchbar=typeof d.buchbar==='boolean'?d.buchbar:alt.buchbar;
const veroeffentlicht=typeof d.veroeffentlicht==='boolean'?d.veroeffentlicht:alt.veroeffentlicht;
const buchungsmodus=d.buchungsmodus===undefined?(alt.buchungsmodus||'gruppe'):
  d.buchungsmodus==='einzelplatz'?'einzelplatz':'gruppe';
const mindestteilnehmer=Number(d.mindestteilnehmer??alt.mindestteilnehmer??5);
const preisProPerson=Number(d.preis_pro_person??alt.preis_pro_person??0);
if(!name||!kategorie||!requestedSites.length||!Number.isInteger(dauer)||dauer<15||dauer>1440||
   !Number.isInteger(kapazitaet)||kapazitaet<1||kapazitaet>1000||termine.some(t=>!gueltigesDatum(t))||
   (buchungsmodus==='einzelplatz'&&(!Number.isInteger(kapazitaet)||kapazitaet<5||kapazitaet>12||
     !Number.isInteger(mindestteilnehmer)||mindestteilnehmer<5||mindestteilnehmer>kapazitaet||
     !Number.isFinite(preisProPerson)||preisProPerson<=0)))
  return reply(res,400,{error:'Dauer, Kapazität oder verfügbare Termine sind ungültig.'});
const place=await pool.query('SELECT name FROM brilon_orte WHERE name=ANY($1::text[]) AND aktiv=true',[requestedSites]);
if(place.rowCount!==requestedSites.length)return reply(res,400,{error:'Mindestens ein gewählter Veranstaltungsort ist nicht aktiv oder nicht angelegt.'});

const q = await pool.query(
  `UPDATE brilon_angebote
   SET preise = $1::jsonb,
       aktiv = COALESCE($3, aktiv),
       name=$4,beschreibung = $5,
       kategorie=$6,zielgruppe=$7,veranstaltungsort=$8,veranstaltungsorte=$9::jsonb,kapazitaet=$10,
       verfuegbare_termine=$11::jsonb,hinweise=$12,buchbar=$13,veroeffentlicht=$14,dauer=$15,
       buchungsmodus=$16,mindestteilnehmer=$17,preis_pro_person=$18,dauer_modus=$19,gruppenstufen=$20::jsonb,bild_url=$21,besuchergruppen=$22::jsonb
   WHERE id = $2
   RETURNING id,preise,aktiv,name,beschreibung,dauer,kategorie,zielgruppe,veranstaltungsort,bild_url,
             kapazitaet,verfuegbare_termine,hinweise,buchbar,veroeffentlicht,
             buchungsmodus,mindestteilnehmer,preis_pro_person,dauer_modus,gruppenstufen,sortierung,archiviert`,
  [
    JSON.stringify(neuePreise),
    preisRoute[1],
    aktiv,
    name,beschreibung,kategorie,zielgruppe,requestedSites[0],JSON.stringify(requestedSites),kapazitaet,
    JSON.stringify(termine),hinweise,buchbar,veroeffentlicht,dauer,
    buchungsmodus,buchungsmodus==='einzelplatz'?mindestteilnehmer:1,
    buchungsmodus==='einzelplatz'?preisProPerson:0,dauerModus,JSON.stringify(gruppenstufen),bildUrl,
    JSON.stringify(besuchergruppen)
  ]
);


  if (!q.rowCount) {
    return reply(res, 404, {
      error: 'Angebot nicht gefunden.'
    });
  }

  return reply(res, 200, q.rows[0]);
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

  try{
    await pruefeBereinigtenBildUpload(bild);
  }catch(error){return malwareScanReply(res,error);}

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
    'medien/' + crypto.randomUUID() + '.' + endung;

      if (!supabase) return reply(res,503,{error:'Bildspeicher ist nicht konfiguriert.'});
      const { error } = await supabase.storage
    .from('angebotsbilder')
    .upload(dateiname, bild, {
      contentType: dateityp,
      upsert: false,
      metadata:{originalName:safeText(req.headers['x-original-filename'],120)||'Bild'}
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

  try{
    await pruefeBereinigtenBildUpload(bild);
  }catch(error){return malwareScanReply(res,error);}

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
    'medien/' + crypto.randomUUID() + '.' + endung;

  if (!supabase) return reply(res,503,{error:'Bildspeicher ist nicht konfiguriert.'});
  const { error } = await supabase.storage
    .from('angebotsbilder')
    .upload(dateiname, bild, {
      contentType: dateityp,
      upsert: false,
      metadata:{originalName:safeText(req.headers['x-original-filename'],120)||'Bild'}
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
 `SELECT id,name,beschreibung,dauer,dauer_modus,gruppenstufen,preise,bild_url,kategorie,zielgruppe,besuchergruppen,
        veranstaltungsort,veranstaltungsorte,kapazitaet,verfuegbare_termine,hinweise,
        buchungsmodus,mindestteilnehmer,preis_pro_person,sortierung,archiviert
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
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_kundenbestaetigung_einstellungen (
  id SMALLINT PRIMARY KEY CHECK(id=1),
  verzoegerung_minuten INTEGER NOT NULL DEFAULT 120 CHECK(verzoegerung_minuten BETWEEN 1 AND 1440),
  ruhebeginn TEXT NOT NULL DEFAULT '18:00' CHECK(ruhebeginn ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ruheende TEXT NOT NULL DEFAULT '09:00' CHECK(ruheende ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`);
      await pool.query(`INSERT INTO brilon_kundenbestaetigung_einstellungen
  (id,verzoegerung_minuten,ruhebeginn,ruheende)
  SELECT 1,
    CASE WHEN data->>'kundenbestaetigungVerzoegerungMinuten' ~ '^[0-9]{1,4}$'
      AND (data->>'kundenbestaetigungVerzoegerungMinuten')::integer BETWEEN 1 AND 1440
      THEN (data->>'kundenbestaetigungVerzoegerungMinuten')::integer ELSE 120 END,
    CASE WHEN data->>'kundenbestaetigungRuhebeginn' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      THEN data->>'kundenbestaetigungRuhebeginn' ELSE '18:00' END,
    CASE WHEN data->>'kundenbestaetigungRuheende' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      THEN data->>'kundenbestaetigungRuheende' ELSE '09:00' END
  FROM brilon_rechnungsdaten WHERE id=1
  ON CONFLICT(id) DO NOTHING`);
      console.log('Einsatzplanungsschema geprüft');
    }else{
      console.warn('Einsatzplanungsschema zurückgestellt: Grundtabellen noch nicht vorhanden.');
    }

}

async function ensureKundenbestaetigungEinstellungen(){
  // Keep this small settings table available even when the broad staffing migration
  // has already been switched off after its first run.
  await pool.query('SELECT 1 FROM brilon_kundenbestaetigungen LIMIT 0');
  await pool.query(`CREATE TABLE IF NOT EXISTS brilon_kalender_einsaetze (
    kalender_id UUID NOT NULL REFERENCES brilon_kalender(id) ON DELETE CASCADE,
    mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('beworben','eingeteilt','bestaetigt','abgelehnt','abgeschlossen')),
    bewerbung_am TIMESTAMPTZ,
    zugewiesen_am TIMESTAMPTZ,
    bestaetigt_am TIMESTAMPTZ,
    aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(kalender_id,mitarbeiter_id)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS brilon_kalender_einsaetze_mitarbeiter_idx ON brilon_kalender_einsaetze(mitarbeiter_id,status)');
  await pool.query('ALTER TABLE brilon_kalender ADD COLUMN IF NOT EXISTS bewerbung_oeffentlich_ab TIMESTAMPTZ');
  const assignments=await pool.query("SELECT to_regclass('public.brilon_einsaetze') AS table_name");
  if(assignments.rows[0]?.table_name)
    await pool.query("ALTER TABLE brilon_einsaetze ADD COLUMN IF NOT EXISTS anschluss_option TEXT CHECK(anschluss_option IN ('keine','davor','danach','beides'))");
  await pool.query(`CREATE TABLE IF NOT EXISTS brilon_kundenbestaetigung_einstellungen (
    id SMALLINT PRIMARY KEY CHECK(id=1),
    verzoegerung_minuten INTEGER NOT NULL DEFAULT 120 CHECK(verzoegerung_minuten BETWEEN 1 AND 1440),
    ruhebeginn TEXT NOT NULL DEFAULT '18:00' CHECK(ruhebeginn ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    ruheende TEXT NOT NULL DEFAULT '09:00' CHECK(ruheende ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`INSERT INTO brilon_kundenbestaetigung_einstellungen
    (id,verzoegerung_minuten,ruhebeginn,ruheende)
    SELECT 1,
      CASE WHEN data->>'kundenbestaetigungVerzoegerungMinuten' ~ '^[0-9]{1,4}$'
        AND (data->>'kundenbestaetigungVerzoegerungMinuten')::integer BETWEEN 1 AND 1440
        THEN (data->>'kundenbestaetigungVerzoegerungMinuten')::integer ELSE 120 END,
      CASE WHEN data->>'kundenbestaetigungRuhebeginn' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        THEN data->>'kundenbestaetigungRuhebeginn' ELSE '18:00' END,
      CASE WHEN data->>'kundenbestaetigungRuheende' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        THEN data->>'kundenbestaetigungRuheende' ELSE '09:00' END
    FROM brilon_rechnungsdaten WHERE id=1
    ON CONFLICT(id) DO NOTHING`);
}

async function start(){
  if(pool){
    await pool.query('SELECT 1');
    if(process.env.RUN_PROGRAM_GROUPS_MIGRATION==='true'){
      const offerTable=await pool.query("SELECT to_regclass('public.brilon_angebote') AS relation");
      if(offerTable.rows[0]?.relation){
        await pool.query("ALTER TABLE brilon_angebote ADD COLUMN IF NOT EXISTS besuchergruppen JSONB NOT NULL DEFAULT '[]'::jsonb");
        console.log('Programm-Gruppenzuordnungsspalte geprüft (RUN_PROGRAM_GROUPS_MIGRATION=true)');
      }else{
        console.log('Programm-Gruppenzuordnungsmigration übersprungen: brilon_angebote wird separat initialisiert.');
      }
    }
    if(process.env.RUN_INVOICE_MIGRATION==='true'){
      const sql=fs.readFileSync(path.join(__dirname,'db/migrations/2026-11-06-rechnungen-agb.sql'),'utf8');
      await pool.query(sql);
      console.log('Rechnungs- und AGB-Schema geprüft (RUN_INVOICE_MIGRATION=true)');
    }
    try{
      const cleaned=await pool.query(`UPDATE brilon_rechnungsdaten
        SET data=jsonb_set(data,'{agbText}',to_jsonb(regexp_replace(data->>'agbText',E'^MUSTER[^\\n]*\\n[[:space:]]*\\n','')),true),
            aktualisiert_am=NOW()
        WHERE id=1 AND data->>'agbText' LIKE 'MUSTER – bitte vor der Veröffentlichung%'`);
      if(cleaned.rowCount)console.log('Musterhinweis aus der AGB-Fassung entfernt.');
    }catch(error){if(error.code!=='42P01')console.warn('AGB-Musterhinweis konnte nicht bereinigt werden:',error.message);}
    try{
      const published=await pool.query(`UPDATE brilon_rechnungsdaten
        SET data=data||jsonb_build_object('agbAktiv',true,'agbInitialfassungAktiviert',true),aktualisiert_am=NOW()
        WHERE id=1 AND data->>'agbAktiv'='false'
          AND COALESCE(data->>'agbInitialfassungAktiviert','false')<>'true'
          AND data->>'agbText' LIKE '1. Buchung und Zahlung%'
          AND data->>'agbText' LIKE '%25 % Anzahlung%'
          AND data->>'agbText' LIKE '%zehn Kalendertage%'
          AND data->>'agbText' LIKE '%geringerer Schaden%'`);
      if(published.rowCount)console.log('Bereinigte AGB-Erstfassung veröffentlicht.');
    }catch(error){if(error.code!=='42P01')console.warn('AGB-Fassung konnte nicht aktiviert werden:',error.message);}
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
    // Separate, explicit one-time opt-in for the venue settings table.
    // This stays independent of both session initialization and broad schema migrations.
    if(process.env.RUN_PLACES_MIGRATION==='true'){
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_orte(
        id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL UNIQUE,aktiv BOOLEAN NOT NULL DEFAULT true,
        erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
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
        ADD COLUMN IF NOT EXISTS besuchergruppen JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS veranstaltungsort TEXT NOT NULL DEFAULT 'Brilon',
        ADD COLUMN IF NOT EXISTS kapazitaet INTEGER NOT NULL DEFAULT 20,
        ADD COLUMN IF NOT EXISTS verfuegbare_termine JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS hinweise TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS buchbar BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS veroeffentlicht BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS buchungsmodus TEXT NOT NULL DEFAULT 'gruppe',
        ADD COLUMN IF NOT EXISTS mindestteilnehmer INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS preis_pro_person NUMERIC(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS sortierung INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS archiviert BOOLEAN NOT NULL DEFAULT false`);
      console.log('Angebotsfelder geprüft (RUN_PROGRAM_FIELDS_MIGRATION=true)');
    }
    // One-time, narrowly scoped migration for the employee and station-inspection area.
    // This does not run the booking, offers, or GPS schema migrations.
    if(process.env.RUN_PRUEF_SCHEMA_MIGRATION==='true'){
      await pool.query(`CREATE TABLE IF NOT EXISTS brilon_orte(
        id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL UNIQUE,aktiv BOOLEAN NOT NULL DEFAULT true,
        erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      await pool.query('ALTER TABLE brilon_orte ADD COLUMN IF NOT EXISTS aktiv BOOLEAN NOT NULL DEFAULT true');
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
    await pool.query('ALTER TABLE brilon_pruef_tablets ADD COLUMN IF NOT EXISTS ort_id BIGINT REFERENCES brilon_orte(id)');
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_tablets_ort_idx ON brilon_pruef_tablets(ort_id)');
    await pool.query('ALTER TABLE brilon_pruef_tablets ADD COLUMN IF NOT EXISTS geloescht_am TIMESTAMPTZ');
    await pool.query('ALTER TABLE brilon_pruef_codes ADD COLUMN IF NOT EXISTS tablet_id UUID REFERENCES brilon_pruef_tablets(id)');
      console.log('Mitarbeiter- und Stationsschema geprüft (RUN_PRUEF_SCHEMA_MIGRATION=true)');
    }
    // Eigenständige, additive Einmal-Migration für die Standortbindung der Werbetablets.
    // Vor produktiver Aktivierung in einer isolierten Umgebung prüfen; nach Erfolg abschalten.
    if(process.env.RUN_TABLET_SITE_MIGRATION==='true'){
      await pool.query('ALTER TABLE brilon_pruef_tablets ADD COLUMN IF NOT EXISTS ort_id BIGINT REFERENCES brilon_orte(id)');
      await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_tablets_ort_idx ON brilon_pruef_tablets(ort_id)');
      console.log('Werbetablet-Standortbindung eingerichtet (RUN_TABLET_SITE_MIGRATION=true)');
    }
    if(process.env.RUN_PRUEF_SITE_CODE_MIGRATION==='true'){
      await pool.query('ALTER TABLE brilon_pruef_codes ADD COLUMN IF NOT EXISTS ort_id BIGINT REFERENCES brilon_orte(id)');
      await pool.query('ALTER TABLE brilon_pruef_sessions ADD COLUMN IF NOT EXISTS ort_id BIGINT REFERENCES brilon_orte(id)');
      await pool.query('DROP INDEX IF EXISTS brilon_pruef_tablets_ein_display_idx');
      console.log('Standortgebundene Prüfcodeausgabe eingerichtet (RUN_PRUEF_SITE_CODE_MIGRATION=true)');
    }
    // Additiver Einmal-Schritt für gelöschte Tablet-Verbindungen.
    // Vergangene Prüfungen bleiben dokumentiert, nur der Gerätezugang wird entfernt.
    if(process.env.RUN_TABLET_DELETE_MIGRATION==='true'){
      await pool.query('ALTER TABLE brilon_pruef_tablets ADD COLUMN IF NOT EXISTS geloescht_am TIMESTAMPTZ');
      console.log('Tablet-Löschfunktion eingerichtet (RUN_TABLET_DELETE_MIGRATION=true)');
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
    // Narrow, one-time migration: calendar entries can be scoped to active locations.
    if(process.env.RUN_CALENDAR_LOCATION_MIGRATION==='true'){
      await pool.query("ALTER TABLE brilon_kalender ADD COLUMN IF NOT EXISTS standorte TEXT[] NOT NULL DEFAULT '{}'");
      console.log('Standortzuordnung für Kalendereinträge geprüft (RUN_CALENDAR_LOCATION_MIGRATION=true)');
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
      ADD COLUMN IF NOT EXISTS besuchergruppen JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS veranstaltungsort TEXT NOT NULL DEFAULT 'Brilon',
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
      ADD COLUMN IF NOT EXISTS archiviert BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS veranstaltungsorte JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await pool.query(`UPDATE brilon_angebote SET veranstaltungsorte=jsonb_build_array(veranstaltungsort)
      WHERE jsonb_array_length(CASE WHEN jsonb_typeof(veranstaltungsorte)='array' THEN veranstaltungsorte ELSE '[]'::jsonb END)=0`);
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
    await pool.query('ALTER TABLE brilon_pruef_tablets ADD COLUMN IF NOT EXISTS ort_id BIGINT REFERENCES brilon_orte(id)');
    await pool.query('CREATE INDEX IF NOT EXISTS brilon_pruef_tablets_ort_idx ON brilon_pruef_tablets(ort_id)');
    await pool.query('ALTER TABLE brilon_pruef_tablets ADD COLUMN IF NOT EXISTS geloescht_am TIMESTAMPTZ');
    await pool.query('ALTER TABLE brilon_pruef_codes ADD COLUMN IF NOT EXISTS tablet_id UUID REFERENCES brilon_pruef_tablets(id)');
    } else {
      console.log('Schemaänderungen übersprungen (RUN_SCHEMA_MIGRATIONS ist nicht true)');
    }
    if(process.env.MOCK_PG!=='1'){
      await pool.query(`ALTER TABLE brilon_angebote
        ADD COLUMN IF NOT EXISTS veranstaltungsorte JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS dauer_modus TEXT NOT NULL DEFAULT 'gruppenstufe',
        ADD COLUMN IF NOT EXISTS gruppenstufen JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await pool.query(`UPDATE brilon_angebote SET veranstaltungsorte=jsonb_build_array(veranstaltungsort)
        WHERE jsonb_array_length(CASE WHEN jsonb_typeof(veranstaltungsorte)='array' THEN veranstaltungsorte ELSE '[]'::jsonb END)=0`);
      console.log('Programmstandorte geprüft und vorhandene Standorte übernommen');
    }
    if(process.env.RUN_SCHEMA_MIGRATIONS==='true'||process.env.RUN_STAFFING_MIGRATION==='true')
      await migrateEinsatzplanung();
    if(process.env.MOCK_PG!=='1'){
      try{
        await ensureKundenbestaetigungEinstellungen();
        await pool.query('SELECT buchung_id FROM brilon_kundenbestaetigungen LIMIT 0');
        const confirmationTimer=setInterval(()=>{
          kundenService.processQueue().catch(error=>console.error('Kundenbestätigungen prüfen:',error.message));
        },60_000);
        confirmationTimer.unref();
        kundenService.processQueue().catch(error=>console.error('Kundenbestätigungen bei Start:',error.message));
      }catch(error){console.warn('Automatische Kundenbestätigung oder Zeiteinstellungen nicht gestartet:',error.message);}
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
    // Diagnose beim Start: niemals Geheimnisse oder Codes ausgeben.
    if(process.env.MOCK_PG!=='1'){
      try{
        const required=['brilon_pruef_tablet_kopplungen','brilon_pruef_tablets','brilon_pruef_codes'];
        const names=await pool.query('SELECT relname FROM pg_class WHERE relkind IN (\'r\',\'p\') AND relname = ANY($1::text[])',[required]);
        const missing=required.filter(name=>!names.rows.some(row=>row.relname===name));
        const configured=typeof process.env.STATION_CHECK_SECRET==='string'&&
          process.env.STATION_CHECK_SECRET.length>=32;
        console.log('Tablet-Kopplung Status:',missing.length?'Tabellen fehlen: '+missing.join(', '):'Tabellen bereit',
          configured?'Sicherheitsgeheimnis bereit':'Sicherheitsgeheimnis fehlt');
      }catch(error){
        console.warn('Tablet-Kopplung Vorprüfung nicht verfügbar:',error?.code||'DB_FEHLER');
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



