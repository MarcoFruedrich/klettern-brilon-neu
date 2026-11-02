'use strict';

function datenbankKonfiguration(url, ca, sslMode) {
  if (!url) return null;
  if (sslMode === 'disable') {
    let parsed;
    try { parsed = new URL(url); }
    catch { throw new Error('Ungültige lokale Testdatenbank-URL.'); }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
        !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
      throw new Error('TLS kann nur für eine lokale PostgreSQL-Testdatenbank deaktiviert werden.');
    return { connectionString: url, ssl: false };
  }
  return { connectionString: url, ssl: { ca, rejectUnauthorized: true } };
}

module.exports = { datenbankKonfiguration };
