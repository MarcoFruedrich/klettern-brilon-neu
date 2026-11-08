'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');

test('Website-Effekte: nur Verwaltung darf konfigurieren, öffentlich nur freigegebene Darstellung',async t=>{
  const probe=net.createServer();
  await new Promise((ok,fail)=>{probe.once('error',fail);probe.listen(0,'127.0.0.1',ok);});
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const repo=path.resolve(__dirname,'..');
  const preload=path.join(repo,'test-support/mocks/force-mock-modules.js');
  const child=spawn(process.execPath,['server.js'],{
    cwd:repo,stdio:['ignore','ignore','pipe'],
    env:{...process.env,PORT:String(port),DATABASE_URL:'mock-test-database',
      MOCK_PG:'1',MOCK_OFFERS:'[]',MOCK_BOOKINGS:'[]',
      NODE_PATH:path.join(repo,'test-support/mocks'),
      NODE_OPTIONS:[process.env.NODE_OPTIONS,`--require=${preload}`].filter(Boolean).join(' '),
      ADMIN_USER:'effekte-test',ADMIN_PASSWORD:'effekte-only-password',
      RUN_SCHEMA_MIGRATIONS:'false',BREVO_API_KEY:'',BREVO_SENDER_EMAIL:'',
      SUPABASE_URL:'',SUPABASE_SECRET_KEY:''}
  });
  let stderr='';child.stderr.on('data',part=>stderr+=part.toString());
  t.after(()=>child.kill());
  const root='http://127.0.0.1:'+port;
  let ready=false;
  for(let i=0;i<65;i++){
    try{const response=await fetch(root+'/index.html');if(response.ok){ready=true;break;}}
    catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(ready,true,'Testserver: '+stderr);
  const before=await fetch(root+'/api/website-effekte');
  assert.equal(before.status,200);
  assert.equal((await before.json()).aktiv,false);
  assert.equal((await fetch(root+'/api/admin/website-effekte')).status,401);
  const login=await fetch(root+'/api/admin/login',{
    method:'POST',headers:{Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({username:'effekte-test',password:'effekte-only-password'})
  });
  assert.equal(login.status,200,stderr);
  const cookie=login.headers.get('set-cookie').split(';')[0],session=await login.json();
  const config={aktiv:true,aktiveId:'herbst',eintraege:[
    {id:'herbst',name:'Herbstlaub',symbol:'🍂',anzahl:5,dauerSekunden:18}
  ]};
  const api=root+'/api/admin/website-effekte';
  const headers={Cookie:cookie,Origin:root,'Content-Type':'application/json',
    'X-CSRF-Token':session.csrfToken};
  assert.equal((await fetch(api,{method:'PUT',headers:{Cookie:cookie,Origin:root,
    'Content-Type':'application/json'},body:JSON.stringify(config)})).status,403);
  const invalid={...config,eintraege:[{...config.eintraege[0],symbol:'<script>'}]};
  assert.equal((await fetch(api,{method:'PUT',headers,body:JSON.stringify(invalid)})).status,400);
  const saved=await fetch(api,{method:'PUT',headers,body:JSON.stringify(config)});
  assert.equal(saved.status,200,await saved.clone().text());
  assert.equal((await saved.json()).success,true);
  const loaded=await fetch(api,{headers:{Cookie:cookie}});
  assert.equal(loaded.status,200);
  assert.deepEqual(await loaded.json(),config);
  const publicView=await fetch(root+'/api/website-effekte');
  assert.deepEqual(await publicView.json(),config);
  assert.equal((await fetch(root+'/api/admin/website-effekte',{
    method:'PUT',headers:{...headers,Origin:'https://untrusted.invalid'},
    body:JSON.stringify(config)})).status,403);
});
