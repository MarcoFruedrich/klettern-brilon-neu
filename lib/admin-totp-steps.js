'use strict';

function createTotpStepStore({pool,steps=new Map(),uhr=Date.now}={}){
  async function einmalig(factorId,step){
    const aeltesterGueltigerSchritt=Math.floor(uhr()/30000)-1;
    if(pool){
      const q=await pool.query(`
        WITH veraltete_schritte AS (
          DELETE FROM brilon_admin_totp_steps WHERE factor_id<>$1 AND last_step<$3
        )
        INSERT INTO brilon_admin_totp_steps(factor_id,last_step) VALUES($1,$2)
        ON CONFLICT(factor_id) DO UPDATE SET last_step=EXCLUDED.last_step
        WHERE brilon_admin_totp_steps.last_step<EXCLUDED.last_step
        RETURNING last_step`,[factorId,step,aeltesterGueltigerSchritt]);
      return q.rowCount===1;
    }

    for(const [gespeicherterFaktor,gespeicherterSchritt] of steps){
      if(Number.isSafeInteger(gespeicherterSchritt)&&gespeicherterSchritt<aeltesterGueltigerSchritt)
        steps.delete(gespeicherterFaktor);
    }
    const vorher=steps.get(factorId);
    if(Number.isSafeInteger(vorher)&&vorher>=step)return false;
    steps.set(factorId,step);
    return true;
  }

  return {einmalig};
}

module.exports={createTotpStepStore};
