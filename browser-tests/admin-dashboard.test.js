'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');

function fakeAdminApi(page) {
  const state = {
    signedIn: false, csrf: 'a'.repeat(64), mutations: [],
    tours: [], games: [],
    places: [{ id: 1, name: 'Brilon', aktiv: true }],
    programs: [{ id: 11, name: 'Klettertest', beschreibung: 'Testprogramm', dauer: 90,
      preise: {'1-4':100, '5-10':160}, aktiv: false, bild_url: null, kategorie: 'Klettern',
      zielgruppe:'Familien', veranstaltungsort:'Brilon', kapazitaet: 15,
      verfuegbare_termine: [], hinweise:'', buchbar:true, veroeffentlicht:false }],
    bookings: [{ id:'550e8400-e29b-41d4-a716-446655440000', status:'offen',
      bearbeitungsnotiz:'', created_at:'2027-01-01T12:00:00Z', data:{
        name:'Beispiel Kunde', vorname:'Beispiel', nachname:'Kunde',
        buchungsnummer:'KUNDE-BEISPIEL-150327', datum:'2027-03-15', uhrzeit:'10:00',
        teilnehmer:3, angebot:'Klettertest', gesamtpreis:100, email:'beispiel@example.test',
        zahlungen:[] }}]
  };
  page.route('**/api/**', async route => {
    const request=route.request(), method=request.method(), u=new URL(request.url()), endpoint=u.pathname;
    const json = (status,data) => route.fulfill({
      status, contentType:'application/json; charset=utf-8',
      headers:{'Cache-Control':'no-store'}, body:JSON.stringify(data)
    });
    const readBody=()=>JSON.parse(request.postData()||'{}');
    if(endpoint==='/api/admin/login'&&method==='POST'){
      const credentials=readBody();
      if(credentials.username!=='test-admin'||credentials.totp!=='123456')
        return json(401,{error:'Test-Anmeldung fehlgeschlagen'});
      state.signedIn=true;return json(200,{success:true,csrfToken:state.csrf});
    }
    if(!state.signedIn) return json(401,{error:'Bitte anmelden.'});
    if(!['GET','HEAD'].includes(method)){
      const csrf=request.headers()['x-csrf-token'];
      if(csrf!==state.csrf)return json(403,{error:'Fehlender CSRF-Testschutz'});
      state.mutations.push({endpoint,method,body:method==='DELETE'?null:readBody()});
    }
    if(endpoint==='/api/admin/csrf')return json(200,{csrfToken:state.csrf});
    if(endpoint==='/api/admin/buchungen'&&method==='GET'){
      if(!u.searchParams.has('seite'))return json(200,state.bookings.slice(0,250));
      const search=(u.searchParams.get('suche')||'').toLowerCase();
      const status=u.searchParams.get('status')||'alle';
      const filtered=state.bookings.filter(b=>(status==='alle'||b.status===status)&&
        (!search||JSON.stringify(b.data).toLowerCase().includes(search)));
      const pageNumber=Number(u.searchParams.get('seite'));
      return json(200,{buchungen:filtered.slice((pageNumber-1)*50,pageNumber*50),seite:pageNumber,proSeite:50,anzahl:filtered.length});
    }
    const bookingRoute=endpoint.match(/^\/api\/admin\/buchungen\/([^/]+)$/);
    if(bookingRoute&&method==='PATCH'){
      const found=state.bookings.find(b=>b.id===bookingRoute[1]);
      if(!found)return json(404,{error:'Buchung nicht gefunden'});
      const input=readBody();
      found.status=input.status;
      found.bearbeitungsnotiz=input.bearbeitungsnotiz;
      return json(200,{status:found.status,id:found.id});
    }
    if(endpoint==='/api/admin/zahlungsuebersicht'&&method==='GET'){
      const filter=u.searchParams.get('filter')||'alle';
      const pageNumber=Number(u.searchParams.get('seite')||1),proSeite=50;
      const entries=state.bookings.map(b=>{
        const paid=(b.data.zahlungen||[]).reduce((sum,z)=>sum+Number(z.betragCent||0),0);
        const total=Math.round(Number(b.data.gesamtpreis||0)*100);
        return {id:b.id,status:b.status,buchungsnummer:b.data.buchungsnummer,
          name:b.data.name,angebot:b.data.angebot,datum:b.data.datum,gesamtpreisCent:total,
          eingegangenCent:paid,offenCent:Math.max(0,total-paid),
          gutschriftCent:0,zahlungen:b.data.zahlungen||[]};
      });
      const filtered=entries.filter(e=>{
        if(filter==='offen')return e.offenCent>0;
        if(filter==='teilzahlung')return e.eingegangenCent>0&&e.offenCent>0;
        if(filter==='vollstaendig')return e.eingegangenCent>=e.gesamtpreisCent;
        if(filter==='gutschrift')return e.gutschriftCent>0;
        return true;
      });
      return json(200,{summen:{eingegangenCent:entries.reduce((v,e)=>v+e.eingegangenCent,0),
        offenCent:entries.reduce((v,e)=>v+e.offenCent,0),
        zahlungseingaenge:entries.reduce((v,e)=>v+e.zahlungen.length,0),
        gutschriftCent:0},eintraege:filtered.slice((pageNumber-1)*proSeite,pageNumber*proSeite),
        seite:pageNumber,proSeite,anzahl:filtered.length});
    }
    if(endpoint==='/api/admin/gps/touren')return json(200,state.tours);
    if(endpoint==='/api/admin/gps/buchungen'&&method==='GET'){
      const tourId=u.searchParams.get('tourId');
      const tour=state.tours.find(t=>t.id===tourId&&t.aktiv&&t.buchbar);
      const suche=(u.searchParams.get('suche')||'').toLowerCase();
      const seite=Number(u.searchParams.get('seite')||1),proSeite=30;
      const matches=state.bookings.filter(b=>b.status==='bestaetigt'&&
        tour&&b.data.angebot===tour.angebotName &&
        (!suche||[b.data.name,b.data.buchungsnummer,b.data.datum,b.data.angebot]
          .some(x=>String(x||'').toLowerCase().includes(suche))));
      return json(200,{buchungen:matches.slice((seite-1)*proSeite,seite*proSeite).map(b=>({
        id:b.id,buchungsnummer:b.data.buchungsnummer,name:b.data.name,
        datum:b.data.datum,angebot:b.data.angebot
      })),anzahl:matches.length,seite,proSeite});
    }
    if(endpoint==='/api/admin/gps/spiele'&&method==='GET'){
      const tourId=u.searchParams.get('tourId')||'';
      const seite=Number(u.searchParams.get('seite')||1),proSeite=30;
      const results=state.games.filter(g=>!tourId||g.tourId===tourId);
      return json(200,{spiele:results.slice((seite-1)*proSeite,seite*proSeite).map(g=>({...g})),
        anzahl:results.length,seite,proSeite});
    }
    const revokeRoute=endpoint.match(/^\/api\/admin\/gps\/spiele\/([^/]+)\/sperren$/);
    if(revokeRoute&&method==='PATCH'){
      const game=state.games.find(g=>g.id===revokeRoute[1]);
      if(!game)return json(404,{error:'Nicht gefunden'});
      game.gesperrtAm=game.gesperrtAm||'2027-01-01T12:05:00Z';
      game.status='gesperrt';
      return json(200,{success:true,id:game.id,gesperrtAm:game.gesperrtAm});
    }
    if(endpoint==='/api/admin/gps/spiele'&&method==='POST'){
      const {tourId,buchungId}=readBody();
      const tour=state.tours.find(t=>t.id===tourId&&t.aktiv&&t.buchbar);
      if(!tour||!state.bookings.some(b=>b.id===buchungId&&b.status==='bestaetigt'&&b.data.angebot===tour.angebotName))
        return json(409,{error:'Tour oder Buchung ist nicht freigegeben.'});
      const booking=state.bookings.find(b=>b.id===buchungId);
      state.games.unshift({id:'550e8400-e29b-41d4-a716-'+String(state.games.length+1).padStart(12,'0'),
        tourId,buchungId,erstelltAm:'2027-01-01T12:00:00Z',gestartetAm:null,
        abgeschlossenAm:null,gesperrtAm:null,stationIndex:0,
        spielzeitSekunden:null,tour:tour.titel,buchungsnummer:booking.data.buchungsnummer,
        name:booking.data.name,datum:booking.data.datum,status:'ausgestellt'});
      return json(201,{id:state.games[0].id,zugangslink:'/gps.html?zugang=TEST-NICHT-ECHT'});
    }
    if(endpoint==='/api/admin/gps/gaesteliste')return json(200,[]);
    if(endpoint==='/api/admin/kalenderbuchungen'||endpoint==='/api/admin/kalender')return json(200,[]);
    if(endpoint==='/api/aktionen'||endpoint==='/api/admin/aktionen')return json(200,[]);
    if(endpoint==='/api/admin/orte'&&method==='GET')return json(200,state.places);
    if(endpoint==='/api/admin/orte'&&method==='POST'){
      const name=readBody().name;
      const place={id:state.places.length+1,name,aktiv:true};
      state.places.push(place);
      return json(201,place);
    }
    if(endpoint==='/api/admin/angebote'&&method==='GET')return json(200,state.programs);
    if(endpoint==='/api/admin/angebote'&&method==='POST'){
      const values=readBody();
      const program={...values,id:20+state.programs.length,aktiv:false,preise:{},bild_url:null};
      state.programs.push(program);
      return json(201,{id:program.id});
    }
    const programRoute=endpoint.match(/^\/api\/admin\/angebote\/(\d+)$/);
    if(programRoute&&method==='PATCH'){
      const program=state.programs.find(p=>p.id===Number(programRoute[1]));
      if(!program)return json(404,{error:'Programm nicht gefunden'});
      Object.assign(program,readBody());
      return json(200,program);
    }
    if(endpoint==='/api/admin/logout'&&method==='POST'){
      state.signedIn=false;return json(200,{success:true});
    }
    return json(404,{error:'Kein Testendpunkt: '+endpoint});
  });
  return state;
}

