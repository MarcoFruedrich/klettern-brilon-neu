'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { erzeugeZugang } = require('../lib/anschlussangebote');

test('HTTP: Buchungsanfrage prüft Konflikte und vergibt kollisionssichere Referenzen', async t => {
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const repo=path.resolve(__dirname,'..');
  const offers=[
    {id:1,name:'Klettern',preise:{'1-4':100,'5-10':150},kapazitaet:20,aktiv:true,
      verfuegbare_termine:['2027-03-15'],buchbar:true,veroeffentlicht:true,dauer:60},
    {id:2,name:'Bouldern',preise:{'1-4':150,'5-10':200},kapazitaet:20,aktiv:true,
      verfuegbare_termine:['2027-03-15'],buchbar:true,veroeffentlicht:true,dauer:60}
  ];
  const offerSecret='test-only-booking-offer-secret-32-chars';
  const tourId='123e4567-e89b-12d3-a456-426614174000';
  const guestId='123e4567-e89b-12d3-a456-426614174001';
  const child=spawn(process.execPath,['server.js'],{cwd:repo,stdio:['ignore','ignore','pipe'],env:{
    ...process.env,PORT:String(port),NODE_PATH:path.join(__dirname,'..','test-support','mocks'),
    DATABASE_URL:'mock-test-database',MOCK_PG:'1',MOCK_OFFERS:JSON.stringify(offers),
    MOCK_PLACES:JSON.stringify([{id:1,name:'Brilon',aktiv:true}]),
    MOCK_GUESTBOOK:JSON.stringify([
      {id:guestId,name:'Freigegebener Teamname',datum:'2027-03-15',dauer_sekunden:912,tour:'Brilon-Rätseltour',tour_id:tourId,einwilligung:true},
      {name:'Nicht öffentlich',datum:'2027-03-15',dauer_sekunden:500,tour:'Brilon-Rätseltour',tour_id:tourId,einwilligung:false}
    ]),
    RUN_SCHEMA_MIGRATIONS:'false',BREVO_API_KEY:'',BREVO_SENDER_EMAIL:'',BOOKING_NOTIFY_EMAIL:'',
    SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',BOOKING_OFFER_SECRET:offerSecret,
    ADMIN_USER:'test-admin',ADMIN_PASSWORD:'test-only-password'
  }});
  let serverErrors='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{serverErrors+=chunk;});
  t.after(()=>child.kill());
  const root=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<50;i++){
    try{await fetch(root+'/index.html');ready=true;break;}
    catch{await new Promise(resolve=>setTimeout(resolve,50));}
  }
  assert.equal(ready,true,'Server sollte mit dem PostgreSQL-Test-Double starten');
  const guestbookPrivate=await fetch(root+'/api/admin/gps/gaesteliste');
  assert.equal(guestbookPrivate.status,401,'Gästelisten-Verwaltung muss geschützt sein');
  const guestDeletePrivate=await fetch(root+`/api/admin/gps/gaesteliste/${guestId}`,{method:'DELETE'});
  assert.equal(guestDeletePrivate.status,401,'Gästelisteneinträge müssen vor unberechtigter Löschung geschützt sein');
  const anfrage=(uhrzeit)=>fetch(root+'/api/buchungen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    vorname:'Max',nachname:'Mueller',email:'max@example.test',datum:'2027-03-15',uhrzeit,
    teilnehmer:4,angebot:'Klettern',datenschutz:'on'
  })});
  const first=await anfrage('10:00');
  assert.equal(first.status,201);
  const firstData=await first.json();
  assert.equal(firstData.buchungsnummer,'MUELLER-MAX-150327');
  const conflict=await anfrage('10:00');
  assert.equal(conflict.status,409);
  const adjacent=await anfrage('11:00');
  assert.equal(adjacent.status,201);
  const adjacentData=await adjacent.json();
  assert.equal(adjacentData.buchungsnummer,'MUELLER-MAX-150327-02');

  const login=await fetch(root+'/api/admin/login',{method:'POST',headers:{Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({username:'test-admin',password:'test-only-password'})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';',1)[0];
  const adminHeaders={Cookie:cookie,Origin:root,'Content-Type':'application/json'};
  const addPlace=await fetch(root+'/api/admin/orte',{method:'POST',headers:adminHeaders,body:JSON.stringify({name:'Sundern'})});
  assert.equal(addPlace.status,201);
  const activePlaces=await fetch(root+'/api/admin/orte',{headers:{Cookie:cookie}});
  assert.deepEqual((await activePlaces.json()).map(place=>place.name).sort(),['Brilon','Sundern']);
  const invalidPlace=await fetch(root+'/api/admin/orte',{method:'POST',headers:adminHeaders,body:JSON.stringify({name:'   '})});
  assert.equal(invalidPlace.status,400);
  const matchingBookings=await fetch(root+'/api/admin/buchungen?suche=max&status=offen',{headers:{Cookie:cookie}});
  assert.equal(matchingBookings.status,200);
  assert.equal((await matchingBookings.json()).length,2,'Suche und Statusfilter werden serverseitig kombiniert');
  const invalidStatus=await fetch(root+'/api/admin/buchungen?status=unbekannt',{headers:{Cookie:cookie}});
  assert.equal(invalidStatus.status,400);
  const guestbook=await fetch(root+'/api/admin/gps/gaesteliste?tour='+tourId,{headers:{Cookie:cookie}});
  assert.equal(guestbook.status,200);
  const guestEntries=await guestbook.json();
  assert.equal(guestEntries.length,1);
  assert.equal(guestEntries[0].id,guestId);
  assert.equal(guestEntries[0].name,'Freigegebener Teamname');
  assert.equal(guestEntries[0].tour,'Brilon-Rätseltour');
  const guestDelete=await fetch(root+`/api/admin/gps/gaesteliste/${guestId}`,{method:'DELETE',headers:adminHeaders});
  assert.equal(guestDelete.status,200);
  const guestbookAfterDelete=await fetch(root+'/api/admin/gps/gaesteliste?tour='+tourId,{headers:{Cookie:cookie}});
  assert.deepEqual(await guestbookAfterDelete.json(),[]);
  const publicGuestbookAfterDelete=await fetch(root+'/api/gps/gaesteliste?tour='+tourId);
  assert.deepEqual(await publicGuestbookAfterDelete.json(),[],'Entfernter Name darf nicht mehr öffentlich erscheinen');
  const payment=await fetch(root+`/api/admin/buchungen/${adjacentData.id}/zahlungen`,{method:'POST',headers:adminHeaders,
    body:JSON.stringify({betrag:'25.00',methode:'ueberweisung',notiz:'Lokaler Testeingang'})});
  assert.equal(payment.status,201);
  const paid=await payment.json();
  assert.equal(paid.buchung.status,'bestaetigt');
  assert.equal(paid.stand.anzahlungErreicht,true);

  const token=erzeugeZugang(adjacentData.id,offerSecret);
  const preview=await fetch(root+'/api/anschlussangebote/vorschau',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({zugang:token})});
  assert.equal(preview.status,200);
  const suggestions=await preview.json();
  const bouldern=suggestions.programme.find(item=>item.name==='Bouldern');
  assert.ok(bouldern);
  assert.deepEqual(bouldern.zeiten.map(item=>item.uhrzeit),['12:00']);

  const addon=await fetch(root+'/api/anschlussangebote/buchen',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({zugang:token,programmId:'2',uhrzeit:'12:00'})});
  const addonData=await addon.json();
  assert.equal(addon.status,201,JSON.stringify({response:addonData,serverErrors}));
  assert.equal(addonData.gesamtpreis,135);
  const bookingsBefore=await fetch(root+'/api/admin/buchungen',{headers:{Cookie:cookie}});
  assert.equal(bookingsBefore.status,200);
  const before=await bookingsBefore.json();
  const addonBooking=before.find(item=>item.data.buchungsnummer===addonData.buchungsnummer);
  assert.ok(addonBooking);

  const addonPayment=await fetch(root+`/api/admin/buchungen/${addonBooking.id}/zahlungen`,{method:'POST',headers:adminHeaders,
    body:JSON.stringify({betrag:'33.75',methode:'ueberweisung',notiz:'Lokaler Testeingang'})});
  assert.equal(addonPayment.status,201);
  const addonPaid=await addonPayment.json();
  assert.equal(addonPaid.buchung.status,'bestaetigt');
  assert.equal(addonPaid.elternRabatt.angewendet,true);

  const bookingsAfter=await fetch(root+'/api/admin/buchungen',{headers:{Cookie:cookie}});
  const after=await bookingsAfter.json();
  const discountedParent=after.find(item=>item.id===adjacentData.id);
  assert.equal(discountedParent.data.gesamtpreis,90);
  assert.equal(discountedParent.data.restbetrag,65);
  assert.ok(discountedParent.data.preisanpassungen.length>=1);

  const cancel=await fetch(root+`/api/admin/buchungen/${addonBooking.id}`,{method:'PATCH',headers:adminHeaders,
    body:JSON.stringify({status:'storniert',bearbeitungsnotiz:'Lokaler Test'})});
  const cancelResult=await cancel.json();
  assert.equal(cancel.status,200,JSON.stringify({cancelResult,serverErrors}));
  const bookingsCancelled=await fetch(root+'/api/admin/buchungen',{headers:{Cookie:cookie}});
  const cancelled=await bookingsCancelled.json();
  const restoredParent=cancelled.find(item=>item.id===adjacentData.id);
  assert.equal(restoredParent.data.gesamtpreis,100);
  assert.equal(restoredParent.data.restbetrag,75);
  assert.ok(restoredParent.data.preisanpassungen.length>=2);
});
