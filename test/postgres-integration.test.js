'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { heuteInBerlin } = require('../lib/kalendertag');

const integrationUrl = process.env.PG_INTEGRATION_URL;

test('Echte PostgreSQL: parallele Buchungen, Kapazität und Eindeutigkeit',
  { skip: integrationUrl ? false : 'Nur mit isolierter PG_INTEGRATION_URL aktiv' }, async t => {
  const dbUrl = new URL(integrationUrl);
  if (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname) ||
      dbUrl.pathname !== '/brilon_test' || dbUrl.username !== 'brilon_ci')
    throw new Error('Integrationstests dürfen nur die lokale Datenbank brilon_test mit Benutzer brilon_ci verwenden.');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: integrationUrl, ssl: false });
  t.after(async () => pool.end());
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const repo = path.resolve(__dirname, '..');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: repo, stdio: ['ignore', 'ignore', 'pipe'], env: {
      ...process.env, PORT: String(port), DATABASE_URL: integrationUrl,
      DATABASE_SSL_MODE: 'disable', RUN_SCHEMA_MIGRATIONS: 'true',
      BREVO_API_KEY: '', BREVO_SENDER_EMAIL: '', BOOKING_NOTIFY_EMAIL: '',
      SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', NODE_PATH: '', MOCK_PG: ''
    }
  });
  t.after(() => child.kill());
  let errors = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { errors += chunk; });
  const root = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { await fetch(root + '/index.html'); ready = true; break; }
    catch { if (child.exitCode !== null) break; await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.ok(ready, `PostgreSQL-Testserver konnte nicht starten: ${errors}`);

  const programName = 'CI-Postgres-Klettern-' + crypto.randomUUID();
  await pool.query(`INSERT INTO brilon_angebote
    (name,beschreibung,dauer,preise,aktiv,kapazitaet,buchbar,veroeffentlicht)
    VALUES ($1,'Isolierter Integrationstest',60,$2::jsonb,true,5,true,true)`,
  [programName, JSON.stringify({ '1-4': 100 })]);
  const day1 = heuteInBerlin(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const day2 = heuteInBerlin(Date.now() + 8 * 24 * 60 * 60 * 1000);
  const book = (name, date, time) => fetch(root + '/api/buchungen', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vorname: name, nachname: 'Postgres', email: `${name}@example.test`,
      datum: date, uhrzeit: time, teilnehmer: 3, angebot: programName, datenschutz: 'on' })
  });
  const capacity = await Promise.all([book('CIAlpha', day1, '10:00'), book('CIBeta', day1, '11:00')]);
  assert.deepEqual(capacity.map(response => response.status).sort(), [201, 409],
    'Zwei parallele, nicht überlappende Dreiergruppen dürfen die Tageskapazität von fünf nicht überschreiten');
  const overlap = await Promise.all([book('CIGamma', day2, '10:00'), book('CIDelta', day2, '10:00')]);
  assert.deepEqual(overlap.map(response => response.status).sort(), [201, 409],
    'Parallele Zugriffe dürfen dasselbe Zeitfenster nicht doppelt reservieren');
  const saved = await pool.query(`SELECT id,buchungsnummer FROM brilon_buchungen
    WHERE data->>'angebot'=$1`, [programName]);
  assert.equal(saved.rowCount, 2, 'In der echten Datenbank dürfen nur zwei Testbuchungen gespeichert sein');
  assert.equal(new Set(saved.rows.map(row => row.buchungsnummer)).size, 2,
    'Buchungsnummern bleiben eindeutig');
  await assert.rejects(() => pool.query(`INSERT INTO brilon_buchungen
    (id,data,status,buchungsnummer) VALUES ($1,'{}'::jsonb,'offen',$2)`,
    [crypto.randomUUID(), saved.rows[0].buchungsnummer]),
  error => error.code === '23505', 'PostgreSQL-Unique-Index muss doppelte Referenzen verhindern');
});
