'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

async function fakePublicApi(page) {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let data;
    if (url.pathname === '/api/orte') {
      data = [{ id: 1, name: 'Brilon' }];
    } else if (url.pathname === '/api/angebote') {
      data = [{ id: 1, name: 'Klettertest', beschreibung: 'Nur automatisierter Browsertest',
        dauer: 60, preise: {'1-4': 100, '5-10': 150}, kapazitaet: 20, aktiv: true,
        buchbar: true, veroeffentlicht: true, verfuegbare_termine: [],
        kategorie: 'Klettern', zielgruppe: 'Testgruppe', veranstaltungsort: 'Brilon' }];
    } else if (url.pathname === '/api/sperrzeiten' || url.pathname === '/api/aktionen') {
      data = [];
    } else if (url.pathname === '/api/belegte-zeiten') {
      data = { zeiten: Array.from({length: 11}, (_, i) => {
        const uhrzeit = String(i+9).padStart(2, '0') + ':00';
        return { uhrzeit, belegt: uhrzeit === '10:00' };
      }) };
    } else if (url.pathname === '/api/buchungen' && route.request().method() === 'POST') {
      const submitted = JSON.parse(route.request().postData());
      assert.equal(submitted.angebot, 'Klettertest');
      assert.equal(submitted.datenschutz, 'on');
      assert.equal(submitted.datum, '2027-03-15');
      data = { success: true, buchungsnummer: 'BROWSERTEST-NUR-LOKAL' };
    } else {
      return route.fulfill({status: 401, contentType: 'application/json', body: '{"error":"Testmodus"}'});
    }
    return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data)});
  });
}

