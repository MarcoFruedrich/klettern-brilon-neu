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
    tours: [], games: [], specials: [],
    inspectionEvents: [], inspectionStatusEvents: [], inspectionStaff: [], invitations: [],
    nextInvite: 0,
    inspectionHints: [],
    inspectionMails: [],
    inspectionOverview: {zaehler:{gesperrt:0,stillgelegt:0,nicht_nutzbar:0,
      hinweise_offen:0,meldungen_ungeklaert:0},stationen:[],hinweise:[],meldungen:[],
      stand:'2027-01-01T16:00:00Z'},
    inspectionTablets: [],
    inspectionStations: [{id:'550e8400-e29b-41d4-a716-446655440099',
      name:'Kletterwand Test',aktiv:true,gesperrt_am:'2027-01-01T12:00:00Z',
      sperrgrund:'Defekte Sicherheitsverbindung an der Wand'}],
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
      if(credentials.username!=='test-admin'||credentials.password!=='Nur-Test-Passwort')
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
    if(endpoint==='/api/admin/pruefung/uebersicht'&&method==='GET')
      return json(200,state.inspectionOverview);
    if(endpoint==='/api/admin/pruefung/tablets'&&method==='GET')
      return json(200,state.inspectionTablets);
    const replacement=endpoint.match(/^\/api\/admin\/pruefung\/tablets\/([^/]+)\/ersetzen$/);
    if(replacement&&method==='POST'){
      const d=readBody(),tablet=state.inspectionTablets.find(x=>x.id===replacement[1]&&x.aktiv);
      if(!d.wechselBestaetigt)return json(400,{error:'Bestätigung erforderlich'});
      if(!tablet)return json(409,{error:'Gerät bereits gesperrt'});
      tablet.aktiv=false;tablet.online=false;tablet.pruefdisplay=false;
      return json(201,{code:'00654321',gueltigSekunden:600,bisherigesGeraet:{id:tablet.id,name:tablet.name}});
    }
    const chooseTablet=endpoint.match(/^\/api\/admin\/pruefung\/tablets\/([^/]+)\/pruefdisplay$/);
    if(chooseTablet&&method==='PATCH'){
      const device=state.inspectionTablets.find(x=>x.id===chooseTablet[1]&&x.aktiv);
      if(!device)return json(409,{error:'Tablet nicht aktiv'});
      state.inspectionTablets.forEach(x=>{x.pruefdisplay=x.id===device.id;});
      return json(200,{id:device.id,pruefdisplay:true});
    }
    if(endpoint==='/api/admin/pruefung/mitarbeitende'&&method==='GET')
      return json(200,[...state.inspectionStaff,...state.invitations]);
    if(endpoint==='/api/admin/pruefung/mitarbeitende'&&method==='POST'){
      const values=readBody();state.invitations=state.invitations.filter(x=>x.email!==values.email);
      const invitation={id:'invite-'+(++state.nextInvite),name:values.name,email:values.email,
        status:'eingeladen',art:'einladung',aktiv:false,ablauf:'2027-01-08T12:00:00Z'};
      state.invitations.push(invitation);
      return json(201,{...invitation,emailVersand:'fehlgeschlagen',
        registrierungsLink:'https://example.test/mitarbeiter-registrierung.html?token='+String(state.nextInvite).padStart(64,'0')});
    }
    const staffApproval=endpoint.match(/^\/api\/admin\/pruefung\/mitarbeitende\/([^/]+)\/freigeben$/);
    if(staffApproval&&method==='PATCH'){
      const user=state.inspectionStaff.find(x=>x.id===staffApproval[1]);
      if(!user)return json(404,{error:'Mitarbeiter nicht gefunden'});
      const selection=readBody();user.aktiv=true;user.status='aktiv';
      user.freigaben=selection.standorte.flatMap(ortId=>selection.qualifikationen.map(qualifikation=>({
        ort:state.places.find(place=>String(place.id)===String(ortId))?.name,qualifikation
      })));
      return json(200,{id:user.id,name:user.name,email:user.email,emailVersand:'fehlgeschlagen'});
    }
    const revokeInvite=endpoint.match(/^\/api\/admin\/pruefung\/mitarbeitende\/([^/]+)\/einladung$/);
    if(revokeInvite&&method==='DELETE'){
      const index=state.invitations.findIndex(x=>x.id===revokeInvite[1]);
      if(index<0)return json(404,{error:'Offene Einladung nicht gefunden'});
      state.invitations.splice(index,1);return json(200,{success:true});
    }
    const staffAction=endpoint.match(/^\/api\/admin\/pruefung\/mitarbeitende\/([^/]+)\/(deaktivieren|reaktivieren|passwort-setzen)$/);
    if(staffAction&&method==='PATCH'){
      const user=state.inspectionStaff.find(x=>x.id===staffAction[1]);
      if(!user)return json(404,{error:'Mitarbeiter nicht vorhanden'});
      const action=staffAction[2];
      if(action==='deaktivieren'){
        if(!user.aktiv)return json(409,{error:'Bereits deaktiviert'});
        user.aktiv=false;return json(200,{id:user.id,aktiv:false});
      }
      const d=readBody();
      if(!d.passwort||d.passwort.length<12)return json(400,{error:'Passwort zu kurz'});
      if(action==='reaktivieren'){
        if(user.aktiv)return json(409,{error:'Bereits aktiv'});
        user.aktiv=true;return json(200,{id:user.id,aktiv:true,sitzungenWiderrufen:true});
      }
      if(!user.aktiv)return json(409,{error:'Mitarbeiter inaktiv'});
      return json(200,{id:user.id,aktiv:true,sitzungenWiderrufen:true});
    }
    if(endpoint==='/api/admin/pruefung/berichte'&&method==='GET')return json(200,[]);
    if(endpoint==='/api/admin/pruefung/meldungen'&&method==='GET')
      return json(200,state.inspectionMails);
    const retryMail=endpoint.match(/^\/api\/admin\/pruefung\/meldungen\/([^/]+)\/erneut-senden$/);
    if(retryMail&&method==='POST'){
      const data=readBody(),item=state.inspectionMails.find(x=>x.bericht_id===retryMail[1]);
      if(!item)return json(404,{error:'Nicht gefunden'});
      if(!data.doppelversandGeprueft)return json(400,{error:'Doppelversand nicht geprüft'});
      if(item.status==='angenommen'||item.status==='sendet')return json(409,{error:'Versand schon bestätigt oder ungeklärt'});
      item.status='angenommen';item.versuche++;item.angenommen_am='2027-01-01T14:00:00Z';
      return json(200,{gefunden:true,erneutVersendet:true,status:'gesendet'});
    }
    if(endpoint==='/api/admin/pruefung/hinweise'&&method==='GET')
      return json(200,state.inspectionHints);
    const finishHint=endpoint.match(/^\/api\/admin\/pruefung\/hinweise\/([^/]+)\/erledigen$/);
    if(finishHint&&method==='POST'){
      const hint=state.inspectionHints.find(x=>x.id===finishHint[1]),d=readBody();
      if(!hint||hint.erledigt_am)return json(409,{error:'Nicht mehr offen'});
      if(!d.geprueft||d.pruefer.length<3||d.ergebnis.length<20)
        return json(400,{error:'Prüfung nicht vollständig'});
      hint.erledigt_am='2027-01-01T16:00:00Z';hint.erledigt_von=d.pruefer;
      hint.erledigt_notiz=d.ergebnis;return json(200,{id:hint.id,erledigt_am:hint.erledigt_am});
    }
    if(endpoint==='/api/admin/pruefung/stationen'&&method==='GET')
      return json(200,state.inspectionStations);
    const statusChange=endpoint.match(/^\/api\/admin\/pruefung\/stationen\/([^/]+)\/(deaktivieren|reaktivieren)$/);
    if(statusChange&&method==='PATCH'){
      const station=state.inspectionStations.find(x=>x.id===statusChange[1]),d=readBody();
      if(!station||d.begruendung?.length<15)return json(400,{error:'Begründung fehlt'});
      const activate=statusChange[2]==='reaktivieren';
      if(station.aktiv===activate)return json(409,{error:'Status bereits gesetzt'});
      station.aktiv=activate;
      state.inspectionStatusEvents.push({
        station_id:station.id,art:activate?'reaktiviert':'deaktiviert',
        begruendung:d.begruendung,verantwortlich:'Testadmin',
        erstellt_am:'2027-01-01T12:00:00Z'
      });
      return json(200,{...station});
    }
    const statusHistory=endpoint.match(/^\/api\/admin\/pruefung\/stationen\/([^/]+)\/statusverlauf$/);
    if(statusHistory&&method==='GET')return json(200,state.inspectionStatusEvents);
    const inspectionRelease=endpoint.match(/^\/api\/admin\/pruefung\/stationen\/([^/]+)\/freigeben$/);
    if(inspectionRelease&&method==='POST'){
      const d=readBody(),station=state.inspectionStations.find(x=>x.id===inspectionRelease[1]);
      if(!station||!station.gesperrt_am)return json(409,{error:'Station nicht gesperrt'});
      if(!d.nachkontrolleBestaetigt||d.freigabeDurch?.length<3||d.begruendung?.length<20)
        return json(400,{error:'Nachkontrolle fehlt'});
      station.gesperrt_am=null;station.sperrgrund=null;
      state.inspectionEvents.push({art:'freigabe',notiz:d.begruendung,verantwortlich:d.freigabeDurch,
        erstellt_am:'2027-01-01T14:00:00Z'});
      return json(200,{id:station.id,name:station.name,gesperrt:false});
    }
    const historyRoute=endpoint.match(/^\/api\/admin\/pruefung\/stationen\/([^/]+)\/ereignisse$/);
    if(historyRoute&&method==='GET')return json(200,state.inspectionEvents);
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
    if((endpoint==='/api/aktionen'||endpoint==='/api/admin/aktionen')&&method==='GET')
      return json(200,state.specials);
    if(endpoint==='/api/admin/aktionen'&&method==='POST'){
      const item={...readBody(),id:'550e8400-e29b-41d4-a716-446655443333'};
      state.specials.push(item);return json(201,{id:item.id});
    }
    const specialChange=endpoint.match(/^\/api\/admin\/aktionen\/([^/]+)\/programm$/);
    if(specialChange&&method==='PATCH'){
      const special=state.specials.find(x=>x.id===specialChange[1]);
      if(!special)return json(404,{error:'Aktion nicht gefunden'});
      const next=String(readBody().programm_id||'');
      if(next&&!state.programs.some(p=>String(p.id)===next&&p.aktiv&&p.buchbar&&p.veroeffentlicht))
        return json(400,{error:'Programm nicht buchbar'});
      special.programm_id=next||null;
      return json(200,{id:special.id,programm_id:special.programm_id});
    }
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
  await page.locator('#login button').click();
  await page.locator('#workspace').waitFor({state:'visible',timeout:15000});
  await page.locator('#angebote-admin-liste').getByText('Klettertest').first().waitFor({state:'attached'});
}

