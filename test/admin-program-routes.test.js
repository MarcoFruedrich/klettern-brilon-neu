'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const server = readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const start = server.indexOf('const angebotLoeschenRoute=');
const end = server.indexOf("if (route === '/api/admin/angebote' && req.method === 'POST')", start);
assert.ok(start >= 0 && end > start, 'Admin-Programmrouten müssen vorhanden sein');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runRoute = new AsyncFunction('route', 'req', 'res', 'pool', 'body', 'reply', server.slice(start, end));

function fakeDb(options = {}) {
  const seen = [];
  const query = async (sql) => {
    seen.push(sql);
    if (/^(BEGIN|ROLLBACK|COMMIT)$/.test(sql)) return { rowCount: 0, rows: [] };
    if (sql.includes('SELECT id,name FROM brilon_angebote')) return { rowCount: 1, rows: [{ id: 7, name: 'Testprogramm' }] };
    if (sql.includes('SELECT 1 FROM brilon_buchungen')) return { rowCount: options.booked ? 1 : 0, rows: [] };
    if (sql.includes("to_regclass('brilon_gps_touren')")) return { rowCount: 1, rows: [{ tabellenname: options.gpsTable ? 'brilon_gps_touren' : null }] };
    if (sql.includes('SELECT 1 FROM brilon_gps_touren')) return { rowCount: options.gpsLinked ? 1 : 0, rows: [] };
    if (sql.includes('SELECT id FROM brilon_gps_touren')) return { rowCount: options.activeTour ? 1 : 0, rows: [] };
    if (sql.includes('DELETE FROM brilon_angebote')) return { rowCount: 1, rows: [] };
    if (sql.includes('UPDATE brilon_angebote SET archiviert')) return { rowCount: 1, rows: [{ id: 7, archiviert: true }] };
    throw Error('Unexpected query: ' + sql);
  };
  return { seen, pool: { query, connect: async () => ({ query, release: () => {} }) } };
}

const reply = (_res, status, payload) => ({ status, payload });
const requestBody = async () => ({ archiviert: true });

test('ungebuchtes Programm ohne GPS-Tabelle dauerhaft löschen', async () => {
  const db = fakeDb({ gpsTable: false });
  const response = await runRoute('/api/admin/angebote/7', { method: 'DELETE' }, {}, db.pool, requestBody, reply);
  assert.equal(response.status, 200);
  assert.equal(response.payload.success, true);
  assert.ok(db.seen.some(sql => sql.includes('DELETE FROM brilon_angebote')));
  assert.ok(!db.seen.some(sql => sql.includes('SELECT 1 FROM brilon_gps_touren')));
});

test('gebuchte Programme dürfen nicht dauerhaft gelöscht werden', async () => {
  const db = fakeDb({ booked: true });
  const response = await runRoute('/api/admin/angebote/7', { method: 'DELETE' }, {}, db.pool, requestBody, reply);
  assert.equal(response.status, 409);
  assert.ok(!db.seen.some(sql => sql.includes('DELETE FROM brilon_angebote')));
});

test('Programme mit verknüpfter GPS-Tour dürfen nicht gelöscht werden', async () => {
  const db = fakeDb({ gpsTable: true, gpsLinked: true });
  const response = await runRoute('/api/admin/angebote/7', { method: 'DELETE' }, {}, db.pool, requestBody, reply);
  assert.equal(response.status, 409);
  assert.ok(!db.seen.some(sql => sql.includes('DELETE FROM brilon_angebote')));
});

test('ohne GPS-Tabelle muss Programm-Archivierung funktionieren', async () => {
  const db = fakeDb({ gpsTable: false });
  const response = await runRoute('/api/admin/angebote/7/archivieren', { method: 'PATCH' }, {}, db.pool, requestBody, reply);
  assert.equal(response.status, 200);
  assert.equal(response.payload.archiviert, true);
  assert.ok(!db.seen.some(sql => sql.includes('SELECT id FROM brilon_gps_touren')));
});

test('eine aktive GPS-Tour verhindert Archivierung', async () => {
  const db = fakeDb({ gpsTable: true, activeTour: true });
  const response = await runRoute('/api/admin/angebote/7/archivieren', { method: 'PATCH' }, {}, db.pool, requestBody, reply);
  assert.equal(response.status, 409);
  assert.ok(!db.seen.some(sql => sql.includes('UPDATE brilon_angebote SET archiviert')));
});
