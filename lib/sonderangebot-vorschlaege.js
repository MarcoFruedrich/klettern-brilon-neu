'use strict';

const { preisFuerTeilnehmer } = require('./buchungslogik');

const uhrzeit = minute => String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');

async function sonderangebotVorschlaege(pool, buchungId) {
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
    const programQuery = await client.query(`SELECT id,name,veranstaltungsort,veranstaltungsorte,preise,gruppenstufen
      FROM brilon_angebote WHERE name=$1 AND archiviert=false AND aktiv=true AND buchbar=true AND veroeffentlicht=true LIMIT 1`, [String(data.angebot || '')]);
    if (!programQuery.rowCount) { await client.query('ROLLBACK'); return { ok:false, status:409, error:'Das gebuchte Programm ist nicht mehr buchbar.' }; }
    const program = programQuery.rows[0];
    const sites = Array.isArray(program.veranstaltungsorte) && program.veranstaltungsorte.length
      ? program.veranstaltungsorte : [program.veranstaltungsort];
    const site = String(data.veranstaltungsort || program.veranstaltungsort || '').trim();
    if (!sites.includes(site)) { await client.query('ROLLBACK'); return { ok:false, status:409, error:'Der Buchungsstandort ist für das Programm nicht mehr freigegeben.' }; }

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
      const eligible = staffQuery.rows.filter(person => person.anschluss_option === direction || person.anschluss_option === 'beides');
      if (!eligible.length) continue;
      const start = direction === 'davor' ? startMain - duration : endMain;
      const end = direction === 'davor' ? startMain : endMain + duration;
      // Davor endet exakt am Haupttermin; danach beginnt das Angebot an dessen Endzeit.
      if (start < 9*60 || start > 19*60 || end > 24*60 || start % 15 !== 0 || end % 15 !== 0) continue;
      candidates.push({ direction, start, end, staff:eligible.map(person => ({ id:person.mitarbeiter_id, name:person.name })) });
    }
    if (!candidates.length) {
      await client.query('ROLLBACK');
      return { ok:false, status:409, error:'Die direkt angrenzenden Zeitfenster liegen außerhalb der Buchungszeiten oder lassen sich nicht exakt in 15-Minuten-Schritten anbieten.' };
    }

    let price = '';
    try { const cents = preisFuerTeilnehmer(program.preise, participants, program.gruppenstufen); if (cents !== null) price = (cents / 100).toFixed(2); } catch {}
    const ids = [];
    for (const candidate of candidates) {
      const start = uhrzeit(candidate.start), end = uhrzeit(candidate.end);
      const prior = await client.query(`SELECT id FROM brilon_aktionen WHERE data->>'quelle_buchung_id'=$1
        AND data->>'vorschlagsrichtung'=$2 AND data->>'datum'=$3 AND data->>'uhrzeit'=$4 LIMIT 1`,
      [buchungId,candidate.direction,datum,start]);
      if (prior.rowCount) { ids.push(prior.rows[0].id); continue; }
      const id = require('crypto').randomUUID();
      const action = {
        status:'vorschlag', titel:`Tagesangebot ${candidate.direction==='davor'?'vor':'nach'} ${data.angebot}`,
        datum, uhrzeit:start, endzeit:end, veranstaltungsort:site, preis, programm_id:String(program.id),
        beschreibung:`Automatisch berechneter Zusatztermin direkt ${candidate.direction==='davor'?'vor':'nach'} „${data.angebot}“.`,
        vorschlagsrichtung:candidate.direction, quelle_buchung_id:bookingId, quellprogramm:String(data.angebot),
        vorschlagsmitarbeiter:candidate.staff, teilnehmer:participants, dauer:duration
      };
      await client.query('INSERT INTO brilon_aktionen(id,data) VALUES($1,$2::jsonb)', [id,JSON.stringify(action)]);
      ids.push(id);
    }
    await client.query('COMMIT');
    return { ok:true, ids, anzahl:ids.length, nachricht:`${ids.length} automatisch berechnete Zusatzangebot(e) liegen der Verwaltung zur Prüfung vor.` };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

module.exports = { sonderangebotVorschlaege };
