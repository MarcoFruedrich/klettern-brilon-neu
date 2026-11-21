'use strict';

const { preisFuerTeilnehmer } = require('./buchungslogik');

const uhrzeit = minute => String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');

async function sonderangebotVorschlaege(pool, buchungId, options={}) {
  const entwurf=options.entwurf===true;
  const richtung=options.richtung;
  if(richtung && !['davor','danach','beides'].includes(richtung))
    return {ok:false,status:400,error:'Ungültige Anschlussrichtung.'};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bookingQuery = await client.query('SELECT id,data,status FROM brilon_buchungen WHERE id=$1 FOR UPDATE', [buchungId]);
    if (!bookingQuery.rowCount) { await client.query('ROLLBACK'); return { ok:false, status:404, error:'Buchung nicht gefunden.' }; }
    const booking = bookingQuery.rows[0], data = booking.data || {};
    const datum = data.datum, time = String(data.uhrzeit || ''), duration = Number(data.dauer), participants = Number(data.teilnehmer);
    if (!['offen','bestaetigt'].includes(booking.status) || !/^\d{4}-\d\d-\d\d$/.test(datum || '') ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !Number.isInteger(duration) || duration < 15 || duration > 1440 ||
        !Number.isInteger(participants) || participants < 1 || participants > 1000) {
      await client.query('ROLLBACK');
      return { ok:false, status:409, error:'Die Buchung hat keine gültige Zeit oder Programmdauer für einen automatischen Vorschlag.' };
    }
    // Öffentliche Folgeangebote erst nach verbindlicher Buchung und Zahlung.
    if(booking.status!=='bestaetigt'){
      await client.query('ROLLBACK');
      return {ok:false,status:409,error:'Der Haupttermin muss vor der Veröffentlichung von Anschlussangeboten verbindlich bestätigt sein.'};
    }
    const programQuery = await client.query(`SELECT id,name,veranstaltungsort,veranstaltungsorte,preise,gruppenstufen,kapazitaet,verfuegbare_termine
      FROM brilon_angebote WHERE ($1::bigint IS NULL OR id=$1) AND name=$2
        AND archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true LIMIT 1`,
      [Number.isSafeInteger(Number(data.programmId))&&Number(data.programmId)>0?Number(data.programmId):null,
        String(data.angebot || '')]);
    if (!programQuery.rowCount) { await client.query('ROLLBACK'); return { ok:false, status:409, error:'Das gebuchte Programm ist nicht mehr buchbar.' }; }
    const program = programQuery.rows[0];
    const sites = Array.isArray(program.veranstaltungsorte) && program.veranstaltungsorte.length
      ? program.veranstaltungsorte : [program.veranstaltungsort];
    const site = String(data.veranstaltungsort || program.veranstaltungsort || '').trim();
    if (!sites.includes(site)) { await client.query('ROLLBACK'); return { ok:false, status:409, error:'Der Buchungsstandort ist für das Programm nicht mehr freigegeben.' }; }
    if(participants>Number(program.kapazitaet)||(
      Array.isArray(program.verfuegbare_termine)&&program.verfuegbare_termine.length&&
      !program.verfuegbare_termine.includes(datum))){
      await client.query('ROLLBACK');
      return {ok:false,status:409,error:'Die Teilnehmerzahl oder Programmdatum ist für ein Anschlussangebot nicht zulässig.'};
    }

    const staffQuery = await client.query(`SELECT e.mitarbeiter_id,e.anschluss_option,m.name
      FROM brilon_einsaetze e JOIN brilon_pruef_mitarbeitende m ON m.id=e.mitarbeiter_id
      WHERE e.buchung_id=$1 AND e.status='bestaetigt' AND e.anschluss_option IN ('davor','danach','beides')
        AND m.aktiv=true AND m.freigabe_am IS NOT NULL
      ORDER BY m.name,e.mitarbeiter_id`, [buchungId]);
    if (!staffQuery.rowCount) { await client.query('ROLLBACK'); return { ok:false, status:409, error:'Für diese Buchung liegt keine bestätigte Mitarbeiterbereitschaft für davor oder danach vor.' }; }

    const startMain = Number(time.slice(0,2)) * 60 + Number(time.slice(3,5));
    const endMain = startMain + duration;
    const candidates = [];
    for (const direction of ['davor','danach']) {
      if(richtung && richtung!=='beides' && direction!==richtung)continue;
      const eligible = staffQuery.rows.filter(person => person.anschluss_option === direction || person.anschluss_option === 'beides');
      if (!eligible.length) continue;
      const start = direction === 'davor' ? startMain - duration - 15 : endMain + 15;
      const end = direction === 'davor' ? startMain - 15 : endMain + 15 + duration;
      // Zwischen dem Haupttermin und dem Anschlussangebot bleiben jeweils mindestens 15 Minuten.
      if (start < 9*60 || start > 19*60 || end > 24*60 || start % 15 !== 0 || end % 15 !== 0) continue;
      candidates.push({ direction, start, end, staff:eligible.map(person => ({ id:person.mitarbeiter_id, name:person.name })) });
    }
    if (!candidates.length) {
      await client.query('ROLLBACK');
      return { ok:false, status:409, error:'Die direkt angrenzenden Zeitfenster liegen außerhalb der Buchungszeiten oder lassen sich nicht exakt in 15-Minuten-Schritten anbieten.' };
    }

    // Kein öffentliches Angebot bei ungeklärten Belegungen, Sperrzeiten oder
    // bereits eingeteilten Mitarbeitern. Unbekannte Zeiten blockieren konservativ.
    const [booked,closures,otherShifts]=await Promise.all([
      client.query(`SELECT id,data FROM brilon_buchungen
        WHERE id<>$1 AND data->>'datum'=$2
          AND (data->>'veranstaltungsort'=$3 OR data->>'veranstaltungsort' IS NULL)
          AND COALESCE(status,'offen') IN ('offen','bestaetigt')`,[buchungId,datum,site]),
      client.query(`SELECT uhrzeit::text AS uhrzeit,endzeit::text AS endzeit
        FROM brilon_kalender WHERE typ='sperrzeit' AND datum<=$1::date
          AND COALESCE(enddatum,datum)>=$1::date
          AND (COALESCE(cardinality(standorte),0)=0 OR $2=ANY(standorte))`,[datum,site]),
      client.query(`SELECT e.mitarbeiter_id,b.data FROM brilon_einsaetze e
        JOIN brilon_buchungen b ON b.id=e.buchung_id
        WHERE e.buchung_id<>$1 AND b.data->>'datum'=$2
          AND e.status IN ('eingeteilt','bestaetigt')`,[buchungId,datum])
    ]);
    const occupied=data=>{
      const time=String(data?.uhrzeit||'').slice(0,5);
      const duration=Number(data?.dauer);
      if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)||
        !Number.isInteger(duration)||duration<1||duration>1440)return [0,1440];
      const start=Number(time.slice(0,2))*60+Number(time.slice(3,5));
      return [start,start+duration];
    };
    const collides=(a,b)=>a[0]<b[1]&&b[0]<a[1];
    const closureWindows=closures.rows.map(row=>{
      const start=String(row.uhrzeit||'').slice(0,5),end=String(row.endzeit||'').slice(0,5);
      if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end))return [0,1440];
      return [Number(start.slice(0,2))*60+Number(start.slice(3,5)),
        Number(end.slice(0,2))*60+Number(end.slice(3,5))];
    });
    const frei=candidate=>{
      const fenster=[candidate.start,candidate.end];
      if(booked.rows.some(b=>collides(fenster,occupied(b.data)))||
        closureWindows.some(block=>collides(fenster,block)))return false;
      // Alle angebotenen Mitarbeiter müssen für den neuen Einsatz verfügbar sein.
      return candidate.staff.every(person=>!otherShifts.rows.some(shift=>
        String(shift.mitarbeiter_id)===String(person.id)&&collides(fenster,occupied(shift.data))));
    };
    const freieCandidates=candidates.filter(frei);
    if(!freieCandidates.length){
      await client.query('ROLLBACK');
      return {ok:false,status:409,error:'Keine freien Anschlusszeiten nach Prüfung von Buchungen, Sperrzeiten und Mitarbeitereinsätzen.'};
    }
    let price = '';
    try { const cents = preisFuerTeilnehmer(program.preise, participants, program.gruppenstufen, duration); if (cents !== null) price = (cents / 100).toFixed(2); } catch {}
    if(!price){
      await client.query('ROLLBACK');
      return {ok:false,status:409,error:'Für diese Gruppengröße und Programmdauer ist kein verlässlicher Preis vorhanden.'};
    }
    const ids = [], angebote = [];
    for (const candidate of freieCandidates) {
      const start = uhrzeit(candidate.start), end = uhrzeit(candidate.end);
      const prior = await client.query(`SELECT id FROM brilon_aktionen WHERE data->>'quelle_buchung_id'=$1
        AND data->>'vorschlagsrichtung'=$2 AND data->>'datum'=$3 AND data->>'uhrzeit'=$4 LIMIT 1`,
      [buchungId,candidate.direction,datum,start]);
      const id = prior.rowCount ? prior.rows[0].id : require('crypto').randomUUID();
      // Ein bereits öffentliches Angebot darf nicht durch einen neuen Entwurf überschrieben werden.
      if(entwurf && prior.rowCount){
        const existing=await client.query("SELECT data->>'status' AS status FROM brilon_aktionen WHERE id=$1",[id]);
        if(existing.rows[0]?.status==='veroeffentlicht')continue;
      }
      const basisCent=Math.round(Number(price)*100);
      const rabattCent=Math.round(basisCent*0.10);
      const endpreis=(Math.max(0,basisCent-rabattCent)/100).toFixed(2);
      const action = {
        status:entwurf?'vorschlag':'veroeffentlicht', titel:`Anschlussangebot ${candidate.direction==='davor'?'vor':'nach'} ${data.angebot}`,
        datum, uhrzeit:start, endzeit:end, veranstaltungsort:site, veranstaltungsorte:[site], preis:entwurf?endpreis:price, programm_id:String(program.id),
        ...(entwurf?{originalpreis:price,rabatt_prozent:10,rabatt_cent:rabattCent,puffer_minuten:15}:{}),
        beschreibung:`Automatisch berechneter Zusatztermin direkt ${candidate.direction==='davor'?'vor':'nach'} „${data.angebot}“.`,
        vorschlagsrichtung:candidate.direction, quelle_buchung_id:buchungId, quellprogramm:String(data.angebot),
        vorschlagsmitarbeiter:candidate.staff, teilnehmer:participants, dauer:duration
      };
      if (!prior.rowCount) await client.query('INSERT INTO brilon_aktionen(id,data) VALUES($1,$2::jsonb)', [id,JSON.stringify(action)]);
      else await client.query('UPDATE brilon_aktionen SET data=$2::jsonb WHERE id=$1',[id,JSON.stringify(action)]);
      ids.push(id);
      angebote.push({id,richtung:candidate.direction,uhrzeit:start,endzeit:end,mitarbeiter:candidate.staff});
    }
    await client.query('COMMIT');
    return { ok:true, ids, angebote, anzahl:ids.length, nachricht:entwurf
      ?`${ids.length} Anschlussvorschlag/-vorschläge mit 15 Minuten Puffer und 10 % Rabatt erstellt. Vor Veröffentlichung prüfen.`
      :`${ids.length} Anschlussangebot(e) wurden mit 15 Minuten Pause berechnet und veröffentlicht.` };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

module.exports = { sonderangebotVorschlaege };
