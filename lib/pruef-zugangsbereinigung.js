'use strict';

function createPruefzugangsbereinigung({pool}){
  async function bereinige(){
    if(!pool)return {sitzungen:0,pruefcodes:0,kopplungscodes:0};
    const q=await pool.query(`
      WITH abgelaufene_sitzungen AS (
        DELETE FROM brilon_pruef_sessions WHERE ablauf<=NOW() RETURNING 1
      ), abgelaufene_pruefcodes AS (
        DELETE FROM brilon_pruef_codes WHERE ablauf<=NOW() RETURNING 1
      ), verwendete_kopplungscodes AS (
        DELETE FROM brilon_pruef_tablet_kopplungen
        WHERE verwendet_am IS NOT NULL OR ablauf<=NOW() RETURNING 1
      )
      SELECT
        (SELECT COUNT(*) FROM abgelaufene_sitzungen)::integer AS sitzungen,
        (SELECT COUNT(*) FROM abgelaufene_pruefcodes)::integer AS pruefcodes,
        (SELECT COUNT(*) FROM verwendete_kopplungscodes)::integer AS kopplungscodes
    `);
    return q.rows[0]||{sitzungen:0,pruefcodes:0,kopplungscodes:0};
  }
  return {bereinige};
}

module.exports={createPruefzugangsbereinigung};
