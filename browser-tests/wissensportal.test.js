'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path'),net=require('node:net');
const id1='550e8400-e29b-41d4-a716-446655440020';
const id2='550e8400-e29b-41d4-a716-446655440021';

test('Wissensportal: Anmeldung, Standortfilter, Artikel, Lesebestätigung und responsive Ansicht',async t=>{
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),stdio:['ignore','ignore','pipe'],
    env:{...process.env,PORT:String(port),DATABASE_URL:'',RUN_SCHEMA_MIGRATIONS:'false',
      BREVO_API_KEY:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:''}});
  let error='';
  child.stderr.on('data',b=>error+=b.toString());
  t.after(()=>child.kill());
  const root='http://127.0.0.1:'+port;
  let ready=false;
  for(let i=0;i<90;i++){
    try{ready=(await fetch(root+'/mitarbeiterbereich.html')).status===200;if(ready)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,70));
  }
  assert.ok(ready,'Testserver: '+error);
  const browser=await chromium.launch({headless:true});
  t.after(async()=>browser.close());
  for(const width of [390,1280]){
    await t.test('Wissensportal bei '+width+' px',async()=>{
      const page=await browser.newPage({viewport:{width,height:900},locale:'de-DE'});
      const errors=[],saves=[];let signedIn=false;
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/api/**',async route=>{
        const req=route.request(),uri=new URL(req.url()),endpoint=uri.pathname;
        const json=(status,data)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
        if(endpoint==='/api/pruefung/login'&&req.method()==='POST'){signedIn=true;return json(200,{success:true});}
        if(!signedIn)return json(401,{error:'Mitarbeiteranmeldung erforderlich.'});
        if(endpoint==='/api/pruefung/mitarbeiterbereiche')return json(200,{
          mitarbeiter:'Testmitarbeiter',verwaltungszugang:false,profil:{name:'Testmitarbeiter',email:'test@example.test',telefon:''},
          bereiche:[],kontakte:[],orte:[]});
        if(endpoint==='/api/wissensportal'&&req.method()==='GET')return json(200,{
          standorte:[{id:1,name:'Brilon'},{id:2,name:'Haltern'}],
          artikel:[
            {id:id1,titel:'Sicherheitsablauf Brilon',kurztext:'PSA und Vorbereitungen',inhalt:'Vorbereitung und Kontrolle',
              kategorie:'sicherheit',standorte:[1],veroeffentlicht:true,version:2,bestaetigte_version:null,
              anhaenge:[{titel:'Ablauf PDF',url:'https://example.test/ablauf.pdf'}],bildUrl:null,dokumentUrl:null,
              aktualisiert_am:'2026-11-06T12:00:00.000Z'},
            {id:id2,titel:'Toprope Programm',kurztext:'Durchführung',inhalt:'Programmbeschreibung',
              kategorie:'programm',standorte:[2],veroeffentlicht:true,version:1,bestaetigte_version:null,
              anhaenge:[],bildUrl:null,dokumentUrl:null,aktualisiert_am:'2026-11-06T12:00:00.000Z'}
          ]});
        if(endpoint==='/api/wissensportal/'+id1+'/bestaetigen'&&req.method()==='POST'){
          saves.push(id1);return json(200,{success:true,version:2,bestaetigt_am:'2026-11-06T13:00:00Z'});
        }
        return json(200,[]);
      });
      await page.goto(root+'/mitarbeiterbereich.html',{waitUntil:'load'});
      await page.locator('#staff-login [name="email"]').fill('test@example.test');
      await page.locator('#staff-login [name="passwort"]').fill('Nur-Test-Passwort');
      await page.locator('#staff-login button[type="submit"]').click();
      await page.locator('#wiki-staff-list button.wiki-entry').first().waitFor({state:'visible'});
      assert.match(await page.locator('#wiki-staff-content').innerText(),/Sicherheitsablauf Brilon/);
      assert.match(await page.locator('#wiki-staff-side').innerText(),/Ablauf PDF/);
      await page.locator('#wiki-topic-tabs button[data-category="programm"]').click();
      assert.equal(await page.locator('#wiki-staff-list button.wiki-entry').count(),1);
      assert.match(await page.locator('#wiki-staff-content').innerText(),/Toprope Programm/);
      await page.locator('#wiki-topic-tabs button[data-category="sicherheit"]').click();
      await page.locator('.wiki-confirm-panel button').click();
      await page.getByText('Die aktuelle Fassung wurde von dir als gelesen bestätigt.').waitFor({state:'visible'});
      assert.deepEqual(saves,[id1]);
      assert.match(await page.locator('.wiki-confirm-panel').innerText(),/gelesen bestätigt/);
      const widthResult=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,body:{width:document.body.getBoundingClientRect().width,scroll:document.body.scrollWidth,client:document.body.clientWidth},offenders:[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,id:el.id,className:String(el.className||'').slice(0,60),left:Math.round(el.getBoundingClientRect().left),right:Math.round(el.getBoundingClientRect().right),width:Math.round(el.getBoundingClientRect().width),scroll:el.scrollWidth,client:el.clientWidth,position:getComputedStyle(el).position})).filter(el=>el.right>innerWidth+2||el.left<-2||el.scroll>el.client+20).slice(0,20)}));
      assert.ok(widthResult.scroll<=widthResult.viewport+2,'Horizontaler Überlauf: '+JSON.stringify(widthResult));
      assert.deepEqual(errors,[]);
      await page.close();
    });
  }
});