'use strict';

const { standard, normalisiereGespeichert, validiereAenderung, fuerWebsite } = require('./social-links');

function createSocialLinksApi({ pool, admin, reply, body }) {
  return async function socialLinksApi(req, res, route) {
    if (route === '/api/social-links' && req.method === 'GET') {
      if (!pool) { reply(res, 200, { kanäle: [] }); return true; }
      try {
        const q = await pool.query('SELECT kanaele FROM brilon_social_links WHERE id=1');
        reply(res, 200, { kanäle: fuerWebsite(normalisiereGespeichert(q.rows[0]?.kanaele)) });
      } catch (error) {
        if (error?.code === '42P01') { reply(res, 200, { kanäle: fuerWebsite(standard()) }); return true; }
        throw error;
      }
      return true;
    }

    if (route !== '/api/admin/social-links' || !['GET', 'PUT'].includes(req.method)) return false;
    if (!await admin(req, res)) return true;
    if (!pool) { reply(res, 503, { error: 'Datenbank nicht konfiguriert.' }); return true; }
    await pool.query(`CREATE TABLE IF NOT EXISTS brilon_social_links (
      id SMALLINT PRIMARY KEY CHECK(id=1), kanaele JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    if (req.method === 'GET') {
      const q = await pool.query('SELECT kanaele FROM brilon_social_links WHERE id=1');
      reply(res, 200, { kanäle: normalisiereGespeichert(q.rows[0]?.kanaele) });
      return true;
    }

    const d = await body(req, 12000);
    let channels;
    try { channels = validiereAenderung(d); }
    catch (error) {
      reply(res, 400, { error: error.message || 'Ungültige Social-Media-Einstellungen.' });
      return true;
    }
    await pool.query(`INSERT INTO brilon_social_links(id,kanaele) VALUES(1,$1::jsonb)
      ON CONFLICT(id) DO UPDATE SET kanaele=EXCLUDED.kanaele,updated_at=NOW()`, [JSON.stringify(channels)]);
    reply(res, 200, { kanäle: channels });
    return true;
  };
}

module.exports = { createSocialLinksApi };
