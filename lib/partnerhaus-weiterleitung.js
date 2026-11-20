'use strict';
const crypto=require('node:crypto');

const emailValid=value=>typeof value==='string'&&value.length<=254&&/^\S+@\S+\.\S+$/.test(value);
const flat=value=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,200);

function partnerNachricht(data){
  const lines=[
    'Guten Tag'+(data.partnerhausKontaktName?' '+flat(data.partnerhausKontaktName):'')+',',
    '',
    'Die Verwaltung hat die Verfügbarkeit der folgenden Anfrage geprüft.',
    'Bitte übernehmen Sie die verbindliche Buchung und Abrechnung direkt mit dem Gast.',
    '',
    'Programm: '+flat(data.angebot||'—'),
    'Termin: '+flat(data.datum||'—')+(data.uhrzeit?' um '+flat(data.uhrzeit)+' Uhr':''),
    'Standort: '+flat(data.veranstaltungsort||'—'),
    'Teilnehmende: '+flat(data.teilnehmer||'—'),
    'Anfragende Person: '+flat(data.name||'—'),
    'E-Mail: '+flat(data.email||'—'),
    'Buchungsnummer: '+flat(data.buchungsnummer||'—'),
    '',
    'Bitte klären Sie die Buchung und Zahlungsfragen direkt mit dem Gast.',
    'Die Website stellt für diese Partnerhaus-Anfrage keine Kundenrechnung.',
    '',
    'Viele Grüße',
    'Klettern & Abenteuer'
  ];
  return lines.join('\n');
}

function createPartnerhausWeiterleitung({pool,brevoMail}){
  if(!pool||typeof pool.query!=='function'||typeof brevoMail!=='function')
    throw new TypeError('Partnerhaus-Weiterleitung benötigt Datenbank und E-Mail-Anbieter.');

  async function statusLesen(id){
    const q=await pool.query(
      "SELECT status,data #>> '{partnerhausWeiterleitung,status}' AS mail_status "+
      "FROM brilon_buchungen WHERE id=$1",[id]);
    return q.rows[0]||null;
  }
  async function statusSpeichern(id,versuch,record){
    const q=await pool.query(
      "UPDATE brilon_buchungen SET data=jsonb_set(COALESCE(data,'{}'::jsonb),"+
      "'{partnerhausWeiterleitung}',$3::jsonb,true),updated_at=NOW() "+
      "WHERE id=$1 AND data #>> '{partnerhausWeiterleitung,versuch}'=$2 "+
      "AND data #>> '{partnerhausWeiterleitung,status}'='wird_versendet' RETURNING id",
      [id,versuch,JSON.stringify(record)]);
    if(q.rowCount!==1)throw new Error('Weiterleitungsstatus konnte nicht eindeutig gespeichert werden.');
  }
  return async function partnerhausWeiterleiten(buchungId){
    const versuch=crypto.randomUUID();
    const reserved=await pool.query(
      "UPDATE brilon_buchungen SET data=jsonb_set(COALESCE(data,'{}'::jsonb),"+
      "'{partnerhausWeiterleitung}',jsonb_build_object("+
      "'status','wird_versendet','versuch',$2::text,'reserviertAm',NOW()::text),true),updated_at=NOW() "+
      "WHERE id=$1 AND status='bestaetigt' AND data->>'partnerhausAbwicklung'='true' "+
      "AND COALESCE(data #>> '{partnerhausWeiterleitung,status}','') "+
      "NOT IN ('wird_versendet','angenommen','unklar') RETURNING data",
      [buchungId,versuch]);
    if(!reserved.rowCount){
      const current=await statusLesen(buchungId);
      if(!current)return {status:'nicht_gefunden',blockiert:true};
      if(current.status!=='bestaetigt')return {status:'nicht_anwendbar',blockiert:true};
      if(current.mail_status==='angenommen')return {status:'bereits_angenommen',blockiert:true};
      return {status:current.mail_status||'nicht_anwendbar',blockiert:true,
        hinweis:'Weiterleitung läuft bereits oder muss in der Verwaltung geprüft werden.'};
    }
    const data=reserved.rows[0].data||{};
    const empfaenger=String(data.partnerhausKontaktEmail||'').trim();
    const zeit=new Date().toISOString();
    const basis={versuch,empfaenger,versuchtAm:zeit};
    if(!emailValid(empfaenger)){
      const problem={...basis,status:'ohne_empfaenger',
        fehler:'Es ist keine gültige Partnerhaus-Kontaktadresse hinterlegt.'};
      try{await statusSpeichern(buchungId,versuch,problem);}
      catch{return {status:'unklar',blockiert:true,
        hinweis:'Partnerhaus-Adresse fehlt; Fehlerstatus konnte nicht gespeichert werden.'};}
      return problem;
    }

    let error;
    try{
      await brevoMail(empfaenger,
        'Verfügbarkeit geprüft: '+flat(data.angebot||'Programm')+' am '+flat(data.datum||'Termin'),
        partnerNachricht(data),{idempotencyKey:versuch});
    }catch(e){error=e;}
    if(error){
      const record={...basis,status:error.uncertain?'unklar':'fehlgeschlagen',
        fehler:String(error.code||error.message||'Versandfehler').replace(/[\r\n]+/g,' ').slice(0,150)};
      try{await statusSpeichern(buchungId,versuch,record);}
      catch{return {status:'unklar',blockiert:true,hinweis:'Versand und Protokollierung müssen geprüft werden.'};}
      return record;
    }
    const angenommen={...basis,status:'angenommen',angenommenAm:new Date().toISOString()};
    try{await statusSpeichern(buchungId,versuch,angenommen);}
    catch{return {status:'unklar',blockiert:true,
      hinweis:'E-Mail wurde vom Anbieter angenommen, aber die Protokollierung muss geprüft werden.'};}
    return angenommen;
  };
}
module.exports={createPartnerhausWeiterleitung};
