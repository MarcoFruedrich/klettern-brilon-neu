'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');

test('Stationsprüfung: mobile Mitarbeiteranmeldung, Code und Mängeldokumentation',async t=>{
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{
    probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);
  });
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const repo=path.resolve(__dirname,'..');
  const child=spawn(process.execPath,['server.js'],{cwd:repo,stdio:['ignore','ignore','pipe'],
    env:{...process.env,PORT:String(port),DATABASE_URL:'',RUN_SCHEMA_MIGRATIONS:'false',
      NODE_OPTIONS:'',MOCK_PG:'',BREVO_API_KEY:'',SUPABASE_URL:''}});
  t.after(()=>child.kill());
  const root='http://127.0.0.1:'+port;
  let ready=false;
  for(let attempt=0;attempt<90;attempt++){
    try{ready=(await fetch(root+'/pruefung.html')).status===200;if(ready)break;}
    catch{await new Promise(resolve=>setTimeout(resolve,50));}
  }
  assert.ok(ready,'Mobile Prüfseite muss vom Testserver ausgeliefert werden');
  const browser=await chromium.launch({headless:true});
  t.after(async()=>browser.close());

  for(const width of [360,390,768]){
    await t.test('Prüfprotokoll '+width+' px und obligatorische Mängelbeschreibung',async()=>{
      const page=await browser.newPage({viewport:{width,height:844},locale:'de-DE'});
      const state={loggedIn:false,unlocked:false,saved:null};
      const station='550e8400-e29b-41d4-a716-446655440001';
      await page.route('**/api/pruefung/**',async route=>{
        const req=route.request(),url=new URL(req.url()),endpoint=url.pathname;
        const respond=(status,data)=>route.fulfill({status,contentType:'application/json',
          body:JSON.stringify(data)});
        if(endpoint==='/api/pruefung/login'&&req.method()==='POST'){
          const d=JSON.parse(req.postData());
          if(d.email!=='test@example.test'||d.passwort!=='Personal-Geheimnis-2026')
            return respond(401,{error:'Anmeldedaten ungültig.'});
          state.loggedIn=true;return respond(200,{name:'Testmitarbeiterin'});
        }
        if(!state.loggedIn)return respond(401,{error:'Mitarbeiteranmeldung erforderlich.'});
        if(endpoint==='/api/pruefung/stationen'){
          return respond(200,{mitarbeiter:'Testmitarbeiterin',
            entsperrtBis:null,stationen:[{id:station,name:'Kletterwand'}]});
        }
        if(endpoint==='/api/pruefung/freischalten'&&req.method()==='POST'){
          if(JSON.parse(req.postData()).code!=='123456')
            return respond(409,{error:'Code ungültig.'});
          state.unlocked=true;return respond(200,{success:true,gueltigMinuten:15});
        }
        if(endpoint==='/api/pruefung/berichte'&&req.method()==='POST'){
          if(!state.unlocked)return respond(403,{error:'Vor-Ort-Code fehlt.'});
          const d=JSON.parse(req.postData());
          state.saved=d;state.unlocked=false;
          return respond(201,{id:'pruefung-nur-simuliert',hatMangel:true,
            status:'mangel_gemeldet',benachrichtigung:'nicht_konfiguriert'});
        }
        return respond(404,{error:'Nicht gefunden.'});
      });
      await page.goto(root+'/pruefung.html');
      const dimensions=await page.evaluate(()=>({
        doc:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,
        overflows:Array.from(document.querySelectorAll('body *')).filter(node=>
          node.getBoundingClientRect().right>innerWidth+2).slice(0,12).map(node=>({
            tag:node.tagName,id:node.id,className:node.className,
            right:Math.round(node.getBoundingClientRect().right)
          }))
      }));
      assert.ok(dimensions.doc<=dimensions.viewport+2,JSON.stringify(dimensions));
      await page.locator('#staff-login input[name="email"]').fill('test@example.test');
      await page.locator('#staff-login input[name="passwort"]').fill('Personal-Geheimnis-2026');
      await page.locator('#staff-login button').click();
      await page.locator('#onsite-unlock input[name="code"]').waitFor({state:'visible'});
      await page.locator('#onsite-unlock input[name="code"]').fill('123456');
      await page.locator('#onsite-unlock button').click();
      await page.locator('#station-inspection input[name="programm"]').waitFor({state:'visible'});
      await page.locator('#station-inspection input[name="programm"]').fill('Testkurs');
      await page.locator('#station-inspection input[name="beginn"]').fill('2027-03-15T10:00');
      await page.locator('.pruefung-station .pruefung-aktiv').check();
      await page.locator('.pruefung-station .pruefung-zustand').selectOption('mangel');
      assert.equal(await page.locator('.pruefung-station .pruefung-beschreibung').getAttribute('required'),'');
      await page.locator('.pruefung-station .pruefung-beschreibung').fill('Defekter Sicherungskarabiner');
      const pngBase64=await page.evaluate(()=>{
        const canvas=document.createElement('canvas');
        canvas.width=8;canvas.height=8;
        canvas.getContext('2d').fillRect(0,0,8,8);
        return canvas.toDataURL('image/png').split(',')[1];
      });
      await page.locator('.pruefung-station .pruefung-foto').setInputFiles({
        name:'defekt.png',mimeType:'image/png',buffer:Buffer.from(pngBase64,'base64')
      });
      await page.locator('#station-inspection button[type="submit"]').click();
      await page.waitForFunction(()=>document.getElementById('pruefung-status')?.textContent.includes('MANGEL ERFASST'));
      assert.equal(state.saved.pruefungen[0].stationId,station);
      assert.equal(state.saved.pruefungen[0].zustand,'mangel');
      assert.match(state.saved.pruefungen[0].beschreibung,/Sicherungskarabiner/);
      assert.match(state.saved.pruefungen[0].foto,/^data:image\/jpeg;base64,/,
        'Das Foto muss vor dem Upload lokal in ein kompaktes JPEG umgewandelt werden');
      assert.equal(await page.locator('#station-inspection').isHidden(),true);
      assert.equal(await page.locator('#onsite-unlock').isVisible(),true);
      await page.close();
    });
  }
});
