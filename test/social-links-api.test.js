'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSocialLinksApi } = require('../lib/social-links-api');
const { standard } = require('../lib/social-links');

function fixture({ stored = null, missingTable = false, authorized = true, requestBody = null } = {}) {
  const calls = [];
  const pool = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT kanaele')) {
      if (missingTable) throw Object.assign(new Error('missing'), { code: '42P01' });
      return { rows: stored ? [{ kanaele: stored }] : [] };
    }
    return { rows: [], rowCount: 1 };
  } };
  const replies = [];
  const api = createSocialLinksApi({ pool,
    admin: async (_req, _res) => {
      if (!authorized) replies.push({ status: 401, payload: { error: 'Bitte anmelden.' } });
      return authorized;
    },
    reply: (_res, status, payload) => replies.push({ status, payload }),
    body: async () => requestBody
  });
  return { api, calls, replies };
}

test('Öffentliche Social-Links liefern nur aktivierte und geprüfte Kanäle', async () => {
  const stored = standard().map(item => item.id === 'instagram'
    ? { ...item, url: 'https://instagram.com/klettern', aktiv: true } : item);
  const x = fixture({ stored });
  assert.equal(await x.api({ method: 'GET' }, {}, '/api/social-links'), true);
  assert.deepEqual(x.replies[0].payload.kanäle.map(item => item.id), ['whatsapp','instagram']);
});

test('Fehlende Social-Link-Tabelle unterbricht keine öffentliche Seite', async () => {
  const x = fixture({ missingTable: true });
  assert.equal(await x.api({ method: 'GET' }, {}, '/api/social-links'), true);
  assert.deepEqual(x.replies[0].payload.kanäle.map(item => item.id), ['whatsapp']);
});

test('Verwaltung lädt sichere Standardwerte und speichert validierte Kanäle', async () => {
  const requestBody = { kanäle: standard().map(item => item.id === 'whatsapp'
    ? { ...item, url: 'https://wa.me/4912345678', aktiv: true } : item) };
  const x = fixture({ requestBody });
  await x.api({ method: 'GET' }, {}, '/api/admin/social-links');
  assert.equal(x.replies[0].status, 200);
  assert.equal(x.replies[0].payload.kanäle.length, 6);
  await x.api({ method: 'PUT' }, {}, '/api/admin/social-links');
  assert.equal(x.replies[1].status, 200);
  assert.ok(x.calls.some(call => call.sql.includes('INSERT INTO brilon_social_links')));
});

test('Social-Link-Änderungen bleiben ohne Adminfreigabe gesperrt', async () => {
  const x = fixture({ authorized: false });
  assert.equal(await x.api({ method: 'PUT' }, {}, '/api/admin/social-links'), true);
  assert.equal(x.calls.length, 0);
  assert.equal(x.replies[0].status, 401);
});
