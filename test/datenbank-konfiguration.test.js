'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { datenbankKonfiguration } = require('../lib/datenbank-konfiguration');

test('Datenbank benutzt standardmäßig überprüfte TLS-Verbindungen', () => {
  assert.equal(datenbankKonfiguration('', undefined, ''), null);
  assert.deepEqual(datenbankKonfiguration('postgres://example.invalid/db', 'test-ca', ''),
    { connectionString: 'postgres://example.invalid/db', ssl: { ca: 'test-ca', rejectUnauthorized: true } });
});

test('Unverschlüsselte Datenbankverbindung ist ausschließlich lokal möglich', () => {
  assert.deepEqual(datenbankKonfiguration('postgresql://test@127.0.0.1:5432/brilon_test', undefined, 'disable'),
    { connectionString: 'postgresql://test@127.0.0.1:5432/brilon_test', ssl: false });
  assert.throws(() => datenbankKonfiguration('postgresql://example.com/live', undefined, 'disable'), /nur für eine lokale/);
  assert.throws(() => datenbankKonfiguration('postgrest://localhost/db', undefined, 'disable'), /nur für eine lokale/);
  assert.throws(() => datenbankKonfiguration('not-a-database-url', undefined, 'disable'), /Ungültige/);
});
