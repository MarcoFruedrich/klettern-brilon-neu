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
      if(!u.searchParams.has('seite'))return json(200,state.bookings);
      const search=(u.searchParams.get('suche')||'').toLowerCase();
      const status=u.searchParams.get('status')||'alle';
      const filtered=state.bookings.filter(b=>(status==='alle'||b.status===status)&&
        (!search||JSON.stringify(b.data).toLowerCase().includes(search)));
      return json(200,{buchungen:filtered,seite:1,proSeite:50,anzahl:filtered.length});
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
    if(endpoint==='/api/admin/zahlungsuebersicht'&&method==='GET')
      return json(200,{summen:{eingegangenCent:0,offenCent:10000,
        zahlungseingaenge:0,gutschriftCent:0},eintraege:[],seite:1,proSeite:50,anzahl:0});
    if(endpoint==='/api/admin/gps/touren')return json(200,[]);
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

  await t.test('Buchung suchen, Status speichern und Veranstaltungsort ergänzen',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const state=fakeAdminApi(page);
    await login(page,root);
    const search=page.locator('#bookings-search');
    await search.fill('Beispiel');
    await page.waitForFunction(()=>document.getElementById('booking-results-summary')?.textContent.includes('1 Buchung(en)'));
    const booking=page.locator('#bookings .booking').first();
    await booking.locator('select:not([name="methode"])').selectOption('bestaetigt');
    await booking.locator('textarea').fill('Test: Rückruf erfolgreich');
    await booking.getByRole('button',{name:'Änderungen speichern'}).click();
    await page.waitForFunction(()=>document.querySelector('#bookings .booking')?.textContent.includes('Bearbeitungsstatus: Bestätigt'));
    assert.equal(state.bookings[0].status,'bestaetigt');
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
