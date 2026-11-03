'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { erzeugeZugang } = require('../lib/anschlussangebote');

test('HTTP: vergangene Buchungstage sind auch über alte Anschlusslinks nicht buchbar', async t => {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const repo = path.resolve(__dirname, '..');
  const preload = path.join(repo, 'test-support', 'mocks', 'force-mock-modules.js');
  const secret = 'isolated-booking-link-test-secret-123456789';
  const parentId = '550e8400-e29b-41d4-a716-446655440000';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: repo, stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env, PORT: String(port),
      NODE_PATH: path.join(repo, 'test-support', 'mocks'),
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${preload}`].filter(Boolean).join(' '),
      DATABASE_URL: 'mock-test-database', MOCK_PG: '1',
      MOCK_OFFERS: JSON.stringify([
        { id: 1, name: 'Klettern', preise: { '1-4': 100 }, kapazitaet: 10, dauer: 60,
          aktiv: true, buchbar: true, veroeffentlicht: true, verfuegbare_termine: [] },
        { id: 2, name: 'Bouldern', preise: { '1-4': 80 }, kapazitaet: 10, dauer: 60,
          aktiv: true, buchbar: true, veroeffentlicht: true, verfuegbare_termine: [] }
      ]),
      MOCK_BOOKINGS: JSON.stringify([{ id: parentId, status: 'bestaetigt', buchungsnummer: 'ALT-ELTERN-010126',
        data: { vorname: 'Alt', nachname: 'Eltern', name: 'Alt Eltern', email: 'alt@example.test',
          datum: '2026-01-01', uhrzeit: '10:00', dauer: 60, teilnehmer: 2, angebot: 'Klettern',
          gesamtpreis: 100, zahlungen: [] } }]),
      MOCK_CALENDAR: '[]', RUN_SCHEMA_MIGRATIONS: 'false', BOOKING_OFFER_SECRET: secret,
      BREVO_API_KEY: '', BREVO_SENDER_EMAIL: '', SUPABASE_URL: '', SUPABASE_SECRET_KEY: ''
    }
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { stderr += data; });
  t.after(() => child.kill());
  const root = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { await fetch(root + '/index.html'); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.equal(ready, true, `Testserver startet nicht: ${stderr}`);

  const historicalBooking = await fetch(root + '/api/buchungen', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vorname: 'Test', nachname: 'Person', email: 'test@example.test',
      datum: '2026-01-01', uhrzeit: '10:00', teilnehmer: 2,
      angebot: 'Klettern', datenschutz: 'on' })
  });
  assert.equal(historicalBooking.status, 400, 'Vergangene Daten dürfen nicht neu gebucht werden');

  const token = erzeugeZugang(parentId, secret);
  const preview = await fetch(root + '/api/anschlussangebote/vorschau', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zugang: token })
  });
  assert.equal(preview.status, 200);
  assert.deepEqual((await preview.json()).programme, [], 'Alte Bestätigungen zeigen keine neuen Angebote');

  const addon = await fetch(root + '/api/anschlussangebote/buchen', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zugang: token, programmId: '2', uhrzeit: '11:00' })
  });
  assert.equal(addon.status, 409, `Vergangene Zusatzbuchung muss abgewiesen werden: ${stderr}`);
  assert.match((await addon.json()).error, /vergangenen/);
});
