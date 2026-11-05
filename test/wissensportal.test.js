'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validate,createWissensportalApi}=require('../lib/wissensportal-api');

const base={titel:'Sicherung am Toprope',kurztext:'Kurzanleitung',inhalt:'Verbindliche Informationen.',
  kategorie:'sicherheit',standorte:[1,2,1],dokumentUrl:'https://example.com/anleitung.pdf',veroeffentlicht:false};

test('Wissensportal: Eingaben erlauben wiederverwendbare Standortzuordnungen und Entwurf',()=>{
  const item=validate(base);
  assert.deepEqual(item.standorte,[1,2]);
  assert.equal(item.veroeffentlicht,false);
  assert.equal(item.kategorie,'sicherheit');
});
test('Wissensportal: unerlaubte URLs, ungültige Kategorien und unvollständige Artikel ablehnen',()=>{
  assert.equal(validate({...base,dokumentUrl:'javascript:alert(1)'}),null);
  assert.equal(validate({...base,inhalt:''}),null);
  assert.equal(validate({...base,kategorie:'admin'}),null);
  assert.equal(validate({...base,veroeffentlicht:'true'}),null);
  assert.equal(validate({...base,standorte:[0]}),null);
});
test('Wissensportal: Administratorrechte für Verwaltungszugriff und Login für Mitarbeiter',async()=>{
  const calls=[];
  const config={
    pool:{query:async(sql)=>{calls.push(sql);return {rows:[],rowCount:0};}},
    admin:async()=>false,staffSession:async()=>null,body:async()=>base,
    sameOriginMutation:()=>true,
    reply:(res,status,data)=>({status,data})
  };
  const api=createWissensportalApi(config);
  const denied=await api({method:'GET'}, {},null,'/api/admin/wissensportal');
  assert.equal(denied,undefined);assert.equal(calls.length,0);
  const staff=await api({method:'GET'}, {},null,'/api/wissensportal');
  assert.equal(staff.status,401);assert.equal(calls.length,0);
});
test('Wissensportal: Lesebestätigung benötigt angemeldete Person und gleiche Herkunft',async()=>{
  const articles='550e8400-e29b-41d4-a716-446655440000';
  const api=createWissensportalApi({
    pool:{query:async()=>{throw Error('Kein Datenbankzugriff vor Sicherheitsprüfung erlaubt');}},
    admin:async()=>true,staffSession:async()=>({mitarbeiter_id:'550e8400-e29b-41d4-a716-446655440001'}),
    body:async()=>base,sameOriginMutation:()=>false,
    reply:(res,status,data)=>({status,data})
  });
  const result=await api({method:'POST'}, {},null,'/api/wissensportal/'+articles+'/bestaetigen');
  assert.equal(result.status,403);
});
test('Wissensportal: Veröffentlichte Sicherheitsinfo wird nur nach staff scope bestätigt',async()=>{
  const id='550e8400-e29b-41d4-a716-446655440000',queries=[];
  const api=createWissensportalApi({
    pool:{query:async(sql,params)=>{
      queries.push([sql,params]);
      if(queries.length===1)return {rowCount:1,rows:[{id,version:3}]};
      return {rowCount:1,rows:[{version:3,bestaetigt_am:'2026-11-06T12:00:00Z'}]};
    }},admin:async()=>true,
    staffSession:async()=>({mitarbeiter_id:'550e8400-e29b-41d4-a716-446655440001'}),
    body:async()=>base,sameOriginMutation:()=>true,reply:(res,status,data)=>({status,data})
  });
  const r=await api({method:'POST'}, {},null,'/api/wissensportal/'+id+'/bestaetigen');
  assert.equal(r.status,200);assert.equal(r.data.version,3);
  assert.match(queries[0][0],/veroeffentlicht=true/);
  assert.match(queries[0][0],/brilon_pruef_freigaben/);
  assert.equal(queries[1][1][2],3);
});