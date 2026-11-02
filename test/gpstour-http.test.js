'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const net=require('node:net');
const path=require('node:path');
const {totpCode}=require('../lib/totp');

test('HTTP: GPS-Touren sind geschützt, speicherbar und geben keine Kontrollcodes heraus',async t=>{
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const repo=path.resolve(__dirname,'..');
  const totpSecret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const child=spawn(process.execPath,['server.js'],{cwd:repo,stdio:['ignore','ignore','pipe'],env:{
    ...process.env,PORT:String(port),NODE_PATH:path.join(repo,'test-support','mocks'),
    DATABASE_URL:'mock-test-database',MOCK_PG:'1',MOCK_OFFERS:'[]',MOCK_GPS_TOURS:'[]',MOCK_PLACES:'[]',
    RUN_SCHEMA_MIGRATIONS:'false',ADMIN_USER:'tour-admin',ADMIN_PASSWORD:'test-only-password',
    ADMIN_TOTP_SECRET_BASE32:totpSecret,GPS_CODE_SECRET:'test-gps-code-secret-with-32-or-more-characters',
    SUPABASE_URL:'',SUPABASE_SECRET_KEY:''
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

  const privateRead=await fetch(root+'/api/admin/gps/touren');
  assert.equal(privateRead.status,401,'GPS-Touren erfordern eine Admin-Sitzung');
  const origin=root;
  const login=await fetch(root+'/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({username:'tour-admin',password:'test-only-password',totp:totpCode(totpSecret,Math.floor(Date.now()/30000))})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';',1)[0];
  const loginData=await login.json();
  const headers={Cookie:cookie,Origin:origin,'X-CSRF-Token':loginData.csrfToken,'Content-Type':'application/json'};
  const tour={titel:'Brilon entdecken',beschreibung:'Eine kurze Kindertour',schwierigkeitsgrad:'leicht',altersgruppe:'3. und 4. Klasse',
    startpunkt:'Marktplatz',ziel:'Marktplatz',dauer:90,preis:45,buchbar:true,aktiv:true,
    stationen:[{id:'station-1',qrId:'BRILON-001',kontrollcode:'4821',frage:'Welche Figur steht am Brunnen?',
      antworten:['Petrus','Ein Drache'],loesungIndex:0,latitude:51.394,longitude:8.572}]};
  const created=await fetch(root+'/api/admin/gps/touren',{method:'POST',headers,body:JSON.stringify(tour)});
  const createdText=await created.text();
  assert.equal(created.status,201,createdText);
  const createdData=JSON.parse(createdText);
  const tourId=createdData.id;

  const read=await fetch(root+'/api/admin/gps/touren',{headers:{Cookie:cookie}});
  assert.equal(read.status,200);
  let stored=(await read.json())[0];
  assert.equal(stored.id,tourId);
  assert.equal(stored.stationen[0].qrId,'BRILON-001');
  assert.equal('kontrollcode' in stored.stationen[0],false);
  assert.equal('kontrollcodeHash' in stored.stationen[0],false);

  const edited={...tour,titel:'Briloner Entdeckertour',aktiv:true,
    stationen:[{...tour.stationen[0],kontrollcode:'',frage:'Welche Figur steht am Petrusbrunnen?'}]};
  const update=await fetch(root+`/api/admin/gps/touren/${tourId}`,{method:'PATCH',headers,body:JSON.stringify(edited)});
  const updateText=await update.text();
  assert.equal(update.status,200,updateText);
  const afterEdit=await (await fetch(root+'/api/admin/gps/touren',{headers:{Cookie:cookie}})).json();
  assert.equal(afterEdit[0].titel,'Briloner Entdeckertour');
  assert.equal(afterEdit[0].stationen[0].frage,'Welche Figur steht am Petrusbrunnen?');

  const changedQr=structuredClone(edited);changedQr.stationen[0].qrId='BRILON-002';
  const missingCode=await fetch(root+`/api/admin/gps/touren/${tourId}`,{method:'PATCH',headers,body:JSON.stringify(changedQr)});
  assert.equal(missingCode.status,400,'Eine neue QR-Kennung erfordert einen neuen Kontrollcode');
  changedQr.stationen[0].kontrollcode='739102';
  const renewedCode=await fetch(root+`/api/admin/gps/touren/${tourId}`,{method:'PATCH',headers,body:JSON.stringify(changedQr)});
  assert.equal(renewedCode.status,200);

  const disabled=await fetch(root+`/api/admin/gps/touren/${tourId}`,{method:'PATCH',headers,body:JSON.stringify({aktiv:false})});
  assert.equal(disabled.status,200);
  stored=(await (await fetch(root+'/api/admin/gps/touren',{headers:{Cookie:cookie}})).json())[0];
  assert.equal(stored.aktiv,false,'Touren lassen sich deaktivieren');
  assert.equal(stored.buchbar,true,'Deaktivieren ändert die Buchbarkeit nicht');
});
