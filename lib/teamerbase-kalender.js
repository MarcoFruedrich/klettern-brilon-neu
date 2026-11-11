'use strict';

const crypto = require('node:crypto');
const BERLIN = 'Europe/Berlin';

function digestParams(header) {
  const source = String(header || '');
  const match = /(?:^|,)\s*Digest\s+/i.exec(source);
  if (!match) return null;
  const input = source.slice(match.index + match[0].length);
  const params = {};
  let index = 0;
  while (index < input.length) {
    while (index < input.length && /[\s,]/.test(input[index])) index++;
    const keyMatch = /^[A-Za-z][A-Za-z0-9_-]*/.exec(input.slice(index));
    if (!keyMatch) break;
    const key = keyMatch[0].toLowerCase();
    index += keyMatch[0].length;
    while (index < input.length && /\s/.test(input[index])) index++;
    if (input[index] !== '=') break;
    index++;
    while (index < input.length && /\s/.test(input[index])) index++;
    let value = '';
    if (input[index] === '"') {
      index++;
      while (index < input.length) {
        if (input[index] === '\\' && index + 1 < input.length) {
          value += input[index + 1];
          index += 2;
        } else if (input[index] === '"') {
          index++;
          break;
        } else value += input[index++];
      }
    } else {
      const valueStart = index;
      while (index < input.length && input[index] !== ',') index++;
      value = input.slice(valueStart, index).trim();
    }
    params[key] = value;
    while (index < input.length && input[index] !== ',') index++;
    if (input[index] === ',') index++;
  }
  return params;
}

function digestHash(algorithm, value) {
  const normalized = String(algorithm || 'MD5').toLowerCase().replace(/-sess$/, '');
  const name = normalized === 'sha-256' ? 'sha256' : normalized;
  if (!['md5', 'sha256'].includes(name))
    throw new Error('Teamerbase verwendet ein nicht unterstütztes Digest-Verfahren.');
  return crypto.createHash(name).update(value, 'utf8').digest('hex');
}

