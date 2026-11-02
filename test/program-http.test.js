'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const net=require('node:net');
const path=require('node:path');
const {totpCode}=require('../lib/totp');

test('HTTP: Programme anlegen, bearbeiten und kontrolliert veröffentlichen',async t=>{
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const repo=path.resolve(__dirname,'..');
  const totpSecret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const child=spawn(process.execPath,['server.js'],{cwd:repo,stdio:['ignore','ignore','pipe'],env:{
    ...process.env,PORT:String(port),NODE_PATH:path.join(repo,'test-support','mocks'),
    DATABASE_URL:'mock-test-database',MOCK_PG:'1',MOCK_OFFERS:'[]',
    MOCK_PLACES:JSON.stringify([{id:1,name:'Brilon',aktiv:true}]),RUN_SCHEMA_MIGRATIONS:'false',
    ADMIN_USER:'program-admin',ADMIN_PASSWORD:'test-only-password',ADMIN_TOTP_SECRET_BASE32:totpSecret,
    SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',BREVO_API_KEY:'',BREVO_SENDER_EMAIL:''
  }});
  let serverErrors='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>serverErrors+=chunk);
  t.after(()=>child.kill());
  const root=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<60;i++){
    try{await fetch(root+'/index.html');ready=true;break;}
    catch{await new Promise(resolve=>setTimeout(resolve,50));}
  }
  assert.equal(ready,true,`Testserver startet nicht: ${serverErrors}`);

  const privateRead=await fetch(root+'/api/admin/angebote');
  assert.equal(privateRead.status,401,'Programmdaten der Verwaltung sind geschützt');
  const login=await fetch(root+'/api/admin/login',{method:'POST',headers:{Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({username:'program-admin',password:'test-only-password',totp:totpCode(totpSecret,Math.floor(Date.now()/30000))})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';',1)[0];
  const loginData=await login.json();
  const headers={Cookie:cookie,Origin:root,'X-CSRF-Token':loginData.csrfToken,'Content-Type':'application/json'};
  const program={name:'Klettern am Turm',beschreibung:'Ein sicheres Testprogramm',dauer:90,kategorie:'Klettern',
    zielgruppe:'Kinder und Familien',veranstaltungsort:'Brilon',kapazitaet:12,verfuegbare_termine:['2027-03-15'],
    hinweise:'Festes Schuhwerk',buchbar:true,veroeffentlicht:true};
  const created=await fetch(root+'/api/admin/angebote',{method:'POST',headers,body:JSON.stringify(program)});
  const createdText=await created.text();
  assert.equal(created.status,201,createdText);
  const id=JSON.parse(createdText).id;
  assert.equal((await (await fetch(root+'/api/angebote')).json()).length,0,
    'Neu angelegte Programme bleiben zunächst deaktiviert und unsichtbar');

  const adminList=await fetch(root+'/api/admin/angebote',{headers:{Cookie:cookie}});
  assert.equal(adminList.status,200);
  const stored=(await adminList.json()).find(item=>item.id===id);
  assert.equal(stored.dauer,90);
  assert.equal(stored.aktiv,false);
  const fields={...program,preise:{'1-4':100,'5-10':150},dauer:120,aktiv:true};
  const activate=await fetch(root+`/api/admin/angebote/${id}`,{method:'PATCH',headers,body:JSON.stringify(fields)});
  assert.equal(activate.status,200,await activate.text());
  let publicOffers=await (await fetch(root+'/api/angebote')).json();
  assert.equal(publicOffers.length,1);
  assert.equal(publicOffers[0].dauer,120,'Änderbare Programmdauer erscheint in den öffentlichen Programmdaten');

  const deactivate=await fetch(root+`/api/admin/angebote/${id}`,{method:'PATCH',headers,
    body:JSON.stringify({...fields,aktiv:false})});
  assert.equal(deactivate.status,200);
  assert.equal((await (await fetch(root+'/api/angebote')).json()).length,0,
    'Deaktivierte Programme werden nicht mehr öffentlich angeboten');
  const reactivate=await fetch(root+`/api/admin/angebote/${id}`,{method:'PATCH',headers,
    body:JSON.stringify({...fields,aktiv:true})});
  assert.equal(reactivate.status,200);
  publicOffers=await (await fetch(root+'/api/angebote')).json();
  assert.equal(publicOffers.length,1,'Aktivierte Programme lassen sich wieder veröffentlichen');
});
