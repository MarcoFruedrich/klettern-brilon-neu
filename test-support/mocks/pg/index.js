'use strict';
class Pool {
  constructor() {
    if (process.env.MOCK_PG !== '1') throw new Error('Der HTTP-Test darf keine echte Datenbank öffnen.');
    this.offers = JSON.parse(process.env.MOCK_OFFERS || '[]');
    this.bookings = [];
    this.bookings = JSON.parse(process.env.MOCK_BOOKINGS || '[]');
    this.guests = JSON.parse(process.env.MOCK_GUESTBOOK || '[]');
    this.places = JSON.parse(process.env.MOCK_PLACES || '[]');
  }

  async query(sql, params=[]) { return this.run(sql, params); }
  async connect() {
    return { query: (sql, params=[]) => this.run(sql, params), release() {} };
  }

  async run(sql, params) {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory_xact_lock)/i.test(sql)) return { rows:[], rowCount:0 };
    if (/^\s*SELECT 1\s*;?\s*$/i.test(sql)) return { rows:[{ '?column?':1 }], rowCount:1 };
    if (sql.includes('FROM brilon_angebote')) {
      const offers=sql.includes('WHERE id=$1')
        ?this.offers.filter(item=>String(item.id)===String(params[0]))
        :params[0]?this.offers.filter(item=>item.name===params[0]):this.offers;
      return { rows:offers, rowCount:offers.length };
    }
    if (sql.includes('FROM brilon_orte')) {
      const rows=this.places.filter(item=>item.aktiv===true).sort((a,b)=>a.name.localeCompare(b.name,'de'));
      return {rows,rowCount:rows.length};
    }
    if (/UPDATE brilon_gps_spiele SET gast_name=\$1,gast_einwilligung=\$2/.test(sql)) {
      const [name,consent,tokenHash]=params;
      const guest=this.guests.find(item=>item.token_hash===tokenHash&&item.abgeschlossen===true);
      if(!guest)return {rows:[],rowCount:0};
      guest.name=name;guest.einwilligung=consent;guest.einwilligung_am=consent?new Date().toISOString():null;
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
    if (sql.includes('FROM brilon_kalender')) return { rows:[], rowCount:0 };
    if (sql.includes('FROM brilon_buchungen')&&sql.includes("data->>'datum'>=$1")) {
      const rows=this.bookings.filter(item=>item.data.datum>=params[0]&&item.data.datum<params[1]&&
        ['offen','bestaetigt'].includes(item.status||'offen'))
        .map(item=>({id:item.id,data:item.data,status:item.status,created_at:item.created_at||new Date(0)}));
      return {rows,rowCount:rows.length};
    }
    if (sql.includes('FROM brilon_gps_spiele g JOIN brilon_gps_touren t')&&sql.includes('gast_einwilligung=true')) {
      const rows=this.guests.filter(item=>item.einwilligung===true&&(!params[0]||item.tour_id===params[0]))
        .map(({id,name,datum,dauer_sekunden,tour,einwilligung_am})=>({id,name,datum,dauer_sekunden,tour,einwilligung_am}));
      return {rows,rowCount:rows.length};
    }
    if (/UPDATE brilon_gps_spiele SET gast_name=NULL,gast_einwilligung=false/.test(sql)) {
      const guest=this.guests.find(item=>item.id===params[0]&&item.einwilligung===true);
      if(!guest)return {rows:[],rowCount:0};
      guest.name=null;guest.einwilligung=false;guest.einwilligung_am=null;
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
    if (sql.includes('SELECT 1 FROM brilon_buchungen')) {
      const found=this.bookings.some(item=>item.data.anschlussElternId===params[0]&&item.data.angebot===params[1]&&
        item.data.uhrzeit===params[2]&&!['abgelehnt','storniert'].includes(item.status));
      return { rows:found?[{'?column?':1}]:[], rowCount:found?1:0 };
    }
    if (sql.includes('AS gebucht') || /\bAS n\b/.test(sql)) {
      const matching=this.bookings.filter(item=>item.data.datum===params[0]&&item.data.angebot===params[1]&&
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
}
module.exports = { Pool };
