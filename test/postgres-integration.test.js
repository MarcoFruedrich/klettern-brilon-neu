'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { heuteInBerlin } = require('../lib/kalendertag');
const { totpCode } = require('../lib/totp');
const totpSecret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

const integrationUrl = process.env.PG_INTEGRATION_URL;

test('Echte PostgreSQL: parallele Buchungen, Kapazität und Eindeutigkeit',
  { skip: integrationUrl ? false : 'Nur mit isolierter PG_INTEGRATION_URL aktiv' }, async t => {
  const dbUrl = new URL(integrationUrl);
  if (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname) ||
      dbUrl.pathname !== '/brilon_test' || dbUrl.username !== 'brilon_ci')
    throw new Error('Integrationstests dürfen nur die lokale Datenbank brilon_test mit Benutzer brilon_ci verwenden.');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: integrationUrl, ssl: false });
  t.after(async () => pool.end());
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const repo = path.resolve(__dirname, '..');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: repo, stdio: ['ignore', 'ignore', 'pipe'], env: {
      ...process.env, PORT: String(port), DATABASE_URL: integrationUrl,
      DATABASE_SSL_MODE: 'disable', RUN_SCHEMA_MIGRATIONS: 'true',
      BREVO_API_KEY: '', BREVO_SENDER_EMAIL: '', BOOKING_NOTIFY_EMAIL: '',
      SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', NODE_PATH: '', MOCK_PG: '',
      ADMIN_USER: 'brilon-ci', ADMIN_PASSWORD: 'local-only-password',
      ADMIN_TOTP_SECRET_BASE32: totpSecret,
      STATION_CHECK_SECRET: 'ci-only-check-code-secret-000000000000000000000000',
      PRUEF_MANGEL_EMAIL: ''
    }
  });
  t.after(() => child.kill());
  let errors = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { errors += chunk; });
  const root = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { await fetch(root + '/index.html'); ready = true; break; }
    catch { if (child.exitCode !== null) break; await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.ok(ready, `PostgreSQL-Testserver konnte nicht starten: ${errors}`);

  const programName = 'CI-Postgres-Klettern-' + crypto.randomUUID();
  await pool.query(`INSERT INTO brilon_angebote
    (name,beschreibung,dauer,preise,aktiv,kapazitaet,buchbar,veroeffentlicht)
    VALUES ($1,'Isolierter Integrationstest',60,$2::jsonb,true,5,true,true)`,
  [programName, JSON.stringify({ '1-4': 100 })]);
  const day1 = heuteInBerlin(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const day2 = heuteInBerlin(Date.now() + 8 * 24 * 60 * 60 * 1000);
  const book = (name, date, time) => fetch(root + '/api/buchungen', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vorname: name, nachname: 'Postgres', email: `${name}@example.test`,
      datum: date, uhrzeit: time, teilnehmer: 3, angebot: programName, datenschutz: 'on' })
  });
  const capacity = await Promise.all([book('CIAlpha', day1, '10:00'), book('CIBeta', day1, '11:00')]);
  assert.deepEqual(capacity.map(response => response.status).sort(), [201, 409],
    'Zwei parallele, nicht überlappende Dreiergruppen dürfen die Tageskapazität von fünf nicht überschreiten');
  const overlap = await Promise.all([book('CIGamma', day2, '10:00'), book('CIDelta', day2, '10:00')]);
  assert.deepEqual(overlap.map(response => response.status).sort(), [201, 409],
    'Parallele Zugriffe dürfen dasselbe Zeitfenster nicht doppelt reservieren');
  const saved = await pool.query(`SELECT id,buchungsnummer FROM brilon_buchungen
    WHERE data->>'angebot'=$1`, [programName]);
  assert.equal(saved.rowCount, 2, 'In der echten Datenbank dürfen nur zwei Testbuchungen gespeichert sein');
  assert.equal(new Set(saved.rows.map(row => row.buchungsnummer)).size, 2,
    'Buchungsnummern bleiben eindeutig');
  await assert.rejects(() => pool.query(`INSERT INTO brilon_buchungen
    (id,data,status,buchungsnummer) VALUES ($1,'{}'::jsonb,'offen',$2)`,
    [crypto.randomUUID(), saved.rows[0].buchungsnummer]),
  error => error.code === '23505', 'PostgreSQL-Unique-Index muss doppelte Referenzen verhindern');

  // 125 Testbuchungen mit identischem Zeitstempel: Paginierung muss deterministisch bleiben.
  await pool.query(`
    INSERT INTO brilon_buchungen(id,data,status,buchungsnummer,created_at)
    SELECT gen_random_uuid(),
      jsonb_build_object('name','CI Massentest '||lpad(i::text,3,'0'),
        'datum',$1::text,'angebot',$2::text,'gesamtpreis',100,
        'zahlungen','[]'::jsonb,'buchungsnummer','CI-MASS-'||lpad(i::text,3,'0')),
      CASE WHEN i<=75 THEN 'offen' ELSE 'bestaetigt' END,
      'CI-MASS-'||lpad(i::text,3,'0'), '2027-01-01T10:00:00Z'::timestamptz
    FROM generate_series(1,125) AS i`,[day1,programName]);

  const otp=totpCode(totpSecret,Math.floor(Date.now()/30000));
  const login=await fetch(root+'/api/admin/login',{method:'POST',
    headers:{Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({username:'brilon-ci',password:'local-only-password',totp:otp})});
  assert.equal(login.status,200,'Der Admin-Zugang muss mit isoliertem PostgreSQL funktionieren');
  const cookie=login.headers.get('set-cookie')?.split(';',1)[0];
  assert.ok(cookie,'Geschützte Testabfragen benötigen das Session-Cookie');
  const query=async params=>{
    const response=await fetch(root+'/api/admin/buchungen?'+new URLSearchParams(params),
      {headers:{Cookie:cookie}});
    assert.equal(response.status,200);
    return response.json();
  };
  const pages=[];
  for(let pageNumber=1;pageNumber<=3;pageNumber++){
    const result=await query({seite:String(pageNumber)});
    assert.equal(result.anzahl,127);
    assert.equal(result.proSeite,50);
    pages.push(result.buchungen);
  }
  assert.deepEqual(pages.map(rows=>rows.length),[50,50,27],
    '127 echte Testbuchungen müssen auf drei Seiten verteilt sein');
  const ids=pages.flat().map(row=>row.id);
  assert.equal(new Set(ids).size,127,
    'Bei identischen Erstellungszeiten darf keine Buchung mehrfach erscheinen');
  const firstPageAgain=await query({seite:'1'});
  assert.deepEqual(firstPageAgain.buchungen.map(row=>row.id),pages[0].map(row=>row.id),
    'Bei gleichen Zeitstempeln muss die Reihenfolge reproduzierbar bleiben');
  const confirmed=await query({seite:'1',status:'bestaetigt'});
  assert.equal(confirmed.anzahl,50);
  assert.ok(confirmed.buchungen.every(row=>row.status==='bestaetigt'));
  const found=await query({seite:'1',suche:'CI Massentest 120'});
  assert.equal(found.anzahl,1);
  assert.equal(found.buchungen[0].data.name,'CI Massentest 120');
  const payments=await fetch(root+'/api/admin/zahlungsuebersicht?seite=3',
    {headers:{Cookie:cookie}});
  assert.equal(payments.status,200);
  const paymentPage=await payments.json();
  assert.equal(paymentPage.anzahl,127);
  assert.equal(paymentPage.eintraege.length,27);

  // Mehr als 250 GPS-relevante Buchungen in einer echten isolierten Datenbank.
  const gpsTourId=crypto.randomUUID();
  const gpsOffer='GPS CI Ausflug '+crypto.randomUUID();
  await pool.query(`INSERT INTO brilon_gps_touren(id,data,aktiv)
    VALUES ($1,$2::jsonb,true)`,[gpsTourId,JSON.stringify({
    titel:'CI-GPS-Tour',angebotName:gpsOffer,buchbar:true
  })]);
  await pool.query(`
    INSERT INTO brilon_buchungen(id,data,status,buchungsnummer,created_at)
    SELECT gen_random_uuid(),
      jsonb_build_object('name','GPS Testgruppe '||lpad(i::text,3,'0'),
        'datum',$1::text,'angebot',$2::text,
        'buchungsnummer','GPS-GROSS-'||lpad(i::text,4,'0')),
      CASE WHEN i<=310 THEN 'bestaetigt' ELSE 'offen' END,
      'GPS-GROSS-'||lpad(i::text,4,'0'),
      '2027-01-01T12:00:00Z'::timestamptz
    FROM generate_series(1,340) AS i`,[day1,gpsOffer]);
  const gpsQuery=async args=>{
    const response=await fetch(root+'/api/admin/gps/buchungen?'+new URLSearchParams(args),
      {headers:{Cookie:cookie}});
    assert.equal(response.status,200);
    return response.json();
  };
  const gpsIds=[];
  for(let n=1;n<=11;n++){
    const page=await gpsQuery({tourId:gpsTourId,seite:String(n)});
    assert.equal(page.anzahl,310);
    assert.equal(page.proSeite,30);
    assert.equal(page.buchungen.length,n===11?10:30);
    gpsIds.push(...page.buchungen.map(b=>b.id));
    assert.ok(page.buchungen.every(b=>b.angebot===gpsOffer));
  }
  assert.equal(new Set(gpsIds).size,310,'Jede bestätigte GPS-Buchung muss auffindbar sein');
  const gpsFound=await gpsQuery({tourId:gpsTourId,seite:'1',suche:'GPS-GROSS-0305'});
  assert.equal(gpsFound.anzahl,1);
  assert.equal(gpsFound.buchungen[0].buchungsnummer,'GPS-GROSS-0305');
  const unfiltered=await gpsQuery({seite:'1',suche:'GPS-GROSS-'});
  assert.equal(unfiltered.anzahl,310,'Offene Buchungen dürfen nicht als GPS-Zugänge erscheinen');
  const invalid=await fetch(root+'/api/admin/gps/buchungen?tourId=ungueltig',{headers:{Cookie:cookie}});
  assert.equal(invalid.status,400,'Eine ungültige GPS-Tour muss abgewiesen werden');

  // Verwaltung ausgestellter Zugänge: ausschließlich Metadaten, permanente Sperrung.
  const gameId=crypto.randomUUID(),secretToken=crypto.randomBytes(32).toString('base64url');
  const tokenHash=crypto.createHash('sha256').update(secretToken).digest('hex');
  await pool.query(
    'INSERT INTO brilon_gps_spiele(id,token_hash,tour_id,buchung_id) VALUES($1,$2,$3,$4)',
    [gameId,tokenHash,gpsTourId,gpsFound.buchungen[0].id]
  );
  const adminGames=async args=>{
    const response=await fetch(root+'/api/admin/gps/spiele?'+new URLSearchParams(args),
      {headers:{Cookie:cookie}});
    assert.equal(response.status,200);
    return response.json();
  };
  const currentGames=await adminGames({tourId:gpsTourId,seite:'1'});
  assert.equal(currentGames.anzahl,1);
  assert.equal(currentGames.spiele[0].id,gameId);
  assert.equal(currentGames.spiele[0].status,'ausgestellt');
  const exposed=JSON.stringify(currentGames);
  assert.ok(!exposed.includes(tokenHash)&&!exposed.includes(secretToken),
    'Der Spielzugang darf weder den geheimen Token noch den Token-Hash offenlegen');
  const noAuth=await fetch(root+'/api/admin/gps/spiele');
  assert.equal(noAuth.status,401,'Die Liste ist nur nach Anmeldung lesbar');
  const invalidPage=await fetch(root+'/api/admin/gps/spiele?seite=0',{headers:{Cookie:cookie}});
  assert.equal(invalidPage.status,400);
  const revokeUrl=root+'/api/admin/gps/spiele/'+gameId+'/sperren';
  const noCsrf=await fetch(revokeUrl,{method:'PATCH',headers:{Cookie:cookie,Origin:root}});
  assert.equal(noCsrf.status,403,'Die Sperrung ist mit dem Admin-CSRF-Token geschützt');
  const csrfToken=(await login.json()).csrfToken;
  const revoke=()=>fetch(revokeUrl,{method:'PATCH',
    headers:{Cookie:cookie,Origin:root,'X-CSRF-Token':csrfToken}});
  const result=await revoke();
  assert.equal(result.status,200,'Ein ausgestellter Zugang muss sperrbar sein');
  const firstRevoked=(await result.json()).gesperrtAm;
  assert.ok(firstRevoked);
  const repeated=await revoke();
  assert.equal(repeated.status,200,'Wiederholte Sperrung muss idempotent sein');
  assert.equal((await repeated.json()).gesperrtAm,firstRevoked);
  const revokedList=await adminGames({tourId:gpsTourId});
  assert.equal(revokedList.spiele[0].status,'gesperrt');
  assert.ok(!JSON.stringify(revokedList).includes(tokenHash));
  const refused=await fetch(root+'/api/gps/start',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:secretToken})});
  assert.equal(refused.status,404,'Gesperrter Token darf ein Spiel nicht mehr starten');
  const refusedGuest=await fetch(root+'/api/gps/abschluss',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:secretToken,einwilligung:false})});
  assert.equal(refusedGuest.status,404,'Gesperrter Zugang darf keine Gästelistenfreigabe ändern');

  // Stationsprüfprotokoll: eigene Mitarbeiterkonten, Code und Mangelbericht.
  const csrf=csrfToken;
  const adminPost=(url,data)=>fetch(root+url,{method:'POST',headers:{
    Origin:root,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf
  },body:JSON.stringify(data)});
  const staffData={name:'CI Prüferin',email:'inspektion@example.test',
    passwort:'CI-Fachkraft-Passwort-2026!'};
  const employee=await adminPost('/api/admin/pruefung/mitarbeitende',staffData);
  assert.equal(employee.status,201,'Mitarbeiterkonto soll im Test anlegbar sein');
  const savedEmployee=await employee.json();
  assert.ok(savedEmployee.id);
  assert.ok(!JSON.stringify(savedEmployee).includes('passwort'));
  const station=await adminPost('/api/admin/pruefung/stationen',{name:'Kletterwand CI'});
  assert.equal(station.status,201);
  const stationId=(await station.json()).id;
  const unauthorizedCode=await fetch(root+'/api/admin/pruefung/code',{method:'POST'});
  assert.equal(unauthorizedCode.status,401,'Codeanzeige ist nur dem Administrator erlaubt');
  const issued=await adminPost('/api/admin/pruefung/code',{});
  assert.equal(issued.status,201);
  const code=(await issued.json()).code;
  assert.match(code,/^[0-9]{6}$/);
  const credentials=await fetch(root+'/api/pruefung/login',{method:'POST',
    headers:{Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({email:staffData.email,passwort:staffData.passwort})});
  assert.equal(credentials.status,200);
  const staffCookie=credentials.headers.get('set-cookie')?.split(';',1)[0];
  assert.ok(staffCookie);
  const userPost=(endpoint,data)=>fetch(root+endpoint,{method:'POST',
    headers:{Cookie:staffCookie,Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify(data)});
  const stations=await fetch(root+'/api/pruefung/stationen',{headers:{Cookie:staffCookie}});
  assert.equal(stations.status,200);
  assert.equal((await stations.json()).stationen.some(p=>p.id===stationId),true);
  const fotoBytes=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(95,0),Buffer.from([255,217])]);
  const foto='data:image/jpeg;base64,'+fotoBytes.toString('base64');
  const input={programm:'Klettern Klasse CI',beginn:day1+'T10:00',
    pruefungen:[{stationId,zustand:'mangel',foto,
      beschreibung:'Karabiner lässt sich nicht ordnungsgemäß schließen'}]};
  assert.equal((await userPost('/api/pruefung/berichte',input)).status,403,
    'Ohne Vor-Ort-Code darf kein Prüfprotokoll gespeichert werden');
  assert.equal((await userPost('/api/pruefung/freischalten',{code})).status,200);
  const duplicate=await userPost('/api/pruefung/freischalten',{code});
  assert.equal(duplicate.status,409,'Code darf kein zweites Mal verwendet werden');
  const weak=await userPost('/api/pruefung/berichte',{...input,
    pruefungen:[{stationId,zustand:'mangel',beschreibung:'Lose'}]});
  assert.equal(weak.status,400,'Ein Mangel ohne klare Beschreibung wird nicht gespeichert');
  const save=await userPost('/api/pruefung/berichte',input);
  assert.equal(save.status,201);
  const receipt=await save.json();
  assert.equal(receipt.hatMangel,true);
  assert.equal(receipt.benachrichtigung,'nicht_konfiguriert',
    'Tests dürfen keine realen Mangel-E-Mails versenden');
  assert.equal((await userPost('/api/pruefung/berichte',input)).status,403,
    'Jede weitere Prüfung benötigt eine neue Freischaltung');
  const reportResponse=await fetch(root+'/api/admin/pruefung/berichte',{headers:{Cookie:cookie}});
  assert.equal(reportResponse.status,200);
  const reports=await reportResponse.json();
  const report=reports.find(p=>p.id===receipt.id);
  assert.ok(report);
  assert.equal(report.pruefer,staffData.name);
  assert.equal(report.pruefungen[0].zustand,'mangel');
  assert.equal(report.hat_mangel,true);
  assert.equal(report.pruefungen[0].hatFoto,true);
  assert.equal(report.pruefungen[0].foto,undefined,
    'Der Admin-Berichtsüberblick enthält keine Rohbilddaten');
  const imageUrl=root+'/api/admin/pruefung/berichte/'+receipt.id+'/foto/'+stationId;
  const imageDenied=await fetch(imageUrl);
  assert.equal(imageDenied.status,401,'Stationsfotos dürfen nur von angemeldeten Administratoren gelesen werden');
  const image=await fetch(imageUrl,{headers:{Cookie:cookie}});
  assert.equal(image.status,200);
  assert.match(image.headers.get('content-type'),/image\/jpeg/);
  assert.match(image.headers.get('content-disposition'),/attachment/);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()),fotoBytes);

  const stationList=async ()=>(await (await fetch(root+'/api/admin/pruefung/stationen',
    {headers:{Cookie:cookie}})).json());
  const locked=(await stationList()).find(x=>x.id===stationId);
  assert.ok(locked.gesperrt_am,'Ein gemeldeter Mangel muss die Station automatisch sperren');
  assert.match(locked.sperrgrund,/Karabiner/);
  assert.equal(receipt.status,'station_gesperrt');
  assert.deepEqual(receipt.gesperrteStationen.map(x=>x.id),[stationId]);

  const stillBlockedResponse=await fetch(root+'/api/pruefung/stationen',
    {headers:{Cookie:staffCookie}});
  assert.equal(stillBlockedResponse.status,200);
  const blockedStation=(await stillBlockedResponse.json()).stationen.find(x=>x.id===stationId);
  assert.ok(blockedStation.gesperrt_am,'Die Sperre muss Mitarbeitenden sofort sichtbar sein');

  const newCodeResponse=await adminPost('/api/admin/pruefung/code',{});
  assert.equal(newCodeResponse.status,201);
  const newCode=(await newCodeResponse.json()).code;
  assert.equal((await userPost('/api/pruefung/freischalten',{code:newCode})).status,200);
  const greenReport=await userPost('/api/pruefung/berichte',{
    programm:'Nachkontrolle CI',beginn:day1+'T10:00',
    pruefungen:[{stationId,zustand:'ok',beschreibung:''}]
  });
  assert.equal(greenReport.status,201);
  const greenData=await greenReport.json();
  assert.equal(greenData.hatMangel,false);
  assert.equal(greenData.status,'station_gesperrt',
    'Auch ein späterer mängelfreier Bericht darf die alte Sperre nicht aufheben');
  assert.ok((await stationList()).find(x=>x.id===stationId).gesperrt_am);

  const releasePath='/api/admin/pruefung/stationen/'+stationId+'/freigeben';
  assert.equal((await fetch(root+releasePath,{method:'POST'})).status,401,
    'Nicht angemeldete Personen dürfen keine Sperren aufheben');
  assert.equal((await fetch(root+releasePath,{method:'POST',
    headers:{Origin:root,Cookie:cookie,'Content-Type':'application/json'},
    body:JSON.stringify({freigabeDurch:'CI Fachprüferin',begruendung:'Station fachlich nachgeprüft und sicher',nachkontrolleBestaetigt:true})})).status,403,
    'Stationsfreigaben benötigen den Admin-CSRF-Schutz');
  assert.equal((await adminPost(releasePath,{freigabeDurch:'CI Fachprüferin',
    begruendung:'Austausch am Sicherungspunkt',nachkontrolleBestaetigt:false})).status,400);
  assert.equal((await adminPost(releasePath,{freigabeDurch:'CI Fachprüferin',
    begruendung:'zu kurz',nachkontrolleBestaetigt:true})).status,400);
  const released=await adminPost(releasePath,{
    freigabeDurch:'CI Fachprüferin',
    begruendung:'Schließmechanismus ersetzt und die Station vor Ort belastungsfrei nachgeprüft.',
    nachkontrolleBestaetigt:true
  });
  assert.equal(released.status,200);
  assert.equal((await released.json()).gesperrt,false);
  assert.equal((await stationList()).find(x=>x.id===stationId).gesperrt_am,null);
  assert.equal((await adminPost(releasePath,{freigabeDurch:'CI Fachprüferin',
    begruendung:'Erneute Freigabe ohne neue Sperre nicht erlaubt',nachkontrolleBestaetigt:true})).status,409);
  const historyResponse=await fetch(root+'/api/admin/pruefung/stationen/'+stationId+'/ereignisse',
    {headers:{Cookie:cookie}});
  assert.equal(historyResponse.status,200);
  const history=await historyResponse.json();
  assert.equal(history.length,2,'Mangel und Freigabe müssen dauerhaft nachvollziehbar sein');
  assert.equal(history.filter(x=>x.art==='mangel').length,1);
  assert.equal(history.filter(x=>x.art==='freigabe').length,1);
  assert.match(history.find(x=>x.art==='freigabe').verantwortlich,/Fachprüferin/);
});
