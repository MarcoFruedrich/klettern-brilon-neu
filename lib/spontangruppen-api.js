'use strict';
const crypto=require('node:crypto');
const {createPartnerInvoicePdf,formatDate}=require('./rechnung');
const {heuteInBerlin}=require('./kalendertag');

function createSpontanGruppenApi({pool,admin,staffSession,reply,body,sameOriginMutation,limit,brevoMail,env=process.env}){
  const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
  const validUuid=value=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value);
  const validEmail=value=>typeof value==='string'&&value.length<=180&&/^\S+@\S+\.\S+$/.test(value);
  async function board(sessionId){
    const [totals,slots,price]=await Promise.all([
      pool.query(`SELECT COUNT(*) FILTER(WHERE interesse)::int AS interessierte,
          COALESCE(SUM(personen) FILTER(WHERE interesse),0)::int AS personen
        FROM brilon_spontan_teilnahmen WHERE session_id=$1`,[sessionId]),
      pool.query(`SELECT s.id,s.datum,s.uhrzeit,s.gruppe_bestaetigt_am,s.mail_status,
          COUNT(v.teilnahme_id)::int AS stimmen,COALESCE(SUM(t.personen),0)::int AS personen
        FROM brilon_spontan_zeiten s LEFT JOIN brilon_spontan_zeitstimmen v ON v.zeit_id=s.id
        LEFT JOIN brilon_spontan_teilnahmen t ON t.session_id=s.session_id AND t.teilnahme_id=v.teilnahme_id AND t.interesse=true
        WHERE s.session_id=$1 AND s.datum>=CURRENT_DATE
        GROUP BY s.id ORDER BY s.datum,s.uhrzeit`,[sessionId]),
      pool.query(`SELECT e.preis_pro_person_cent FROM brilon_spontan_sessions s
        LEFT JOIN brilon_spontan_einstellungen e ON e.standort_id=s.standort_id WHERE s.id=$1`,[sessionId])
    ]);
    return {interessierte:totals.rows[0]?.interessierte||0,personen:totals.rows[0]?.personen||0,
      preisProPersonCent:price.rows[0]?.preis_pro_person_cent??null,zeiten:slots.rows};
  }
  async function staffForPlace(req,ortId){
    const staff=staffSession?await staffSession(req):null;
    if(!staff)return null;
    const grant=await pool.query(`SELECT 1 FROM brilon_pruef_freigaben f
      JOIN brilon_orte o ON o.id=f.ort_id AND o.aktiv=true
      WHERE f.mitarbeiter_id=$1 AND f.ort_id=$2 LIMIT 1`,[staff.mitarbeiter_id,ortId]);
    return grant.rowCount?staff:null;
  }
  async function groupConfirmation(sessionId,slotId){
    const slot=await pool.query(`SELECT s.id,s.datum,s.uhrzeit,ss.standort_id,o.name AS standort,
        COALESCE(SUM(t.personen),0)::int AS personen,e.preis_pro_person_cent,e.netzwerkpartner_id
      FROM brilon_spontan_zeiten s JOIN brilon_spontan_sessions ss ON ss.id=s.session_id
      JOIN brilon_orte o ON o.id=ss.standort_id
      LEFT JOIN brilon_spontan_einstellungen e ON e.standort_id=ss.standort_id
      JOIN brilon_spontan_zeitstimmen v ON v.zeit_id=s.id
      JOIN brilon_spontan_teilnahmen t ON t.session_id=s.session_id AND t.teilnahme_id=v.teilnahme_id AND t.interesse=true
      WHERE s.id=$1 AND s.session_id=$2
      GROUP BY s.id,ss.standort_id,o.name,e.preis_pro_person_cent,e.netzwerkpartner_id`,[slotId,sessionId]);
    if(!slot.rowCount||slot.rows[0].personen<5||slot.rows[0].personen>15||slot.rows[0].preis_pro_person_cent===null||!slot.rows[0].netzwerkpartner_id)return;
    const locked=await pool.query(`UPDATE brilon_spontan_zeiten
      SET gruppe_bestaetigt_am=NOW(),mail_status='wird_gesendet'
      WHERE id=$1 AND gruppe_bestaetigt_am IS NULL RETURNING id`,[slotId]);
    if(!locked.rowCount)return;
    const guests=await pool.query(`SELECT DISTINCT t.gast_name,t.gast_email,t.personen
      FROM brilon_spontan_zeitstimmen v JOIN brilon_spontan_teilnahmen t
        ON t.session_id=$2 AND t.teilnahme_id=v.teilnahme_id
      WHERE v.zeit_id=$1 AND t.interesse=true ORDER BY t.gast_name`,[slotId,sessionId]);
    const partner=await pool.query(`SELECT COALESCE(NULLIF(BTRIM(p.programm_benachrichtigung_email),''),p.email) AS email
      FROM brilon_spontan_einstellungen e JOIN brilon_netzwerkpartner p ON p.id=e.netzwerkpartner_id AND p.aktiv=true
      WHERE e.standort_id=$1`,[slot.rows[0].standort_id]);
    const recipients=[...new Set([...partner.rows.map(row=>row.email),env.BOOKING_NOTIFY_EMAIL]
      .filter(email=>validEmail(email)).map(email=>email.trim().toLowerCase()))];
    const when=`${slot.rows[0].datum} um ${String(slot.rows[0].uhrzeit).slice(0,5)} Uhr`;
    const subject='Klettergruppe steht · '+slot.rows[0].standort+' · '+when;
    const baseRaw=env.PUBLIC_BASE_URL||'https://klettern-brilon-neu.onrender.com';
    const base=baseRaw.endsWith('/')?baseRaw.slice(0,-1):baseRaw;
    const attendanceLink=base+'/spontangruppen-anwesenheit.html';
    const guestText=guest=>`Hallo ${guest.gast_name},

die spontane Klettergruppe an der Jugendherberge ${slot.rows[0].standort} kommt zustande.

Termin: ${when}
Angemeldete Gruppe: ${slot.rows[0].personen} Personen
Deine Anmeldung: ${guest.personen} Person(en)
Preis je Person: ${(slot.rows[0].preis_pro_person_cent/100).toFixed(2).replace('.',',')} €
Dein voraussichtlicher Betrag: ${(guest.personen*slot.rows[0].preis_pro_person_cent/100).toFixed(2).replace('.',',')} €

Abrechnung und Rechnung erfolgen über die Jugendherberge ${slot.rows[0].standort}.

Bitte melde dich bei Änderungen rechtzeitig bei der Jugendherberge. Der Termin wird vor Ort durch das Team begleitet.

Viele Grüße
Klettern & Abenteuer`;
    const venueText=`Die spontane Klettergruppe ist zustande gekommen.

Standort: ${slot.rows[0].standort}
Termin: ${when}
Angemeldete Gruppe: ${slot.rows[0].personen} Personen
Preis je Person: ${(slot.rows[0].preis_pro_person_cent/100).toFixed(2).replace('.',',')} €
Gesamtbetrag der angemeldeten Gruppe: ${(slot.rows[0].personen*slot.rows[0].preis_pro_person_cent/100).toFixed(2).replace('.',',')} €
Gäste: ${guests.rows.map(g=>g.gast_name+' ('+g.personen+') · '+g.gast_email).join(String.fromCharCode(10))}

Rechnung und Abrechnung erfolgen über die Jugendherberge.

Anwesenheitsliste für das Team: ${attendanceLink}`;
    const results=await Promise.allSettled([
      ...guests.rows.filter(g=>validEmail(g.gast_email)).map(g=>brevoMail(g.gast_email,subject,guestText(g))),
      ...recipients.map(email=>brevoMail(email,subject,venueText))
    ]);
    const mailStatus=results.length&&results.every(item=>item.status==='fulfilled')?'gesendet':'teilweise_fehlgeschlagen';
    await pool.query('UPDATE brilon_spontan_zeiten SET mail_status=$2 WHERE id=$1',[slotId,mailStatus]);
  }
  const invoiceDataForRow=row=>typeof row.data==='string'?JSON.parse(row.data):row.data;
  async function sendPartnerInvoice(invoice){
    const data=invoiceDataForRow(invoice),email=data.partner?.email;
    if(!validEmail(email))return {status:'ohne_empfaenger'};
    if(invoice.email_status==='angenommen')return {status:'angenommen',nummer:invoice.rechnungsnummer};
    const pdf=Buffer.from(invoice.pdf);
    try{
      await brevoMail(email,'Partnerabrechnung / Rechnung '+invoice.rechnungsnummer,
        'Guten Tag '+(data.partner.unternehmen||data.partner.name||'')+',\n\nanbei erhalten Sie die Rechnung '+invoice.rechnungsnummer+
          ' für die durchgeführte spontane Klettergruppe. Die Abrechnung weist Teilnehmer, E-Mail-Adressen, tatsächliche Personenzahlen und den vereinbarten Partnerabzug aus.\n\nViele Grüße\n'+
          (data.aussteller?.firma||'Klettern & Abenteuer'),
        {idempotencyKey:'netzwerkpartner-'+invoice.id,attachments:[{name:'Rechnung-'+invoice.rechnungsnummer+'.pdf',content:pdf.toString('base64')}]});
      await pool.query("UPDATE brilon_netzwerkpartner_abrechnungen SET email_status='angenommen',email_fehler=NULL,versandt_am=NOW() WHERE id=$1",[invoice.id]);
      return {status:'angenommen',nummer:invoice.rechnungsnummer};
    }catch(error){
      const state=error?.uncertain?'unklar':'fehlgeschlagen';
      await pool.query('UPDATE brilon_netzwerkpartner_abrechnungen SET email_status=$1,email_fehler=$2 WHERE id=$3',
        [state,String(error?.message||'').slice(0,250),invoice.id]);
      return {status:state,nummer:invoice.rechnungsnummer};
    }
  }
  async function preparePartnerInvoice(zeitId,staff){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const event=await client.query(`SELECT s.id,s.session_id,s.datum,s.uhrzeit,s.abgeschlossen_am,ss.standort_id,o.name AS standort
        FROM brilon_spontan_zeiten s JOIN brilon_spontan_sessions ss ON ss.id=s.session_id
        JOIN brilon_orte o ON o.id=ss.standort_id WHERE s.id=$1 AND s.gruppe_bestaetigt_am IS NOT NULL FOR UPDATE OF s`,[zeitId]);
      if(!event.rowCount)throw Object.assign(new Error('Bestätigte Gruppe wurde nicht gefunden.'),{status:404});
      const existing=await client.query('SELECT * FROM brilon_netzwerkpartner_abrechnungen WHERE zeit_id=$1',[zeitId]);
      if(existing.rowCount){await client.query('COMMIT');return existing.rows[0];}
      const unchecked=await client.query(`SELECT COUNT(*)::int AS anzahl FROM brilon_spontan_zeitstimmen v
        JOIN brilon_spontan_teilnahmen t ON t.session_id=$2 AND t.teilnahme_id=v.teilnahme_id
        WHERE v.zeit_id=$1 AND t.interesse=true AND t.geprueft_am IS NULL`,[zeitId,event.rows[0].session_id]);
      if(unchecked.rows[0].anzahl)throw Object.assign(new Error('Bitte zuerst die Anwesenheit aller angemeldeten Gruppen speichern.'),{status:409});
      const setting=await client.query(`SELECT preis_pro_person_cent,netzwerkpartner_id,abzug_typ,abzug_wert
        FROM brilon_spontan_einstellungen WHERE standort_id=$1 FOR UPDATE`,[event.rows[0].standort_id]);
      if(!setting.rowCount||setting.rows[0].preis_pro_person_cent===null||!setting.rows[0].netzwerkpartner_id||!setting.rows[0].abzug_typ)
        throw Object.assign(new Error('Preis, Netzwerkpartner und Partnerabzug müssen in der Verwaltung hinterlegt sein.'),{status:409});
      const terms=setting.rows[0];
      const partnerQ=await client.query(`SELECT id,unternehmen,ansprechpartner,email,programm_benachrichtigung_email,
          strasse,plz,ort,telefon,weitere_angaben
        FROM brilon_netzwerkpartner WHERE id=$1 AND standort_id=$2 AND aktiv=true`,[terms.netzwerkpartner_id,event.rows[0].standort_id]);
      if(!partnerQ.rowCount)throw Object.assign(new Error('Der vereinbarte Netzwerkpartner ist nicht mehr für den Standort freigegeben.'),{status:409});
      const partnerRow=partnerQ.rows[0],partnerEmail=partnerRow.programm_benachrichtigung_email||partnerRow.email;
      if(!validEmail(partnerEmail)||!partnerRow.strasse||!partnerRow.plz||!partnerRow.ort)
        throw Object.assign(new Error('Beim Netzwerkpartner fehlen gültige Rechnungsanschrift oder E-Mail-Adresse.'),{status:409});
      const settings=await client.query('SELECT data,naechste_nummer FROM brilon_rechnungsdaten WHERE id=1 FOR UPDATE');
      if(!settings.rowCount)throw Object.assign(new Error('Rechnungsstellerdaten sind nicht eingerichtet.'),{status:409});
      const issuer=settings.rows[0].data||{};
      if(!(issuer.firma&&issuer.name&&issuer.strasse&&issuer.plz&&issuer.ort&&issuer.email&&issuer.telefon&&(issuer.steuernummer||issuer.ustIdNr||issuer.steuerhinweis)))
        throw Object.assign(new Error('Die Rechnungsstellerdaten sind unvollständig.'),{status:409});
      const guests=await client.query(`SELECT t.gast_name,t.gast_email,t.personen,t.anwesend,t.anwesend_personen
        FROM brilon_spontan_zeitstimmen v JOIN brilon_spontan_teilnahmen t
          ON t.session_id=$2 AND t.teilnahme_id=v.teilnahme_id
        WHERE v.zeit_id=$1 AND t.interesse=true ORDER BY t.gast_name`,[zeitId,event.rows[0].session_id]);
      const attended=guests.rows.reduce((sum,g)=>sum+Number(g.anwesend_personen||0),0);
      if(attended<1)throw Object.assign(new Error('Es wurde keine anwesende Person eingetragen; es wird keine Rechnung erstellt.'),{status:409});
      const rateCents=Number(terms.preis_pro_person_cent);
      if(!Number.isSafeInteger(rateCents)||rateCents<0||!Number.isSafeInteger(attended)||attended<1||
         !Number.isSafeInteger(attended*rateCents))
        throw Object.assign(new Error('Teilnehmerzahl oder Preis pro Person ist ungültig.'),{status:409});
      const grossCents=attended*rateCents,commissionValue=Number(terms.abzug_wert);
      // Invalid or negative deductions must never increase the partner invoice.
      if(!Number.isFinite(commissionValue)||commissionValue<0||
         (terms.abzug_typ==='prozent'&&commissionValue>100))
        throw Object.assign(new Error('Der Partnerabzug muss ein gültiger, nicht negativer Wert sein (Prozent maximal 100).'),{status:409});
      let deductionCents=0,commissionLabel='';
      if(terms.abzug_typ==='prozent'){
        deductionCents=Math.round(grossCents*commissionValue/100);commissionLabel='Partnerabzug ('+commissionValue.toLocaleString('de-DE')+' %)';
      }else if(terms.abzug_typ==='pro_person'){
        deductionCents=Math.round(commissionValue*100)*attended;commissionLabel='Partnerabzug ('+commissionValue.toLocaleString('de-DE')+' € je Person)';
      }else if(terms.abzug_typ==='pauschal'){
        deductionCents=Math.round(commissionValue*100);commissionLabel='Pauschaler Partnerabzug';
      }else throw Object.assign(new Error('Die Partnerabzugsart ist ungültig.'),{status:409});
      if(deductionCents>grossCents)throw Object.assign(new Error('Der vereinbarte Partnerabzug übersteigt den Rechnungsbetrag.'),{status:409});
      const netCents=grossCents-deductionCents;
      const prefix=String(issuer.rechnungsPraefix||'KA-').trim().slice(0,20)||'KA-';
      const date=heuteInBerlin(),sequence=Number(settings.rows[0].naechste_nummer)||1;
      const number=prefix+date.slice(0,4)+'-NP-'+String(sequence).padStart(4,'0');
      const items=guests.rows.map(g=>({
        name:g.gast_name||'Teilnehmer',email:g.gast_email||'',
        angemeldet:Number(g.personen||0),anwesend:Number(g.anwesend_personen||0),
        personen:Number(g.anwesend_personen||0),preisProPersonCent:rateCents,
        betragCent:Number(g.anwesend_personen||0)*rateCents
      }));
      const invoiceData={
        nummer:number,rechnungsdatum:formatDate(date),leistungsdatum:formatDate(event.rows[0].datum),
        leistungszeit:String(event.rows[0].uhrzeit).slice(0,5)+' Uhr',standort:event.rows[0].standort,angebot:'Spontane Klettergruppe',bruttoCent:grossCents,
        abzugTyp:terms.abzug_typ,abzugWert:commissionValue,abzugCent:deductionCents,
        abzugBezeichnung:commissionLabel,nettoCent:netCents,steuerhinweis:issuer.steuerhinweis||'',
        aussteller:{firma:issuer.firma,name:issuer.name,strasse:issuer.strasse,plz:issuer.plz,ort:issuer.ort,
          email:issuer.email,telefon:issuer.telefon,steuernummer:issuer.steuernummer,ustIdNr:issuer.ustIdNr,
          steuerhinweis:issuer.steuerhinweis,bankname:issuer.bankname,iban:issuer.iban,bic:issuer.bic,
          rechnungshinweis:issuer.rechnungshinweis},
        partner:{unternehmen:partnerRow.unternehmen,name:partnerRow.unternehmen||partnerRow.ansprechpartner,
          ansprechpartner:partnerRow.ansprechpartner,strasse:partnerRow.strasse,plz:partnerRow.plz,ort:partnerRow.ort,email:partnerEmail},
        teilnehmer:items
      };
      const pdf=createPartnerInvoicePdf(invoiceData),id=crypto.randomUUID();
      await client.query('UPDATE brilon_rechnungsdaten SET naechste_nummer=$1,aktualisiert_am=NOW() WHERE id=1',[sequence+1]);
      await client.query(`INSERT INTO brilon_netzwerkpartner_abrechnungen(id,zeit_id,netzwerkpartner_id,rechnungsnummer,data,pdf,email_status)
        VALUES($1,$2,$3,$4,$5::jsonb,$6,'ausstehend')`,
        [id,zeitId,partnerRow.id,number,JSON.stringify(invoiceData),pdf]);
      await client.query('UPDATE brilon_spontan_zeiten SET abgeschlossen_am=NOW(),abgeschlossen_von=$2 WHERE id=$1',[zeitId,staff.mitarbeiter_id]);
      await client.query('COMMIT');
      return {id,zeit_id:zeitId,netzwerkpartner_id:partnerRow.id,rechnungsnummer:number,data:invoiceData,pdf,email_status:'ausstehend'};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  const handler=async(req,res,u,route,ip)=>{
    if(!pool)return reply(res,503,{error:'Spontane Gruppenangebote sind derzeit nicht verfügbar.'});
    if(route==='/api/spontangruppen/partner'&&req.method==='GET'){
      if(!await admin(req,res))return;
      const ortId=Number(u.searchParams.get('ortId'));
      if(!Number.isSafeInteger(ortId)||ortId<1)return reply(res,400,{error:'Bitte einen gültigen Standort auswählen.'});
      const q=await pool.query(`SELECT id,unternehmen,ansprechpartner,email,standort_id FROM brilon_netzwerkpartner
        WHERE standort_id=$1 AND aktiv=true ORDER BY COALESCE(NULLIF(unternehmen,''),ansprechpartner),email`,[ortId]);
      return reply(res,200,q.rows);
    }
    if(route==='/api/spontangruppen/einstellungen'&&req.method==='GET'){
      if(!await admin(req,res))return;
      const ortId=Number(u.searchParams.get('ortId'));
      if(!Number.isSafeInteger(ortId)||ortId<1)return reply(res,400,{error:'Bitte einen gültigen Standort auswählen.'});
      const q=await pool.query(`SELECT o.id,o.name,e.preis_pro_person_cent,e.netzwerkpartner_id,e.abzug_typ,e.abzug_wert
        FROM brilon_orte o LEFT JOIN brilon_spontan_einstellungen e ON e.standort_id=o.id
        WHERE o.id=$1 AND o.aktiv=true`,[ortId]);
      if(!q.rowCount)return reply(res,404,{error:'Der Standort ist nicht aktiv.'});
      return reply(res,200,{ortId:q.rows[0].id,standort:q.rows[0].name,preisProPersonCent:q.rows[0].preis_pro_person_cent,
        netzwerkpartnerId:q.rows[0].netzwerkpartner_id,abzugTyp:q.rows[0].abzug_typ||'prozent',abzugWert:q.rows[0].abzug_wert||0});
    }
    if(route==='/api/spontangruppen/einstellungen'&&req.method==='POST'){
      if(!await admin(req,res))return;
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
      const d=await body(req,6000),ortId=Number(d.ortId),preis=Number(d.preisProPerson);
      const partnerId=typeof d.netzwerkpartnerId==='string'?d.netzwerkpartnerId:'';
      const abzugTyp=d.abzugTyp,abzugWert=Number(d.abzugWert);
      if(!Number.isSafeInteger(ortId)||ortId<1||!Number.isFinite(preis)||preis<0||preis>500||
        !validUuid(partnerId)||!['prozent','pro_person','pauschal'].includes(abzugTyp)||
        !Number.isFinite(abzugWert)||abzugWert<0||abzugWert>5000||
        (abzugTyp==='prozent'&&abzugWert>100))
        return reply(res,400,{error:'Bitte Preis, Netzwerkpartner und gültige Abzugsvereinbarung eintragen.'});
      const cents=Math.round(preis*100);
      if(Math.abs(preis*100-cents)>0.000001)return reply(res,400,{error:'Der Preis darf höchstens zwei Nachkommastellen haben.'});
      const place=await pool.query('SELECT id FROM brilon_orte WHERE id=$1 AND aktiv=true',[ortId]);
      if(!place.rowCount)return reply(res,404,{error:'Der Standort ist nicht aktiv.'});
      const partner=await pool.query('SELECT id FROM brilon_netzwerkpartner WHERE id=$1 AND standort_id=$2 AND aktiv=true',[partnerId,ortId]);
      if(!partner.rowCount)return reply(res,409,{error:'Der Netzwerkpartner ist nicht für diesen Standort freigegeben.'});
      await pool.query(`INSERT INTO brilon_spontan_einstellungen(standort_id,preis_pro_person_cent,netzwerkpartner_id,abzug_typ,abzug_wert)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(standort_id) DO UPDATE
        SET preis_pro_person_cent=EXCLUDED.preis_pro_person_cent,netzwerkpartner_id=EXCLUDED.netzwerkpartner_id,
            abzug_typ=EXCLUDED.abzug_typ,abzug_wert=EXCLUDED.abzug_wert,updated_at=NOW()`,
        [ortId,cents,partnerId,abzugTyp,abzugWert]);
      return reply(res,200,{success:true,ortId,preisProPersonCent:cents,netzwerkpartnerId:partnerId,abzugTyp,abzugWert});
    }
    if(route==='/api/spontangruppen/standorte'&&req.method==='GET'){
      const q=await pool.query('SELECT id,name FROM brilon_orte WHERE aktiv=true ORDER BY name');
      return reply(res,200,q.rows);
    }
    if(route==='/api/spontangruppen/monitor'&&req.method==='GET'){
      if(!await admin(req,res))return;
      const ortId=Number(u.searchParams.get('ortId'));
      if(!Number.isSafeInteger(ortId)||ortId<1)return reply(res,400,{error:'Bitte einen gültigen Standort auswählen.'});
      const place=await pool.query('SELECT id,name FROM brilon_orte WHERE id=$1 AND aktiv=true',[ortId]);
      if(!place.rowCount)return reply(res,404,{error:'Der Standort ist nicht aktiv.'});
      await pool.query('UPDATE brilon_spontan_sessions SET aktiv=false WHERE standort_id=$1 AND aktiv=true AND ablauf<=NOW()',[ortId]);
      // Finanzrelevante Sessions NICHT automatisch löschen: Rechnungen und
      // Anwesenheitsbelege hängen per Fremdschlüssel (ON DELETE CASCADE) daran.
      // Aufbewahrung und datenschutzkonforme Löschung erst nach gesicherter
      // unabhängiger Archivierung mit ausdrücklichem Aufbewahrungskonzept.

      let session=(await pool.query(`SELECT id,code,code_ablauf,ablauf FROM brilon_spontan_sessions
        WHERE standort_id=$1 AND aktiv=true ORDER BY erstellt_am DESC LIMIT 1`,[ortId])).rows[0];
      if(!session){
        const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
        try{
          const q=await pool.query(`INSERT INTO brilon_spontan_sessions(id,standort_id,code,code_hash,code_ablauf,ablauf)
            VALUES($1,$2,$3,$4,NOW()+INTERVAL '10 minutes',NOW()+INTERVAL '24 hours')
            RETURNING id,code,code_ablauf,ablauf`,[crypto.randomUUID(),ortId,code,sha256(code)]);
          session=q.rows[0];
        }catch(error){
          if(error.code!=='23505')throw error;
          session=(await pool.query(`SELECT id,code,code_ablauf,ablauf FROM brilon_spontan_sessions
            WHERE standort_id=$1 AND aktiv=true ORDER BY erstellt_am DESC LIMIT 1`,[ortId])).rows[0];
          if(!session)throw error;
        }
      }
      if(new Date(session.code_ablauf).getTime()<=Date.now()){
        const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
        const q=await pool.query(`UPDATE brilon_spontan_sessions SET code=$2,code_hash=$3,code_ablauf=NOW()+INTERVAL '10 minutes'
          WHERE id=$1 RETURNING id,code,code_ablauf,ablauf`,[session.id,code,sha256(code)]);
        session=q.rows[0];
      }
      return reply(res,200,{sessionId:session.id,standort:place.rows[0].name,ortId,
        code:session.code,codeGueltigBis:session.code_ablauf,sessionGueltigBis:session.ablauf,
        link:'/spontangruppen.html?ortId='+ortId,...await board(session.id)});
    }
    if(route==='/api/spontangruppen/board'&&req.method==='GET'){
      const ortId=Number(u.searchParams.get('ortId'));
      if(!Number.isSafeInteger(ortId)||ortId<1)return reply(res,400,{error:'Bitte einen gültigen Standort auswählen.'});
      const q=await pool.query(`SELECT s.id,s.standort_id,o.name AS standort
        FROM brilon_spontan_sessions s JOIN brilon_orte o ON o.id=s.standort_id
        WHERE s.standort_id=$1 AND s.aktiv=true AND s.ablauf>NOW()
        ORDER BY s.erstellt_am DESC LIMIT 1`,[ortId]);
      if(!q.rowCount){
        const price=await pool.query('SELECT preis_pro_person_cent FROM brilon_spontan_einstellungen WHERE standort_id=$1',[ortId]);
        return reply(res,200,{aktiv:false,standort:null,interessierte:0,personen:0,
          preisProPersonCent:price.rows[0]?.preis_pro_person_cent??null,zeiten:[]});
      }
      return reply(res,200,{aktiv:true,sessionId:q.rows[0].id,standort:q.rows[0].standort,
        ...await board(q.rows[0].id)});
    }
    if(route==='/api/spontangruppen/abstimmung'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
      if(!limit('spontangruppen:'+ip,20,600000))return reply(res,429,{error:'Bitte später erneut versuchen.'});
      const d=await body(req,8000),ortId=Number(d.ortId),code=typeof d.code==='string'?d.code.trim():'';
      const teilnahmeId=typeof d.teilnahmeId==='string'?d.teilnahmeId:'';
      const interesse=d.interesse===true,personen=Number(d.personen||1);
      const gastName=typeof d.name==='string'?d.name.trim().slice(0,120):'';
      const gastEmail=typeof d.email==='string'?d.email.trim().toLowerCase():'';
      if(gastName.length<2||!validEmail(gastEmail))return reply(res,400,{error:'Bitte Namen und eine gültige E-Mail-Adresse eintragen.'});
      if(!Number.isSafeInteger(ortId)||ortId<1||!/^[0-9]{6}$/.test(code)||!validUuid(teilnahmeId)||
        (interesse&&(!Number.isInteger(personen)||personen<1||personen>15)))
        return reply(res,400,{error:'Bitte den sechsstelligen Monitorcode eingeben und die Abstimmung vollständig ausfüllen.'});
      const active=await pool.query(`SELECT id FROM brilon_spontan_sessions
        WHERE standort_id=$1 AND aktiv=true AND ablauf>NOW() AND code_ablauf>NOW() AND code_hash=$2
        ORDER BY erstellt_am DESC LIMIT 1`,[ortId,sha256(code)]);
      if(!active.rowCount)return reply(res,403,{error:'Der Code ist abgelaufen oder gehört zu einem anderen Standort. Bitte den aktuellen Code am Monitor verwenden.'});
      const setting=await pool.query('SELECT preis_pro_person_cent,netzwerkpartner_id,abzug_typ,abzug_wert FROM brilon_spontan_einstellungen WHERE standort_id=$1',[ortId]);
      if(!setting.rowCount||setting.rows[0].preis_pro_person_cent===null||!setting.rows[0].netzwerkpartner_id||!setting.rows[0].abzug_typ)
        return reply(res,409,{error:'Preis und Partnervereinbarung sind noch nicht durch die Verwaltung hinterlegt.'});
      const sessionId=active.rows[0].id;
      const proposals=interesse&&Array.isArray(d.neueZeiten)?d.neueZeiten.slice(0,4):[];
      const added=[];
      for(const item of proposals){
        if(!item||typeof item.datum!=='string'||typeof item.uhrzeit!=='string'||
          !/^\d{4}-\d{2}-\d{2}$/.test(item.datum)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.uhrzeit))continue;
        const slotDate=new Date(item.datum+'T00:00:00Z'),today=new Date();today.setUTCHours(0,0,0,0);
        if(Number.isNaN(slotDate.getTime())||slotDate<today||slotDate>new Date(today.getTime()+90*86400000))continue;
        const ins=await pool.query(`INSERT INTO brilon_spontan_zeiten(id,session_id,datum,uhrzeit)
          VALUES($1,$2,$3,$4) ON CONFLICT(session_id,datum,uhrzeit) DO NOTHING
          RETURNING id`,[crypto.randomUUID(),sessionId,item.datum,item.uhrzeit]);
        let slotId=ins.rows[0]?.id;
        if(!slotId)slotId=(await pool.query('SELECT id FROM brilon_spontan_zeiten WHERE session_id=$1 AND datum=$2 AND uhrzeit=$3',[sessionId,item.datum,item.uhrzeit])).rows[0]?.id;
        if(slotId)added.push(slotId);
      }
      const selected=interesse&&Array.isArray(d.zeitenIds)?d.zeitenIds.filter(validUuid).slice(0,20):[];
      const targets=[...new Set([...selected,...added])];
      for(const slotId of targets){
        const slot=await pool.query('SELECT id FROM brilon_spontan_zeiten WHERE id=$1 AND session_id=$2',[slotId,sessionId]);
        if(!slot.rowCount)continue;
        const existing=await pool.query(`SELECT COALESCE(SUM(t.personen),0)::int AS personen
          FROM brilon_spontan_zeitstimmen v JOIN brilon_spontan_teilnahmen t
            ON t.session_id=$2 AND t.teilnahme_id=v.teilnahme_id
          WHERE v.zeit_id=$1 AND v.teilnahme_id<>$3 AND t.interesse=true`,[slotId,sessionId,teilnahmeId]);
        if(interesse&&(existing.rows[0]?.personen||0)+personen>15)
          return reply(res,409,{error:'Diese Zeit ist bereits mit 15 Personen voll. Bitte stimme für eine andere Zeit ab.'});
      }
      await pool.query(`INSERT INTO brilon_spontan_teilnahmen(session_id,teilnahme_id,gast_name,gast_email,interesse,personen)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(session_id,teilnahme_id)
        DO UPDATE SET gast_name=EXCLUDED.gast_name,gast_email=EXCLUDED.gast_email,interesse=EXCLUDED.interesse,
          personen=EXCLUDED.personen,updated_at=NOW()`,
        [sessionId,teilnahmeId,gastName,gastEmail,interesse,interesse?personen:0]);
      await pool.query(`DELETE FROM brilon_spontan_zeitstimmen v USING brilon_spontan_zeiten s
        WHERE v.zeit_id=s.id AND s.session_id=$1 AND v.teilnahme_id=$2`,[sessionId,teilnahmeId]);
      for(const slotId of targets){
        const slot=await pool.query('SELECT id FROM brilon_spontan_zeiten WHERE id=$1 AND session_id=$2',[slotId,sessionId]);
        if(slot.rowCount)await pool.query(`INSERT INTO brilon_spontan_zeitstimmen(zeit_id,teilnahme_id)
          VALUES($1,$2) ON CONFLICT DO NOTHING`,[slotId,teilnahmeId]);
      }
      for(const slotId of targets)await groupConfirmation(sessionId,slotId);
      const place=await pool.query('SELECT name FROM brilon_orte WHERE id=$1',[ortId]);
      return reply(res,200,{success:true,standort:place.rows[0]?.name||'',...await board(sessionId)});
    }
    if(route==='/api/spontangruppen/buchhaltung'&&req.method==='GET'){
      if(!await admin(req,res))return;
      const q=await pool.query(`SELECT a.id,a.zeit_id,a.netzwerkpartner_id,a.rechnungsnummer,a.data,a.email_status,
          a.email_fehler,a.erstellt_am,a.versandt_am,p.unternehmen,p.ansprechpartner,o.name AS standort
        FROM brilon_netzwerkpartner_abrechnungen a
        JOIN brilon_netzwerkpartner p ON p.id=a.netzwerkpartner_id
        JOIN brilon_spontan_zeiten s ON s.id=a.zeit_id
        JOIN brilon_spontan_sessions ss ON ss.id=s.session_id
        JOIN brilon_orte o ON o.id=ss.standort_id
        ORDER BY a.erstellt_am DESC LIMIT 100`);
      return reply(res,200,{abrechnungen:q.rows});
    }
    const partnerPdf=route.match(/^\/api\/spontangruppen\/buchhaltung\/([a-f0-9-]{36})\.pdf$/i);
    if(partnerPdf&&req.method==='GET'){
      if(!await admin(req,res))return;
      const q=await pool.query('SELECT rechnungsnummer,pdf FROM brilon_netzwerkpartner_abrechnungen WHERE id=$1',[partnerPdf[1]]);
      if(!q.rowCount)return reply(res,404,{error:'Partnerabrechnung nicht gefunden.'});
      res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="Rechnung-${q.rows[0].rechnungsnummer}.pdf"`,'Cache-Control':'private, no-store'});
      return res.end(q.rows[0].pdf);
    }
    const partnerSend=route.match(/^\/api\/spontangruppen\/buchhaltung\/([a-f0-9-]{36})\/versenden$/i);
    if(partnerSend&&req.method==='POST'){
      if(!await admin(req,res))return;
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
      const q=await pool.query('SELECT * FROM brilon_netzwerkpartner_abrechnungen WHERE id=$1',[partnerSend[1]]);
      if(!q.rowCount)return reply(res,404,{error:'Partnerabrechnung nicht gefunden.'});
      const result=await sendPartnerInvoice(q.rows[0]);
      return reply(res,result.status==='angenommen'?200:502,{success:result.status==='angenommen',...result});
    }
    if(route==='/api/spontangruppen/abrechnung'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
      const staff=staffSession?await staffSession(req):null;
      if(!staff)return reply(res,401,{error:'Bitte im Mitarbeiterbereich anmelden.'});
      const d=await body(req,4000),zeitId=typeof d.zeitId==='string'?d.zeitId:'';
      if(!validUuid(zeitId))return reply(res,400,{error:'Termin ist ungültig.'});
      const event=await pool.query(`SELECT ss.standort_id FROM brilon_spontan_zeiten s
        JOIN brilon_spontan_sessions ss ON ss.id=s.session_id WHERE s.id=$1 AND s.gruppe_bestaetigt_am IS NOT NULL`,[zeitId]);
      if(!event.rowCount)return reply(res,404,{error:'Bestätigte Gruppe nicht gefunden.'});
      const authorized=await staffForPlace(req,event.rows[0].standort_id);
      if(!authorized)return reply(res,403,{error:'Du bist für diesen Standort nicht freigegeben.'});
      try{
        const invoice=await preparePartnerInvoice(zeitId,authorized);
        const mail=await sendPartnerInvoice(invoice);
        const data=invoiceDataForRow(invoice);
        return reply(res,200,{success:true,rechnungsnummer:invoice.rechnungsnummer,emailStatus:mail.status,
          nettoCent:data.nettoCent,abrechnungId:invoice.id});
      }catch(error){
        return reply(res,error.status||500,{error:error.status?error.message:'Partnerrechnung konnte nicht erstellt werden.'});
      }
    }
    if(route==='/api/spontangruppen/anwesenheit/standorte'&&req.method==='GET'){
      const staff=staffSession?await staffSession(req):null;
      if(!staff)return reply(res,401,{error:'Bitte im Mitarbeiterbereich anmelden.'});
      const q=await pool.query(`SELECT DISTINCT o.id,o.name FROM brilon_pruef_freigaben f
        JOIN brilon_orte o ON o.id=f.ort_id AND o.aktiv=true
        WHERE f.mitarbeiter_id=$1 ORDER BY o.name`,[staff.mitarbeiter_id]);
      return reply(res,200,q.rows);
    }
    if(route==='/api/spontangruppen/anwesenheit/termine'&&req.method==='GET'){
      const ortId=Number(u.searchParams.get('ortId'));
      if(!Number.isSafeInteger(ortId)||ortId<1)return reply(res,400,{error:'Bitte einen gültigen Standort auswählen.'});
      const staff=await staffForPlace(req,ortId);
      if(!staff)return reply(res,403,{error:'Du bist für diesen Standort nicht freigegeben.'});
      const q=await pool.query(`SELECT s.id,s.datum,s.uhrzeit,s.mail_status,
          COALESCE(SUM(t.personen),0)::int AS angemeldet,
          COUNT(*) FILTER(WHERE t.anwesend)::int AS anwesende_buchungen,
          COALESCE(SUM(t.anwesend_personen),0)::int AS anwesend
        FROM brilon_spontan_zeiten s
        JOIN brilon_spontan_sessions ss ON ss.id=s.session_id
        JOIN brilon_spontan_zeitstimmen v ON v.zeit_id=s.id
        JOIN brilon_spontan_teilnahmen t ON t.session_id=s.session_id AND t.teilnahme_id=v.teilnahme_id AND t.interesse=true
        WHERE ss.standort_id=$1 AND s.gruppe_bestaetigt_am IS NOT NULL AND s.abgeschlossen_am IS NULL
        GROUP BY s.id ORDER BY s.datum,s.uhrzeit`,[ortId]);
      return reply(res,200,q.rows);
    }
    if(route==='/api/spontangruppen/anwesenheit/gruppe'&&req.method==='GET'){
      const zeitId=u.searchParams.get('zeitId')||'';
      if(!validUuid(zeitId))return reply(res,400,{error:'Termin ist ungültig.'});
      const location=await pool.query(`SELECT ss.standort_id FROM brilon_spontan_zeiten s
        JOIN brilon_spontan_sessions ss ON ss.id=s.session_id WHERE s.id=$1 AND s.gruppe_bestaetigt_am IS NOT NULL`,[zeitId]);
      if(!location.rowCount)return reply(res,404,{error:'Bestätigte Gruppe nicht gefunden.'});
      const staff=await staffForPlace(req,location.rows[0].standort_id);
      if(!staff)return reply(res,403,{error:'Du bist für diesen Standort nicht freigegeben.'});
      const [group,guests]=await Promise.all([
        pool.query(`SELECT s.id,s.datum,s.uhrzeit,o.name AS standort,s.mail_status,s.abgeschlossen_am,
              a.rechnungsnummer,a.email_status AS rechnungs_email_status
          FROM brilon_spontan_zeiten s JOIN brilon_spontan_sessions ss ON ss.id=s.session_id
          JOIN brilon_orte o ON o.id=ss.standort_id
          LEFT JOIN brilon_netzwerkpartner_abrechnungen a ON a.zeit_id=s.id WHERE s.id=$1`,[zeitId]),
        pool.query(`SELECT t.teilnahme_id,t.gast_name,t.gast_email,t.personen,t.anwesend,t.anwesend_personen,t.geprueft_am
          FROM brilon_spontan_zeitstimmen v JOIN brilon_spontan_zeiten s ON s.id=v.zeit_id
          JOIN brilon_spontan_teilnahmen t ON t.session_id=s.session_id AND t.teilnahme_id=v.teilnahme_id
          WHERE s.id=$1 AND t.interesse=true ORDER BY t.gast_name`,[zeitId])
      ]);
      return reply(res,200,{gruppe:group.rows[0],gaeste:guests.rows});
    }
    if(route==='/api/spontangruppen/anwesenheit/speichern'&&req.method==='POST'){
      if(!sameOriginMutation(req))return reply(res,403,{error:'Herkunft der Anfrage nicht zulässig.'});
      const d=await body(req,10000),zeitId=typeof d.zeitId==='string'?d.zeitId:'';
      if(!validUuid(zeitId)||!Array.isArray(d.eintraege)||d.eintraege.length>30||
        d.eintraege.some(item=>!item||!validUuid(item.teilnahmeId)||typeof item.anwesend!=='boolean'||
          !Number.isInteger(Number(item.personen))||Number(item.personen)<0||Number(item.personen)>15||(item.anwesend&&Number(item.personen)<1)))
        return reply(res,400,{error:'Bitte die Anwesenheitsliste vollständig prüfen.'});
      const location=await pool.query(`SELECT ss.standort_id FROM brilon_spontan_zeiten s
        JOIN brilon_spontan_sessions ss ON ss.id=s.session_id WHERE s.id=$1 AND s.gruppe_bestaetigt_am IS NOT NULL`,[zeitId]);
      if(!location.rowCount)return reply(res,404,{error:'Bestätigte Gruppe nicht gefunden.'});
      const staff=await staffForPlace(req,location.rows[0].standort_id);
      if(!staff)return reply(res,403,{error:'Du bist für diesen Standort nicht freigegeben.'});
      for(const item of d.eintraege){
        const q=await pool.query(`UPDATE brilon_spontan_teilnahmen t
          SET anwesend=$3,anwesend_personen=CASE WHEN $3 THEN $4 ELSE 0 END,
              geprueft_am=NOW(),geprueft_von=$5,updated_at=NOW()
          WHERE t.session_id=(SELECT session_id FROM brilon_spontan_zeiten WHERE id=$1)
            AND t.teilnahme_id=$2 AND EXISTS(SELECT 1 FROM brilon_spontan_zeitstimmen v WHERE v.zeit_id=$1 AND v.teilnahme_id=t.teilnahme_id)
          RETURNING t.teilnahme_id`,[zeitId,item.teilnahmeId,item.anwesend,Number(item.personen),staff.mitarbeiter_id]);
        if(!q.rowCount)return reply(res,409,{error:'Mindestens eine Person gehört nicht zu dieser Gruppe. Bitte Liste neu laden.'});
      }
      const totals=await pool.query(`SELECT COALESCE(SUM(t.personen),0)::int AS angemeldet,
          COALESCE(SUM(t.anwesend_personen),0)::int AS anwesend
        FROM brilon_spontan_zeitstimmen v JOIN brilon_spontan_zeiten s ON s.id=v.zeit_id
        JOIN brilon_spontan_teilnahmen t ON t.session_id=s.session_id AND t.teilnahme_id=v.teilnahme_id
        WHERE s.id=$1 AND t.interesse=true`,[zeitId]);
      const details=await pool.query(`SELECT s.datum,s.uhrzeit,o.name AS standort,e.preis_pro_person_cent
        FROM brilon_spontan_zeiten s JOIN brilon_spontan_sessions ss ON ss.id=s.session_id
        JOIN brilon_orte o ON o.id=ss.standort_id LEFT JOIN brilon_spontan_einstellungen e ON e.standort_id=o.id
        WHERE s.id=$1`,[zeitId]);
      const hostel=await pool.query(`SELECT COALESCE(NULLIF(BTRIM(programm_benachrichtigung_email),''),email) AS email
        FROM brilon_netzwerkpartner WHERE standort_id=$1 AND aktiv=true`,[location.rows[0].standort_id]);
      const recipients=[...new Set([...hostel.rows.map(row=>row.email),env.BOOKING_NOTIFY_EMAIL]
        .filter(email=>validEmail(email)).map(email=>email.trim().toLowerCase()))];
      const item=details.rows[0],when=item?item.datum+' um '+String(item.uhrzeit).slice(0,5)+' Uhr':'';
      const price=item?.preis_pro_person_cent;
      const invoiceTotal=price===null||price===undefined?'':`\nVoraussichtlicher Rechnungsbetrag nach Anwesenheitsliste: ${(Number(totals.rows[0].anwesend)*price/100).toFixed(2).replace('.',',')} €`;
      await Promise.allSettled(recipients.map(email=>brevoMail(email,
        'Anwesenheit spontane Klettergruppe · '+(item?.standort||'')+' · '+when,
        `Die Anwesenheit der spontanen Klettergruppe wurde geprüft.

Standort: ${item?.standort||''}
Termin: ${when}
Angemeldet: ${totals.rows[0].angemeldet} Personen
Tatsächlich anwesend: ${totals.rows[0].anwesend} Personen${invoiceTotal}

Die Abrechnung und Rechnung erfolgen über die Jugendherberge.`)));
      return reply(res,200,{success:true,...totals.rows[0]});
    }
    return reply(res,404,{error:'Nicht gefunden.'});
  };
  return handler;
}
module.exports={createSpontanGruppenApi};
