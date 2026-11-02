'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { erzeugeZugang } = require('../lib/anschlussangebote');
const {totpCode}=require('../lib/totp');

const totpSecret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('HTTP: Buchungsanfrage prüft Konflikte und vergibt kollisionssichere Referenzen', async t => {
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const repo=path.resolve(__dirname,'..');
  const offers=[
    {id:1,name:'Klettern',preise:{'1-4':100,'5-10':150},kapazitaet:20,aktiv:true,
      verfuegbare_termine:['2027-03-15','2027-03-16','2027-03-17'],buchbar:true,veroeffentlicht:true,dauer:60},
    {id:2,name:'Bouldern',preise:{'1-4':150,'5-10':200},kapazitaet:20,aktiv:true,
      verfuegbare_termine:['2027-03-15','2027-03-16','2027-03-17'],buchbar:true,veroeffentlicht:true,dauer:60}
  ];
  const archivedBookings=Array.from({length:55},(_,i)=>({
    id:`archive-${i+1}`,status:'offen',buchungsnummer:`ARCHIV-${String(i+1).padStart(3,'0')}`,
    data:{name:`Archiv Gruppe ${i+1}`,email:`archiv${i+1}@example.test`,angebot:'Archivprogramm',datum:'2026-01-01',
      gesamtpreis:100,zahlungen:[{betragCent:1000,erhaltenAm:'2026-01-02T00:00:00Z',methode:'ueberweisung'}]},
    created_at:new Date(i*1000).toISOString()
  }));
  archivedBookings[0].data.email='MAX@EXAMPLE.TEST';
  archivedBookings[1].id='123e4567-e89b-12d3-a456-426614174099';
  archivedBookings[1].data.email=null;
  const offerSecret='test-only-booking-offer-secret-32-chars';
  const tourId='123e4567-e89b-12d3-a456-426614174000';
  const guestId='123e4567-e89b-12d3-a456-426614174001';
  const guestToken='gps-guest-token-for-consent-test-00000001';
  const guestTokenHash=crypto.createHash('sha256').update(guestToken).digest('hex');
  const mailMessages=[];
  const preload=path.join(repo,'test-support','mocks','brevo-fetch.js');
  const child=spawn(process.execPath,['server.js'],{cwd:repo,stdio:['ignore','ignore','pipe','ipc'],env:{
    ...process.env,PORT:String(port),NODE_PATH:path.join(__dirname,'..','test-support','mocks'),
    NODE_OPTIONS:[process.env.NODE_OPTIONS,`--require=${preload}`].filter(Boolean).join(' '),
    DATABASE_URL:'mock-test-database',MOCK_PG:'1',MOCK_OFFERS:JSON.stringify(offers),
    MOCK_BOOKINGS:JSON.stringify(archivedBookings),
    MOCK_CALENDAR:JSON.stringify([{id:'123e4567-e89b-12d3-a456-426614174002',titel:'Test-Sperrzeit',
      datum:'2027-03-16',enddatum:'2027-03-17',typ:'sperrzeit'}]),
    MOCK_GPS_GAMES:JSON.stringify([
      {buchung_id:'*',tour:'Brilon-Rätseltour',gestartet_am:'2027-03-15T10:00:00.000Z',
        abgeschlossen_am:'2027-03-15T11:00:00.000Z',spielzeit_sekunden:3600,station_index:15,
        gast_name:'Nicht freigegebener Name',gast_einwilligung:false,einwilligung_am:null,einwilligung_version:null},
      {buchung_id:'first',tour:'Brilon-Rätseltour',gestartet_am:'2027-03-15T09:00:00.000Z',
        abgeschlossen_am:'2027-03-15T09:30:00.000Z',spielzeit_sekunden:1800,station_index:8,
        gast_name:null,gast_einwilligung:false,einwilligung_am:null,einwilligung_version:null}
    ]),
    MOCK_PLACES:JSON.stringify([{id:1,name:'Brilon',aktiv:true}]),
    MOCK_GUESTBOOK:JSON.stringify([
      {id:guestId,name:null,datum:'2027-03-15',dauer_sekunden:912,tour:'Brilon-Rätseltour',tour_id:tourId,
        token_hash:guestTokenHash,abgeschlossen:true,einwilligung:false,einwilligung_am:null},
      {name:'Nicht öffentlich',datum:'2027-03-15',dauer_sekunden:500,tour:'Brilon-Rätseltour',tour_id:tourId,einwilligung:false}
    ]),
    RUN_SCHEMA_MIGRATIONS:'false',MOCK_BREVO_EMAILS:'1',BREVO_API_KEY:'test-only-mail-key',
    BREVO_SENDER_EMAIL:'sender@example.test',BOOKING_NOTIFY_EMAIL:'operator@example.test',
    SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',BOOKING_OFFER_SECRET:offerSecret,
    ADMIN_USER:'test-admin',ADMIN_PASSWORD:'test-only-password',ADMIN_TOTP_SECRET_BASE32:totpSecret
  }});
  child.on('message',message=>{
    if(message?.type==='mock-brevo-email')mailMessages.push(message.message);
  });
  let serverErrors='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{serverErrors+=chunk;});
  t.after(()=>child.kill());
  const waitForEmails=async(expected)=>{
    const deadline=Date.now()+1500;
    while(mailMessages.length<expected&&Date.now()<deadline)
      await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(mailMessages.length>=expected,`Erwartet mindestens ${expected} Test-E-Mails, erhalten ${mailMessages.length}`);
  };
  const root=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<50;i++){
    try{await fetch(root+'/index.html');ready=true;break;}
    catch{await new Promise(resolve=>setTimeout(resolve,50));}
  }
  assert.equal(ready,true,'Server sollte mit dem PostgreSQL-Test-Double starten');
  const qrLibrary=await fetch(root+'/vendor/qrcode-generator.js');
  assert.equal(qrLibrary.status,200,'Lokale QR-Bibliothek muss über die Website erreichbar sein');
  const qrBuilder=await fetch(root+'/qr-etiketten.js');
  assert.equal(qrBuilder.status,200,'Lokaler QR-Etikettengenerator muss über die Website erreichbar sein');
  const gpsPage=await fetch(root+'/gps.html');
  assert.match(await gpsPage.text(),/data-consent-version="2026-11-02-v1"/);
  const missingGuestName=await fetch(root+'/api/gps/abschluss',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:guestToken,einwilligung:true,name:''})});
  assert.equal(missingGuestName.status,400,'Ein öffentlicher Eintrag erfordert einen freiwilligen Namen');
  const oldConsent=await fetch(root+'/api/gps/abschluss',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:guestToken,einwilligung:true,name:'Freigegebener Teamname',einwilligungVersion:'2026-10-01-v1'})});
  assert.equal(oldConsent.status,409,'Veraltete Einwilligungstexte dürfen keinen öffentlichen Eintrag freigeben');
  const consent=await fetch(root+'/api/gps/abschluss',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:guestToken,einwilligung:true,name:'Freigegebener Teamname',einwilligungVersion:'2026-11-02-v1'})});
  assert.equal(consent.status,200);
  assert.equal((await consent.json()).oeffentlich,true);
  const publicGuestbook=await fetch(root+'/api/gps/gaesteliste?tour='+tourId);
  const publicEntry=(await publicGuestbook.json())[0];
  assert.equal(publicEntry.name,'Freigegebener Teamname');
  assert.equal('einwilligung_version' in publicEntry,false,'Einwilligungsversion bleibt in der geschützten Verwaltung');
  const guestbookPrivate=await fetch(root+'/api/admin/gps/gaesteliste');
  assert.equal(guestbookPrivate.status,401,'Gästelisten-Verwaltung muss geschützt sein');
  const guestDeletePrivate=await fetch(root+`/api/admin/gps/gaesteliste/${guestId}`,{method:'DELETE'});
  assert.equal(guestDeletePrivate.status,401,'Gästelisteneinträge müssen vor unberechtigter Löschung geschützt sein');
  const paymentPrivate=await fetch(root+'/api/admin/zahlungsuebersicht');
  assert.equal(paymentPrivate.status,401,'Zahlungsdetails müssen vor unberechtigtem Zugriff geschützt sein');
  const exportPrivate=await fetch(root+`/api/admin/buchungen/${guestId}/export`);
  assert.equal(exportPrivate.status,401,'Kundendatenexport muss geschützt sein');
  const anfrage=(uhrzeit,datum='2027-03-15')=>fetch(root+'/api/buchungen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    vorname:'Max',nachname:'Mueller',email:'max@example.test',datum,uhrzeit,
    teilnehmer:4,angebot:'Klettern',datenschutz:'on'
  })});
  const blockedDates=await fetch(root+'/api/sperrzeiten');
  assert.equal(blockedDates.status,200);
  assert.deepEqual(await blockedDates.json(),[{datum:'2027-03-16',enddatum:'2027-03-17'}]);
  const blockedStart=await anfrage('10:00','2027-03-16');
  assert.equal(blockedStart.status,409,'Der erste Tag eines mehrtägigen Sperrzeitraums darf nicht gebucht werden');
  assert.match((await blockedStart.json()).error,/gesperrt/);
  const blockedEnd=await anfrage('10:00','2027-03-17');
  assert.equal(blockedEnd.status,409,'Auch der letzte Tag des Sperrzeitraums muss gesperrt bleiben');
  const first=await anfrage('10:00');
  assert.equal(first.status,201);
  const firstData=await first.json();
  assert.equal(firstData.buchungsnummer,'MUELLER-MAX-150327');
  await waitForEmails(2);
  const customerRequest=mailMessages.find(message=>message.to?.[0]?.email==='max@example.test');
  const operatorRequest=mailMessages.find(message=>message.to?.[0]?.email==='operator@example.test');
  assert.ok(customerRequest,'Kundenpostfach muss eine Buchungseingangsbestätigung erhalten');
  assert.ok(operatorRequest,'Betreiberpostfach muss eine neue Buchungsanfrage erhalten');
  for(const message of [customerRequest,operatorRequest]){
    assert.match(message.textContent,/MUELLER-MAX-150327/);
    assert.match(message.textContent,/Gesamtpreis: 100,00 €/);
    assert.match(message.textContent,/Anzahlung \(25 %\): 25,00 €/);
    assert.match(message.textContent,/Restbetrag \(75 %\): 75,00 €/);
  }
  const conflict=await anfrage('10:00');
  assert.equal(conflict.status,409);
  const adjacent=await anfrage('11:00');
  assert.equal(adjacent.status,201);
  const adjacentData=await adjacent.json();
  assert.equal(adjacentData.buchungsnummer,'MUELLER-MAX-150327-02');
  await waitForEmails(4);

  const otp=totpCode(totpSecret,Math.floor(Date.now()/30000));
  const login=await fetch(root+'/api/admin/login',{method:'POST',headers:{Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({username:'test-admin',password:'test-only-password',totp:otp})});
  assert.equal(login.status,200);
  const replayedLogin=await fetch(root+'/api/admin/login',{method:'POST',headers:{Origin:root,'Content-Type':'application/json'},
    body:JSON.stringify({username:'test-admin',password:'test-only-password',totp:otp})});
  assert.equal(replayedLogin.status,401,'Auch der persistente Datenbankzähler muss einen bereits genutzten Code ablehnen');
  const cookie=login.headers.get('set-cookie').split(';',1)[0];
  const loginData=await login.json();
  const unauthCalendar=await fetch(root+'/api/admin/kalenderbuchungen?monat=2026-01');
  assert.equal(unauthCalendar.status,401,'Kalenderbuchungen müssen geschützt sein');
  const calendar=await fetch(root+'/api/admin/kalenderbuchungen?monat=2026-01',{headers:{Cookie:cookie}});
  assert.equal(calendar.status,200);
  assert.equal((await calendar.json()).length,55,'Kalender lädt alle Buchungen des Monats, auch außerhalb der letzten 250');
  const invalidCalendarMonth=await fetch(root+'/api/admin/kalenderbuchungen?monat=2026-13',{headers:{Cookie:cookie}});
  assert.equal(invalidCalendarMonth.status,400);
  const paymentPage=await fetch(root+'/api/admin/zahlungsuebersicht?seite=2&filter=teilzahlung',{headers:{Cookie:cookie}});
  assert.equal(paymentPage.status,200);
  const paymentResult=await paymentPage.json();
  assert.equal(paymentResult.anzahl,55);
  assert.equal(paymentResult.eintraege.length,5);
  assert.equal(paymentResult.summen.eingegangenCent,55000);
  assert.equal(paymentResult.summen.offenCent,515000);
  const invalidPaymentPage=await fetch(root+'/api/admin/zahlungsuebersicht?seite=0',{headers:{Cookie:cookie}});
  assert.equal(invalidPaymentPage.status,400);
  const adminHeaders={Cookie:cookie,Origin:root,'X-CSRF-Token':loginData.csrfToken,'Content-Type':'application/json'};
  const noEmailExportResponse=await fetch(root+`/api/admin/buchungen/${archivedBookings[1].id}/export`,{headers:{Cookie:cookie}});
  assert.equal(noEmailExportResponse.status,200);
  const noEmailExport=await noEmailExportResponse.json();
  assert.equal(noEmailExport.kontaktEmail,null);
  assert.equal(noEmailExport.buchungen.length,1,'Ohne Kontakt-E-Mail bleibt der Export auf die ausgewählte Buchung beschränkt');
  assert.equal(noEmailExport.buchungen[0].buchung.referenz,'ARCHIV-002');
  const addPlace=await fetch(root+'/api/admin/orte',{method:'POST',headers:adminHeaders,body:JSON.stringify({name:'Sundern'})});
  assert.equal(addPlace.status,201);
  const activePlaces=await fetch(root+'/api/admin/orte',{headers:{Cookie:cookie}});
  assert.deepEqual((await activePlaces.json()).map(place=>place.name).sort(),['Brilon','Sundern']);
  const invalidPlace=await fetch(root+'/api/admin/orte',{method:'POST',headers:adminHeaders,body:JSON.stringify({name:'   '})});
  assert.equal(invalidPlace.status,400);
  const matchingBookings=await fetch(root+'/api/admin/buchungen?suche=max&status=offen',{headers:{Cookie:cookie}});
  assert.equal(matchingBookings.status,200);
  assert.equal((await matchingBookings.json()).length,3,'Suche und Statusfilter werden serverseitig kombiniert und E-Mail-Schreibweise ignoriert');
  const archivePage1=await fetch(root+'/api/admin/buchungen?suche=Archiv&status=offen&seite=1',{headers:{Cookie:cookie}});
  assert.equal(archivePage1.status,200);
  const archiveResult1=await archivePage1.json();
  assert.equal(archiveResult1.anzahl,55);
  assert.equal(archiveResult1.buchungen.length,50);
  assert.equal(archiveResult1.seite,1);
  const archivePage2=await fetch(root+'/api/admin/buchungen?suche=Archiv&status=offen&seite=2',{headers:{Cookie:cookie}});
  const archiveResult2=await archivePage2.json();
  assert.equal(archiveResult2.buchungen.length,5);
  assert.equal(archiveResult2.seite,2);
  const invalidPage=await fetch(root+'/api/admin/buchungen?seite=0',{headers:{Cookie:cookie}});
  assert.equal(invalidPage.status,400,'Ungültige Seitennummern werden abgelehnt');
  const invalidStatus=await fetch(root+'/api/admin/buchungen?status=unbekannt',{headers:{Cookie:cookie}});
  assert.equal(invalidStatus.status,400);
  const guestbook=await fetch(root+'/api/admin/gps/gaesteliste?tour='+tourId,{headers:{Cookie:cookie}});
  assert.equal(guestbook.status,200);
  const guestEntries=await guestbook.json();
  assert.equal(guestEntries.length,1);
  assert.equal(guestEntries[0].id,guestId);
  assert.equal(guestEntries[0].name,'Freigegebener Teamname');
  assert.equal(guestEntries[0].tour,'Brilon-Rätseltour');
  assert.ok(Number.isFinite(Date.parse(guestEntries[0].einwilligung_am)),'Einwilligungszeitpunkt muss erfasst werden');
  assert.equal(guestEntries[0].einwilligung_version,'2026-11-02-v1');
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
  await waitForEmails(6);
  const confirmation=mailMessages.find(message=>message.to?.[0]?.email==='max@example.test'&&
    message.subject==='Deine Buchung ist bestätigt – Klettern & Abenteuer Brilon');
  assert.ok(confirmation,'Bei erreichter Anzahlung wird eine Kundenbestätigung versendet');
  assert.match(confirmation.textContent,/MUELLER-MAX-150327-02/);
  assert.match(confirmation.textContent,/Gesamtpreis: 100,00 €/);
  assert.match(confirmation.textContent,/Anzahlung \(25 %\): 25,00 €/);
  assert.match(confirmation.textContent,/Tatsächlich erfasst: 25,00 €/);
  assert.match(confirmation.textContent,/Offener Restbetrag: 75,00 €/);
  const bookingExportResponse=await fetch(root+`/api/admin/buchungen/${adjacentData.id}/export`,{headers:{Cookie:cookie}});
  assert.equal(bookingExportResponse.status,200);
  assert.match(bookingExportResponse.headers.get('content-disposition'),/attachment; filename="buchung-/);
  const bookingExport=await bookingExportResponse.json();
  assert.equal(bookingExport.exportformat,'klettern-abenteuer-kundendaten-v2');
  assert.equal(bookingExport.kontaktEmail,'max@example.test');
  assert.equal(bookingExport.buchungen.length,3,'Alle Buchungen derselben Kontakt-E-Mail müssen exportiert werden');
  const exportedReferences=bookingExport.buchungen.map(entry=>entry.buchung.referenz);
  assert.ok(exportedReferences.includes(firstData.buchungsnummer));
  assert.ok(exportedReferences.includes(adjacentData.buchungsnummer));
  assert.ok(exportedReferences.includes('ARCHIV-001'),'E-Mail-Adressen dürfen sich nur in Groß-/Kleinschreibung unterscheiden');
  assert.equal(exportedReferences.some(reference=>/^ARCHIV-(?!001$)/.test(reference)),false,'Andere Kontakt-E-Mails dürfen nicht in den Export gelangen');
  const adjacentExport=bookingExport.buchungen.find(entry=>entry.buchung.referenz===adjacentData.buchungsnummer);
  const firstExport=bookingExport.buchungen.find(entry=>entry.buchung.referenz===firstData.buchungsnummer);
  assert.equal(adjacentExport.kunde.email,'max@example.test');
  assert.equal(adjacentExport.zahlung.zahlungen[0].betragCent,2500);
  assert.equal(adjacentExport.gpsSpiele.length,1);
  assert.equal(adjacentExport.gpsSpiele[0].tour,'Brilon-Rätseltour');
  assert.equal(adjacentExport.gpsSpiele[0].spielzeitSekunden,3600);
  assert.equal(firstExport.gpsSpiele.length,1,'GPS-Spielverläufe aller zugehörigen Buchungen werden separat zugeordnet');
  assert.equal(adjacentExport.gpsSpiele[0].gaestelistenName,null,'Namen ohne öffentliche Einwilligung werden nicht exportiert');
  assert.equal(JSON.stringify(bookingExport).includes('Nicht freigegebener Name'),false);
  assert.equal('token_hash' in adjacentExport.gpsSpiele[0],false);
  assert.equal('kontrollcode' in adjacentExport.gpsSpiele[0],false);
  assert.equal('latitude' in adjacentExport.gpsSpiele[0],false);
  assert.equal('bearbeitungsnotiz' in bookingExport,false,'Interne Bearbeitungsnotizen gehören nicht in den Export');
  assert.equal('spielzugang' in bookingExport,false,'GPS-Spielzugänge gehören nicht in den Kundendatenexport');

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
  const linkedBookingDelete=await fetch(root+`/api/admin/buchungen/${addonBooking.id}`,{method:'DELETE',headers:adminHeaders});
  assert.equal(linkedBookingDelete.status,409,'Anschlussbuchungen dürfen nicht aus dem Rabatt- und Zahlungszusammenhang gelöscht werden');

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
  await waitForEmails(11);
  const cancellationNotice=mailMessages.find(message=>message.to?.[0]?.email==='max@example.test'&&
    message.subject==='Deine Buchung wurde storniert – Klettern Brilon');
  assert.ok(cancellationNotice,'Eine Stornierung muss eine Kundenbenachrichtigung auslösen');
  assert.match(cancellationNotice.textContent,new RegExp(addonData.buchungsnummer));
  assert.match(cancellationNotice.textContent,/wurde storniert/i);
  const bookingsCancelled=await fetch(root+'/api/admin/buchungen',{headers:{Cookie:cookie}});
  const cancelled=await bookingsCancelled.json();
  const restoredParent=cancelled.find(item=>item.id===adjacentData.id);
  assert.equal(restoredParent.data.gesamtpreis,100);
  assert.equal(restoredParent.data.restbetrag,75);
  assert.ok(restoredParent.data.preisanpassungen.length>=2);
  const linkedParentDelete=await fetch(root+`/api/admin/buchungen/${adjacentData.id}`,{method:'DELETE',headers:adminHeaders});
  assert.equal(linkedParentDelete.status,409,'Elternbuchungen mit Anschlussverlauf müssen erhalten bleiben');
  const firstDelete=await fetch(root+`/api/admin/buchungen/${firstData.id}`,{method:'DELETE',headers:adminHeaders});
  assert.equal(firstDelete.status,200);
  assert.equal((await firstDelete.json()).gpsSpieleGeloescht,1,'Zugehörige GPS-Spieldaten müssen gemeinsam gelöscht werden');
  const deletedExport=await fetch(root+`/api/admin/buchungen/${firstData.id}/export`,{headers:{Cookie:cookie}});
  assert.equal(deletedExport.status,404);
  const logout=await fetch(root+'/api/admin/logout',{method:'POST',headers:adminHeaders});
  assert.equal(logout.status,200);
  const afterLogout=await fetch(root+'/api/admin/buchungen',{headers:{Cookie:cookie}});
  assert.equal(afterLogout.status,401,'Datenbanksitzung muss nach Abmelden widerrufen sein');
});
