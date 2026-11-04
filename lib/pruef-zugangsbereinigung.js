'use strict';

function createPruefzugangsbereinigung({pool}){
  async function bereinige(){
    if(!pool)return {sitzungen:0,pruefcodes:0,kopplungscodes:0,einladungen:0};
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
    const result={...(q.rows[0]||{sitzungen:0,pruefcodes:0,kopplungscodes:0}),einladungen:0};
    // Older installations may not yet have applied the opt-in invitation migration.
    // Keep the existing session/code cleanup operational until it is installed.
    const table=await pool.query("SELECT to_regclass('brilon_pruef_einladungen') AS name");
    if(table.rows[0]?.name){
      const invitations=await pool.query(`DELETE FROM brilon_pruef_einladungen
        WHERE verwendet_am IS NOT NULL OR widerrufen_am IS NOT NULL OR ablauf<=NOW()`);
      result.einladungen=invitations.rowCount||0;
    }
    return result;
  }
  return {bereinige};
}

module.exports={createPruefzugangsbereinigung};
