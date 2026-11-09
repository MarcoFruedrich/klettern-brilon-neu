'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');

test('Browser: Besuchergruppen, Programmfilter und Buchungsübergang',async t=>{
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{
    probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);
  });
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const root='http://127.0.0.1:'+port;
  const repo=path.resolve(__dirname,'..');
  const preload=path.join(repo,'test-support','mocks','force-mock-modules.js');
  const child=spawn(process.execPath,['server.js'],{
    cwd:repo,stdio:['ignore','ignore','pipe'],
    env:{
      ...process.env,PORT:String(port),NODE_ENV:'production',
      DATABASE_URL:'mock-browser-database',MOCK_PG:'1',
      NODE_PATH:path.join(repo,'test-support','mocks'),
      NODE_OPTIONS:[process.env.NODE_OPTIONS,'--require='+preload].filter(Boolean).join(' '),
      MOCK_OFFERS:'[]',MOCK_PLACES:JSON.stringify([{id:1,name:'Brilon',aktiv:true}]),
      RUN_SCHEMA_MIGRATIONS:'false',
      ADMIN_USER:'visitor-admin',ADMIN_PASSWORD:'visitor-test-only',
      SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',BREVO_API_KEY:'',BREVO_SENDER_EMAIL:''
    }
  });
  let stderr='';child.stderr.setEncoding('utf8');child.stderr.on('data',part=>stderr+=part);
  t.after(()=>child.kill());
  let ready=false;
  for(let i=0;i<90;i++){
    try{const response=await fetch(root+'/index.html');if(response.ok){ready=true;break;}}
    catch{}
    await new Promise(resolve=>setTimeout(resolve,70));
  }
  assert.ok(ready,'Testserver konnte nicht starten: '+stderr.slice(-500));
  const browser=await chromium.launch({headless:true});
  t.after(()=>browser.close());

  await t.test('Erst Standort wählen, danach buchbare Programmkacheln und Gruppenfilter',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    try{
      const offers=[
        {id:7,name:'Schul-Klettertag',beschreibung:'Für Schulklassen',dauer:90,dauer_modus:'fest',
          kategorie:'Klettern',zielgruppe:'Schulen und Klassen',veranstaltungsort:'Brilon',
          veranstaltungsorte:['Brilon'],gruppenstufen:[],preise:{'1-12':150},buchungsmodus:'gruppe'},
        {id:8,name:'Familien-Kletterspaß',beschreibung:'Für Eltern und Kinder',dauer:90,dauer_modus:'fest',
          kategorie:'Klettern',zielgruppe:'Familien',veranstaltungsort:'Brilon',
          veranstaltungsorte:['Brilon'],gruppenstufen:[],preise:{'1-12':150},buchungsmodus:'gruppe'},
        {id:9,name:'GPS-Tour Hamm',beschreibung:'Orientierung und Abenteuer',dauer:120,dauer_modus:'fest',
          kategorie:'GPS',zielgruppe:'Jugendgruppen',veranstaltungsort:'Hamm',
          veranstaltungsorte:['Hamm'],gruppenstufen:[],preise:{'1-12':180},buchungsmodus:'gruppe'}
      ];
      await page.route('**/api/angebote',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(offers)}));
      await page.route('**/api/orte',route=>route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify([{id:1,name:'Brilon'},{id:2,name:'Hamm'}])}));
      await page.goto(root+'/',{waitUntil:'domcontentloaded'});
      await page.locator('#angebote-standort-filter option[value="Hamm"]').waitFor({state:'attached'});
      const sectionOrder=await page.evaluate(()=>Array.from(document.querySelectorAll('main > section'))
        .map(section=>section.id).filter(Boolean));
      assert.ok(sectionOrder.indexOf('standortwahl')<sectionOrder.indexOf('angebote'));
      assert.ok(sectionOrder.indexOf('angebote')<sectionOrder.indexOf('besuchergruppen'));
      assert.equal(await page.locator('#angebote-standort-filter').inputValue(),'');
      assert.equal(await page.locator('#angebote-uebersicht article').count(),0,
        'Ohne ausgewählten Standort sind keine Programme sichtbar');
      assert.equal(await page.locator('#besuchergruppen-kacheln article').count(),0,
        'Besuchergruppen erscheinen erst nach der Standortwahl');

      await page.locator('#angebote-standort-filter').selectOption('Brilon');
      await page.waitForFunction(()=>document.querySelectorAll('#angebote-uebersicht article').length===2);
      assert.match(await page.locator('#angebote-uebersicht').innerText(),/Schul-Klettertag/);
      assert.doesNotMatch(await page.locator('#angebote-uebersicht').innerText(),/GPS-Tour Hamm/);
      await page.locator('#besuchergruppen-kacheln article').first().waitFor({state:'visible'});
      assert.equal(await page.locator('#besuchergruppen-kacheln article').count(),6);
      const overflowing=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+3);
      assert.equal(overflowing,false,'Auf dem Smartphone entsteht kein horizontaler Überlauf');
      await page.locator('#besuchergruppen-kacheln article').filter({hasText:'Schulen'})
        .getByRole('link',{name:/Angebote entdecken/}).click();
      await page.waitForFunction(()=>document.querySelectorAll('#angebote-uebersicht article').length===1);
      assert.match(await page.locator('#angebote-uebersicht').innerText(),/Schul-Klettertag/);
      assert.doesNotMatch(await page.locator('#angebote-uebersicht').innerText(),/Familien-Kletterspaß/);
      await page.locator('#angebote-uebersicht .angebote-anfragen-link').click();
      assert.equal(await page.locator('#buchungs-standort').inputValue(),'Brilon');
      assert.equal(await page.locator('#angebot-auswahl').inputValue(),'Schul-Klettertag');

      await page.locator('#angebote-standort-filter').selectOption('Hamm');
      await page.waitForFunction(()=>document.querySelectorAll('#angebote-uebersicht article').length===1);
      assert.match(await page.locator('#angebote-uebersicht').innerText(),/GPS-Tour Hamm/);
      assert.doesNotMatch(await page.locator('#angebote-uebersicht').innerText(),/Schul-Klettertag/);
      assert.equal(await page.locator('#buchungs-standort').inputValue(),'Hamm',
        'Die Standortwahl ist mit dem Buchungsformular synchronisiert');
      assert.equal(await page.locator('#angebot-auswahl').inputValue(),'',
        'Programm wird beim Standortwechsel nicht fälschlich übernommen');
    }finally{await page.close();}
  });

});
