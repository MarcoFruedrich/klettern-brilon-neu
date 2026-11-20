'use strict';
const crypto=require('node:crypto');

function createEinsatzRueckmeldungMailer({pool,brevoMail,env=process.env}){
  if(!pool||typeof pool.query!=='function'||typeof brevoMail!=='function')
    throw new TypeError('Einsatzrückmeldung benötigt Datenbank und E-Mail-Anbieter.');

  async function abschliessen(buchungId,staffId,versuch,protokoll){
    const q=await pool.query(
      "UPDATE brilon_buchungen SET data=jsonb_set(COALESCE(data,'{}'::jsonb),"+
      "'{mitarbeiterRueckmeldungen}',"+
      "COALESCE(data->'mitarbeiterRueckmeldungen','{}'::jsonb) || "+
      "jsonb_build_object($2::text,$4::jsonb),true),updated_at=NOW() "+
      "WHERE id=$1 AND data #>> ARRAY['mitarbeiterRueckmeldungen',$2::text,'versuch']=$3 "+
      "AND data #>> ARRAY['mitarbeiterRueckmeldungen',$2::text,'status']='wird_versendet' RETURNING id",
      [buchungId,staffId,versuch,JSON.stringify(protokoll)]);
    if(q.rowCount!==1)throw Error('Versandstatus konnte nicht eindeutig gespeichert werden.');
  }

  async function informiere({buchungId,mitarbeiterId,mitarbeiterName,entscheidung,anschlussOption}){
    if(!/^[a-f0-9-]{36}$/i.test(String(mitarbeiterId))||
      !['bestaetigt','abgelehnt'].includes(entscheidung))
      throw new RangeError('Ungültige Mitarbeiter-Rückmeldung.');
    const versuch=crypto.randomUUID(),zeit=new Date().toISOString();
    const basis={versuch,entscheidung,versuchtAm:zeit};
    const reserve=await pool.query(
      "UPDATE brilon_buchungen SET data=jsonb_set(COALESCE(data,'{}'::jsonb),"+
      "'{mitarbeiterRueckmeldungen}',"+
      "COALESCE(data->'mitarbeiterRueckmeldungen','{}'::jsonb) || "+
      "jsonb_build_object($2::text,$3::jsonb),true),updated_at=NOW() "+
      "WHERE id=$1 AND COALESCE(data #>> ARRAY['mitarbeiterRueckmeldungen',$2::text,'status'],'') "+
      "NOT IN ('wird_versendet','angenommen','unklar') RETURNING data",
      [buchungId,mitarbeiterId,JSON.stringify({...basis,status:'wird_versendet'})]);
    if(!reserve.rowCount)return {status:'bereits_bearbeitet',blockiert:true};

    const book=reserve.rows[0].data||{};
    const adminEmail=String(env.BOOKING_NOTIFY_EMAIL||'').trim();
    if(!/^\S+@\S+\.\S+$/.test(adminEmail)){
      const entry={...basis,status:'keine_adresse',
        fehler:'Für Verwaltungsbenachrichtigungen ist keine E-Mail-Adresse hinterlegt.'};
      try{await abschliessen(buchungId,mitarbeiterId,versuch,entry);}
      catch{return {status:'unklar',blockiert:true};}
      return entry;
    }
    const clean=x=>String(x??'').replace(/[\r\n]+/g,' ').trim().slice(0,160);
    const subject=entscheidung==='bestaetigt'?'Mitarbeiterzusage: ':'Mitarbeiterabsage: ';
    const text=[
      'Mitarbeiter-Rückmeldung zu einer Buchung.',
      '',
      'Mitarbeiter: '+clean(mitarbeiterName||mitarbeiterId),
      'Entscheidung: '+(entscheidung==='bestaetigt'?'Zusage':'Absage'),
      'Buchungsnummer: '+clean(book.buchungsnummer||'—'),
      'Programm: '+clean(book.angebot||'—'),
      'Standort: '+clean(book.veranstaltungsort||'—'),
      'Termin: '+clean(book.datum||'—')+' '+clean(book.uhrzeit||'')+' Uhr',
      'Anschlussoption: '+clean(entscheidung==='bestaetigt'?anschlussOption||'keine':'entfällt'),
      '',
      'Die Rückmeldung ist in der Einsatzplanung gespeichert. Bitte dort die weiteren Einteilungen prüfen.',
      'Klettern & Abenteuer'
    ].join('\n');
    let mailError;
    try{
      await brevoMail(adminEmail,subject+clean(book.angebot||'Programm')+' · '+clean(book.datum||''),
        text,{idempotencyKey:versuch});
    }catch(error){mailError=error;}
    const entry=mailError
      ?{...basis,status:mailError.uncertain?'unklar':'fehlgeschlagen',
        fehler:String(mailError.code||mailError.message||'Unbekannter Fehler').slice(0,160)}
      :{...basis,status:'angenommen',angenommenAm:new Date().toISOString()};
    try{await abschliessen(buchungId,mitarbeiterId,versuch,entry);}
    catch{return {status:'unklar',blockiert:true,
      hinweis:'Mailstatus beim Anbieter und Buchungseintrag müssen geprüft werden.'};}
    return entry;
  }
  return informiere;
}

module.exports={createEinsatzRueckmeldungMailer};