test('Browser: responsive Website, Navigation und unverbindliche Buchungsanfrage', async t => {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const repo = path.resolve(__dirname, '..');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: repo, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(port), DATABASE_URL: '',
      RUN_SCHEMA_MIGRATIONS: 'false', NODE_OPTIONS: '', MOCK_PG: '',
      BREVO_API_KEY: '', BREVO_SENDER_EMAIL: '', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' }
  });
  let errors = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { errors += chunk; });
  t.after(() => child.kill());
  const root = 'http://127.0.0.1:' + port;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { const response = await fetch(root + '/index.html'); ready = response.status === 200; if (ready) break; }
    catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.ok(ready, 'Testserver startet nicht: ' + errors);
  const browser = await chromium.launch({ headless: true });
  t.after(async () => browser.close());

  await t.test('Ansichten 360/390/768/1280 px ohne horizontalen Seitenüberlauf', async () => {
    for (const width of [360, 390, 768, 1280]) {
      const context = await browser.newContext({ viewport: {width, height: 900}, locale: 'de-DE' });
      const page = await context.newPage();
      await fakePublicApi(page);
      for (const url of ['/', '/admin.html', '/gps.html', '/anschluss.html']) {
        await page.goto(root + url, {waitUntil: 'load'});
        await page.waitForTimeout(150);
        const result = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth,
          viewport: document.documentElement.clientWidth
        }));
        if (result.document > result.viewport + 2) {
          await page.screenshot({path: '/tmp/brilon-overflow-' + width + '-' + url.replace(/[/.]/g, '_') + '.png', fullPage: true});
        }
        assert.ok(result.document <= result.viewport + 2,
          url + ' bei ' + width + ' px hat Überlauf: ' + JSON.stringify(result));
      }
      await context.close();
    }
  });

  await t.test('Tablet zeigt ausschließlich Standortangebote und priorisiert Sicherheitscode',async()=>{
    const page=await browser.newPage({viewport:{width:1024,height:768},locale:'de-DE'});
    let siteId=2,code=null,offerCalls=0;
    await page.route('**/api/pruefung/tablet/**',route=>{
      const u=new URL(route.request().url());
      let data;
      if(u.pathname==='/api/pruefung/tablet/anzeige'){
        data={name:'Tablet Winterberg',ortId:siteId,
          standort:siteId===2?'Winterberg':null,pruefdisplay:true,
          code,gueltigSekunden:code?120:0};
      }else if(u.pathname==='/api/pruefung/tablet/angebote'){
        offerCalls++;
        data={ortId:siteId,standort:siteId===2?'Winterberg':null,
          angebote:siteId===2?[{id:7,name:'Klettern Winterberg',
            beschreibung:'Nur Standort Winterberg'}]:[]};
      }else{
        return route.fulfill({status:404,contentType:'application/json',body:'{}'});
      }
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.goto(root+'/tablet.html');
    await page.waitForFunction(()=>document.getElementById('tablet-offer-title')?.textContent==='Klettern Winterberg');
    assert.equal(await page.locator('#tablet-site').textContent(),'Winterberg');
    assert.equal(offerCalls>0,true);
    code='123456';
    await page.waitForFunction(()=>document.getElementById('tablet-digits')?.textContent==='123456');
    assert.equal(await page.locator('#tablet-marketing').isVisible(),false);
    siteId=null;code=null;
    await page.waitForFunction(()=>document.getElementById('tablet-site')?.textContent==='Noch kein Standort zugewiesen');
    assert.match(await page.locator('#tablet-offer-description').textContent(),/Standort zugeordnet/);
    assert.equal(await page.locator('#tablet-marketing').isVisible(),true);
    await page.close();
  });

  await t.test('WhatsApp-Schalter blendet sowohl Floating-Button als auch Kontaktlink aus',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    await fakePublicApi(page);
    let enabled=true;
    await page.route('**/api/social-links',route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({kanäle:enabled
        ?[{id:'whatsapp',name:'WhatsApp Business',url:'https://wa.me/message/JXO6HLT34O37B1'}]
        :[]})
    }));
    await page.goto(root+'/');
    await page.locator('#social-whatsapp-button').waitFor({state:'visible'});
    assert.equal(await page.locator('#social-contact-links a[data-social-channel="whatsapp"]').count(),1);
    enabled=false;
    await page.reload();
    await page.waitForResponse(response=>response.url().includes('/api/social-links'));
    assert.equal(await page.locator('#social-whatsapp-button').count(),0);
    assert.equal(await page.locator('#social-contact-links a[data-social-channel="whatsapp"]').count(),0);
    enabled=true;
    await page.reload();
    await page.locator('#social-whatsapp-button').waitFor({state:'visible'});
    assert.equal(await page.locator('#social-contact-links a[data-social-channel="whatsapp"]').count(),1);
    await page.close();
  });

  await t.test('WhatsApp-Angebote öffnen das vorhandene Buchungsformular statt eines WhatsApp-Chats',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    await fakePublicApi(page);
    await page.goto(root+'/?programm=1#buchung');
    await page.locator('#angebot-auswahl option[value="Klettertest"]').waitFor({state:'attached'});
    await page.waitForFunction(()=>document.getElementById('angebot-auswahl')?.value==='Klettertest');
    assert.equal(await page.locator('#buchungs-standort').inputValue(),'Brilon');
    assert.equal(await page.locator('#angebot-auswahl').inputValue(),'Klettertest');
    const share=page.locator('#angebote-uebersicht .whatsapp-share-link').first();
    assert.match(await share.getAttribute('href'),/api\.whatsapp\.com\/send\?text=/);
    const message=new URL(await share.getAttribute('href')).searchParams.get('text');
    assert.match(message,/\?programm=1#buchung/);
    assert.match(message,/reguläre Buchungsformular/);
    assert.equal(await page.locator('#booking').isVisible(),true);
    await page.close();
  });

  await t.test('Geteilte WhatsApp-Sonderaktion führt in reguläre, vorausgefüllte Anfrage',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    await fakePublicApi(page);
    await page.route('**/api/aktionen',route=>route.fulfill({status:200,
      contentType:'application/json',body:JSON.stringify([
        {id:'aktion-77',titel:'Kletter-Extra',datum:'2027-03-15',
          uhrzeit:'11:00',endzeit:'12:00',veranstaltungsort:'Brilon',programm_id:1,
          beschreibung:'Sonderaktion mit regulärer Buchung'}
      ])}));
    await page.goto(root+'/?aktion=aktion-77#buchung');
    await page.waitForFunction(()=>document.getElementById('selected-special')?.textContent.includes('Kletter-Extra'));
    assert.equal(await page.locator('#angebot-auswahl').inputValue(),'Klettertest');
    assert.equal(await page.locator('#buchungs-standort').inputValue(),'Brilon');
    assert.equal(await page.locator('#booking input[name="datum"]').inputValue(),'2027-03-15');
    assert.match(await page.locator('#booking textarea[name="nachricht"]').inputValue(),/Anfrage zur Sonderaktion: Kletter-Extra/);
    const share=page.locator('#specials .whatsapp-share-link').first();
    const message=new URL(await share.getAttribute('href')).searchParams.get('text');
    assert.match(message,/\?aktion=aktion-77#buchung/);
    assert.equal(await page.locator('#booking').isVisible(),true);
    await page.close();
  });

  await t.test('Smartphone-Menü öffnet und schließt per Tastatur', async () => {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    await fakePublicApi(page);
    await page.goto(root + '/');
    const toggle = page.locator('#menuToggle');
    await toggle.waitFor({state: 'visible'});
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await toggle.evaluate(node => node === document.activeElement), true);
    await toggle.click();
    await page.locator('#siteNav a[href="#angebote"]').click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(new URL(page.url()).hash, '#angebote');
    await page.close();
  });

  await t.test('Sonderaktion startet passende unverbindliche Anfrage ohne falsche Preiszusage',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await fakePublicApi(page);
    await page.route('**/api/aktionen',route=>route.fulfill({status:200,
      contentType:'application/json',body:JSON.stringify([
        {id:'aktion-1',titel:'Spezial-Kletteraktion',datum:'2027-03-15',
          beschreibung:'Angebot zum Klettern',preis:'80',programm_id:1},
        {id:'aktion-2',titel:'Familien-Spezial',datum:'2027-04-20',
          beschreibung:'Unabhängiges Sonderangebot',preis:'50'}
      ])}));
    await page.goto(root+'/');
    await page.locator('#buchungs-standort').selectOption('Brilon');
    await page.locator('#angebot-auswahl option[value="Klettertest"]').waitFor({state:'attached'});
    await page.locator('#booking textarea[name="nachricht"]').fill('Bitte mit Getränkepause planen.');
    await page.locator('#specials article').first().getByText('Diese Aktion anfragen').click();
    await page.waitForFunction(()=>document.querySelector('#selected-special')?.textContent.includes('Spezial-Kletteraktion'));
    assert.equal(await page.locator('#angebot-auswahl').inputValue(),'Klettertest');
    assert.equal(await page.locator('input[name="datum"]').inputValue(),'2027-03-15');
    assert.match(await page.locator('textarea[name="nachricht"]').inputValue(),
      /^Anfrage zur Sonderaktion: Spezial-Kletteraktion \(Termin: 2027-03-15\)\nBitte mit Getränkepause planen\./);
    assert.match(await page.locator('#selected-special').textContent(),/Preis und Verfügbarkeit/);
    assert.equal(await page.locator('#booking-status').textContent(),'');
    await page.locator('#specials article').nth(1).getByText('Diese Aktion anfragen').click();
    assert.equal(await page.locator('#angebot-auswahl').inputValue(),'',
      'Eine nicht verknüpfte Sonderaktion darf kein altes Programm übernehmen');
    assert.match(await page.locator('textarea[name="nachricht"]').inputValue(),
      /^Anfrage zur Sonderaktion: Familien-Spezial \(Termin: 2027-04-20\)\nBitte mit Getränkepause planen\./);
    assert.equal((await page.locator('textarea[name="nachricht"]').inputValue())
      .split('Anfrage zur Sonderaktion:').length,2,
      'Nicht mehrere alte Sonderaktions-Vermerke anhängen');
    // A title alone must never silently link to a programme.
    await page.route('**/api/aktionen',route=>route.fulfill({status:200,
      contentType:'application/json',body:JSON.stringify([
        {id:'aktion-3',titel:'Klettertest',datum:'2027-03-15',
          beschreibung:'Gleicher Titel, aber explizit nicht verknüpft',preis:'80'}
      ])}));
    await page.evaluate(()=>specials());
    await page.locator('#specials article').first().getByText('Diese Aktion anfragen').click();
    assert.equal(await page.locator('#angebot-auswahl').inputValue(),'',
      'An identical title without an explicit programme ID may not select a product');
    assert.deepEqual(errors,[]);
    await page.close();
  });

  await t.test('Verspätete Verfügbarkeitsantwort darf nicht die aktuelle Programmauswahl überschreiben',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    await fakePublicApi(page);
    let pendingResolve,firstRequest=false;
    await page.route('**/api/belegte-zeiten?*',async route=>{
      const url=new URL(route.request().url());
      if(url.searchParams.get('teilnehmer')==='6'&&!firstRequest){
        firstRequest=true;
        await new Promise(resolve=>{pendingResolve=resolve;});
        return route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({zeiten:[{uhrzeit:'09:00',belegt:true}]})});
      }
      return route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({zeiten:[{uhrzeit:'09:00',belegt:false}]})});
    });
    await page.goto(root+'/');
    await page.locator('#buchungs-standort').selectOption('Brilon');
    await page.locator('#angebot-auswahl option[value="Klettertest"]').waitFor({state:'attached'});
    await page.locator('#angebot-auswahl').selectOption('Klettertest');
    await page.locator('input[name="datum"]').fill('2027-03-15');
    await page.locator('input[name="datum"]').dispatchEvent('change');
    await page.waitForFunction(()=>document.getElementById('uhrzeit-hinweis')?.textContent.includes('geprüft'));
    await page.locator('#buchungs-teilnehmer').fill('4');
    await page.waitForFunction(()=>!document.getElementById('buchungs-uhrzeit')?.disabled &&
      document.getElementById('buchungs-uhrzeit').options.length>1);
    pendingResolve?.();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#buchungs-uhrzeit option[value="09:00"]').isDisabled(),false);
    assert.equal(await page.locator('#buchungs-uhrzeit').isEnabled(),true);
    await page.close();
  });

  await t.test('Buchungsformular: Preis, belegte Uhrzeit, Testbestätigung', async () => {
    const page = await browser.newPage({viewport: {width: 390, height: 844}, locale: 'de-DE'});
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await fakePublicApi(page);
    await page.goto(root + '/#buchung');
    const date = page.locator('input[name="datum"]');
    const minimum = await date.getAttribute('min');
    assert.match(minimum || '', /^\d{4}-\d{2}-\d{2}$/,
      'Das native Datumsfeld benötigt ein gültiges ISO-Mindestdatum');
    await page.locator('#buchungs-standort').selectOption('Brilon');
    await page.locator('#angebot-auswahl option[value="Klettertest"]').waitFor({state: 'attached'});
    await page.locator('#angebot-auswahl').selectOption('Klettertest');
    await page.locator('#buchungs-teilnehmer').fill('6');
    await date.fill('2027-03-15');
    await date.dispatchEvent('change');
    await page.waitForFunction(() => {
      const element = document.getElementById('buchungs-uhrzeit');
      return !element.disabled && element.options.length > 1 &&
        element.querySelector('option[value="10:00"]')?.disabled;
    });
    assert.match(await page.locator('#angebots-preis').textContent(), /150,00\s*€/);
    await page.locator('#buchungs-uhrzeit').selectOption('11:00');
    await page.locator('input[name="vorname"]').fill('Nur');
    await page.locator('input[name="nachname"]').fill('Test');
    await page.locator('input[name="email"]').fill('browser@example.test');
    await page.locator('#ist-gast').selectOption('nein');
    await page.locator('#booking input[name="datenschutz"]').check();
    await page.locator('#booking button[type=submit]').click();
    await page.waitForFunction(() => document.getElementById('booking-status')?.textContent?.includes('BROWSERTEST-NUR-LOKAL'));
    assert.deepEqual(pageErrors, [], 'Die Buchungsseite darf keine JavaScript-Laufzeitfehler erzeugen');
    await page.close();
  });

  await t.test('Individualklettern: ein Einzelplatz, Restplätze und Anzahlungshinweis',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    let submitted;
    await fakePublicApi(page);
    await page.route('**/api/angebote',route=>route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify([{id:3,name:'Individualklettern',beschreibung:'Offene Klettergruppe',dauer:90,
        veranstaltungsort:'Brilon',
        kapazitaet:12,aktiv:true,buchbar:true,veroeffentlicht:true,verfuegbare_termine:[],
        buchungsmodus:'einzelplatz',mindestteilnehmer:5,preis_pro_person:18}])}));
    await page.route('**/api/belegte-zeiten?*',route=>route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({zeiten:[{uhrzeit:'10:00',belegt:false,freie_plaetze:11,angemeldet:1,mindestteilnehmer:5}]})}));
    await page.route('**/api/buchungen',route=>{
      submitted=JSON.parse(route.request().postData());
      return route.fulfill({status:201,contentType:'application/json',
        body:JSON.stringify({success:true,buchungsnummer:'EINZELPLATZ-TEST',einzelplatz:true,mindestteilnehmer:5})});
    });
    await page.goto(root+'/#buchung');
    await page.locator('#buchungs-standort').selectOption('Brilon');
    await page.locator('#angebot-auswahl option[value="Individualklettern"]').waitFor({state:'attached'});
    await page.locator('#angebot-auswahl').selectOption('Individualklettern');
    const participants=page.locator('#buchungs-teilnehmer');
    await page.waitForFunction(()=>document.getElementById('buchungs-modus-hinweis')?.textContent.includes('Einzelplatzreservierung'));
    assert.equal(await participants.inputValue(),'1');
    assert.equal(await participants.getAttribute('readonly'),'');
    assert.match(await page.locator('#angebots-preis').textContent(),/18,00\s*€ pro Person/);
    await page.locator('#ist-gast').selectOption('nein');
    await page.locator('input[name="datum"]').fill('2027-03-18');
    await page.locator('input[name="datum"]').dispatchEvent('change');
    await page.waitForFunction(()=>!document.getElementById('buchungs-uhrzeit')?.disabled);
    assert.match(await page.locator('#buchungs-uhrzeit option[value="10:00"]').textContent(),/noch 11 Plätze/);
    await page.locator('#buchungs-uhrzeit').selectOption('10:00');
    await page.locator('input[name="vorname"]').fill('Einzel');
    await page.locator('input[name="nachname"]').fill('Test');
    await page.locator('input[name="email"]').fill('individual@example.test');
    await page.locator('#booking input[name="datenschutz"]').check();
    await page.locator('#booking button[type=submit]').click();
    await page.waitForFunction(()=>document.getElementById('booking-status')?.textContent.includes('EINZELPLATZ-TEST'));
    assert.equal(submitted.teilnehmer,'1');
    assert.match(await page.locator('#booking-status').textContent(),/Keine Anzahlung erforderlich/);
    await page.close();
  });
});
