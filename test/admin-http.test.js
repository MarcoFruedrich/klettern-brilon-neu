'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

test('HTTP: Admin-Login, Sitzung und Same-Origin-Schutz', async t => {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const repo = path.resolve(__dirname, '..');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: repo,
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: String(port),
      NODE_PATH: path.join(__dirname, '..', 'test-support', 'mocks'),
      DATABASE_URL: '',
      SUPABASE_URL: '',
      SUPABASE_SECRET_KEY: '',
      BREVO_API_KEY: '',
      ADMIN_USER: 'test-admin',
      ADMIN_PASSWORD: 'test-only-password'
    }
  });
  t.after(() => child.kill());
  const root = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { await fetch(root + '/admin.html'); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.equal(ready, true, 'Server sollte lokal starten');

  const unauthed = await fetch(root + '/api/admin/buchungen');
  assert.equal(unauthed.status, 401);
  const wrongLogin = await fetch(root + '/api/admin/login', {
    method: 'POST', headers: { Origin: root, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test-admin', password: 'wrong' })
  });
  assert.equal(wrongLogin.status, 401);
  const crossLogin = await fetch(root + '/api/admin/login', {
    method: 'POST', headers: { Origin: 'http://evil.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test-admin', password: 'test-only-password' })
  });
  assert.equal(crossLogin.status, 403);

  const login = await fetch(root + '/api/admin/login', {
    method: 'POST', headers: { Origin: root, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test-admin', password: 'test-only-password' })
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Strict/i);
  const cookie = setCookie.split(';', 1)[0];

  const authenticated = await fetch(root + '/api/admin/buchungen', { headers: { Cookie: cookie } });
  assert.equal(authenticated.status, 503, 'Sitzung wurde akzeptiert; nur die absichtlich fehlende DB blockiert');
  const route = root + '/api/admin/anschlussrabatt/vorschau';
  const body = JSON.stringify({ programme: [
    {id:'a',start:'2027-01-01T09:00:00Z',ende:'2027-01-01T10:00:00Z',preisCent:1000},
    {id:'b',start:'2027-01-01T10:00:00Z',ende:'2027-01-01T11:00:00Z',preisCent:1000}
  ] });
  const withoutOrigin = await fetch(route, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body });
  assert.equal(withoutOrigin.status, 403);
  const crossOrigin = await fetch(route, { method: 'POST', headers: { Cookie: cookie, Origin: 'http://evil.test', 'Content-Type': 'application/json' }, body });
  assert.equal(crossOrigin.status, 403);
  const crossSiteFetch = await fetch(route, { method: 'POST', headers: { Cookie: cookie, Origin: root,
    'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, body });
  assert.equal(crossSiteFetch.status, 403, 'Cross-Site-Schreibanfragen müssen auch bei passendem Origin-Scheinwert scheitern');
  const sameOrigin = await fetch(route, { method: 'POST', headers: { Cookie: cookie, Origin: root, 'Content-Type': 'application/json' }, body });
  assert.equal(sameOrigin.status, 200);
  const preview = await sameOrigin.json();
  assert.equal(preview.rabattGesamtCent, 200);
  const logout=await fetch(root+'/api/admin/logout',{method:'POST',headers:{Cookie:cookie,Origin:root}});
  assert.equal(logout.status,200);
  const afterLogout=await fetch(root+'/api/admin/buchungen',{headers:{Cookie:cookie}});
  assert.equal(afterLogout.status,401,'Abmelden muss die Sitzung sofort widerrufen');
});

test('HTTP: DB-Admin-Login verweigert Sitzungen ohne vorbereitete Tabelle', async t => {
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const repo=path.resolve(__dirname,'..');
  const child=spawn(process.execPath,['server.js'],{cwd:repo,stdio:'ignore',env:{
    ...process.env,PORT:String(port),NODE_PATH:path.join(__dirname,'..','test-support','mocks'),
    DATABASE_URL:'mock-test-database',MOCK_PG:'1',MOCK_ADMIN_SESSION_FAIL:'1',
    RUN_SCHEMA_MIGRATIONS:'false',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',
    ADMIN_USER:'test-admin',ADMIN_PASSWORD:'test-only-password'
  }});
  t.after(()=>child.kill());
  const root=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<50;i++){
    try{await fetch(root+'/admin.html');ready=true;break;}
    catch{await new Promise(resolve=>setTimeout(resolve,50));}
  }
  assert.equal(ready,true);
  const login=await fetch(root+'/api/admin/login',{method:'POST',headers:{Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({username:'test-admin',password:'test-only-password'})});
  assert.equal(login.status,503);
  assert.equal(login.headers.get('set-cookie'),null,'Ohne DB-Sitzungsspeicher darf kein Session-Cookie ausgegeben werden');
});