function digestAuthorization(challenge, username, password, method, target, body) {
  if (!challenge.realm || !challenge.nonce)
    throw new Error('Teamerbase-Digest-Challenge ist unvollständig.');
  const algorithm = challenge.algorithm || 'MD5';
  const qops = String(challenge.qop || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const qop = qops.includes('auth') ? 'auth' : qops.includes('auth-int') ? 'auth-int' : null;
  if (qops.length && !qop) throw new Error('Teamerbase verlangt ein nicht unterstütztes Digest-qop.');
  const cnonce = crypto.randomBytes(16).toString('hex');
  const nc = '00000001';
  const uri = target.pathname + target.search || '/';
  let ha1 = digestHash(algorithm, username + ':' + challenge.realm + ':' + password);
  if (String(algorithm).toLowerCase().endsWith('-sess'))
    ha1 = digestHash(algorithm, ha1 + ':' + challenge.nonce + ':' + cnonce);
  const entityHash = qop === 'auth-int' ? digestHash(algorithm, body || '') : '';
  const ha2 = digestHash(algorithm, method + ':' + uri + (qop === 'auth-int' ? ':' + entityHash : ''));
  const response = qop
    ? digestHash(algorithm, ha1 + ':' + challenge.nonce + ':' + nc + ':' + cnonce + ':' + qop + ':' + ha2)
    : digestHash(algorithm, ha1 + ':' + challenge.nonce + ':' + ha2);
  const quote = value => '"' + String(value).replace(/(["\\])/g, '\\$1') + '"';
  const fields = [
    'username=' + quote(username), 'realm=' + quote(challenge.realm),
    'nonce=' + quote(challenge.nonce), 'uri=' + quote(uri),
    'response=' + quote(response), 'algorithm=' + algorithm
  ];
  if (qop) fields.push('qop=' + qop, 'nc=' + nc, 'cnonce=' + quote(cnonce));
  if (challenge.opaque) fields.push('opaque=' + quote(challenge.opaque));
  return 'Digest ' + fields.join(', ');
}
const DAY_MS = 24 * 60 * 60 * 1000;
const SYNC_INTERVAL_MS = 3 * DAY_MS;
const LOCK_ID = 438217;

function textValue(value = '') {
  return String(value).replace(/\\[nN]/g, '\n').replace(/\\,/g, ',')
    .replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

function properties(lines) {
  const result = new Map();
  for (const line of lines) {
    const index = line.indexOf(':');
    if (index < 0) continue;
    const left = line.slice(0, index).split(';');
    const name = left.shift().toUpperCase();
    const params = Object.fromEntries(left.map(item => {
      const split = item.indexOf('=');
      return split < 0 ? [item.toUpperCase(), ''] :
        [item.slice(0, split).toUpperCase(), item.slice(split + 1).replace(/^"|"$/g, '')];
    }));
    const values = result.get(name) || [];
    values.push({ value: line.slice(index + 1), params });
    result.set(name, values);
  }
  return result;
}

function propertyValue(props, key) {
  return props.get(key)?.[0] || null;
}

function berlinParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BERLIN, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(item => item.type !== 'literal').map(item => [item.type, item.value]));
}

function localTimeInZone(parts, zone) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  let guess = desired;
  for (let attempt = 0; attempt < 3; attempt++) {
    const zoned = Object.fromEntries(formatter.formatToParts(new Date(guess))
      .filter(item => item.type !== 'literal').map(item => [item.type, Number(item.value)]));
    const represented = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
    guess += desired - represented;
  }
  return new Date(guess);
}

function parseCalendarDate(prop) {
  if (!prop) return { datum: null, uhrzeit: null, ganztags: false };
  const value = prop.value.trim();
  const dateOnly = prop.params.VALUE?.toUpperCase() === 'DATE' || /^\d{8}$/.test(value);
  if (!/^\d{8}(?:T\d{6}Z?)?$/.test(value)) return { datum: null, uhrzeit: null, ganztags: false };
  const parts = {
    year: Number(value.slice(0, 4)), month: Number(value.slice(4, 6)), day: Number(value.slice(6, 8)),
    hour: Number(value.slice(9, 11) || 0), minute: Number(value.slice(11, 13) || 0), second: Number(value.slice(13, 15) || 0)
  };
  if (dateOnly) return { datum: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, uhrzeit: null, ganztags: true };
  const date = value.endsWith('Z') ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second))
    : localTimeInZone(parts, prop.params.TZID || BERLIN);
  const berlin = berlinParts(date);
  return { datum: `${berlin.year}-${berlin.month}-${berlin.day}`, uhrzeit: `${berlin.hour}:${berlin.minute}:${berlin.second}`, ganztags: false };
}

function parseCalendarEvents(calendarText) {
  const unfolded = String(calendarText || '').replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT\s*$/i.test(line)) { current = []; continue; }
    if (/^END:VEVENT\s*$/i.test(line)) {
      if (!current) continue;
      const props = properties(current);
      const uid = textValue(propertyValue(props, 'UID')?.value || '');
      const summary = textValue(propertyValue(props, 'SUMMARY')?.value || '');
      const location = textValue(propertyValue(props, 'LOCATION')?.value || '');
      const start = parseCalendarDate(propertyValue(props, 'DTSTART'));
      const end = parseCalendarDate(propertyValue(props, 'DTEND'));
      const recurrence = textValue(propertyValue(props, 'RECURRENCE-ID')?.value || '');
      const status = textValue(propertyValue(props, 'STATUS')?.value || '').toUpperCase();
      if (uid && summary && start.datum) {
        events.push({
          sourceUid: recurrence ? `${uid}::${recurrence}` : uid,
          title: summary.slice(0, 180), location: location.slice(0, 100),
          datum: start.datum, uhrzeit: start.uhrzeit, enddatum: end.datum,
          endzeit: end.uhrzeit, ganztags: start.ganztags, cancelled: status === 'CANCELLED'
        });
      }
      current = null;
      continue;
    }
    if (current) current.push(line);
  }
  return events;
}