async function login(page,root){
  await page.goto(root+'/admin.html');
  await page.locator('#username').fill('test-admin');
  await page.locator('#password').fill('Nur-Test-Passwort');
  await page.locator('#totp-code').fill('123456');
  await page.locator('#login button').click();
  await page.locator('#workspace').waitFor({state:'visible',timeout:15000});
  await page.locator('#angebote-admin-liste').getByText('Klettertest').first().waitFor();
}

test('Browser: geschütztes Admin-Dashboard auf mobilen und großen Bildschirmen',async t=>{
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{
    probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);
  });
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const repo=path.resolve(__dirname,'..');
  const child=spawn(process.execPath,['server.js'],{cwd:repo,stdio:['ignore','ignore','pipe'],
    env:{...process.env,PORT:String(port),DATABASE_URL:'',RUN_SCHEMA_MIGRATIONS:'false',
      NODE_OPTIONS:'',MOCK_PG:'',BREVO_API_KEY:'',BREVO_SENDER_EMAIL:'',
      SUPABASE_URL:'',SUPABASE_SECRET_KEY:''}});
  let errors='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>errors+=chunk);
  t.after(()=>child.kill());
  const root='http://127.0.0.1:'+port;
  let ready=false;
  for(let i=0;i<80;i++){
    try{ready=(await fetch(root+'/admin.html')).status===200;if(ready)break;}
    catch{await new Promise(resolve=>setTimeout(resolve,50));}
  }
  assert.ok(ready,'Admin-Testserver startet nicht: '+errors);
  const browser=await chromium.launch({headless:true});
  t.after(async()=>browser.close());

  await t.test('Angemeldetes Dashboard bei 360/768/1280 px ohne Seitenüberlauf',async()=>{
    for(const width of [360,768,1280]){
      const page=await browser.newPage({viewport:{width,height:900},locale:'de-DE'});
      const state=fakeAdminApi(page);
      const runtimeErrors=[];page.on('pageerror',error=>runtimeErrors.push(error.message));
      await login(page,root);
      const dimensions=await page.evaluate(()=>({
        page:document.documentElement.scrollWidth,screen:document.documentElement.clientWidth,
        navigation:document.querySelector('.admin-navigation').scrollWidth
      }));
      assert.ok(dimensions.page<=dimensions.screen+2,
        'Administrationsoberfläche bei '+width+' px überläuft horizontal: '+JSON.stringify(dimensions));
      assert.ok(state.signedIn);
      assert.deepEqual(runtimeErrors,[]);
      await page.close();
    }
  });

  await t.test('Programm erstellen, editieren und aktivieren mit CSRF-Token',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const state=fakeAdminApi(page);
    const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});
    await login(page,root);
    const form=page.locator('#neues-angebot-form');
    await form.locator('[name="name"]').fill('Bouldern Kinder');
    await form.locator('[name="beschreibung"]').fill('Browsertestangebot');
    await form.locator('[name="dauer"]').fill('75');
    await form.locator('[name="kapazitaet"]').fill('12');
    await form.locator('[name="zielgruppe"]').fill('Kinder');
    await form.locator('[name="verfuegbare_termine"]').fill('2027-03-15');
    await form.locator('[name="veroeffentlicht"]').check();
    await form.locator('button[type="submit"]').click();
    await page.locator('#angebote-admin-liste').getByText('Bouldern Kinder').first().waitFor();
    const created=state.programs.find(p=>p.name==='Bouldern Kinder');
    assert.ok(created);
    assert.equal(created.aktiv,false,'Neue Programme dürfen nicht ungeprüft aktiviert werden');
    assert.deepEqual(created.verfuegbare_termine,['2027-03-15']);
    const entry=page.locator('#angebote-admin-liste .card').filter({has:page.getByRole('heading',{name:'Bouldern Kinder'})});
    await entry.locator('[name="dauer"]').fill('120');
    await entry.locator('[data-gruppe="1-4"]').fill('85');
    await entry.getByRole('button',{name:'Programm speichern'}).click();
    await page.waitForFunction(()=>document.querySelector('#angebote-admin-liste')?.textContent.includes('Bouldern Kinder'));
    assert.equal(created.dauer,120);
    assert.equal(created.preise['1-4'],'85');
    const reactivateEntry=page.locator('#angebote-admin-liste .card').filter({has:page.getByRole('heading',{name:'Bouldern Kinder'})});
    await reactivateEntry.getByRole('button',{name:/Deaktiviert/}).click();
    await page.waitForFunction(()=>document.querySelector('#angebote-admin-liste')?.textContent.includes('Bouldern Kinder'));
    assert.equal(created.aktiv,true);
    assert.ok(state.mutations.some(r=>r.endpoint==='/api/admin/angebote'&&r.method==='POST'));
    assert.ok(state.mutations.some(r=>r.endpoint==='/api/admin/angebote/'+created.id&&r.method==='PATCH'));
    assert.ok(dialogs.some(x=>x.includes('erfolgreich gespeichert')));
    await page.close();
  });

  await t.test('135 Buchungen: Seitenwechsel, Statusfilter und vollständige Zahlungsübersicht',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const state=fakeAdminApi(page);
    state.bookings=Array.from({length:135},(_,i)=>({
      id:'550e8400-e29b-41d4-a716-'+String(i+1).padStart(12,'0'),
      status:i<85?'offen':'bestaetigt',bearbeitungsnotiz:'',
      created_at:new Date(Date.UTC(2027,0,1)+i*60000).toISOString(),
      data:{
        name:'Testgruppe '+String(i+1).padStart(3,'0'),vorname:'Testgruppe',
        nachname:String(i+1).padStart(3,'0'),buchungsnummer:'MASSENTEST-'+String(i+1).padStart(3,'0'),
        datum:'2027-03-15',uhrzeit:'10:00',teilnehmer:3,angebot:'Klettertest',gesamtpreis:100,
        email:'gruppe'+(i+1)+'@example.test',zahlungen:i%3===0
          ?[{betragCent:2500,methode:'ueberweisung',erhaltenAm:'2027-01-01T12:00:00Z'}]:[]
      }
    }));
    await login(page,root);
    const info=page.locator('#booking-results-summary');
    await page.waitForFunction(()=>document.getElementById('booking-results-summary')?.textContent.includes('135 Buchung(en) gefunden'));
    assert.equal(await page.locator('#bookings .booking').count(),50);
    assert.match(await info.textContent(),/Seite 1 von 3/);
    await page.locator('#bookings-next').evaluate(node=>node.scrollIntoView({block:'center'}));
    await page.locator('#bookings-next').click();
    await page.waitForFunction(()=>document.getElementById('booking-results-summary')?.textContent.includes('Seite 2 von 3'));
    assert.equal(await page.locator('#bookings .booking').count(),50);
    await page.locator('#bookings-next').evaluate(node=>node.scrollIntoView({block:'center'}));
    await page.locator('#bookings-next').click();
    await page.waitForFunction(()=>document.getElementById('booking-results-summary')?.textContent.includes('Seite 3 von 3'));
    assert.equal(await page.locator('#bookings .booking').count(),35);
    assert.equal(await page.locator('#bookings-next').isDisabled(),true);
    await page.locator('#bookings-status-filter').selectOption('bestaetigt');
    await page.waitForFunction(()=>document.getElementById('booking-results-summary')?.textContent.includes('50 Buchung(en) gefunden'));
    assert.equal(await page.locator('#bookings .booking').count(),50);
    assert.equal(await page.locator('#bookings-next').isDisabled(),true);
    await page.locator('#bookings-search').fill('Testgruppe 120');
    await page.waitForFunction(()=>document.getElementById('booking-results-summary')?.textContent.includes('1 Buchung(en) gefunden'));
    assert.equal(await page.locator('#bookings .booking').count(),1);
    assert.match(await page.locator('#bookings .booking').first().textContent(),/MASSENTEST-120/);
    await page.waitForFunction(()=>document.getElementById('payment-overview-page-info')?.textContent.includes('Seite 1 / 3'));
    assert.equal(await page.locator('#payment-overview-list .payment-record').count(),50);
    await page.locator('#payment-overview-next').evaluate(node=>node.scrollIntoView({block:'center'}));
    await page.locator('#payment-overview-next').click();
    await page.waitForFunction(()=>document.getElementById('payment-overview-page-info')?.textContent.includes('Seite 2 / 3'));
    assert.equal(await page.locator('#payment-overview-list .payment-record').count(),50);
    await page.locator('#payment-overview-filter').selectOption('teilzahlung');
    await page.waitForFunction(()=>document.getElementById('payment-overview-page-info')?.textContent.includes('45 Buchungen'));
    assert.equal(await page.locator('#payment-overview-list .payment-record').count(),45);
    assert.equal(await page.locator('#payment-overview-next').isDisabled(),true);
    const size=await page.evaluate(()=>({body:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));
    assert.ok(size.body<=size.view+2,'Große Datenbestände dürfen die Smartphone-Seite nicht horizontal verbreitern: '+JSON.stringify(size));
    await page.close();
  });

  await t.test('GPS-Zugang: bestätigte Buchung jenseits von 250 finden und auswählen',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const state=fakeAdminApi(page);
    const tourId='550e8400-e29b-41d4-a716-446655440abc';
    const name='GPS-Schatzsuche: CI-Mustertour';
    state.tours=[{id:tourId,titel:'CI-Mustertour',angebotName:name,
      schwierigkeitsgrad:'leicht',altersgruppe:'3./4. Klasse',stationen:[],
      startpunkt:'Brilon',ziel:'Brilon',aktiv:true,buchbar:true}];
    state.bookings=Array.from({length:330},(_,i)=>({
      id:'550e8400-e29b-41d4-a716-'+String(i+1).padStart(12,'0'),
      status:i<310?'bestaetigt':'offen',bearbeitungsnotiz:'',
      created_at:new Date(Date.UTC(2027,0,1)+i*60000).toISOString(),
      data:{name:'GPS Gruppe '+String(i+1).padStart(3,'0'),
        buchungsnummer:'GPS-CI-'+String(i+1).padStart(3,'0'),datum:'2027-03-15',
        angebot:i%11===0?'Anderes Programm':name,gesamtpreis:100,zahlungen:[]}
    }));
    const calls=[];page.on('request',r=>{if(r.url().includes('/api/admin/gps/buchungen'))calls.push(r.url());});
    await login(page,root);
    await page.locator('#gps-game-form [name="tourId"]').selectOption(tourId);
    await page.waitForFunction(()=>document.getElementById('gps-booking-results')?.textContent.includes('passende bestätigte'));
    const eligible=state.bookings.filter(b=>b.status==='bestaetigt'&&b.data.angebot===name);
    assert.equal(await page.locator('#gps-game-form [name="buchungId"] option').count(),31);
    assert.match(await page.locator('#gps-booking-results').textContent(),new RegExp(String(eligible.length)));
    await page.locator('#gps-booking-next').click();
    await page.waitForFunction(()=>document.getElementById('gps-booking-page-info')?.textContent.includes('Seite 2 /'));
    assert.equal(await page.locator('#gps-game-form [name="buchungId"] option').count(),31);
    await page.locator('#gps-booking-search').fill('GPS-CI-305');
    await page.waitForFunction(()=>document.getElementById('gps-booking-results')?.textContent.startsWith('1 passende'));
    const select=page.locator('#gps-game-form [name="buchungId"]');
    await page.waitForFunction(()=>document.querySelectorAll('#gps-game-form [name="buchungId"] option').length===2);
    assert.equal(await select.locator('option').count(),2);
    await select.selectOption(state.bookings[304].id);
    await page.locator('#gps-game-form button[type="submit"]').click();
    await page.waitForFunction(()=>document.getElementById('gps-game-status')?.textContent.includes('TEST-NICHT-ECHT'));
    assert.ok(state.mutations.some(m=>m.endpoint==='/api/admin/gps/spiele'&&m.body.buchungId===state.bookings[304].id),
      'Eine ältere GPS-Buchung muss trotz mehr als 250 Datensätzen erreichbar sein');
    assert.ok(calls.some(url=>url.includes('seite=2')));
    assert.ok(calls.every(url=>url.includes('tourId=')));
    const dimensions=await page.evaluate(()=>({
      doc:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth
    }));
    assert.ok(dimensions.doc<=dimensions.viewport+2);
    await page.close();
  });

  await t.test('GPS-Zugänge: Liste, Seitenwechsel und bestätigte dauerhafte Sperrung',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const state=fakeAdminApi(page);
    const tourId='550e8400-e29b-41d4-a716-446655440abc';
    state.tours=[{id:tourId,titel:'CI-Tour',angebotName:'GPS-Test',
      schwierigkeitsgrad:'leicht',altersgruppe:'Kinder',stationen:[],
      startpunkt:'Brilon',ziel:'Brilon',aktiv:true,buchbar:true}];
    state.games=Array.from({length:65},(_,i)=>({
      id:'550e8400-e29b-41d4-a716-'+String(1000+i).padStart(12,'0'),
      tourId,buchungId:'550e8400-e29b-41d4-a716-446655440000',
      erstelltAm:'2027-01-01T12:00:00Z',gestartetAm:null,
      abgeschlossenAm:null,gesperrtAm:null,stationIndex:0,
      spielzeitSekunden:null,tour:'CI-Tour',name:'Nur Test',
      buchungsnummer:'CI-SP-'+String(i+1).padStart(3,'0'),
      datum:'2027-03-15',status:'ausgestellt'
    }));
    const alerts=[];page.on('dialog',async d=>{alerts.push(d.message());await d.accept();});
    await login(page,root);
    await page.waitForFunction(()=>document.getElementById('gps-access-status')?.textContent.includes('65 ausgestellte'));
    assert.equal(await page.locator('#gps-access-list article').count(),30);
    assert.equal(await page.locator('#gps-access-page-info').textContent(),'Seite 1 / 3');
    await page.locator('#gps-access-next').click();
    await page.waitForFunction(()=>document.getElementById('gps-access-page-info')?.textContent==='Seite 2 / 3');
    assert.equal(await page.locator('#gps-access-list article').count(),30);
    await page.locator('#gps-access-next').click();
    await page.waitForFunction(()=>document.getElementById('gps-access-page-info')?.textContent==='Seite 3 / 3');
    assert.equal(await page.locator('#gps-access-list article').count(),5);
    const target=state.games[60].id;
    await page.locator('#gps-access-list article').first().getByRole('button',{name:'Zugang dauerhaft sperren'}).click();
    await page.waitForFunction(()=>document.querySelector('#gps-access-list')?.textContent.includes('Status: Gesperrt'));
    assert.equal(state.games[60].id,target);
    assert.equal(state.games[60].status,'gesperrt');
    assert.ok(alerts.some(message=>message.includes('dauerhaft sperren')));
    assert.equal(await page.locator('#gps-access-list article').first().getByRole('button',{name:'Zugang dauerhaft sperren'}).count(),0);
    assert.ok(state.mutations.some(m=>m.endpoint.endsWith('/sperren')&&m.method==='PATCH'));
    assert.ok(!JSON.stringify(await page.locator('#gps-access-list').textContent()).includes('TEST-NICHT-ECHT'));
    const size=await page.evaluate(()=>({body:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));
    assert.ok(size.body<=size.view+2,'GPS-Zugangsverwaltung darf auf dem Smartphone nicht überlaufen');
    await page.close();
  });

  await t.test('Buchung suchen, Status speichern und Veranstaltungsort ergänzen',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const state=fakeAdminApi(page);
    await login(page,root);
    const search=page.locator('#bookings-search');
    const originalCard=await page.locator('#bookings .booking').first().elementHandle();
    await search.fill('Beispiel');
    // Die Suchfilter aktualisieren die Liste entprellt nach 250 ms.
    // Erst nach dem DOM-Austausch darf die neue Buchungskarte editiert werden.
    await page.waitForFunction(oldCard=>document.querySelector('#bookings .booking')!==oldCard,originalCard);
    await page.waitForFunction(()=>document.getElementById('booking-results-summary')?.textContent.includes('1 Buchung(en)'));
    const booking=page.locator('#bookings .booking').first();
    await booking.locator('select:not([name="methode"])').selectOption('bestaetigt');
    await booking.locator('textarea').fill('Test: Rückruf erfolgreich');
    await booking.getByRole('button',{name:'Änderungen speichern'}).click();
    for(let attempt=0;attempt<40 && state.bookings[0].status!=='bestaetigt';attempt++)
      await new Promise(resolve=>setTimeout(resolve,75));
    assert.equal(state.bookings[0].status,'bestaetigt',
      'Server-Mock hat die Statusänderung nicht erhalten: '+JSON.stringify({
        mutations:state.mutations,karte:await booking.textContent(),meldung:await page.locator('#status').textContent()
      }));
    await page.waitForFunction(()=>document.querySelector('#bookings .booking')?.textContent.includes('Bearbeitungsstatus: Bestätigt'),null,{timeout:5000});
    assert.equal(state.bookings[0].bearbeitungsnotiz,'Test: Rückruf erfolgreich');

    const placeForm=page.locator('#admin-place-form');
    await placeForm.locator('[name="name"]').fill('Rüthen');
    await placeForm.locator('button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('admin-place-status')?.textContent.includes('Rüthen'));
    assert.equal(state.places.some(ort=>ort.name==='Rüthen'),true);
    assert.equal(await page.locator('#angebot-ort').inputValue(),'Rüthen');
    assert.ok(state.mutations.every(item=>['POST','PATCH','DELETE'].includes(item.method)));
    await page.close();
  });
});
