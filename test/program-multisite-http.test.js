'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const net=require('node:net');
const path=require('node:path');

test('HTTP: Mehrfachstandorte bleiben gespeichert und werden öffentlich gefiltert',async t=>{
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const repo=path.resolve(__dirname,'..'),root='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,['server.js'],{cwd:repo,stdio:['ignore','ignore','pipe'],env:{
    ...process.env,PORT:String(port),NODE_ENV:'production',MOCK_PG:'1',DATABASE_URL:'mock-test-database',
    NODE_PATH:path.join(repo,'test-support','mocks'),
    NODE_OPTIONS:[process.env.NODE_OPTIONS,'--require='+path.join(repo,'test-support','mocks','force-mock-modules.js')].filter(Boolean).join(' '),
    MOCK_PROGRAM_LOCATIONS:'1',MOCK_PLACES:JSON.stringify([
      {id:1,name:'Brilon',aktiv:true},{id:2,name:'Olpe',aktiv:true},{id:3,name:'Rüthen',aktiv:true}]),
    MOCK_OFFERS:'[]',RUN_SCHEMA_MIGRATIONS:'false',ADMIN_USER:'standorte-admin',ADMIN_PASSWORD:'test-only-password',
    BREVO_API_KEY:'',BREVO_SENDER_EMAIL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:''
  }});
  t.after(()=>child.kill());
  let errors='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>errors+=chunk);
  let ready=false;
  for(let i=0;i<80;i++){
    try{await fetch(root+'/index.html');ready=true;break;}
    catch{await new Promise(resolve=>setTimeout(resolve,50));}
  }
  assert.equal(ready,true,'Testserver sollte starten: '+errors);
  const login=await fetch(root+'/api/admin/login',{method:'POST',headers:{Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({username:'standorte-admin',password:'test-only-password'})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';',1)[0];
  const csrf=(await login.json()).csrfToken;
  const headers={Cookie:cookie,Origin:root,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
  const programme={name:'Klettern in zwei Städten',beschreibung:'Buchbares Testangebot',dauer:90,
    standorte:['Brilon','Olpe'],kapazitaet:20,buchbar:true,veroeffentlicht:true};
  const created=await fetch(root+'/api/admin/angebote',{method:'POST',headers,body:JSON.stringify(programme)});
  assert.equal(created.status,201,await created.text());
  const id=(await (await fetch(root+'/api/admin/angebote',{headers:{Cookie:cookie}})).json())[0].id;
  const stored=(await (await fetch(root+'/api/admin/angebote',{headers:{Cookie:cookie}})).json())[0];
  assert.deepEqual(stored.standorte,['Brilon','Olpe']);
  assert.equal(stored.veranstaltungsort,'Brilon');
  const patched=await fetch(root+'/api/admin/angebote/'+id,{method:'PATCH',headers,
    body:JSON.stringify({...programme,standorte:['Olpe','Rüthen'],preise:{'1-4':80,'5-10':120},aktiv:true})});
  assert.equal(patched.status,200,await patched.text());
  const published=await (await fetch(root+'/api/angebote')).json();
  assert.deepEqual(published[0].standorte,['Olpe','Rüthen']);
  assert.equal(published[0].veranstaltungsort,'Olpe');
  const availability=async standort=>fetch(root+'/api/belegte-zeiten?'+new URLSearchParams({
    datum:'2027-04-01',teilnehmer:'5',angebot:programme.name,standort}));
  const allowed=await availability('Rüthen');assert.equal(allowed.status,200,await allowed.text());
  const forbidden=await availability('Brilon');assert.equal(forbidden.status,409);
});
