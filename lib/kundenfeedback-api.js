'use strict';
const crypto=require('node:crypto');
const {heuteInBerlin}=require('./kalendertag');
const FEEDBACK_CONSENT_VERSION='2026-11-05-v1';
function createKundenfeedbackApi({pool,admin,reply,body,sameOriginMutation,limit,brevoMail}){
  return async function(req,res,u,route,ip){
    if(!pool)return reply(res,503,{error:'Feedback kann derzeit nicht gespeichert werden.'});
    if(route==='/api/kundenfeedback'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
      if(!limit('kundenfeedback:'+ip,5,600000))return reply(res,429,{error:'Zu viele Versuche. Bitte später erneut versuchen.'});
      const d=await body(req,8000),buchungsnummer=typeof d.buchungsnummer==='string'?d.buchungsnummer.trim():'';
      const programm=Number(d.programmBewertung),mitarbeiter=Number(d.mitarbeiterBewertung),sicherheit=Number(d.sicherheitsBewertung);
      const veraenderungen=typeof d.veraenderungen==='string'?d.veraenderungen.trim():'';
      const ideen=typeof d.ideen==='string'?d.ideen.trim():'';
      if(buchungsnummer.length<3||buchungsnummer.length>40||
         ![programm,mitarbeiter,sicherheit].every(value=>Number.isInteger(value)&&value>=1&&value<=5)||
         veraenderungen.length>2000||ideen.length>2000||d.datenschutz!==true)
        return reply(res,400,{error:'Bitte Kundennummer, alle drei Bewertungen und die Datenschutzeinwilligung prüfen.'});
      const client=await pool.connect();let customer;
      try{
        await client.query('BEGIN');
        const booking=await client.query(`SELECT id,buchungsnummer,data,status FROM brilon_buchungen
          WHERE buchungsnummer=$1 OR data->>'buchungsnummer'=$1 FOR SHARE`,[buchungsnummer]);
        if(!booking.rowCount){await client.query('ROLLBACK');return reply(res,404,{error:'Kundennummer wurde nicht gefunden. Bitte die Nummer aus deiner Buchungsbestätigung prüfen.'});}
        const row=booking.rows[0],data=row.data||{};
        if(row.status!=='bestaetigt'||typeof data.datum!=='string'||data.datum>=heuteInBerlin()){
          await client.query('ROLLBACK');return reply(res,409,{error:'Feedback ist nach einem bestätigten und bereits stattgefundenen Termin möglich.'});
        }
        const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
        if(!/^\S+@\S+\.\S+$/.test(email)){
          await client.query('ROLLBACK');return reply(res,409,{error:'Zu dieser Buchung ist keine gültige E-Mail-Adresse hinterlegt. Bitte melde dich unter info@klettern-abenteuer.de.'});
        }
        const already=await client.query('SELECT 1 FROM brilon_kundenfeedback WHERE buchung_id=$1',[row.id]);
        if(already.rowCount){await client.query('ROLLBACK');return reply(res,409,{error:'Zu dieser Kundennummer wurde bereits Feedback abgegeben.'});}
        await client.query(`INSERT INTO brilon_kundenfeedback
          (id,buchung_id,buchungsnummer,programm_bewertung,mitarbeiter_bewertung,sicherheits_bewertung,
           veraenderungen,ideen,einwilligung_am,einwilligung_version)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9)`,[crypto.randomUUID(),row.id,row.buchungsnummer||data.buchungsnummer||buchungsnummer,
          programm,mitarbeiter,sicherheit,veraenderungen||null,ideen||null,FEEDBACK_CONSENT_VERSION]);
        await client.query('COMMIT');customer={email,name:typeof data.name==='string'?data.name.trim():'',
          programm:typeof data.angebot==='string'?data.angebot.trim():'das Programm',
          nummer:row.buchungsnummer||data.buchungsnummer||buchungsnummer};
      }catch(error){
        await client.query('ROLLBACK');
        if(error.code==='23505')return reply(res,409,{error:'Zu dieser Kundennummer wurde bereits Feedback abgegeben.'});
        if(error.code==='42P01')return reply(res,503,{error:'Die Feedbackfunktion wird gerade eingerichtet. Bitte später erneut versuchen.'});
        throw error;
      }finally{client.release();}
      const answer=`Programm: ${programm}/5\nMitarbeiter: ${mitarbeiter}/5\nSicherheitsgefühl: ${sicherheit}/5\nVeränderungsvorschläge: ${veraenderungen||'Keine Angabe'}\nZusätzliche Angebotsideen: ${ideen||'Keine Angabe'}`;
      let emailVersand='gesendet';
      try{await brevoMail(customer.email,'Dein Feedback zum Programm – Klettern & Abenteuer Brilon',
        `Hallo${customer.name?' '+customer.name:''},\n\nvielen Dank für dein vertrauliches Feedback zum Programm „${customer.programm}“ (Kundennummer ${customer.nummer}). Hier ist eine Kopie deiner Antworten:\n\n${answer}\n\nDeine Antworten werden nur von der Verwaltung eingesehen und intern zur Auswertung verwendet.\n\nKlettern & Abenteuer Brilon`);
      }catch(error){emailVersand=error?.uncertain?'versand_ungeklaert':'fehlgeschlagen';console.warn('Feedbackbestätigung konnte nicht versandt werden.',error?.code||'MAIL_ERROR');}
      return reply(res,201,{success:true,emailVersand});
    }
    if(route==='/api/admin/kundenfeedback'&&req.method==='GET'){
      if(!await admin(req,res))return;
      try{
        const [summary,items]=await Promise.all([
          pool.query(`SELECT COUNT(*)::int AS anzahl,
            ROUND(AVG(programm_bewertung)::numeric,2) AS programm,
            ROUND(AVG(mitarbeiter_bewertung)::numeric,2) AS mitarbeiter,
            ROUND(AVG(sicherheits_bewertung)::numeric,2) AS sicherheit
            FROM brilon_kundenfeedback`),
          pool.query(`SELECT f.id,f.buchungsnummer,f.programm_bewertung,f.mitarbeiter_bewertung,
            f.sicherheits_bewertung,f.veraenderungen,f.ideen,f.erstellt_am,
            b.data->>'name' AS kunde,b.data->>'email' AS email,b.data->>'angebot' AS programm,
            b.data->>'datum' AS datum
            FROM brilon_kundenfeedback f JOIN brilon_buchungen b ON b.id=f.buchung_id
            ORDER BY f.erstellt_am DESC,f.id LIMIT 200`)
        ]);
        return reply(res,200,{statistik:summary.rows[0],eintraege:items.rows});
      }catch(error){if(error.code==='42P01')return reply(res,503,{error:'Die Feedbackfunktion ist noch nicht freigeschaltet.'});throw error;}
    }
    return reply(res,404,{error:'Nicht gefunden.'});
  };
}
module.exports={createKundenfeedbackApi};