async function openAdminView(page,href){
  await page.locator('.admin-navigation a[href="'+href+'"]').click();
  await page.locator(href).waitFor({state:'visible'});
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

  await t.test('Linke Navigation zeigt einzeln verlinkbare Verwaltungsbereiche',async()=>{
    const page=await browser.newPage({viewport:{width:1280,height:900},locale:'de-DE'});
    const state=fakeAdminApi(page);
    await login(page,root);
    const navigation=page.locator('.admin-navigation');
    const visibleViews=()=>page.locator('[data-admin-view]:visible').count();
    assert.equal(await visibleViews(),1,'Nach Anmeldung soll genau ein Bereich sichtbar sein');
    assert.equal(await page.locator('#admin-dashboard').isVisible(),true);
    assert.equal(await navigation.locator('[aria-current="page"]').getAttribute('href'),'#admin-dashboard');
    assert.equal(await page.locator('.admin-layout').evaluate(node=>getComputedStyle(node).display),'grid');
    assert.equal(await navigation.evaluate(node=>getComputedStyle(node).flexDirection),'column');

    const startHash=await page.evaluate(()=>location.hash);
    await navigation.locator('a[href="#payment-overview-section"]').click();
    await page.waitForFunction(()=>location.hash==='#payment-overview-section');
    assert.equal(await visibleViews(),1);
    assert.equal(await page.locator('#payment-overview-section').isVisible(),true);
    assert.equal(await page.locator('#bookings-section').isVisible(),false);
    assert.equal(await navigation.locator('[aria-current="page"]').getAttribute('href'),'#payment-overview-section');

    await page.goBack();
    await page.waitForFunction(expected=>location.hash===expected,startHash);
    assert.equal(await page.locator('#admin-dashboard').isVisible(),true,
      'Browser-Zurück soll die vorherige Ansicht wiederherstellen');

    await page.setViewportSize({width:390,height:844});
    assert.equal(await navigation.evaluate(node=>getComputedStyle(node).flexDirection),'row',
      'Auf schmalen Displays soll das Menü horizontal wischbar sein');
    assert.ok(state.signedIn);
    await page.close();
  });

  await t.test('Programm erstellen, editieren und aktivieren mit CSRF-Token',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const state=fakeAdminApi(page);
    const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});
    await login(page,root);
    await openAdminView(page,'#angebote-verwaltung');
    const form=page.locator('#neues-angebot-form');
    await form.locator('[name="name"]').fill('Bouldern Kinder');
    await form.locator('[name="beschreibung"]').fill('Browsertestangebot');
    await form.locator(':scope > label > input[name="dauer"]').fill('75');
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
    await openAdminView(page,'#bookings-section');
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
    await openAdminView(page,'#payment-overview-section');
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
    await openAdminView(page,'#gps-verwaltung');
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
    await openAdminView(page,'#gps-verwaltung');
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

  await t.test('Gesperrte Station: Smartphone-Warnung, dokumentierte Freigabe und Verlauf',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const state=fakeAdminApi(page);
    const dialogs=[];
    page.on('dialog',async d=>{
      dialogs.push(d.type());
      if(d.type()==='prompt'){
        const answer=dialogs.filter(x=>x==='prompt').length===1?
          'CI Fachprüferin':'Defekten Karabiner ersetzt, danach fachlich geprüft und kontrolliert.';
        await d.accept(answer);
      }else await d.accept();
    });
    await login(page,root);
    await openAdminView(page,'#stationspruefung');
    await page.locator('#pruef-station-list article').getByText('GESPERRT – NICHT BENUTZEN').waitFor();
    const release=page.locator('#pruef-station-list article')
      .getByRole('button',{name:'Nach fachlicher Prüfung freigeben'});
    await release.click();
    await page.waitForFunction(()=>document.querySelector('#pruef-station-list')?.textContent.includes('Nicht gesperrt'));
    assert.equal(state.inspectionStations[0].gesperrt_am,null);
    assert.equal(state.inspectionEvents.length,1);
    assert.ok(state.mutations.some(m=>m.endpoint.endsWith('/freigeben')&&
      m.body.nachkontrolleBestaetigt===true&&m.body.freigabeDurch==='CI Fachprüferin'));
    assert.deepEqual(dialogs,['prompt','prompt','confirm']);
    await page.locator('#pruef-station-list article')
      .getByRole('button',{name:'Prüf- und Freigabeverlauf anzeigen'}).click();
    await page.locator('#pruef-station-list').getByText(/fachlich geprüft und kontrolliert/).waitFor();
    assert.equal(await release.count(),0,'Freigabe darf nicht mehrfach angefordert werden');
    await page.close();
  });

  await t.test('Offenen kleinen Hinweis zur Nachprüfung verwalten ohne Stationssperre',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const state=fakeAdminApi(page);
    const hintId='550e8400-e29b-41d4-a716-446655440055';
    state.inspectionStations[0].gesperrt_am=null;
    state.inspectionStations[0].sperrgrund=null;
    state.inspectionHints=[{
      id:hintId,station_id:state.inspectionStations[0].id,
      bericht_id:'550e8400-e29b-41d4-a716-446655440066',
      beschreibung:'Stationsschild lässt sich schwer lesen, sollte geprüft werden',
      station:'Kletterwand Test',gesperrt_am:null,
      erstellt_von:'CI Mitarbeiterin',erstellt_am:'2027-01-01T14:00:00Z',
      erledigt_am:null,erledigt_von:null,erledigt_notiz:null
    }];
    const dialogs=[];
    page.on('dialog',async dialog=>{
      dialogs.push(dialog.type());
      if(dialog.type()==='prompt')
        await dialog.accept(dialogs.filter(x=>x==='prompt').length===1?
          'CI Prüfer':'Stationsschild kontrolliert und vollständig ausgetauscht.');
      else await dialog.accept();
    });
    await login(page,root);
    await openAdminView(page,'#stationspruefung');
    await page.locator('#pruef-hinweis-list').getByText(/Offener Hinweis: Kletterwand Test/).waitFor();
    assert.match(await page.locator('#pruef-hinweis-status').textContent(),/1 offene/);
    assert.equal(state.inspectionStations[0].gesperrt_am,null);
    await page.locator('#pruef-hinweis-list')
      .getByRole('button',{name:'Nach Prüfung als erledigt markieren'}).click();
    await page.waitForFunction(()=>document.getElementById('pruef-hinweis-list')?.textContent.includes('Geprüfter Hinweis'));
    assert.ok(state.inspectionHints[0].erledigt_am);
    assert.equal(state.inspectionStations[0].gesperrt_am,null);
    assert.deepEqual(dialogs,['prompt','prompt','confirm']);
    assert.equal(await page.locator('#pruef-hinweis-list')
      .getByRole('button',{name:'Nach Prüfung als erledigt markieren'}).count(),0);
    assert.ok(state.mutations.some(x=>x.endpoint.endsWith(hintId+'/erledigen')));
    await page.close();
  });

  await t.test('Mängelbenachrichtigung: gesicherte manuelle Wiederholung und kein Doppelsenden',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const state=fakeAdminApi(page);
    const id='550e8400-e29b-41d4-a716-446655440075';
    state.inspectionMails=[{
      bericht_id:id,programm:'Klettern CI',beginn:'2027-04-01T10:00',
      status:'fehlgeschlagen',versuche:1,letzter_versuch:'2027-01-01T12:00:00Z',
      angenommen_am:null,letzter_fehler:'Mail-Anbieter hat Versand nicht bestätigt.',
      stationen:['Kletterwand']
    }];
    const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.type());await dialog.accept();});
    await login(page,root);
    await openAdminView(page,'#stationspruefung');
    await page.locator('#pruef-mail-list').getByText('Versand fehlgeschlagen').waitFor();
    await page.locator('#pruef-mail-list')
      .getByRole('button',{name:'Mängelmeldung erneut senden'}).click();
    await page.waitForFunction(()=>document.querySelector('#pruef-mail-list')?.textContent.includes('Vom Anbieter angenommen'));
    assert.deepEqual(dialogs,['confirm']);
    assert.equal(state.inspectionMails[0].versuche,2);
    assert.equal(state.inspectionMails[0].status,'angenommen');
    assert.equal(await page.locator('#pruef-mail-list')
      .getByRole('button',{name:'Mängelmeldung erneut senden'}).count(),0);
    assert.equal(state.mutations.filter(x=>x.endpoint.endsWith('/erneut-senden')).length,1);
    assert.equal(state.mutations.find(x=>x.endpoint.endsWith('/erneut-senden')).body.doppelversandGeprueft,true);
    await page.close();
  });

  await t.test('Tabletverwaltung zeigt Online-Status und letzten Kontakt statt bloßer Kopplung',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const state=fakeAdminApi(page);
    const id='550e8400-e29b-41d4-a716-446655441234';
    state.inspectionTablets=[{
      id,name:'Fenster-Tablet',aktiv:true,online:false,
      gekoppelt_am:'2027-01-01T12:00:00Z',zuletzt_gesehen_am:'2027-01-01T12:05:00Z'
    }];
    await login(page,root);
    await openAdminView(page,'#stationspruefung');
    await page.locator('#tablet-admin-list').getByText(/Keine aktuelle Verbindung/).waitFor();
    assert.match(await page.locator('#tablet-admin-list').textContent(),/0?1\.0?1\.2027/);
    state.inspectionTablets[0].online=true;
    await page.locator('#tablet-admin-refresh').click();
    await page.locator('#tablet-admin-list').getByText(/Erreichbar – letztes Lebenszeichen/).waitFor();
    state.inspectionTablets[0].aktiv=false;
    state.inspectionTablets[0].online=false;
    await page.locator('#tablet-admin-refresh').click();
    await page.locator('#tablet-admin-list').getByText('Zugang gesperrt').waitFor();
    assert.equal(await page.locator('#tablet-admin-list').getByRole('button',{name:'Tablet-Zugang sperren'}).count(),0);
    await page.close();
  });

  await t.test('Verwaltung bestimmt genau ein Prüfdisplay; andere Tablets bleiben Werbeanzeigen',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const state=fakeAdminApi(page);
    const first='550e8400-e29b-41d4-a716-446655441010',second='550e8400-e29b-41d4-a716-446655441011';
    state.inspectionTablets=[
      {id:first,name:'Fenster-Display',aktiv:true,online:true,pruefdisplay:true,
        gekoppelt_am:'2027-01-01T12:00:00Z',zuletzt_gesehen_am:'2027-01-01T12:05:00Z'},
      {id:second,name:'Ersatz-Werbetablet',aktiv:true,online:true,pruefdisplay:false,
        gekoppelt_am:'2027-01-01T12:00:00Z',zuletzt_gesehen_am:'2027-01-01T12:05:00Z'}
    ];
    const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.type());await dialog.accept();});
    await login(page,root);
    await openAdminView(page,'#stationspruefung');
    const standby=page.locator('#tablet-admin-list article').filter({hasText:'Ersatz-Werbetablet'});
    await standby.getByText('Nur Werbeanzeige – keine Prüfcodes').waitFor();
    await standby.getByRole('button',{name:'Als Prüfdisplay auswählen'}).click();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('#tablet-admin-list article'))
      .some(a=>a.textContent.includes('Ersatz-Werbetablet')&&a.textContent.includes('Ausgewähltes Prüfdisplay')));
    assert.deepEqual(dialogs,['confirm']);
    assert.equal(state.inspectionTablets.filter(x=>x.pruefdisplay).length,1);
    assert.equal(state.inspectionTablets.find(x=>x.id===second).pruefdisplay,true);
    assert.equal(state.inspectionTablets.find(x=>x.id===first).pruefdisplay,false);
    assert.equal(state.mutations.filter(m=>m.endpoint.endsWith('/pruefdisplay')).length,1);
    await page.close();
  });

  await t.test('Administrativer Tabletwechsel sperrt das Altgerät und zeigt einen neuen Kopplungscode',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const state=fakeAdminApi(page);
    const id='550e8400-e29b-41d4-a716-446655441033';
    state.inspectionTablets=[{id,name:'Prüfdisplay am Fenster',aktiv:true,online:true,
      pruefdisplay:true,gekoppelt_am:'2027-01-01T12:00:00Z',
      zuletzt_gesehen_am:'2027-01-01T12:05:00Z'}];
    const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.type());await dialog.accept();});
    await login(page,root);
    await openAdminView(page,'#stationspruefung');
    await page.locator('#tablet-admin-list')
      .getByRole('button',{name:'Tablet ersetzen / neu koppeln'}).click();
    await page.locator('#tablet-pair-code').getByText(/00654321/).waitFor();
    await page.locator('#tablet-admin-list').getByText('Zugang gesperrt').waitFor();
    assert.equal(state.inspectionTablets[0].aktiv,false);
    assert.equal(state.inspectionTablets[0].pruefdisplay,false);
    assert.deepEqual(dialogs,['confirm']);
    assert.equal(state.mutations.filter(x=>x.endpoint.endsWith('/ersetzen')).length,1);
    assert.equal(state.mutations.find(x=>x.endpoint.endsWith('/ersetzen')).body.wechselBestaetigt,true);
    await page.close();
  });

  await t.test('Mitarbeiterverwaltung: Deaktivieren, Passwort vergeben und Reaktivieren',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const state=fakeAdminApi(page);
    const id='550e8400-e29b-41d4-a716-446655440140';
    state.inspectionStaff=[{id,name:'CI Fachkraft',email:'ci@example.test',aktiv:true}];
    page.on('dialog',async d=>d.accept());
    await login(page,root);
    await openAdminView(page,'#mitarbeiter-section');
    const card=page.locator('#pruef-personal-list article').first();
    await card.getByText('Zugang aktiv').waitFor();
    await card.getByRole('button',{name:'Zugang pausieren'}).click();
    await page.locator('#pruef-personal-list').getByText('Zugang deaktiviert').waitFor();
    await page.locator('#pruef-personal-list input[type="password"]').fill('Neues-Protokoll-Passwort-2026!');
    await page.locator('#pruef-personal-list')
      .getByRole('button',{name:'Zugang reaktivieren'}).click();
    await page.locator('#pruef-personal-list').getByText('Zugang aktiv').waitFor();
    assert.equal(state.inspectionStaff[0].aktiv,true);
    assert.ok(state.mutations.some(m=>m.endpoint.endsWith('/reaktivieren')&&
      m.body.passwort==='Neues-Protokoll-Passwort-2026!'));
    await page.locator('#pruef-personal-list input[type="password"]').fill('Weiteres-Start-Passwort-2026!');
    await page.locator('#pruef-personal-list')
      .getByRole('button',{name:'Passwort zurücksetzen'}).click();
    await page.waitForFunction(()=>document.querySelector('#pruef-personal-list input[type=password]')?.value==='');
    assert.ok(state.mutations.some(m=>m.endpoint.endsWith('/passwort-setzen')));
    await page.close();
  });

  await t.test('Stationsverwaltung: Deaktivierung und Reaktivierung erhält die Mangelsperre',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const state=fakeAdminApi(page);
    const dialogs=[];
    page.on('dialog',async d=>{
      dialogs.push(d.type());
      if(d.type()==='prompt')
        await d.accept('Stilllegung für Reparatur und fachliche Kontrolle erforderlich.');
      else await d.accept();
    });
    await login(page,root);
    await openAdminView(page,'#stationspruefung');
    const card=page.locator('#pruef-station-list article').first();
    await card.getByText('GESPERRT – NICHT BENUTZEN').waitFor();
    await card.getByRole('button',{name:'Station deaktivieren'}).click();
    await card.getByText('STATION DEAKTIVIERT – NICHT BENUTZEN').waitFor();
    assert.equal(state.inspectionStations[0].aktiv,false);
    assert.ok(state.inspectionStations[0].gesperrt_am);
    assert.equal(await card.getByRole('button',{name:'Nach fachlicher Prüfung freigeben'}).isDisabled(),true);
    await card.getByRole('button',{name:'Station reaktivieren'}).click();
    await card.getByText('GESPERRT – NICHT BENUTZEN').waitFor();
    assert.equal(state.inspectionStations[0].aktiv,true);
    assert.ok(state.inspectionStations[0].gesperrt_am);
    await card.getByRole('button',{name:'Stilllegungs- und Reaktivierungsverlauf'}).click();
    await card.getByText(/Stilllegung für Reparatur/).first().waitFor();
    assert.equal(state.inspectionStatusEvents.length,2);
    assert.deepEqual(dialogs,['prompt','confirm','prompt','confirm']);
    await page.close();
  });

  await t.test('Sicherheitsübersicht priorisiert Mangelsperren, offene Hinweise und Meldungen',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const state=fakeAdminApi(page);
    state.inspectionOverview={
      zaehler:{gesperrt:1,stillgelegt:1,nicht_nutzbar:2,
        hinweise_offen:1,meldungen_ungeklaert:1},
      stationen:[
        {id:'550e8400-e29b-41d4-a716-446655440010',name:'Kletterwand West',
          aktiv:true,gesperrt_am:'2027-01-01T12:00:00Z',
          sperrgrund:'Defekte Sicherung am Tragseil',offene_hinweise:1},
        {id:'550e8400-e29b-41d4-a716-446655440011',name:'Wartungsleiter',
          aktiv:false,gesperrt_am:null,sperrgrund:null,offene_hinweise:0}
      ],
      hinweise:[{id:'550e8400-e29b-41d4-a716-446655440099',
        station:'Kletterwand West',aktiv:true,gesperrt_am:'2027-01-01T12:00:00Z',
        beschreibung:'Abgenutzte Beschriftung zur Nachprüfung'}],
      meldungen:[{bericht_id:'550e8400-e29b-41d4-a716-446655440088',
        programm:'Kletterkurs Vormittag',status:'fehlgeschlagen',versuche:1}],
      stand:'2027-01-01T16:00:00Z'
    };
    await login(page,root);
    await openAdminView(page,'#stationspruefung');
    const summary=page.locator('#pruef-uebersicht');
    await summary.getByText('Sicherheitsgesperrte Stationen: 1').waitFor();
    assert.match(await summary.textContent(),/Stillgelegte Stationen: 1/);
    assert.match(await summary.textContent(),/Offene kleine Hinweise: 1/);
    assert.match(await summary.textContent(),/Nicht bestätigte Mängel-E-Mails: 1/);
    const text=await summary.locator('#pruef-uebersicht-inhalt').textContent();
    assert.ok(text.indexOf('NICHT BENUTZEN – SICHERHEITSMANGEL')<
      text.indexOf('NICHT BENUTZEN – STATION STILLGELEGT'));
    assert.match(text,/Abgenutzte Beschriftung zur Nachprüfung/);
    assert.match(text,/Defekte Sicherung am Tragseil/);
    assert.match(text,/Mailstatus: fehlgeschlagen/);
    assert.match(text,/keine automatische Stationssperre|bereits sicherheitsgesperrt/i);
    await summary.getByRole('button',{name:'Sicherheitsübersicht aktualisieren'}).click();
    await summary.getByText('Sicherheitsgesperrte Stationen: 1').waitFor();
    await summary.getByRole('button',{name:'Hinweis und Nachprüfung öffnen'}).click();
    assert.equal(await page.locator('#pruef-hinweis-list').getAttribute('tabindex'),'-1');
    assert.equal(state.mutations.filter(m=>m.endpoint.includes('/pruefung/')).length,0,
      'The dashboard must be read-only.');
    await page.close();
  });

  await t.test('Sonderaktionen lassen sich ausdrücklich mit einem veröffentlichten Programm verknüpfen',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
    const state=fakeAdminApi(page);
    state.programs[0].aktiv=true;
    state.programs[0].veroeffentlicht=true;
    await login(page,root);
    await openAdminView(page,'#special-offers-view');
    const selected=page.locator('#special-program-select');
    await selected.locator('option[value="11"]').waitFor({state:'attached'});
    await selected.selectOption('11');
    await page.locator('#special-form [name="titel"]').fill('Sonder-Kletteraktion');
    await page.locator('#special-form [name="datum"]').fill('2027-03-15');
    await page.locator('#special-form button[type="submit"], #special-form button:not([type])').click();
    await page.locator('#special-list').getByText('Sonder-Kletteraktion').waitFor();
    assert.equal(state.specials.length,1);
    assert.equal(state.specials[0].programm_id,'11',
      'Programme are linked by stable identifier, not by similar titles');
    assert.match(await page.locator('#special-list').textContent(),
      /Explizit verknüpft mit Programm-ID: 11/);
    assert.equal(state.mutations.filter(x=>x.endpoint==='/api/admin/aktionen').length,1);
    const specialCard=page.locator('#special-list .booking').first();
    await specialCard.getByRole('button',{name:'Programmzuordnung speichern'}).waitFor();
    await specialCard.locator('select').selectOption('');
    await specialCard.getByRole('button',{name:'Programmzuordnung speichern'}).click();
    await page.waitForFunction(()=>document.querySelector('#special-list')?.textContent?.includes('Unabhängige Aktion'));
    assert.equal(state.specials[0].programm_id,null);
    await page.locator('#special-list .booking select').selectOption('11');
    await page.locator('#special-list .booking').first()
      .getByRole('button',{name:'Programmzuordnung speichern'}).click();
    await page.waitForFunction(()=>document.querySelector('#special-list')?.textContent?.includes('Explizit verknüpft mit Programm-ID: 11'));
    assert.equal(state.specials[0].programm_id,'11');
    await page.close();
  });

  await t.test('Buchung suchen, Status speichern und Veranstaltungsort ergänzen',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const state=fakeAdminApi(page);
    await login(page,root);
    await openAdminView(page,'#bookings-section');
    const search=page.locator('#bookings-search');
    const originalCard=await page.locator('#bookings .booking').first().elementHandle();
    await search.fill('Beispiel');
    // Die Suchfilter aktualisieren die Liste entprellt nach 250 ms.
    // Erst nach dem DOM-Austausch darf die neue Buchungskarte editiert werden.
    await page.waitForFunction(oldCard=>document.querySelector('#bookings .booking')!==oldCard,originalCard);
    await page.waitForFunction(()=>document.getElementById('booking-results-summary')?.textContent.includes('1 Buchung(en)'));
    const booking=page.locator('#bookings .booking').first();
    await booking.locator('select:not([name="methode"])').selectOption('bestaetigt');
    await booking.locator('textarea[placeholder="Zum Beispiel: Rückruf vereinbart"]').fill('Test: Rückruf erfolgreich');
    await booking.getByRole('button',{name:'Änderungen speichern'}).click();
    for(let attempt=0;attempt<40 && state.bookings[0].status!=='bestaetigt';attempt++)
      await new Promise(resolve=>setTimeout(resolve,75));
    assert.equal(state.bookings[0].status,'bestaetigt',
      'Server-Mock hat die Statusänderung nicht erhalten: '+JSON.stringify({
        mutations:state.mutations,karte:await booking.textContent(),meldung:await page.locator('#status').textContent()
      }));
    await page.waitForFunction(()=>document.querySelector('#bookings .booking')?.textContent.includes('Bearbeitungsstatus: Bestätigt'),null,{timeout:5000});
    assert.equal(state.bookings[0].bearbeitungsnotiz,'Test: Rückruf erfolgreich');

    await openAdminView(page,'#standorte-section');
    const placeForm=page.locator('#admin-place-form');
    await placeForm.locator('[name="name"]').fill('Rüthen');
    await placeForm.locator('button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('admin-place-status')?.textContent.includes('Rüthen'));
    assert.equal(state.places.some(ort=>ort.name==='Rüthen'),true);
    assert.equal(await page.locator('#angebot-ort').inputValue(),'Rüthen');
    assert.ok(state.mutations.every(item=>['POST','PATCH','DELETE'].includes(item.method)));
    await page.close();
  });

  await t.test('Mitarbeitereinladung neu ausstellen oder widerrufen',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const state=fakeAdminApi(page);
    page.on('dialog',dialog=>dialog.accept());
    await login(page,root);
    await openAdminView(page,'#mitarbeiter-einladen-section');
    const form=page.locator('#pruef-personal-form');
    await form.locator('[name="name"]').fill('Neue Fachkraft');
    await form.locator('[name="email"]').fill('fachkraft@example.test');
    await form.locator('button[type="submit"]').click();
    await page.locator('#pruef-einladung-status a.invite-link').waitFor();
    assert.match(await page.locator('#pruef-einladung-status').textContent(),/E-Mail konnte nicht versandt werden/);
    await openAdminView(page,'#mitarbeiter-section');
    const card=page.locator('#pruef-personal-list .booking').filter({hasText:'fachkraft@example.test'});
    await card.getByRole('button',{name:'Neue Einladung senden'}).click();
    await page.waitForFunction(()=>document.querySelectorAll('#pruef-personal-list .booking').length===1);
    assert.equal(state.invitations.length,1);
    assert.equal(state.nextInvite,2,'Neue Einladung ersetzt den vorherigen Link');
    await page.locator('#pruef-personal-list .booking').getByRole('button',{name:'Einladung widerrufen'}).click();
    await page.waitForFunction(()=>document.querySelectorAll('#pruef-personal-list .booking').length===0);
    assert.equal(state.invitations.length,0,'Widerruf entfernt die offene Einladung aus der Verwaltung');
    assert.ok(state.mutations.some(item=>item.method==='DELETE'&&item.endpoint.endsWith('/einladung')));
    await page.close();
  });

  await t.test('Mitarbeiterfreigabe speichert mehrere Standorte und geprüfte Qualifikationen',async()=>{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const state=fakeAdminApi(page);page.on('dialog',dialog=>dialog.accept());
    state.places.push({id:2,name:'Rüthen',aktiv:true});
    state.inspectionStaff.push({id:'pending-staff',name:'Geprüfte Fachkraft',email:'geprueft@example.test',
      aktiv:false,status:'freigabe_ausstehend',art:'konto',telefon:'+49 170 111111',
      strasse:'Musterstraße 4',plz:'59929',wohnort:'Brilon',
      qualifikationen:'Kletterqualifikation\nErste Hilfe',bescheinigungen:[],freigaben:[]});
    await login(page,root);
    await openAdminView(page,'#mitarbeiter-section');
    const grant=page.locator('#pruef-personal-list .booking').filter({hasText:'geprueft@example.test'});
    await grant.locator('.staff-grant-place').nth(0).check();
    await grant.locator('.staff-grant-place').nth(1).check();
    await grant.locator('.staff-grant-qualification').nth(0).check();
    await grant.getByRole('button',{name:'Auswahl freigeben und Zugang aktivieren'}).click();
    await page.waitForFunction(()=>document.getElementById('pruef-personal-status')?.textContent.includes('Freigaben erstellt'));
    const saved=state.mutations.find(item=>item.endpoint.endsWith('/freigeben'));
    assert.deepEqual(saved.body.standorte,[1,2]);
    assert.deepEqual(saved.body.qualifikationen,['Kletterqualifikation']);
    assert.equal(state.inspectionStaff[0].freigaben.length,2);
    await page.close();
  });
});
