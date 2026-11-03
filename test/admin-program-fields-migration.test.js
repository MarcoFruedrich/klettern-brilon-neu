'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const net=require('node:net');
const path=require('node:path');

test('HTTP: Angebotsfelder lassen sich separat und ohne allgemeine Schemaänderungen einrichten',async t=>{
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const repo=path.resolve(__dirname,'..');
  const preload=path.join(repo,'test-support','mocks','force-mock-modules.js');
  const child=spawn(process.execPath,['server.js'],{cwd:repo,stdio:['ignore','pipe','pipe'],env:{
    ...process.env,PORT:String(port),NODE_ENV:'production',MOCK_MALWARE_SCAN:'1',
    NODE_PATH:path.join(repo,'test-support','mocks'),
    NODE_OPTIONS:[process.env.NODE_OPTIONS,`--require=${preload}`].filter(Boolean).join(' '),
    DATABASE_URL:'mock-test-database',MOCK_PG:'1',MOCK_OFFERS:'[]',MOCK_PLACES:'[]',
    RUN_PROGRAM_FIELDS_MIGRATION:'true',RUN_SCHEMA_MIGRATIONS:'false',
    RUN_ADMIN_SESSION_MIGRATION:'false',RUN_PLACES_MIGRATION:'false',
    RUN_ADMIN_DASHBOARD_MIGRATION:'false',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',
    ADMIN_USER:'migration-admin',ADMIN_PASSWORD:'test-only-password'
  }});
  let output='',errors='';
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>output+=chunk);
  child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>errors+=chunk);
  t.after(()=>child.kill());
  const root=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<80;i++){
    try{ready=(await fetch(root+'/admin.html')).status===200;if(ready)break;}
    catch{await new Promise(resolve=>setTimeout(resolve,50));}
  }
  assert.equal(ready,true,`Testserver startet nicht: ${errors}`);
  for(let i=0;i<40&&!output.includes('Angebotsfelder geprüft');i++)
    await new Promise(resolve=>setTimeout(resolve,25));
  assert.match(output,/Angebotsfelder geprüft \\(RUN_PROGRAM_FIELDS_MIGRATION=true\\)/);
  assert.match(output,/Schemaänderungen übersprungen/);
  assert.doesNotMatch(errors,/SQL im Test-Double nicht implementiert/);
});