function xmlUnescape(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

async function readCalendar({ url, username, password, fetchImpl = fetch, now = new Date() }) {
  if (!url || !username || !password) throw new Error('CalDAV-Zugang ist nicht eingerichtet.');
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { throw new Error('CalDAV-URL ist ungültig.'); }
  if (parsedUrl.username || parsedUrl.password) throw new Error('CalDAV-URL darf keine Zugangsdaten enthalten. Benutzername und Passwort gehören in die separaten Servervariablen.');
  if (parsedUrl.protocol !== 'https:') throw new Error('CalDAV muss über HTTPS erreichbar sein.');
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  const end = new Date(now.getTime() + 730 * DAY_MS);
  const startDate = new Intl.DateTimeFormat('en-CA', { timeZone: BERLIN }).format(new Date(now.getTime() - 90 * DAY_MS));
  const endDate = new Intl.DateTimeFormat('en-CA', { timeZone: BERLIN }).format(end);
  const requestBody = `<?xml version="1.0" encoding="utf-8"?>` +
    `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">` +
    `<d:prop><d:getetag/><c:calendar-data><c:comp name="VCALENDAR"><c:comp name="VEVENT">` +
    `<c:prop name="UID"/><c:prop name="DTSTAMP"/><c:prop name="SUMMARY"/><c:prop name="LOCATION"/>` +
    `<c:prop name="DTSTART"/><c:prop name="DTEND"/><c:prop name="STATUS"/><c:prop name="RECURRENCE-ID"/>` +
    `</c:comp></c:comp></c:calendar-data></d:prop>` +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">` +
    `<c:time-range start="${startDate.replaceAll('-', '')}T000000Z" end="${endDate.replaceAll('-', '')}T235959Z"/>` +
    `</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  async function davRequest(target, method, body, depth='0') {
    const headers = { Depth: depth, 'Content-Type': 'application/xml; charset=utf-8',
      Accept: 'application/xml, text/calendar' };
    let response;
    try {
      response = await fetchImpl(target, {
        method, signal: AbortSignal.timeout(20000),
        headers: { ...headers, Authorization: 'Basic ' + auth }, body
      });
    } catch {
      throw new Error('CalDAV-Verbindung fehlgeschlagen. Zugangsdaten wurden aus der Fehlermeldung ausgeblendet.');
    }
    let text = await response.text();
    if (!response.ok && response.status === 401) {
      const challengeHeader = response.headers?.get?.('www-authenticate') || '';
      const challenge = digestParams(challengeHeader);
      if (challenge) {
        const finalUrl = new URL(response.url || target, parsedUrl);
        if (finalUrl.origin !== target.origin)
          throw new Error('Teamerbase leitete die Digest-Anmeldung auf einen anderen Host um; Anmeldung aus Sicherheitsgründen abgebrochen.');
        const authorization = digestAuthorization(challenge, username, password, method, finalUrl, body);
        try {
          response = await fetchImpl(finalUrl, {
            method, signal: AbortSignal.timeout(20000),
            headers: { ...headers, Authorization: authorization }, body
          });
        } catch {
          throw new Error('CalDAV-Verbindung fehlgeschlagen. Zugangsdaten wurden aus der Fehlermeldung ausgeblendet.');
        }
        text = await response.text();
      }
    }
    if (!response.ok) {
      const finalUrl = new URL(response.url || target, parsedUrl);
      const challenge = response.headers?.get?.('www-authenticate') || '';
      const authScheme = challenge.match(/^\s*([A-Za-z][A-Za-z0-9_-]*)/)?.[1] || 'keine';
      const redirectInfo = response.redirected ? '; nach Weiterleitung' : '';
      throw new Error('CalDAV-Abruf fehlgeschlagen (HTTP ' + response.status + '; ' + method + ' an ' + finalUrl.host + finalUrl.pathname + '; Auth-Challenge ' + authScheme + redirectInfo + ').');
    }
    return text;
  }
  function hrefsWithin(xml, element) {
    const container = xml.match(new RegExp(`<(?:(?:[\\w.-]+):)?${element}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${element}>`, 'i'))?.[1] || '';
    return [...container.matchAll(/<(?:[\w.-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?href>/gi)]
      .map(match => xmlUnescape(match[1].trim()));
  }
  const discoveryBody = `<?xml version="1.0" encoding="utf-8"?>`+
    `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>`+
    `<d:current-user-principal/><c:calendar-home-set/></d:prop></d:propfind>`;
  const discovery = await davRequest(parsedUrl, 'PROPFIND', discoveryBody, '0');
  let homes = hrefsWithin(discovery, 'calendar-home-set');
  if (!homes.length) {
    const principal = hrefsWithin(discovery, 'current-user-principal');
    if (principal.length && new URL(principal[0], parsedUrl).href !== parsedUrl.href) {
      const principalUrl = new URL(principal[0], parsedUrl);
      const principalReply = await davRequest(principalUrl, 'PROPFIND', discoveryBody, '0');
      homes = hrefsWithin(principalReply, 'calendar-home-set');
    }
  }
  let collections = [];
  for (const home of homes) {
    const homeUrl = new URL(home, parsedUrl);
    const listingBody = `<?xml version="1.0" encoding="utf-8"?>`+
      `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>`+
      `<d:resourcetype/><d:displayname/></d:prop></d:propfind>`;
    const listing = await davRequest(homeUrl, 'PROPFIND', listingBody, '1');
    const responses = [...listing.matchAll(/<(?:[\w.-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?response>/gi)];
    collections.push(...responses.filter(match => /<(?:[\w.-]+:)?calendar\b/i.test(match[1]))
      .flatMap(match => hrefsWithin(match[1], 'href')).map(href => new URL(href, homeUrl)));
  }
  // If the configured URL is itself a calendar collection, query it directly.
  if (!collections.length && /\/calendars?\//i.test(parsedUrl.pathname)) collections = [parsedUrl];
  if (!collections.length) throw new Error('CalDAV konnte kein zugängliches Kalenderverzeichnis finden.');
  const allEvents = [];
  for (const calendarUrl of [...new Map(collections.map(item=>[item.href,item])).values()]) {
    const responseText = await davRequest(calendarUrl, 'REPORT', requestBody, '1');
    const blocks = [...responseText.matchAll(/<(?:[\w.-]+:)?calendar-data\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?calendar-data>/gi)]
      .map(match => xmlUnescape(match[1]));
    const text = blocks.length ? blocks.join('\n') : responseText.includes('BEGIN:VCALENDAR') ? responseText : '';
    if (text) allEvents.push(...parseCalendarEvents(text));
  }
  if (!allEvents.length) throw new Error('CalDAV-Antwort enthält keine Kalendertermine.');
  return allEvents;
}

function createTeamerbaseSync({ pool, env = process.env, fetchImpl = fetch }) {
  async function sync({ force = false } = {}) {
    if (!pool) throw new Error('Datenbank nicht konfiguriert.');
    if (!env.TEAMERBASE_CALDAV_URL || !env.TEAMERBASE_CALDAV_USER || !env.TEAMERBASE_CALDAV_PASSWORD)
      return { configured: false, skipped: true, reason: 'CalDAV-Zugang ist noch nicht eingerichtet.' };
    const client = await pool.connect();
    let locked = false;
    try {
      const lock = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_ID]);
      locked = lock.rows[0]?.locked === true;
      if (!locked) return { configured: true, skipped: true, reason: 'Ein Abgleich läuft bereits.' };
      const state = await client.query('SELECT zuletzt_geprueft_am FROM brilon_teamerbase_sync_status WHERE id=1');
      const last = state.rows[0]?.zuletzt_geprueft_am ? new Date(state.rows[0].zuletzt_geprueft_am).getTime() : 0;
      if (!force && Date.now() - last < SYNC_INTERVAL_MS)
        return { configured: true, skipped: true, naechstePruefung: new Date(last + SYNC_INTERVAL_MS).toISOString() };

      const events = await readCalendar({ url: env.TEAMERBASE_CALDAV_URL, username: env.TEAMERBASE_CALDAV_USER,
        password: env.TEAMERBASE_CALDAV_PASSWORD, fetchImpl });
      const target = String(env.TEAMERBASE_LOCATION_FILTER || 'Brilon').toLocaleLowerCase('de');
      const selected = events.filter(event => event.location.toLocaleLowerCase('de').includes(target) ||
        event.title.toLocaleLowerCase('de').includes(target)).map(event=>({
          ...event,location:event.location||target
        }));
      await client.query('BEGIN');
      for (const event of selected) {
        await client.query(`INSERT INTO brilon_teamerbase_programme(source_name,standort,angezeigter_name,zuletzt_gesehen_am)
          VALUES($1,$2,$1,NOW()) ON CONFLICT(source_name,standort) DO UPDATE SET zuletzt_gesehen_am=NOW()`,
        [event.title, event.location]);
        await client.query(`INSERT INTO brilon_teamerbase_termine(source_uid,titel,standort,datum,uhrzeit,enddatum,endzeit,ganztags,storniert,zuletzt_gesehen_am)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
          ON CONFLICT(source_uid) DO UPDATE SET titel=EXCLUDED.titel,standort=EXCLUDED.standort,
            datum=EXCLUDED.datum,uhrzeit=EXCLUDED.uhrzeit,enddatum=EXCLUDED.enddatum,endzeit=EXCLUDED.endzeit,
            ganztags=EXCLUDED.ganztags,storniert=EXCLUDED.storniert,zuletzt_gesehen_am=NOW()`,
        [event.sourceUid,event.title,event.location,event.datum,event.uhrzeit,event.enddatum,event.endzeit,event.ganztags,event.cancelled]);
      }
      await client.query(`INSERT INTO brilon_teamerbase_sync_status(id,zuletzt_geprueft_am,letzter_fehler,anzahl_termine)
        VALUES(1,NOW(),NULL,$1) ON CONFLICT(id) DO UPDATE SET zuletzt_geprueft_am=NOW(),letzter_fehler=NULL,anzahl_termine=EXCLUDED.anzahl_termine`,
      [selected.length]);
      await client.query('COMMIT');
      return { configured: true, synced: true, anzahlTermine: selected.length, geprueftAm: new Date().toISOString() };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      try {
        await client.query(`INSERT INTO brilon_teamerbase_sync_status(id,letzter_fehler)
          VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET letzter_fehler=EXCLUDED.letzter_fehler`, [String(error.message).slice(0,500)]);
      } catch {}
      throw error;
    } finally {
      if (locked) { try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]); } catch {} }
      client.release();
    }
  }

  return { sync };
}

module.exports = { createTeamerbaseSync, parseCalendarEvents, readCalendar };
  function hrefsWithin(xml, element) {
    const container = xml.match(new RegExp(`<(?:(?:[\\w.-]+):)?${element}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${element}>`, 'i'))?.[1] || '';
    return [...container.matchAll(/<(?:[\w.-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?href>/gi)]
      .map(match => xmlUnescape(match[1].trim()));
  }
  const discoveryBody = `<?xml version="1.0" encoding="utf-8"?>`+
    `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>`+
    `<d:current-user-principal/><c:calendar-home-set/></d:prop></d:propfind>`;
  const discovery = await davRequest(parsedUrl, 'PROPFIND', discoveryBody, '0');
  let homes = hrefsWithin(discovery, 'calendar-home-set');
  if (!homes.length) {
    const principal = hrefsWithin(discovery, 'current-user-principal');
    if (principal.length && new URL(principal[0], parsedUrl).href !== parsedUrl.href) {
      const principalUrl = new URL(principal[0], parsedUrl);
      const principalReply = await davRequest(principalUrl, 'PROPFIND', discoveryBody, '0');
      homes = hrefsWithin(principalReply, 'calendar-home-set');
    }
  }
  let collections = [];
  for (const home of homes) {
    const homeUrl = new URL(home, parsedUrl);
    const listingBody = `<?xml version="1.0" encoding="utf-8"?>`+
      `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>`+
      `<d:resourcetype/><d:displayname/></d:prop></d:propfind>`;
    const listing = await davRequest(homeUrl, 'PROPFIND', listingBody, '1');
    const responses = [...listing.matchAll(/<(?:[\w.-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?response>/gi)];
    collections.push(...responses.filter(match => /<(?:[\w.-]+:)?calendar\b/i.test(match[1]))
      .flatMap(match => hrefsWithin(match[1], 'href')).map(href => new URL(href, homeUrl)));
  }
  // If the configured URL is itself a calendar collection, query it directly.
  if (!collections.length && /\/calendars?\//i.test(parsedUrl.pathname)) collections = [parsedUrl];
  if (!collections.length) throw new Error('CalDAV konnte kein zugängliches Kalenderverzeichnis finden.');
  const allEvents = [];
  for (const calendarUrl of [...new Map(collections.map(item=>[item.href,item])).values()]) {
    const responseText = await davRequest(calendarUrl, 'REPORT', requestBody, '1');
    const blocks = [...responseText.matchAll(/<(?:[\w.-]+:)?calendar-data\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?calendar-data>/gi)]
      .map(match => xmlUnescape(match[1]));
    const text = blocks.length ? blocks.join('\n') : responseText.includes('BEGIN:VCALENDAR') ? responseText : '';
    if (text) allEvents.push(...parseCalendarEvents(text));
  }
  if (!allEvents.length) throw new Error('CalDAV-Antwort enthält keine Kalendertermine.');
  return allEvents;
}

function createTeamerbaseSync({ pool, env = process.env, fetchImpl = fetch }) {
  async function sync({ force = false } = {}) {
    if (!pool) throw new Error('Datenbank nicht konfiguriert.');
    if (!env.TEAMERBASE_CALDAV_URL || !env.TEAMERBASE_CALDAV_USER || !env.TEAMERBASE_CALDAV_PASSWORD)
      return { configured: false, skipped: true, reason: 'CalDAV-Zugang ist noch nicht eingerichtet.' };
    const client = await pool.connect();
    let locked = false;
    try {
      const lock = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_ID]);
      locked = lock.rows[0]?.locked === true;
      if (!locked) return { configured: true, skipped: true, reason: 'Ein Abgleich läuft bereits.' };
      const state = await client.query('SELECT zuletzt_geprueft_am FROM brilon_teamerbase_sync_status WHERE id=1');
      const last = state.rows[0]?.zuletzt_geprueft_am ? new Date(state.rows[0].zuletzt_geprueft_am).getTime() : 0;
      if (!force && Date.now() - last < SYNC_INTERVAL_MS)
        return { configured: true, skipped: true, naechstePruefung: new Date(last + SYNC_INTERVAL_MS).toISOString() };

      const events = await readCalendar({ url: env.TEAMERBASE_CALDAV_URL, username: env.TEAMERBASE_CALDAV_USER,
        password: env.TEAMERBASE_CALDAV_PASSWORD, fetchImpl });
      const target = String(env.TEAMERBASE_LOCATION_FILTER || 'Brilon').toLocaleLowerCase('de');
      const selected = events.filter(event => event.location.toLocaleLowerCase('de').includes(target) ||
        event.title.toLocaleLowerCase('de').includes(target)).map(event=>({
          ...event,location:event.location||target
        }));
      await client.query('BEGIN');
      for (const event of selected) {
        await client.query(`INSERT INTO brilon_teamerbase_programme(source_name,standort,angezeigter_name,zuletzt_gesehen_am)
          VALUES($1,$2,$1,NOW()) ON CONFLICT(source_name,standort) DO UPDATE SET zuletzt_gesehen_am=NOW()`,
        [event.title, event.location]);
        await client.query(`INSERT INTO brilon_teamerbase_termine(source_uid,titel,standort,datum,uhrzeit,enddatum,endzeit,ganztags,storniert,zuletzt_gesehen_am)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
          ON CONFLICT(source_uid) DO UPDATE SET titel=EXCLUDED.titel,standort=EXCLUDED.standort,
            datum=EXCLUDED.datum,uhrzeit=EXCLUDED.uhrzeit,enddatum=EXCLUDED.enddatum,endzeit=EXCLUDED.endzeit,
            ganztags=EXCLUDED.ganztags,storniert=EXCLUDED.storniert,zuletzt_gesehen_am=NOW()`,
        [event.sourceUid,event.title,event.location,event.datum,event.uhrzeit,event.enddatum,event.endzeit,event.ganztags,event.cancelled]);
      }
      await client.query(`INSERT INTO brilon_teamerbase_sync_status(id,zuletzt_geprueft_am,letzter_fehler,anzahl_termine)
        VALUES(1,NOW(),NULL,$1) ON CONFLICT(id) DO UPDATE SET zuletzt_geprueft_am=NOW(),letzter_fehler=NULL,anzahl_termine=EXCLUDED.anzahl_termine`,
      [selected.length]);
      await client.query('COMMIT');
      return { configured: true, synced: true, anzahlTermine: selected.length, geprueftAm: new Date().toISOString() };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      try {
        await client.query(`INSERT INTO brilon_teamerbase_sync_status(id,letzter_fehler)
          VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET letzter_fehler=EXCLUDED.letzter_fehler`, [String(error.message).slice(0,500)]);
      } catch {}
      throw error;
    } finally {
      if (locked) { try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]); } catch {} }
      client.release();
    }
  }

  return { sync };
}

module.exports = { createTeamerbaseSync, parseCalendarEvents, readCalendar };
