'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { abgelaufeneEintraegeEntfernen, erstelleRateLimiter, adminLoginErlauben } = require('../lib/sicherheitszustand');
const { createTotpStepStore } = require('../lib/admin-totp-steps');

test('Rate-Limits zählen pro Schlüssel und verfallen nach dem Zeitfenster', () => {
  let jetzt = 1000;
  const limit = erstelleRateLimiter({ uhr: () => jetzt });
  assert.equal(limit.erlauben('ip-a', 2, 1000), true);
  assert.equal(limit.erlauben('ip-a', 2, 1000), true);
  assert.equal(limit.erlauben('ip-a', 2, 1000), false);
  assert.equal(limit.erlauben('ip-b', 2, 1000), true);
  jetzt = 2001;
  assert.equal(limit.erlauben('ip-a', 2, 1000), true);
});

test('Rate-Limit-Schlüssel sind begrenzt und abgelaufene Buckets werden entfernt', () => {
  let jetzt = 1000;
  const limit = erstelleRateLimiter({ maxSchluessel: 2, bereinigungAlle: 99, uhr: () => jetzt });
  assert.equal(limit.erlauben('a', 1, 1000), true);
  assert.equal(limit.erlauben('b', 1, 1000), true);
  assert.equal(limit.erlauben('c', 1, 1000), false);
  jetzt = 601001;
  assert.equal(limit.erlauben('c', 1, 1000), true);
  assert.equal(limit.anzahlSchluessel(), 1);
});

test('Admin-Login begrenzt Versuche zusätzlich kontoweit trotz wechselnder IPs',()=>{
  const limiter=erstelleRateLimiter();
  for(let i=0;i<30;i++)assert.equal(adminLoginErlauben(limiter,'ip-'+i,'konto-hash'),true);
  assert.equal(adminLoginErlauben(limiter,'neue-ip','konto-hash'),false);
});

test('Admin-Login begrenzt auch wiederholte Versuche derselben IP',()=>{
  const limiter=erstelleRateLimiter();
  for(let i=0;i<6;i++)assert.equal(adminLoginErlauben(limiter,'gleiche-ip','konto-'+i),true);
  assert.equal(adminLoginErlauben(limiter,'gleiche-ip','anderes-konto'),false);
});

test('Sitzungsbereinigung entfernt nur abgelaufene oder ungültige Ablaufwerte', () => {
  const sessions = new Map([['expired', 99], ['active', 101], ['invalid', NaN]]);
  abgelaufeneEintraegeEntfernen(sessions, 100);
  assert.deepEqual([...sessions.keys()], ['active']);
});

test('TOTP-Wiederverwendungsmarker bleiben im gültigen Zeitfenster erhalten und veraltete werden entfernt',async()=>{
  let jetzt=3_000_000;
  const steps=new Map([['veraltet',98],['vorheriger-schritt',99]]);
  const store=createTotpStepStore({steps,uhr:()=>jetzt});
  assert.equal(await store.einmalig('faktor',100),true);
  assert.equal(steps.has('veraltet'),false);
  assert.equal(steps.get('vorheriger-schritt'),99,'Der noch akzeptierte vorherige TOTP-Schritt bleibt geschützt');
  assert.equal(await store.einmalig('faktor',100),false,'Ein benutzter Code bleibt im gültigen Zeitfenster gesperrt');
  jetzt=3_030_000;
  assert.equal(await store.einmalig('faktor',101),true);
  assert.equal(steps.has('vorheriger-schritt'),false,'Ein nicht mehr akzeptierter Schritt wird entfernt');
});

test('PostgreSQL-TOTP-Bereinigung und Einmalverwendung erfolgen in einem Statement',async()=>{
  let sql,args;
  const store=createTotpStepStore({pool:{async query(statement,values){
    sql=statement;args=values;return {rowCount:1};
  }},uhr:()=>3_000_000});
  assert.equal(await store.einmalig('faktor-hash',100),true);
  assert.match(sql,/DELETE FROM brilon_admin_totp_steps WHERE factor_id<>\$1 AND last_step<\$3/);
  assert.match(sql,/ON CONFLICT\(factor_id\) DO UPDATE/);
  assert.deepEqual(args,['faktor-hash',100,99]);
});
