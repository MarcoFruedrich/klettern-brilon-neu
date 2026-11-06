'use strict';
class Pool {
  constructor() {
    if (process.env.MOCK_PG !== '1') throw new Error('Der HTTP-Test darf keine echte Datenbank öffnen.');
    this.offers = JSON.parse(process.env.MOCK_OFFERS || '[]');
    this.bookings = [];
    this.bookings = JSON.parse(process.env.MOCK_BOOKINGS || '[]');
    this.guests = JSON.parse(process.env.MOCK_GUESTBOOK || '[]');
    this.calendar = JSON.parse(process.env.MOCK_CALENDAR || '[]');
    this.places = JSON.parse(process.env.MOCK_PLACES || '[]');
    this.placesTableReady=process.env.MOCK_PLACES_TABLE!=='missing';
    this.gpsTours = JSON.parse(process.env.MOCK_GPS_TOURS || '[]');
    this.nextOfferId = this.offers.reduce((next,offer)=>Math.max(next,Number(offer.id)||0),0)+1;
    this.adminSessions = new Map();
    this.adminTotpSteps = new Map();
    this.gpsGames = JSON.parse(process.env.MOCK_GPS_GAMES || '[]');
    this.rechnungsdaten = {agbText:'Test-AGB', agbAktiv:true, agbVersion:1,
      empfehlungAktiv:false, empfehlungRabattArt:'prozent', empfehlungRabattWert:''};
    this.advisoryLockOwner = null;
    this.advisoryLockWaiters = [];
  }

  async query(sql, params=[]) { return this.run(sql, params); }
  async connect() {
    const client={query:(sql,params=[])=>this.run(sql,params,client),release:()=>this.advisoryLockFreigeben(client)};
    return client;
  }

