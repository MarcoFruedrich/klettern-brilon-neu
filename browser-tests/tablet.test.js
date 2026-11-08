'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');

test('Gekoppeltes Werbetablet: Werbung, Kurzzeitcode und Widerruf ohne Adminanmeldung',async t=>{
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const root='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),
    stdio:'ignore',env:{...process.env,PORT:String(port),DATABASE_URL:'',
      RUN_SCHEMA_MIGRATIONS:'false',BREVO_API_KEY:'',NODE_OPTIONS:''}});
  t.after(()=>child.kill());
  let ready=false;
  for(let i=0;i<90;i++){
    try{ready=(await fetch(root+'/tablet.html')).status===200;if(ready)break;}
    catch{await new Promise(resolve=>setTimeout(resolve,75));}
  }
  assert.ok(ready,'Werbetablet-Seite wird ohne Datenbank ausgeliefert');
  const browser=await chromium.launch({headless:true});t.after(async()=>browser.close());
  for(const width of [390,1280]){
    await t.test('Tablet bei '+width+' px: Kopplung, Codeanzeige, Verbrauch und Sperrung',async()=>{
      const page=await browser.newPage({viewport:{width,height:780},locale:'de-DE'});
      let paired=false,enabled=true,code=null,connectionBroken=false;
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/api/pruefung/tablet/angebote',async route=>route.fulfill({status:200,
        contentType:'application/json',body:JSON.stringify({ortId:1,standort:'Brilon',angebote:[
          {name:'Klettern & Abenteuer',beschreibung:'Spannende Programme für Familien und Schulklassen.'},
          {name:'Bouldern und Teamspiele',beschreibung:'Gemeinsam Herausforderungen meistern.'}
        ]})}));
      await page.route('**/api/pruefung/tablet/**',async route=>{
        const url=new URL(route.request().url());
        const send=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
        if(url.pathname==='/api/pruefung/tablet/koppeln'){
          const input=JSON.parse(route.request().postData());
          if(input.code!=='12345678')return send(409,{error:'Kopplung ungültig'});
          paired=true;return send(201,{gekoppelt:true,name:input.name});
        }
        if(!paired||!enabled)return send(401,{error:'Tablet gesperrt'});
        if(connectionBroken)return send(503,{error:'Netzwerk vorübergehend nicht verfügbar'});
        return send(200,{name:'Testtablet',ortId:1,standort:'Brilon',code,gueltigSekunden:code?120:0});
      });
      await page.goto(root+'/tablet.html');
      assert.equal(await page.locator('#tablet-pairing').isVisible(),true);
      await page.locator('#tablet-pair-form [name="code"]').fill('12345678');
      await page.locator('#tablet-pair-form button').click();
      await page.locator('#tablet-marketing').waitFor({state:'visible'});
      await page.waitForFunction(()=>document.getElementById('tablet-offer-title')?.textContent==='Klettern & Abenteuer');
      assert.equal(await page.locator('#tablet-digits').textContent(),'');
      // Anwendungsstart und Angebotswechsel ohne Neustart des Geräts.
      const refreshedOffer='Neues Teamprogramm';let offersOffline=false;
      await page.unroute('**/api/pruefung/tablet/angebote');
      await page.route('**/api/pruefung/tablet/angebote',async route=>{
        if(offersOffline)return route.fulfill({status:503,contentType:'application/json',
          body:JSON.stringify({error:'Testweise offline'})});
        return route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({ortId:1,standort:'Brilon',angebote:[{id:'neu',name:refreshedOffer,
            beschreibung:'Frisch veröffentlichte Programme für Familien.'}]})});
      });
      await page.evaluate(()=>loadOffers());
      await page.waitForFunction(()=>document.getElementById('tablet-offer-title').textContent==='Neues Teamprogramm');
      offersOffline=true;
      await page.evaluate(()=>loadOffers());
      assert.equal(await page.locator('#tablet-offer-title').textContent(),refreshedOffer,
        'Letzte Angebote sollen auch bei einem Serverfehler sichtbar bleiben.');
      await page.evaluate(()=>cycle());
      assert.equal(await page.locator('#tablet-offer-title').textContent(),refreshedOffer);
      offersOffline=false;
      // Kurzzeitcode hat Vorrang; während des Ablaufens läuft keine Adminoberfläche.
      code='004261';
      await page.evaluate(()=>checkTablet());
      await page.waitForFunction(()=>document.getElementById('tablet-digits')?.textContent==='004261');
      assert.equal(await page.locator('#tablet-marketing').isHidden(),true);
      assert.equal(await page.locator('#tablet-pairing').isHidden(),true);
      await page.evaluate(()=>{
        expiry=Date.now()-1000;
        countdown();
      });
      assert.equal(await page.locator('#tablet-digits').textContent(),'',
        'Ablauf muss auch ohne Serverantwort die Codeanzeige sofort beenden.');
      assert.equal(await page.locator('#tablet-marketing').isVisible(),true);
      code='004261';
      await page.evaluate(()=>checkTablet());
      await page.waitForFunction(()=>document.getElementById('tablet-digits').textContent==='004261');
      code=null;
      await page.evaluate(()=>checkTablet());
      assert.equal(await page.locator('#tablet-digits').textContent(),'');
      assert.equal(await page.locator('#tablet-marketing').isVisible(),true);
      // Ein Browser-Neustart der Seite zeigt Werbung und holt erneut den Status,
      // ohne Benutzerinteraktion oder erneute Kopplung.
      await page.reload();
      await page.locator('#tablet-marketing').waitFor({state:'visible'});
      await page.waitForFunction(()=>document.getElementById('tablet-connection').textContent.includes('Gekoppeltes Tablet'));
      assert.equal(await page.locator('#tablet-pairing').isHidden(),true);
      assert.equal(await page.locator('#tablet-digits').textContent(),'');
      // Die Werbung soll bei kurzzeitigem Serverausfall sichtbar bleiben,
      // ein möglicherweise abgelaufener Sicherheitscode dagegen nicht.
      code='998812';
      await page.evaluate(()=>checkTablet());
      await page.waitForFunction(()=>document.getElementById('tablet-digits').textContent==='998812');
      connectionBroken=true;
      await page.evaluate(()=>checkTablet());
      assert.equal(await page.locator('#tablet-digits').textContent(),'');
      assert.equal(await page.locator('#tablet-marketing').isVisible(),true);
      assert.match(await page.locator('#tablet-connection').textContent(),/Verbindung unterbrochen/);
      connectionBroken=false;
      code=null;
      await page.evaluate(()=>refreshAfterWake());
      assert.equal(await page.locator('#tablet-marketing').isVisible(),true);
      assert.equal(await page.locator('#tablet-digits').textContent(),'');
      enabled=false;
      await page.evaluate(()=>checkTablet());
      assert.equal(await page.locator('#tablet-pairing').isVisible(),true);
      assert.equal(await page.locator('#tablet-digits').textContent(),'');
      const dims=await page.evaluate(()=>({a:document.documentElement.scrollWidth,b:document.documentElement.clientWidth}));
      assert.ok(dims.a<=dims.b+2,'Tablet view cannot horizontally overflow '+JSON.stringify(dims));
      assert.deepEqual(errors,[]);
      await page.close();
    });
  }
});
