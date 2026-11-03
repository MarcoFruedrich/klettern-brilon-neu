'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const net=require('node:net');
const path=require('node:path');

async function startServer(t,extraEnv={}){
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{
    probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);
  });
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const repo=path.resolve(__dirname,'..');
  const preload=path.join(repo,'test-support','mocks','force-mock-modules.js');
  const child=spawn(process.execPath,['server.js'],{cwd:repo,stdio:['ignore','ignore','pipe'],env:{
    ...process.env,PORT:String(port),NODE_PATH:path.join(repo,'test-support','mocks'),
    NODE_OPTIONS:[process.env.NODE_OPTIONS,`--require=${preload}`].filter(Boolean).join(' '),
    DATABASE_URL:'mock-test-database',MOCK_PG:'1',MOCK_PLACES_TABLE:'missing',
    RUN_ADMIN_SESSION_MIGRATION:'false',RUN_ADMIN_DASHBOARD_MIGRATION:'false',
    RUN_SCHEMA_MIGRATIONS:'false',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',
    ADMIN_USER:'test-admin',ADMIN_PASSWORD:'test-only-password',...extraEnv
  }});
  let errors='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>errors+=chunk);
  t.after(()=>child.kill());
  const root=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<80;i++){
    try{ready=(await fetch(root+'/admin.html')).status===200;if(ready)break;}
    catch{await new Promise(resolve=>setTimeout(resolve,50));}
  }
  assert.equal(ready,true,'Der Testserver muss starten: '+errors);
  const response=await fetch(root+'/api/admin/login',{method:'POST',headers:{
    Origin:root,'Content-Type':'application/json'
  },body:JSON.stringify({username:'test-admin',password:'test-only-password'})});
  assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie').split(';',1)[0];
  return {root,cookie};
}

test('HTTP: fehlende Veranstaltungstabelle erklärt die notwendige gezielte Einrichtung',async t=>{
  const {root,cookie}=await startServer(t);
  const response=await fetch(root+'/api/admin/orte',{headers:{Cookie:cookie}});
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,
    'Die Veranstaltungsort-Tabelle fehlt. Einmalig RUN_PLACES_MIGRATION=true setzen und den Server neu starten.');
});

test('HTTP: separate Veranstaltungsort-Migration richtet nur die benötigte Tabelle ein',async t=>{
  const {root,cookie}=await startServer(t,{RUN_PLACES_MIGRATION:'true'});
  const response=await fetch(root+'/api/admin/orte',{headers:{Cookie:cookie}});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),[{id:1,name:'Brilon',aktiv:true}]);
});