  async run(sql, params, client=null) {
    if(process.env.RUN_PROGRAM_FIELDS_MIGRATION==='true'&&
       /^\s*ALTER TABLE brilon_angebote\b/i.test(sql))
      return {rows:[],rowCount:0};
    if(process.env.RUN_EMPLOYEE_AREAS_MIGRATION==='true'&&
       /^\s*ALTER TABLE brilon_mitarbeiterbereiche\b/i.test(sql))
      return {rows:[],rowCount:0};
    if(/^\s*CREATE TABLE IF NOT EXISTS brilon_mitarbeiterbereiche\b/i.test(sql))
      return {rows:[],rowCount:0};
    if(/^\s*CREATE TABLE IF NOT EXISTS brilon_mitarbeiterbereich_orte\b/i.test(sql))
      return {rows:[],rowCount:0};
    if(/^\s*CREATE INDEX IF NOT EXISTS brilon_mitarbeiterbereich_orte_ort_idx\b/i.test(sql))
      return {rows:[],rowCount:0};
    if(/^\s*SELECT 1 FROM brilon_pruef_admin_sessions\b/i.test(sql))
      return {rows:[],rowCount:0};
    if(/^\s*BEGIN\b/i.test(sql))return {rows:[],rowCount:0};
    if(/^\s*(COMMIT|ROLLBACK)\b/i.test(sql)){
      if(client)this.advisoryLockFreigeben(client);
      return {rows:[],rowCount:0};
    }
    if(/^\s*SELECT\s+pg_advisory_xact_lock\(/i.test(sql)){
      if(client&&this.advisoryLockOwner!==client){
        if(this.advisoryLockOwner)this.advisoryLockWaiters.push(client);
        else this.advisoryLockOwner=client;
        if(this.advisoryLockOwner!==client)
          await new Promise(resolve=>{client.advisoryLockFortsetzen=resolve;});
      }
      return {rows:[],rowCount:0};
    }
    if (sql.includes('FROM brilon_rechnungsdaten')) {
      if (sql.includes("data->>'agbText'")) return {rows:[{text:this.rechnungsdaten.agbText,
        aktiv:String(this.rechnungsdaten.agbAktiv),version:String(this.rechnungsdaten.agbVersion)}],rowCount:1};
      return {rows:[{data:this.rechnungsdaten}],rowCount:1};
    }
    if (sql.includes('UPDATE brilon_rechnungsdaten')) return {rows:[],rowCount:1};
    if (process.env.MOCK_ADMIN_SESSION_FAIL==='1'&&sql.includes('brilon_admin_sessions'))
      throw new Error('Test-double: Admin-Sitzungstabelle fehlt');
    if (process.env.MOCK_ADMIN_TOTP_FAIL==='1'&&sql.includes('brilon_admin_totp_steps'))
      throw new Error('Test-double: TOTP-Zählertabelle fehlt');
    if(/CREATE TABLE IF NOT EXISTS brilon_orte/i.test(sql)){
      this.placesTableReady=true;
      return {rows:[],rowCount:0};
    }
    if(!this.placesTableReady&&/(?:FROM|INTO)\s+brilon_orte\b/i.test(sql)){
      const error=new Error('relation "brilon_orte" does not exist');
      error.code='42P01';
      throw error;
    }
    if(sql.includes("INSERT INTO brilon_orte(name) VALUES('Brilon')")){
      if(!this.places.some(place=>place.name==='Brilon'))
        this.places.push({id:this.places.length+1,name:'Brilon',aktiv:true});
      return {rows:[],rowCount:1};
    }
    if(sql.includes('INSERT INTO brilon_angebote(name,beschreibung,dauer,preise,aktiv)')){
      const [name,beschreibung,dauer,rawPrices,aktiv]=params;
      const offer={id:this.nextOfferId++,name,beschreibung,dauer,preise:JSON.parse(rawPrices),aktiv};
      this.offers.push(offer);return {rows:[{id:offer.id}],rowCount:1};
    }
    if(/INSERT INTO brilon_angebote\s*\(name,beschreibung,dauer,preise,aktiv,kategorie/.test(sql)){
      const [name,beschreibung,dauer,kategorie,zielgruppe,veranstaltungsort,kapazitaet,rawDates,hinweise,buchbar,veroeffentlicht,buchungsmodus='gruppe',mindestteilnehmer=1,preis_pro_person=0]=params;
      const sortierung=Math.max(0,...this.offers.map(item=>Number(item.sortierung)||0))+1;
      const offer={id:this.nextOfferId++,name,beschreibung,dauer,preise:{},aktiv:false,kategorie,zielgruppe,
        veranstaltungsort,kapazitaet,verfuegbare_termine:JSON.parse(rawDates),hinweise,buchbar,veroeffentlicht,
        buchungsmodus,mindestteilnehmer,preis_pro_person,sortierung,archiviert:false};
      this.offers.push(offer);return {rows:[{id:offer.id}],rowCount:1};
    }
    if(sql.includes('INSERT INTO brilon_gps_touren(id,angebot_id,data,aktiv)')){
      const [id,angebot_id,raw,aktiv]=params;
      const tour={id,angebot_id,data:JSON.parse(raw),aktiv,erstellt_am:new Date().toISOString(),aktualisiert_am:null};
      this.gpsTours.push(tour);return {rows:[],rowCount:1};
    }
    if(sql.includes('FROM brilon_gps_touren')&&sql.includes('ORDER BY erstellt_am DESC'))
      return {rows:[...this.gpsTours].reverse(),rowCount:this.gpsTours.length};
    if(sql.includes('SELECT id FROM brilon_gps_touren WHERE angebot_id=$1 AND aktiv=true')){
      const tour=this.gpsTours.find(item=>String(item.angebot_id)===String(params[0])&&item.aktiv===true);
      return {rows:tour?[{id:tour.id}]:[],rowCount:tour?1:0};
    }
    if(sql.includes('UPDATE brilon_gps_touren SET aktiv=$1,aktualisiert_am=NOW()')){
      const [aktiv,id]=params,tour=this.gpsTours.find(item=>item.id===id);
      if(!tour)return {rows:[],rowCount:0};
      tour.aktiv=aktiv;tour.aktualisiert_am=new Date().toISOString();
      return {rows:[{id,aktiv}],rowCount:1};
    }
    if(sql.includes('SELECT angebot_id,data FROM brilon_gps_touren WHERE id=$1')){
      const tour=this.gpsTours.find(item=>item.id===params[0]);
      return {rows:tour?[{angebot_id:tour.angebot_id,data:tour.data}]:[],rowCount:tour?1:0};
    }
    if(sql.includes('SELECT data,angebot_id FROM brilon_gps_touren WHERE id=$1')){
      const tour=this.gpsTours.find(item=>item.id===params[0]);
      return {rows:tour?[{data:tour.data,angebot_id:tour.angebot_id}]:[],rowCount:tour?1:0};
    }
    if(sql.includes('UPDATE brilon_gps_touren SET data=$1::jsonb,aktiv=COALESCE($2,aktiv)')){
      const [raw,aktiv,id]=params,tour=this.gpsTours.find(item=>item.id===id);
      if(!tour)return {rows:[],rowCount:0};
      tour.data=JSON.parse(raw);if(aktiv!==null)tour.aktiv=aktiv;tour.aktualisiert_am=new Date().toISOString();
      return {rows:[{id,aktiv:tour.aktiv}],rowCount:1};
    }
    if(sql.includes('UPDATE brilon_angebote SET name=$1,beschreibung=$2,dauer=$3,preise=$4::jsonb,aktiv=$5 WHERE id=$6')){
      const [name,beschreibung,dauer,rawPrices,aktiv,id]=params,offer=this.offers.find(item=>String(item.id)===String(id));
      if(!offer)return {rows:[],rowCount:0};
      Object.assign(offer,{name,beschreibung,dauer,preise:JSON.parse(rawPrices),aktiv});return {rows:[],rowCount:1};
    }
    if(sql.includes('UPDATE brilon_angebote SET aktiv=$1 WHERE id=$2')){
      const [aktiv,id]=params,offer=this.offers.find(item=>String(item.id)===String(id));
      if(!offer)return {rows:[],rowCount:0};offer.aktiv=aktiv;return {rows:[],rowCount:1};
    }
    if(sql.includes('INSERT INTO brilon_admin_totp_steps')){
      const [factorId,step]=params,previous=this.adminTotpSteps.get(factorId);
      if(previous!==undefined&&previous>=Number(step))return {rows:[],rowCount:0};
      this.adminTotpSteps.set(factorId,Number(step));
      return {rows:[{last_step:step}],rowCount:1};
    }
    if (sql.includes('INSERT INTO brilon_admin_sessions')) {
      this.adminSessions.set(params[0],new Date(params[1]).getTime());
      return {rows:[],rowCount:1};
    }
    if (sql.includes('DELETE FROM brilon_admin_sessions WHERE expires_at<=NOW()')) {
      let removed=0;for(const [hash,expiry] of this.adminSessions)if(expiry<=Date.now()){this.adminSessions.delete(hash);removed++;}
      return {rows:[],rowCount:removed};
    }
    if (sql.includes('DELETE FROM brilon_admin_sessions WHERE token_hash=$1')) {
      const removed=this.adminSessions.delete(params[0]);return {rows:[],rowCount:removed?1:0};
    }
    if (sql.includes('SELECT 1 FROM brilon_admin_sessions WHERE token_hash=$1')) {
      const expiry=this.adminSessions.get(params[0]),valid=Number.isFinite(expiry)&&expiry>Date.now();
      return {rows:valid?[{'?column?':1}]:[],rowCount:valid?1:0};
    }
    if (/^\s*SELECT 1\s*;?\s*$/i.test(sql)) return { rows:[{ '?column?':1 }], rowCount:1 };
    if (/UPDATE brilon_angebote\s+SET preise/.test(sql)) {
      const [prices,id,active,name,description,category,audience,place,capacity,dates,notes,bookable,published,duration,mode,minPeople,personPrice]=params;
      const offer=this.offers.find(item=>String(item.id)===String(id));
      if(!offer)return {rows:[],rowCount:0};
      Object.assign(offer,{preise:JSON.parse(prices),aktiv:active===null?offer.aktiv:active,name,beschreibung:description,
        kategorie:category,zielgruppe:audience,veranstaltungsort:place,kapazitaet:capacity,
        verfuegbare_termine:JSON.parse(dates),hinweise:notes,buchbar:bookable,veroeffentlicht:published,dauer:duration,
        buchungsmodus:mode,mindestteilnehmer:minPeople,preis_pro_person:personPrice});
      return {rows:[offer],rowCount:1};
    }
    if (sql.includes('FROM brilon_angebote')) {
      let offers=/WHERE id\s*=\s*\$1/.test(sql)
        ?this.offers.filter(item=>String(item.id)===String(params[0]))
        :params[0]?this.offers.filter(item=>item.name===params[0]):this.offers;
      if(sql.includes('aktiv=true AND buchbar=true AND veroeffentlicht=true'))
        offers=offers.filter(item=>item.aktiv===true&&item.buchbar===true&&item.veroeffentlicht===true);
      if(sql.includes('archiviert=false'))offers=offers.filter(item=>item.archiviert!==true);
      if(sql.includes('ORDER BY archiviert ASC,sortierung ASC,id DESC'))
        offers.sort((a,b)=>Number(a.archiviert)-Number(b.archiviert)||(a.sortierung||0)-(b.sortierung||0)||b.id-a.id);
      if(sql.includes('ORDER BY sortierung ASC,name ASC'))
        offers.sort((a,b)=>(a.sortierung||0)-(b.sortierung||0)||a.name.localeCompare(b.name));
      return { rows:offers.slice(), rowCount:offers.length };
    }
    if(sql.includes('UPDATE brilon_angebote AS angebot SET sortierung=')){
      const ids=params[0].map(Number),changed=[];
      ids.forEach((id,index)=>{const offer=this.offers.find(item=>item.id===id&&!item.archiviert);if(offer){offer.sortierung=index;changed.push({id});}});
      return {rows:changed,rowCount:changed.length};
    }
    if(sql.includes('UPDATE brilon_angebote SET archiviert=$1')){
      const offer=this.offers.find(item=>String(item.id)===String(params[1]));
      if(!offer)return {rows:[],rowCount:0};
      offer.archiviert=params[0];return {rows:[{id:offer.id,archiviert:offer.archiviert}],rowCount:1};
    }
    if (sql.includes('FROM brilon_orte')) {
      const rows=this.places.filter(item=>item.aktiv===true).sort((a,b)=>a.name.localeCompare(b.name,'de'));
      return {rows,rowCount:rows.length};
    }
    if (/UPDATE brilon_gps_spiele SET gast_name=\$1,gast_einwilligung=\$2/.test(sql)) {
      const [name,consent,version,tokenHash]=params;
      const guest=this.guests.find(item=>item.token_hash===tokenHash&&item.abgeschlossen===true);
      if(!guest)return {rows:[],rowCount:0};
      guest.name=name;guest.einwilligung=consent;guest.einwilligung_am=consent?new Date().toISOString():null;
      guest.einwilligung_version=consent?version:null;
      return {rows:[{id:guest.id}],rowCount:1};
    }
    if (sql.includes('FROM brilon_gps_spiele g WHERE g.tour_id=$1')&&sql.includes('gast_einwilligung=true')) {
      const rows=this.guests.filter(item=>item.einwilligung===true&&item.name&&item.tour_id===params[0])
        .map(({name,datum,dauer_sekunden})=>({name,datum,dauer_sekunden}));
      return {rows,rowCount:rows.length};
    }
    if (sql.includes('INSERT INTO brilon_orte')) {
      const name=params[0];let place=this.places.find(item=>item.name.toLocaleLowerCase('de-DE')===name.toLocaleLowerCase('de-DE'));
      if(place)place.aktiv=true;else{place={id:this.places.length+1,name,aktiv:true};this.places.push(place);}
      return {rows:[place],rowCount:1};
    }
    if (sql.includes('FROM brilon_kalender')) {
      if(sql.includes("typ='sperrzeit'")&&sql.includes('COALESCE(enddatum,datum) >= $1::date')){
        const rows=this.calendar.filter(item=>item.typ==='sperrzeit'&&item.datum<=params[0]&&
          (item.enddatum||item.datum)>=params[0]).slice(0,1).map(({id})=>({id:id??1}));
        return {rows,rowCount:rows.length};
      }
      if(sql.includes('COALESCE(enddatum,datum)::text AS enddatum')){
        const rows=this.calendar.filter(item=>item.typ==='sperrzeit').map(item=>({
          datum:item.datum,enddatum:item.enddatum||item.datum
        }));
        return {rows,rowCount:rows.length};
      }
      if(sql.includes('titel,datum::text AS datum'))return {rows:this.calendar,rowCount:this.calendar.length};
      return {rows:[],rowCount:0};
    }
    if (sql.includes('jsonb_build_object')&&sql.includes('FROM brilon_buchungen')) {
      const rows=this.bookings.map(item=>({id:item.id,status:item.status,buchungsnummer:item.buchungsnummer,
        data:{buchungsnummer:item.data.buchungsnummer,name:item.data.name,angebot:item.data.angebot,datum:item.data.datum,
          gesamtpreis:item.data.gesamtpreis,zahlungen:item.data.zahlungen,zahlungsgutschriftCent:item.data.zahlungsgutschriftCent}}));
      return {rows,rowCount:rows.length};
    }
    if (sql.includes('FROM brilon_buchungen')&&sql.includes("data->>'datum'>=$1")) {
      const rows=this.bookings.filter(item=>item.data.datum>=params[0]&&item.data.datum<params[1]&&
        ['offen','bestaetigt'].includes(item.status||'offen'))
        .map(item=>({id:item.id,data:item.data,status:item.status,created_at:item.created_at||new Date(0)}));
      return {rows,rowCount:rows.length};
    }
    if(/SELECT\s+data\s+FROM brilon_buchungen/.test(sql)&&sql.includes("data->>'datum'=$1")){
      const rows=this.bookings.filter(item=>item.data.datum===params[0]&&
        ['offen','bestaetigt'].includes(item.status||'offen')).map(item=>({data:item.data}));
      return {rows,rowCount:rows.length};
    }
    if (sql.includes('FROM brilon_gps_spiele g JOIN brilon_gps_touren t')&&sql.includes('gast_einwilligung=true')) {
      const rows=this.guests.filter(item=>item.einwilligung===true&&(!params[0]||item.tour_id===params[0]))
        .map(({id,name,datum,dauer_sekunden,tour,einwilligung_am,einwilligung_version})=>({id,name,datum,dauer_sekunden,tour,einwilligung_am,einwilligung_version}));
      return {rows,rowCount:rows.length};
    }
    if (/UPDATE brilon_gps_spiele SET gast_name=NULL,gast_einwilligung=false/.test(sql)) {
      const guest=this.guests.find(item=>item.id===params[0]&&item.einwilligung===true);
      if(!guest)return {rows:[],rowCount:0};
      guest.name=null;guest.einwilligung=false;guest.einwilligung_am=null;guest.einwilligung_version=null;
      return {rows:[{id:guest.id}],rowCount:1};
    }
    if (sql.includes('COUNT(*)::integer AS anzahl')) {
      const count=this.bookings.filter(item=>item.data.anschlussElternId===params[0]&&item.id!==params[1]&&item.status==='bestaetigt').length;
      return { rows:[{anzahl:count}], rowCount:1 };
    }
    if (sql.includes('COUNT(*)::text AS anzahl FROM brilon_buchungen')) {
      const rows=this.bookings.filter(item=>(params[0]==='alle'||(item.status||'offen')===params[0])&&
        (!params[1]||[item.data.name,item.data.buchungsnummer,item.buchungsnummer,item.data.email,item.data.angebot]
          .join(' ').toLocaleLowerCase('de-DE').includes(String(params[1]).toLocaleLowerCase('de-DE'))));
      return {rows:[{anzahl:String(rows.length)}],rowCount:1};
    }
    if (sql.includes('SELECT id,data,status,created_at,updated_at,zahlungsinfo_gesendet_am')&&sql.includes('WHERE id=$1')) {
      const item=this.bookings.find(entry=>entry.id===params[0]);
      return {rows:item?[{id:item.id,data:item.data,status:item.status,buchungsnummer:item.buchungsnummer,
        created_at:item.created_at||new Date(0),updated_at:item.updated_at||null,zahlungsinfo_gesendet_am:null}]:[],rowCount:item?1:0};
    }
    if(sql.includes("UPDATE brilon_buchungen")&&sql.includes("COALESCE(data,'{}'::jsonb)||$1::jsonb")&&sql.includes('WHERE id=$2 RETURNING id')){
      const [raw,id]=params,item=this.bookings.find(entry=>entry.id===id);
      if(!item)return {rows:[],rowCount:0};
      item.data={...item.data,...JSON.parse(raw)};
      return {rows:[{id}],rowCount:1};
    }
    if(sql.includes('SELECT id,data FROM brilon_buchungen WHERE id=$1 FOR UPDATE')){
      const item=this.bookings.find(entry=>entry.id===params[0]);
      return {rows:item?[{id:item.id,data:item.data}]:[],rowCount:item?1:0};
    }
    if(sql.includes("SELECT id FROM brilon_buchungen WHERE data->>'anschlussElternId'=$1")){
      const rows=this.bookings.filter(item=>item.data.anschlussElternId===params[0]).map(({id})=>({id}));
      return {rows,rowCount:rows.length};
    }
    if(sql.includes("SELECT to_regclass('brilon_gps_spiele')"))
      return {rows:[{relation:'brilon_gps_spiele'}],rowCount:1};
    if(sql.includes('DELETE FROM brilon_gps_spiele WHERE buchung_id=$1')){
      const first=this.bookings.find(item=>item.buchungsnummer==='MUELLER-MAX-150327')?.id;
      const before=this.gpsGames.length;
      this.gpsGames=this.gpsGames.filter(game=>game.buchung_id!=='first'||first!==params[0]);
      const removed=this.gpsGames.length<before?before-this.gpsGames.length:0;
      return {rows:[],rowCount:removed};
    }
    if(sql.includes('DELETE FROM brilon_buchungen WHERE id=$1 RETURNING id')){
      const index=this.bookings.findIndex(item=>item.id===params[0]);
      if(index<0)return {rows:[],rowCount:0};
      const [item]=this.bookings.splice(index,1);
      return {rows:[{id:item.id}],rowCount:1};
    }
    if (sql.includes("LOWER(BTRIM(data->>'email'))=LOWER($1)")) {
      const rows=this.bookings.filter(item=>String(item.data.email||'').trim().toLocaleLowerCase('en-US')===
        String(params[0]).trim().toLocaleLowerCase('en-US')).map(item=>({id:item.id,data:item.data,status:item.status,
          buchungsnummer:item.buchungsnummer,created_at:item.created_at||new Date(0),updated_at:item.updated_at||null,
          zahlungsinfo_gesendet_am:null}));
      return {rows,rowCount:rows.length};
    }
    if (sql.includes('FROM brilon_gps_spiele g JOIN brilon_gps_touren t')&&sql.includes('ANY($1::uuid[])')) {
      const ids=params[0]||[],fallbackId=ids.at(-1);
      const firstId=this.bookings.find(item=>item.buchungsnummer==='MUELLER-MAX-150327')?.id;
      const rows=this.gpsGames.filter(game=>game.buchung_id==='*'?ids.length>0:
        game.buchung_id==='first'?ids.includes(firstId):ids.includes(game.buchung_id))
        .map(game=>({buchung_id:game.buchung_id==='*'?fallbackId:game.buchung_id==='first'?firstId:game.buchung_id,tour:game.tour,
          gestartet_am:game.gestartet_am,abgeschlossen_am:game.abgeschlossen_am,
          spielzeit_sekunden:game.spielzeit_sekunden,station_index:game.station_index,gast_name:game.gast_name,
          gast_einwilligung:game.gast_einwilligung,einwilligung_am:game.einwilligung_am,
          einwilligung_version:game.einwilligung_version}));
      return {rows,rowCount:rows.length};
    }
    if (sql.includes('SELECT 1 FROM brilon_buchungen')) {
      const found=this.bookings.some(item=>item.data.anschlussElternId===params[0]&&item.data.angebot===params[1]&&
        item.data.uhrzeit===params[2]&&!['abgelehnt','storniert'].includes(item.status));
      return { rows:found?[{'?column?':1}]:[], rowCount:found?1:0 };
    }
    if (sql.includes('AS gebucht') || /\bAS n\b/.test(sql)) {
      const statusReactivation=sql.includes('id<>$1');
      const [idOrDate,dateOrOffer,offerOrTime,time]=params;
      const matching=this.bookings.filter(item=>(statusReactivation?item.id!==idOrDate:true)&&
        item.data.datum===(statusReactivation?dateOrOffer:idOrDate)&&
        item.data.angebot===(statusReactivation?offerOrTime:dateOrOffer)&&
        (!(statusReactivation?time:offerOrTime)||item.data.uhrzeit===(statusReactivation?time:offerOrTime))&&
        ['offen','bestaetigt'].includes(item.status));
      const sum=matching.reduce((value,item)=>value+Number(item.data.teilnehmer||0),0);
      return { rows:[{ gebucht:sum, n:sum }], rowCount:1 };
    }
    if (sql.includes('SELECT buchungsnummer FROM brilon_buchungen')) {
      const rows=this.bookings.filter(item=>item.buchungsnummer===params[0]||item.buchungsnummer.startsWith(params[1].slice(0,-1)))
        .map(item=>({buchungsnummer:item.buchungsnummer}));
      return { rows, rowCount:rows.length };
    }
    if (sql.includes('SELECT id,data FROM brilon_buchungen')) {
      const rows=this.bookings.filter(item=>item.data.datum===params[0]&&['offen','bestaetigt'].includes(item.status)&&
        (!params[1]||item.id!==params[1])).map(({id,data})=>({id,data}));
      return { rows, rowCount:rows.length };
    }
    if (sql.includes('SELECT id,status,data FROM brilon_buchungen') || sql.includes('SELECT id,data,status FROM brilon_buchungen')) {
      const item=this.bookings.find(entry=>entry.id===params[0]);
      return { rows:item?[{id:item.id,data:item.data,status:item.status}]:[], rowCount:item?1:0 };
    }
    if (sql.includes('SELECT id,data,status,bearbeitungsnotiz')) {
      let rows=this.bookings.filter(item=>(params[0]==='alle'||(item.status||'offen')===params[0])&&
        (!params[1]||[item.data.name,item.data.buchungsnummer,item.buchungsnummer,item.data.email,item.data.angebot]
          .join(' ').toLocaleLowerCase('de-DE').includes(String(params[1]).toLocaleLowerCase('de-DE'))))
        .map(item=>({id:item.id,data:item.data,status:item.status,bearbeitungsnotiz:'',
          created_at:new Date(0),updated_at:new Date(0),zahlungsinfo_gesendet_am:null}));
      if(sql.includes('LIMIT $3 OFFSET $4'))rows=rows.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
        .slice(params[3],params[3]+params[2]);
      return { rows, rowCount:rows.length };
    }
    if (sql.includes('UPDATE brilon_buchungen SET data=$1::jsonb,status=$2')) {
      const [raw,status,id]=params,item=this.bookings.find(entry=>entry.id===id);
      if(!item)return {rows:[],rowCount:0};
      item.data=typeof raw==='string'?JSON.parse(raw):raw;item.status=status;
      return {rows:[{id:item.id,data:item.data,status:item.status}],rowCount:1};
    }
    if (sql.includes('UPDATE brilon_buchungen SET data=$1::jsonb,updated_at=NOW() WHERE id=$2')) {
      const [raw,id]=params,item=this.bookings.find(entry=>entry.id===id);
      if(!item)return {rows:[],rowCount:0};
      item.data=typeof raw==='string'?JSON.parse(raw):raw;
      return {rows:[{id:item.id,data:item.data}],rowCount:1};
    }
    if (/UPDATE brilon_buchungen\s+SET status=\$1/.test(sql)) {
      const [status,note,raw,id]=params,item=this.bookings.find(entry=>entry.id===id);
      if(!item)return {rows:[],rowCount:0};
      item.data=typeof raw==='string'?JSON.parse(raw):raw;item.status=status;item.bearbeitungsnotiz=note;
      return {rows:[{id:item.id,data:item.data,status:item.status}],rowCount:1};
    }
    if (sql.includes('INSERT INTO brilon_buchungen')) {
      const [id,raw,status,buchungsnummer]=params.length===3
        ?[params[0],params[1],'offen',params[2]]:params;
      const item={id,data:typeof raw==='string'?JSON.parse(raw):raw,status,buchungsnummer};
      this.bookings.push(item);
      return { rows:[item], rowCount:1 };
    }
    throw new Error('SQL im Test-Double nicht implementiert: '+sql.slice(0,100));
  }

  advisoryLockFreigeben(client){
    if(this.advisoryLockOwner!==client)return;
    const naechster=this.advisoryLockWaiters.shift();
    this.advisoryLockOwner=naechster||null;
    if(naechster&&naechster.advisoryLockFortsetzen){
      const fortsetzen=naechster.advisoryLockFortsetzen;
      delete naechster.advisoryLockFortsetzen;
      fortsetzen();
    }
  }
}
module.exports = { Pool };
