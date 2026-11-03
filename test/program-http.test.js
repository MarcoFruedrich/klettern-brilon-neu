'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
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
  const preload=path.join(repo,'test-support','mocks','force-mock-modules.js');
  const totpSecret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const child=spawn(process.execPath,['server.js'],{cwd:repo,stdio:['ignore','ignore','pipe'],env:{
    ...process.env,PORT:String(port),NODE_PATH:path.join(repo,'test-support','mocks'),
    NODE_OPTIONS:[process.env.NODE_OPTIONS,`--require=${preload}`].filter(Boolean).join(' '),
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

  const bildUrl=root+`/api/admin/angebote/${id}/bild`;
  const jpegHeaders={Cookie:cookie,Origin:root,'X-CSRF-Token':loginData.csrfToken,'Content-Type':'image/jpeg'};
  const fakeJpeg=await fetch(bildUrl,{method:'POST',headers:jpegHeaders,body:Buffer.from([0xff,0xd8,0xff])});
  assert.equal(fakeJpeg.status,400,'Ein JPEG-Signaturpräfix ohne Bildinhalt wird abgewiesen');
  const zuGrossesPng=Buffer.from(fs.readFileSync(path.join(repo,'site/klettern-brilon-icon.png')));
  zuGrossesPng.writeUInt32BE(7000,16);zuGrossesPng.writeUInt32BE(7000,20);
  const zuGross={...jpegHeaders,'Content-Type':'image/png'};
  const imageBomb=await fetch(bildUrl,{method:'POST',headers:zuGross,body:zuGrossesPng});
  assert.equal(imageBomb.status,400,'Bilder über 40 Megapixel werden vor dem Speichern abgewiesen');
  const echtesPng=await fetch(bildUrl,{method:'POST',headers:zuGross,
    body:fs.readFileSync(path.join(repo,'site/klettern-brilon-icon.png'))});
  assert.equal(echtesPng.status,503,'Ohne Malware-Scannerkonfiguration wird das Bild vor dem Speichern abgewiesen');
  assert.match((await echtesPng.json()).error,/Bildprüfung ist nicht verfügbar/);

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

  const secondCreated=await fetch(root+'/api/admin/angebote',{method:'POST',headers,
    body:JSON.stringify({...program,name:'Bouldern am Turm'})});
  assert.equal(secondCreated.status,201);
  const secondId=(await secondCreated.json()).id;
  const secondActivate=await fetch(root+`/api/admin/angebote/${secondId}`,{method:'PATCH',headers,
    body:JSON.stringify({...fields,name:'Bouldern am Turm',aktiv:true})});
  assert.equal(secondActivate.status,200);
  const badOrder=await fetch(root+'/api/admin/angebote/reihenfolge',{method:'PATCH',headers,
    body:JSON.stringify({ids:[id,id]})});
  assert.equal(badOrder.status,400,'Doppelte Programm-IDs werden in der Reihenfolge abgelehnt');
  const reorder=await fetch(root+'/api/admin/angebote/reihenfolge',{method:'PATCH',headers,
    body:JSON.stringify({ids:[secondId,id]})});
  assert.equal(reorder.status,200);
  publicOffers=await (await fetch(root+'/api/angebote')).json();
  assert.deepEqual(publicOffers.map(item=>item.name),['Bouldern am Turm','Klettern am Turm']);

  const archived=await fetch(root+`/api/admin/angebote/${id}/archivieren`,{method:'PATCH',headers,
    body:JSON.stringify({archiviert:true})});
  assert.equal(archived.status,200);
  assert.equal((await archived.json()).archiviert,true);
  publicOffers=await (await fetch(root+'/api/angebote')).json();
  assert.deepEqual(publicOffers.map(item=>item.name),['Bouldern am Turm'],
    'Archivierte Angebote werden nicht mehr öffentlich buchbar angezeigt');
  const archivedAdmin=(await (await fetch(root+'/api/admin/angebote',{headers:{Cookie:cookie}})).json())
    .find(item=>item.id===id);
  assert.equal(archivedAdmin.archiviert,true,'Archivierte Programme bleiben in der Verwaltung erhalten');
  const restore=await fetch(root+`/api/admin/angebote/${id}/archivieren`,{method:'PATCH',headers,
    body:JSON.stringify({archiviert:false})});
  assert.equal(restore.status,200);
  assert.equal((await restore.json()).archiviert,false);
});
