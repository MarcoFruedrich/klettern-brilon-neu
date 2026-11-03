'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const net=require('node:net');
const path=require('node:path');

test('HTTP: parallele Anfragen überschreiten weder Zeitfenster noch Tageskapazität',async t=>{
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const repo=path.resolve(__dirname,'..');
  const preload=path.join(repo,'test-support','mocks','force-mock-modules.js');
  const offers=[{id:1,name:'Klettern',preise:{'1-4':75},kapazitaet:5,aktiv:true,
    verfuegbare_termine:['2027-03-15','2027-03-16','2027-03-17'],buchbar:true,veroeffentlicht:true,dauer:60}];
  const child=spawn(process.execPath,['server.js'],{cwd:repo,stdio:['ignore','ignore','pipe'],env:{
    ...process.env,PORT:String(port),NODE_PATH:path.join(repo,'test-support','mocks'),
    NODE_OPTIONS:[process.env.NODE_OPTIONS,`--require=${preload}`].filter(Boolean).join(' '),
    DATABASE_URL:'mock-test-database',MOCK_PG:'1',MOCK_OFFERS:JSON.stringify(offers),MOCK_BOOKINGS:'[]',
    MOCK_CALENDAR:'[]',RUN_SCHEMA_MIGRATIONS:'false',BREVO_API_KEY:'',BREVO_SENDER_EMAIL:'',
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

  const request=(name,date,time,participants=3)=>fetch(root+'/api/buchungen',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({vorname:name,nachname:'Team',email:name.toLowerCase()+'@example.test',datum:date,uhrzeit:time,
      teilnehmer:participants,angebot:'Klettern',datenschutz:'on'})});
  const capacityResults=await Promise.all([request('Alpha','2027-03-15','10:00'),request('Beta','2027-03-15','11:00')]);
  assert.deepEqual(capacityResults.map(response=>response.status).sort(),[201,409],
    'Bei gleichzeitigen, nicht überlappenden Anfragen darf die Kapazität von fünf Personen nicht überschritten werden');

  const overlapResults=await Promise.all([request('Gamma','2027-03-16','10:00'),request('Delta','2027-03-16','10:00')]);
  assert.deepEqual(overlapResults.map(response=>response.status).sort(),[201,409],
    'Bei gleichzeitigem Zugriff kann dasselbe Zeitfenster nur einmal reserviert werden');

  const referenceResults=await Promise.all([request('Echo','2027-03-17','10:00',2),request('Echo','2027-03-17','11:00',2)]);
  assert.deepEqual(referenceResults.map(response=>response.status),[201,201],
    'Zwei freie Anschlusszeiten dürfen trotz desselben Namens angenommen werden');
  const references=await Promise.all(referenceResults.map(response=>response.json().then(data=>data.buchungsnummer)));
  assert.equal(new Set(references).size,2,'Parallele Buchungen dürfen keine Referenz doppelt vergeben');
  assert.deepEqual(references.sort(),['TEAM-ECHO-170327','TEAM-ECHO-170327-02']);
});
