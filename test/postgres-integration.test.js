'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const sharp = require('sharp');
const { fotoBereinigen } = require('../lib/stationspruefung');
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
      ...process.env, PORT: String(port), NODE_ENV: 'test', DATABASE_URL: integrationUrl,
      DATABASE_SSL_MODE: 'disable', RUN_SCHEMA_MIGRATIONS: 'true',
      BREVO_API_KEY: '', BREVO_SENDER_EMAIL: '', BOOKING_NOTIFY_EMAIL: '',
      SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', NODE_PATH: '', MOCK_PG: '', MOCK_MALWARE_SCAN: '1',
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
  const individualName='CI-Individualklettern-'+crypto.randomUUID();
  await pool.query(`INSERT INTO brilon_angebote
    (name,beschreibung,dauer,preise,aktiv,kapazitaet,buchbar,veroeffentlicht,
     buchungsmodus,mindestteilnehmer,preis_pro_person)
    VALUES ($1,'Isolierter Einzelplatztest',90,'{}'::jsonb,true,12,true,true,'einzelplatz',5,18)`,
    [individualName]);
  await pool.query(`INSERT INTO brilon_buchungen(id,data,status,buchungsnummer)
    SELECT gen_random_uuid(),jsonb_build_object('vorname','CISeed'||i,'nachname','Postgres',
      'email','seed'||i||'@example.test','datum',$2::text,'angebot',$1::text,'teilnehmer',1,
      'uhrzeit','14:00','buchungsmodus','einzelplatz','gesamtpreis',18),
      'offen','CI-INDIVIDUAL-SEED-'||i
    FROM generate_series(1,10) AS i`,[individualName,day1]);
  const individualBook=index=>fetch(root+'/api/buchungen',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({vorname:'CIIndividual'+index,
      nachname:'Postgres',email:`individual${index}@example.test`,datum:day1,uhrzeit:'14:00',
      teilnehmer:1,angebot:individualName,datenschutz:'on'})});
  const individualResults=await Promise.all(Array.from({length:2},(_,i)=>individualBook(i+1)));
  assert.ok(individualResults.every(response=>response.status===201),
    'Gleichzeitige Einzelanmeldungen dürfen denselben Termin teilen und je einen Platz reservieren');
  const individualAvailability=await fetch(root+'/api/belegte-zeiten?'+new URLSearchParams({
    datum:day1,teilnehmer:'1',angebot:individualName
  }));
  assert.equal(individualAvailability.status,200);
  const fullSlot=(await individualAvailability.json()).zeiten.find(item=>item.uhrzeit==='14:00');
  assert.equal(fullSlot.angemeldet,12);
  assert.equal(fullSlot.freie_plaetze,0);
  assert.equal(fullSlot.belegt,true);
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
    assert.equal(result.anzahl,139);
    assert.equal(result.proSeite,50);
    pages.push(result.buchungen);
  }
  assert.deepEqual(pages.map(rows=>rows.length),[50,50,39],
    '139 echte Testbuchungen müssen auf drei Seiten verteilt sein');
  const ids=pages.flat().map(row=>row.id);
  assert.equal(new Set(ids).size,139,
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
  assert.equal(paymentPage.anzahl,139);
  assert.equal(paymentPage.eintraege.length,39);

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
  const fotoBytes=await sharp({create:{width:12,height:8,channels:3,background:'#4382aa'}})
    .jpeg().withExif({IFD0:{ImageDescription:'private location data'}}).toBuffer();
  const foto='data:image/jpeg;base64,'+fotoBytes.toString('base64');
  const bereinigtesFoto=await fotoBereinigen(foto);
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
  const heruntergeladenesFoto=Buffer.from(await image.arrayBuffer());
  assert.deepEqual(heruntergeladenesFoto,
    Buffer.from(bereinigtesFoto.slice('data:image/jpeg;base64,'.length),'base64'));
  assert.equal((await sharp(heruntergeladenesFoto).metadata()).exif,undefined,
    'Mängelfotos werden ohne EXIF-Daten gespeichert');

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

  // Ein kleiner Hinweis löst weder eine Sperre noch einen Mängelalarm aus.
  const extraStation=await adminPost('/api/admin/pruefung/stationen',{name:'Hinweistest Bouldermatte'});
  assert.equal(extraStation.status,201);
  const extraId=(await extraStation.json()).id;
  const siteCode=async()=>{
    const answer=await adminPost('/api/admin/pruefung/code',{});
    assert.equal(answer.status,201);
    const c=(await answer.json()).code;
    assert.equal((await userPost('/api/pruefung/freischalten',{code:c})).status,200);
  };
  await siteCode();
  const hintData={programm:'Vorabkontrolle Bouldern',beginn:day1+'T10:00',
    pruefungen:[{stationId:extraId,zustand:'hinweis',
      beschreibung:'Stationsschild ist verblasst, Befestigung aber unauffällig'}]};
  const hintReport=await userPost('/api/pruefung/berichte',hintData);
  assert.equal(hintReport.status,201);
  const hintResult=await hintReport.json();
  assert.equal(hintResult.hatMangel,false);
  assert.equal(hintResult.hatHinweis,true);
  assert.equal(hintResult.status,'hinweis_offen');
  assert.equal(hintResult.benachrichtigung,'kein_mangel');
  assert.deepEqual(hintResult.gesperrteStationen,[]);
  assert.equal((await stationList()).find(x=>x.id===extraId).gesperrt_am,null,
    'Ein kleiner Hinweis darf die Station nicht automatisch sperren');
  const hintsResponse=await fetch(root+'/api/admin/pruefung/hinweise',{headers:{Cookie:cookie}});
  assert.equal(hintsResponse.status,200);
  const hint=(await hintsResponse.json()).find(x=>x.bericht_id===hintResult.id);
  assert.ok(hint,'Der Hinweis muss in der Admin-Nachprüfliste erscheinen');
  assert.equal(hint.station_id,extraId);
  assert.equal(hint.erledigt_am,null);
  const hintReportList=await (await fetch(root+'/api/admin/pruefung/berichte',{headers:{Cookie:cookie}})).json();
  assert.equal(hintReportList.find(x=>x.id===hintResult.id).hat_hinweis,true);
  const hintResolvePath='/api/admin/pruefung/hinweise/'+hint.id+'/erledigen';
  assert.equal((await fetch(root+hintResolvePath,{method:'POST'})).status,401);
  assert.equal((await fetch(root+hintResolvePath,{method:'POST',
    headers:{Origin:root,Cookie:cookie,'Content-Type':'application/json'},
    body:JSON.stringify({pruefer:'CI Prüferin',ergebnis:'Stationsschild ausgetauscht und geprüft',
      geprueft:true})})).status,403);
  assert.equal((await adminPost(hintResolvePath,{
    pruefer:'CI Prüferin',ergebnis:'noch zu kurz',geprueft:true})).status,400);
  const hintResolved=await adminPost(hintResolvePath,{
    pruefer:'CI Prüferin',ergebnis:'Stationsschild erneuert, Beschriftung wieder gut lesbar.',
    geprueft:true
  });
  assert.equal(hintResolved.status,200);
  assert.equal((await adminPost(hintResolvePath,{
    pruefer:'CI Prüferin',ergebnis:'Wiederholte Erledigung ist nicht zulässig',geprueft:true})).status,409);
  const afterHint=(await (await fetch(root+'/api/admin/pruefung/hinweise',
    {headers:{Cookie:cookie}})).json()).find(x=>x.id===hint.id);
  assert.ok(afterHint.erledigt_am);
  assert.match(afterHint.erledigt_notiz,/Beschriftung/);
  assert.equal((await stationList()).find(x=>x.id===extraId).gesperrt_am,null,
    'Auch die Erledigung des Hinweises darf den Sperrstatus nicht verändern');

  // Wenn dieselbe Station später einen echten Sicherheitsmangel aufweist,
  // wird unabhängig vom bereits erledigten Hinweis sofort gesperrt.
  await siteCode();
  const urgent=await userPost('/api/pruefung/berichte',{programm:'Bouldermatte Sicherheit',
    beginn:day1+'T10:00',pruefungen:[
      {stationId:extraId,zustand:'mangel',
        beschreibung:'Befestigung der Bouldermatte ist sicherheitsrelevant beschädigt'}]});
  assert.equal(urgent.status,201);
  const urgentReceipt=await urgent.json();
  assert.equal(urgentReceipt.hatMangel,true);
  assert.ok((await stationList()).find(x=>x.id===extraId).gesperrt_am);

  // Permanent queued notification, isolated from hints and protected against duplicate sends.
  const mailUrl='/api/admin/pruefung/meldungen';
  assert.equal((await fetch(root+mailUrl)).status,401);
  const mailList=await fetch(root+mailUrl,{headers:{Cookie:cookie}});
  assert.equal(mailList.status,200);
  const mailRecords=await mailList.json();
  const originalAlert=mailRecords.find(x=>x.bericht_id===receipt.id);
  const laterAlert=mailRecords.find(x=>x.bericht_id===urgentReceipt.id);
  assert.ok(originalAlert&&laterAlert,'Sicherheitsmängel erhalten dauerhaft einen Mail-Ausgang');
  assert.equal(originalAlert.status,'nicht_konfiguriert');
  assert.equal(laterAlert.status,'nicht_konfiguriert');
  assert.equal(mailRecords.some(x=>x.bericht_id===hintResult.id),false,
    'Kleine Hinweise dürfen keine Sicherheitsmangel-E-Mail erzeugen');
  assert.ok(!JSON.stringify(mailRecords).includes(foto),
    'Berichtsfotos dürfen nicht als Rohdaten in Mailübersichten erscheinen');

  const retryMail=root+mailUrl+'/'+receipt.id+'/erneut-senden';
  assert.equal((await fetch(retryMail,{method:'POST'})).status,401);
  assert.equal((await fetch(retryMail,{method:'POST',
    headers:{Cookie:cookie,Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({doppelversandGeprueft:true})})).status,403,
    'Erneuter Versand muss gegen CSRF geschützt sein');
  assert.equal((await adminPost(mailUrl+'/'+receipt.id+'/erneut-senden',
    {doppelversandGeprueft:false})).status,400);
  const retryWithoutMailbox=await adminPost(mailUrl+'/'+receipt.id+'/erneut-senden',
    {doppelversandGeprueft:true});
  assert.equal(retryWithoutMailbox.status,200);
  assert.equal((await retryWithoutMailbox.json()).status,'nicht_konfiguriert',
    'Kein echter Versand bei fehlender Test-E-Mail-Konfiguration');
  const mailListAgain=await (await fetch(root+mailUrl,{headers:{Cookie:cookie}})).json();
  assert.ok(mailListAgain.find(x=>x.bericht_id===receipt.id).versuche>=2);
  await pool.query("UPDATE brilon_pruef_meldungen SET status='angenommen' WHERE bericht_id=$1",
    [receipt.id]);
  assert.equal((await adminPost(mailUrl+'/'+receipt.id+'/erneut-senden',
    {doppelversandGeprueft:true})).status,409,
    'Bereits akzeptierte Nachrichten dürfen nicht nochmals verschickt werden');
  await pool.query("UPDATE brilon_pruef_meldungen SET status='sendet' WHERE bericht_id=$1",
    [receipt.id]);
  assert.equal((await adminPost(mailUrl+'/'+receipt.id+'/erneut-senden',
    {doppelversandGeprueft:true})).status,409,
    'Ein ungeklärter Versandzustand darf nicht blind erneut gesendet werden');


  const tabletPath='/api/pruefung/tablet/anzeige';
  assert.equal((await fetch(root+tabletPath)).status,401);
  const pairing=await adminPost('/api/admin/pruefung/tablet/kopplung',{});
  assert.equal(pairing.status,201);
  const pairingCode=(await pairing.json()).code;
  assert.match(pairingCode,/^\d{8}$/);
  const connect=code=>fetch(root+'/api/pruefung/tablet/koppeln',{
    method:'POST',headers:{Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({code,name:'Test-Werbetablet'})});
  const paired=await connect(pairingCode);
  assert.equal(paired.status,201);
  const kioskCookie=paired.headers.get('set-cookie').split(';')[0];
  assert.equal((await connect(pairingCode)).status,409);
  const kiosk=()=>fetch(root+tabletPath,{headers:{Cookie:kioskCookie}});
  // Pairing alone is not proof that the display is actually online.
  const initialDisplay=await kiosk();
  assert.equal(initialDisplay.status,200);
  assert.equal((await initialDisplay.json()).code,null);
  const beforeChoice=await userPost('/api/pruefung/code-anfordern',{});
  assert.equal(beforeChoice.status,409,
    'Gekoppelte Geräte ohne Administrator-Freigabe dürfen keine Prüfcodes auslösen.');
  const listed=await (await fetch(root+'/api/admin/pruefung/tablets',
    {headers:{Cookie:cookie}})).json();
  const selectedId=listed.find(x=>x.name==='Test-Werbetablet').id;
  const choosePath='/api/admin/pruefung/tablets/'+selectedId+'/pruefdisplay';
  assert.equal((await fetch(root+choosePath,{method:'PATCH'})).status,401);
  assert.equal((await fetch(root+choosePath,{method:'PATCH',
    headers:{Cookie:cookie,Origin:root}})).status,403);
  const chosen=await fetch(root+choosePath,{method:'PATCH',
    headers:{Cookie:cookie,Origin:root,'X-CSRF-Token':csrf}});
  assert.equal(chosen.status,200);
  assert.equal((await chosen.json()).pruefdisplay,true);
  const requested=await userPost('/api/pruefung/code-anfordern',{});
  assert.equal(requested.status,201);
  const shown=await (await kiosk()).json();
  assert.match(shown.code,/^\d{6}$/);
  const crypt=await pool.query('SELECT code_verschluesselt FROM brilon_pruef_codes WHERE verbraucht_am IS NULL ORDER BY ablauf DESC LIMIT 1');
  assert.ok(crypt.rows[0].code_verschluesselt);
  assert.ok(!crypt.rows[0].code_verschluesselt.includes(shown.code));
  assert.equal((await userPost('/api/pruefung/freischalten',{code:shown.code})).status,200);
  assert.equal((await (await kiosk()).json()).code,null);
  const tabletList=async()=>{
    const response=await fetch(root+'/api/admin/pruefung/tablets',{headers:{Cookie:cookie}});
    assert.equal(response.status,200);
    return response.json();
  };
  const devices=await tabletList();
  const tabletId=devices.find(x=>x.name==='Test-Werbetablet').id;
  assert.equal(devices.find(x=>x.id===tabletId).online,true);
  assert.ok(devices.find(x=>x.id===tabletId).zuletzt_gesehen_am);
  // A paired but dormant display must not receive a newly requested code.
  await pool.query("UPDATE brilon_pruef_tablets SET zuletzt_gesehen_am=NOW()-INTERVAL '70 seconds' WHERE id=$1",
    [tabletId]);
  const dormant=await tabletList();
  assert.equal(dormant.find(x=>x.id===tabletId).online,false);
  assert.equal((await userPost('/api/pruefung/code-anfordern',{})).status,409,
    'Bei einer seit über 45 Sekunden fehlenden Tabletmeldung darf kein Prüfcode angefordert werden');
  assert.equal((await kiosk()).status,200,'Beim erneuten Öffnen kann das gekoppelte Tablet wieder melden');
  assert.equal((await tabletList()).find(x=>x.id===tabletId).online,true);

  // Ein zweites gekoppeltes Tablet darf unabhängig von dessen Online-Zustand
  // den für das gewählte Prüfdisplay ausgestellten Code niemals lesen.
  const secondPairing=await adminPost('/api/admin/pruefung/tablet/kopplung',{});
  assert.equal(secondPairing.status,201);
  const secondPairingCode=(await secondPairing.json()).code;
  const connectedSecond=await fetch(root+'/api/pruefung/tablet/koppeln',{
    method:'POST',headers:{Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({code:secondPairingCode,name:'Zweites Werbetablet'})});
  assert.equal(connectedSecond.status,201);
  const secondCookie=connectedSecond.headers.get('set-cookie').split(';')[0];
  const secondKiosk=()=>fetch(root+tabletPath,{headers:{Cookie:secondCookie}});
  assert.equal((await secondKiosk()).status,200);
  const secondId=(await tabletList()).find(x=>x.name==='Zweites Werbetablet').id;
  // A second independently authenticated employee exercises subsequent requests
  // without bypassing the production three-requests-per-ten-minutes rate limit.
  const extraStaff={name:'CI Zweitprüfer',email:'zweitpruefer@example.test',
    passwort:'Zweites-Prueferpasswort-2026!'};
  const extraAccount=await adminPost('/api/admin/pruefung/mitarbeitende',extraStaff);
  assert.equal(extraAccount.status,201);
  const extraLogin=await fetch(root+'/api/pruefung/login',{method:'POST',
    headers:{Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({email:extraStaff.email,passwort:extraStaff.passwort})});
  assert.equal(extraLogin.status,200);
  const extraCookie=extraLogin.headers.get('set-cookie').split(';')[0];
  const extraPost=(endpoint,data)=>fetch(root+endpoint,{method:'POST',
    headers:{Cookie:extraCookie,Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify(data)});

  const requestedForFirst=await extraPost('/api/pruefung/code-anfordern',{});
  assert.equal(requestedForFirst.status,201);
  const codeOnlyFirst=(await (await kiosk()).json()).code;
  assert.match(codeOnlyFirst,/^\d{6}$/);
  const standby=await (await secondKiosk()).json();
  assert.equal(standby.code,null,
    'Gekoppeltes Zweitgerät darf den aktuellen Prüfcode nicht sehen');
  assert.equal(standby.pruefdisplay,false);
  assert.equal((await tabletList()).filter(x=>x.pruefdisplay).length,1);

  // Die Verwaltung legt das andere Display fest. Alte Codes werden sofort ungültig.
  const switchUrl='/api/admin/pruefung/tablets/'+secondId+'/pruefdisplay';
  const switched=await fetch(root+switchUrl,{method:'PATCH',
    headers:{Origin:root,Cookie:cookie,'X-CSRF-Token':csrf}});
  assert.equal(switched.status,200);
  assert.equal((await (await kiosk()).json()).code,null);
  assert.equal((await (await secondKiosk()).json()).code,null);
  assert.equal((await extraPost('/api/pruefung/freischalten',{code:codeOnlyFirst})).status,409,
    'Ein beim Tabletwechsel ungültig gemachter Prüfcode darf nicht weiter gelten');
  assert.equal((await tabletList()).filter(x=>x.pruefdisplay).length,1);
  const requestedForSecond=await extraPost('/api/pruefung/code-anfordern',{});
  assert.equal(requestedForSecond.status,201);
  assert.equal((await (await kiosk()).json()).code,null);
  assert.match((await (await secondKiosk()).json()).code,/^\d{6}$/);

  // Sperrung des ausgewählten Tablets macht dessen Code sofort ungültig,
  // auch wenn ein anderer, nicht ausgewählter Tablet-Zugang aktiv bleibt.
  const chosenRevocation=await fetch(root+'/api/admin/pruefung/tablets/'+secondId+'/sperren',{
    method:'PATCH',headers:{Origin:root,Cookie:cookie,'X-CSRF-Token':csrf}});
  assert.equal(chosenRevocation.status,200);
  assert.equal((await secondKiosk()).status,401);
  assert.equal((await extraPost('/api/pruefung/code-anfordern',{})).status,409,
    'Nicht ausgewählte andere Tablets dürfen die Codeanforderung nicht ermöglichen');
  // Admin initiates replacement of the remaining tablet. Old access is
  // immediately revoked; a short-lived code is issued atomically.
  const replacementPath='/api/admin/pruefung/tablets/'+tabletId+'/ersetzen';
  assert.equal((await fetch(root+replacementPath,{method:'POST'})).status,401);
  assert.equal((await fetch(root+replacementPath,{method:'POST',
    headers:{Origin:root,Cookie:cookie,'Content-Type':'application/json'},
    body:JSON.stringify({wechselBestaetigt:true})})).status,403);
  assert.equal((await adminPost(replacementPath,{wechselBestaetigt:false})).status,400);
  const replacement=await adminPost(replacementPath,{wechselBestaetigt:true});
  assert.equal(replacement.status,201);
  const replacementCode=(await replacement.json()).code;
  assert.match(replacementCode,/^\d{8}$/);
  assert.equal((await kiosk()).status,401,'Bisheriges Tablet ist nach Gerätewechsel abgemeldet.');
  assert.equal((await tabletList()).find(x=>x.id===tabletId).aktiv,false);
  assert.equal((await tabletList()).filter(x=>x.pruefdisplay).length,0);
  assert.equal((await adminPost(replacementPath,{wechselBestaetigt:true})).status,409,
    'Ein bereits gesperrtes Gerät darf nicht erneut ausgetauscht werden');
  const replacePair=await fetch(root+'/api/pruefung/tablet/koppeln',{
    method:'POST',headers:{Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({code:replacementCode,name:'Neues Kletterhallen-Tablet'})});
  assert.equal(replacePair.status,201);
  const replacementCookie=replacePair.headers.get('set-cookie').split(';')[0];
  const replacementKiosk=()=>fetch(root+tabletPath,{headers:{Cookie:replacementCookie}});
  assert.equal((await fetch(root+'/api/pruefung/tablet/koppeln',{
    method:'POST',headers:{Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({code:replacementCode,name:'Nicht zulässiges Zweitgerät'})})).status,409);
  const newKioskData=await (await replacementKiosk()).json();
  assert.equal(newKioskData.code,null);
  assert.equal(newKioskData.pruefdisplay,false,
    'Ersatzgerät benötigt eine bewusste neue Admin-Auswahl als Prüfdisplay');
  assert.equal((await tabletList()).filter(x=>x.pruefdisplay).length,0);

  // Administratively disable a station without deleting the original defect
  // or the inspection/audit history. Re-enabling must NOT clear its safety lock.
  const patchAdmin=(endpoint,data)=>fetch(root+endpoint,{method:'PATCH',
    headers:{Origin:root,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},
    body:JSON.stringify(data)});
  const stationStop='/api/admin/pruefung/stationen/'+extraId+'/deaktivieren';
  assert.equal((await fetch(root+stationStop,{method:'PATCH'})).status,401);
  assert.equal((await fetch(root+stationStop,{method:'PATCH',headers:{Cookie:cookie,Origin:root}})).status,403);
  assert.equal((await patchAdmin(stationStop,{begruendung:'kurz'})).status,400);
  const stopped=await patchAdmin(stationStop,{begruendung:'Station wird zur Wartung vorübergehend stillgelegt.'});
  assert.equal(stopped.status,200);
  const stoppedData=await stopped.json();
  assert.equal(stoppedData.aktiv,false);
  assert.ok(stoppedData.gesperrt_am,'Eine Stilllegung darf keinen Sicherheitsmangel löschen');
  assert.equal((await stationList()).find(x=>x.id===extraId).aktiv,false);
  const listedForStaff=await (await fetch(root+'/api/pruefung/stationen',
    {headers:{Cookie:staffCookie}})).json();
  assert.equal(listedForStaff.stationen.some(x=>x.id===extraId),false,
    'Stillgelegte Stationen dürfen im mobilen Formular nicht angeboten werden');
  assert.equal((await patchAdmin(stationStop,{begruendung:'Erneuter Stilllegungsversuch nicht erlaubt'})).status,409);
  const startAgain='/api/admin/pruefung/stationen/'+extraId+'/reaktivieren';
  const reactivated=await patchAdmin(startAgain,{
    begruendung:'Wartung abgeschlossen, Station für künftige Prüfungen wieder aufnehmen.'});
  assert.equal(reactivated.status,200);
  assert.equal((await reactivated.json()).aktiv,true);
  assert.ok((await stationList()).find(x=>x.id===extraId).gesperrt_am,
    'Reaktivierung darf keine noch bestehende Sicherheitsmängelsperre freigeben');
  assert.equal((await patchAdmin(startAgain,{begruendung:'Nicht erneut aktivieren'})).status,409);
  const statusLogResponse=await fetch(root+'/api/admin/pruefung/stationen/'+extraId+'/statusverlauf',
    {headers:{Cookie:cookie}});
  assert.equal(statusLogResponse.status,200);
  const statusLog=await statusLogResponse.json();
  assert.equal(statusLog.length,2);
  assert.deepEqual(new Set(statusLog.map(x=>x.art)),new Set(['deaktiviert','reaktiviert']));
  assert.ok(statusLog.every(x=>x.begruendung.length>=15));
  assert.ok((await (await fetch(root+'/api/admin/pruefung/berichte',
    {headers:{Cookie:cookie}})).json()).some(x=>x.id===urgentReceipt.id),
    'Historische Prüfberichte müssen auch nach Stationsstilllegung erhalten bleiben');

  // Staff credentials must never revive with the old password or old sessions.
  const employeePath='/api/admin/pruefung/mitarbeitende/'+savedEmployee.id;
  assert.equal((await patchAdmin(employeePath+'/reaktivieren',
    {passwort:'Ohne-Vorherige-Deaktivierung'})).status,409);
  assert.equal((await patchAdmin(employeePath+'/passwort-setzen',{passwort:'short'})).status,400);
  const reset=await patchAdmin(employeePath+'/passwort-setzen',
    {passwort:'Aktualisiert-Sicher-2026-!'});
  assert.equal(reset.status,200);
  assert.equal((await reset.json()).sitzungenWiderrufen,true);
  assert.equal((await fetch(root+'/api/pruefung/stationen',
    {headers:{Cookie:staffCookie}})).status,401,
    'Alle alten Mitarbeitersitzungen sind nach Passwortwechsel widerrufen');
  const tryLogin=(passwort)=>fetch(root+'/api/pruefung/login',{method:'POST',
    headers:{Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({email:staffData.email,passwort})});
  assert.equal((await tryLogin(staffData.passwort)).status,401);
  const freshLogin=await tryLogin('Aktualisiert-Sicher-2026-!');
  assert.equal(freshLogin.status,200);
  const freshCookie=freshLogin.headers.get('set-cookie').split(';')[0];
  const deactivated=await patchAdmin(employeePath+'/deaktivieren',{});
  assert.equal(deactivated.status,200);
  assert.equal((await deactivated.json()).aktiv,false);
  assert.equal((await fetch(root+'/api/pruefung/stationen',
    {headers:{Cookie:freshCookie}})).status,401);
  assert.equal((await tryLogin('Aktualisiert-Sicher-2026-!')).status,401);
  assert.equal((await patchAdmin(employeePath+'/deaktivieren',{})).status,409);
  assert.equal((await patchAdmin(employeePath+'/reaktivieren',{passwort:'zu kurz'})).status,400);
  const restarted=await patchAdmin(employeePath+'/reaktivieren',
    {passwort:'Reaktiviert-Einmal-2026-!'});
  assert.equal(restarted.status,200);
  assert.equal((await restarted.json()).aktiv,true);
  assert.equal((await fetch(root+'/api/pruefung/stationen',
    {headers:{Cookie:freshCookie}})).status,401);
  assert.equal((await tryLogin('Aktualisiert-Sicher-2026-!')).status,401);
  assert.equal((await tryLogin('Reaktiviert-Einmal-2026-!')).status,200);

  // Safety overview aggregates distinct blocked/inactive stations, unresolved
  // minor hints and unconfirmed mail acceptance, without granting permissions.
  const summaryPath=root+'/api/admin/pruefung/uebersicht';
  assert.equal((await fetch(summaryPath)).status,401,
    'The entire safety overview must be restricted to administrators.');
  assert.equal((await fetch(summaryPath,{headers:{Cookie:staffCookie}})).status,401);
  const pendingId=crypto.randomUUID();
  await pool.query(`INSERT INTO brilon_pruef_hinweise
    (id,station_id,bericht_id,beschreibung,erstellt_von)
    VALUES($1,$2,$3,$4,$5)`,
    [pendingId,stationId,hintResult.id,
      'Kontrolle des Stationsschilds bei der nächsten fachlichen Nachprüfung erforderlich',
      'Testfachkraft']);
  const disableExtra=await patchAdmin(stationStop,{
    begruendung:'Die Station wird bis zur fachlichen Sicherheitsprüfung vorsorglich stillgelegt.'});
  assert.equal(disableExtra.status,200);
  const dashboardResponse=await fetch(summaryPath,{headers:{Cookie:cookie}});
  assert.equal(dashboardResponse.status,200);
  assert.match(dashboardResponse.headers.get('cache-control')||'',/no-store/i);
  const overview=await dashboardResponse.json();
  assert.equal(typeof overview.stand,'string');
  assert.ok(overview.zaehler.gesperrt>=1);
  assert.ok(overview.zaehler.stillgelegt>=1);
  assert.ok(overview.zaehler.hinweise_offen>=1);
  assert.ok(overview.zaehler.meldungen_ungeklaert>=1);
  const counts=await pool.query(`SELECT
    (SELECT COUNT(*)::int FROM brilon_pruef_stationen WHERE gesperrt_am IS NOT NULL) AS gesperrt,
    (SELECT COUNT(*)::int FROM brilon_pruef_stationen WHERE aktiv=false) AS stillgelegt,
    (SELECT COUNT(*)::int FROM brilon_pruef_stationen
      WHERE aktiv=false OR gesperrt_am IS NOT NULL) AS nicht_nutzbar,
    (SELECT COUNT(*)::int FROM brilon_pruef_hinweise WHERE erledigt_am IS NULL) AS hinweise_offen,
    (SELECT COUNT(*)::int FROM brilon_pruef_meldungen
      WHERE status<>'angenommen') AS meldungen_ungeklaert`);
  assert.deepEqual(overview.zaehler,counts.rows[0],
    'Overview counters reflect all records, including overlaps exactly once.');
  const blockedItem=overview.stationen.find(x=>x.id===extraId);
  assert.ok(blockedItem&&blockedItem.gesperrt_am&&!blockedItem.aktiv);
  assert.ok(overview.stationen[0].gesperrt_am,
    'Stations with active safety locks must appear before purely inactive ones.');
  assert.equal(overview.stationen.filter(x=>x.id===extraId).length,1,
    'A station both inactive and locked is listed only once.');
  assert.ok(overview.hinweise.some(x=>x.id===pendingId));
  assert.equal(overview.hinweise.some(x=>x.id===hint.id),false,
    'Completed minor hints are not outstanding follow-ups.');
  assert.ok(overview.meldungen.some(x=>x.bericht_id===receipt.id));
  assert.equal(JSON.stringify(overview).includes(foto),false,
    'Never include inspection photo bytes in the admin dashboard.');
  assert.equal(JSON.stringify(overview).includes(staffData.passwort),false);
  assert.equal((await stationList()).find(x=>x.id===extraId).aktiv,false,
    'Reading the overview must not reactivate or release a station.');
  assert.ok((await stationList()).find(x=>x.id===extraId).gesperrt_am);

  // A daily special must explicitly refer to a currently bookable programme.
  // A misleading same-name match or a deactivated programme is never enough.
  const specialProgramme=await pool.query('SELECT id FROM brilon_angebote WHERE name=$1',[programName]);
  assert.equal(specialProgramme.rowCount,1);
  const linkedId=String(specialProgramme.rows[0].id);
  const invalidAction=await adminPost('/api/admin/aktionen',{
    titel:'Falsche Verknüpfung',datum:day1,programm_id:'999999999'});
  assert.equal(invalidAction.status,400);
  const missingId=await adminPost('/api/admin/aktionen',{
    titel:'Ungültige Kennung',datum:day1,programm_id:'NOT-A-NUMBER'});
  assert.equal(missingId.status,400);
  const savedAction=await adminPost('/api/admin/aktionen',{
    titel:'Herbst-Erlebnisaktion',datum:day1,beschreibung:'CI Aktionsbeschreibung',
    preis:'80',programm_id:linkedId});
  assert.equal(savedAction.status,201);
  const savedActionId=(await savedAction.json()).id;
  const publicActions=async()=>{
    const response=await fetch(root+'/api/aktionen');
    assert.equal(response.status,200);
    return response.json();
  };
  const activeAction=(await publicActions()).find(x=>x.id===savedActionId);
  assert.equal(String(activeAction.programm_id),linkedId);
  assert.equal(activeAction.programm_name,programName);
  assert.notEqual(activeAction.titel,programName);
  const actionForAdmin=await fetch(root+'/api/admin/aktionen',{headers:{Cookie:cookie}});
  assert.equal(actionForAdmin.status,200);
  assert.equal((await actionForAdmin.json()).find(x=>x.id===savedActionId).programm_id,linkedId);
  assert.equal((await fetch(root+'/api/admin/aktionen')).status,401);
  await pool.query('UPDATE brilon_angebote SET aktiv=false WHERE id=$1',[linkedId]);
  const disabledAction=(await publicActions()).find(x=>x.id===savedActionId);
  assert.equal(disabledAction.programm_id,null,
    'A disabled programme may never be selected through an old special action.');
  await pool.query('UPDATE brilon_angebote SET aktiv=true WHERE id=$1',[linkedId]);
  const newlyRestricted=await pool.query(
    'UPDATE brilon_angebote SET verfuegbare_termine=$2::jsonb WHERE id=$1',
    [linkedId,JSON.stringify([day2])]);
  assert.equal(newlyRestricted.rowCount,1);
  assert.equal((await publicActions()).find(x=>x.id===savedActionId).programm_id,null,
    'No programme auto-select when the special date is no longer enabled.');
  assert.equal((await adminPost('/api/admin/aktionen',{
    titel:'Aktionsdatum unzulässig',datum:day1,programm_id:linkedId})).status,400);
  // Keep other integration assertions unaffected by the temporary programme.
  await pool.query('UPDATE brilon_angebote SET verfuegbare_termine=$2::jsonb WHERE id=$1',
    [linkedId,'[]']);

  // Existing actions may be re-assigned or deliberately left independent.
  const assocPath=root+'/api/admin/aktionen/'+savedActionId+'/programm';
  const assocPatch=(data,headers={})=>fetch(assocPath,{method:'PATCH',
    headers:{Origin:root,Cookie:cookie,'Content-Type':'application/json',
      'X-CSRF-Token':csrf,...headers},
    body:JSON.stringify(data)});
  assert.equal((await fetch(assocPath,{method:'PATCH'})).status,401);
  assert.equal((await fetch(assocPath,{method:'PATCH',headers:{
    Origin:root,Cookie:cookie,'Content-Type':'application/json'},
    body:JSON.stringify({programm_id:''})})).status,403);
  assert.equal((await assocPatch({programm_id:'wrong-id'})).status,400);
  assert.equal((await assocPatch({programm_id:'999999999'})).status,400);
  assert.equal((await assocPatch({programm_id:''})).status,200);
  assert.equal((await publicActions()).find(x=>x.id===savedActionId).programm_id,null);
  const linkedAgain=await assocPatch({programm_id:linkedId});
  assert.equal(linkedAgain.status,200);
  assert.equal((await linkedAgain.json()).programm_id,linkedId);
  assert.equal(String((await publicActions()).find(x=>x.id===savedActionId).programm_id),linkedId);
  assert.equal((await pool.query(
    "SELECT data->>'titel' AS titel FROM brilon_aktionen WHERE id=$1",[savedActionId]
  )).rows[0].titel,'Herbst-Erlebnisaktion',
    'Changing a programme association must not rewrite other action properties.');
});
