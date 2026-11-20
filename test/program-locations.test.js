'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const begin=server.indexOf('function programmStandorteValidieren(');
const after=server.indexOf('async function programmStandorteAktivPruefen(',begin);
assert.ok(begin>0&&after>begin,'Mehrfachstandort-Validierung muss vorhanden sein');
const {programmStandorteValidieren:validieren,programmStandorteErwartet:erwarteteStandorte,
  programmStandortVergleichSql:sqlVergleich}=new Function(server.slice(begin,after)+
  '\nreturn {programmStandorteValidieren,programmStandorteErwartet,programmStandortVergleichSql};')();
const routeStart=server.indexOf('const programmStandortRoute=route.match(');
const routeEnd=server.indexOf('const preisRoute = route.match(',routeStart);
assert.ok(routeStart>0&&routeEnd>routeStart,'Separater Standort-Speicherweg muss vorhanden sein');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const rawSave=new AsyncFunction('route','req','res','body','reply','pool','programmStandorteValidieren',
  'programmStandorteAktivPruefen','programmStandorteErwartet','programmStandortVergleichSql',
  server.slice(routeStart,routeEnd));
const save=(route,req,res,body,reply,pool,validate,active)=>
  rawSave(route,req,res,body,reply,pool,validate,active,erwarteteStandorte,sqlVergleich);

test('Mehrere gültige Standorte bleiben in ursprünglicher Auswahl erhalten',()=>{
  const orte=['Jugendherberge Brilon','Olpe','Rüthen'];
  assert.deepEqual(validieren(orte),{standorte:orte});
  assert.equal(validieren([]).error!==undefined,true);
  assert.equal(validieren(['Olpe','Olpe']).error!==undefined,true);
  assert.equal(validieren(['Olpe','']).error!==undefined,true);
  assert.deepEqual(validieren(undefined,['Jugendherberge Brilon']),{standorte:['Jugendherberge Brilon']});
});

test('Eigenständiger Speicherweg ändert nur Standortliste und Hauptstandort',async()=>{
  const queryCalls=[];
  const orte=['Jugendherberge Brilon','Olpe','Rüthen'];
  const pool={query:async (sql,args)=>{
    queryCalls.push({sql,args});
    return {rowCount:1,rows:[{id:7,veranstaltungsort:orte[0],veranstaltungsorte:orte}]};
  }};
  const result=await save('/api/admin/angebote/7/standorte',{method:'PATCH'},{},
    async()=>({veranstaltungsorte:orte}),(_res,status,data)=>({status,data}),pool,validieren,async()=>true);
  assert.equal(result.status,200);
  assert.equal(result.data.success,true);
  assert.deepEqual(result.data.veranstaltungsorte,orte);
  assert.equal(queryCalls.length,1);
  assert.match(queryCalls[0].sql,/SET veranstaltungsorte=/);
  assert.doesNotMatch(queryCalls[0].sql,/preise|gruppenstufen|kapazitaet|buchbar/i);
  assert.deepEqual(JSON.parse(queryCalls[0].args[1]),orte);
  assert.match(queryCalls[0].sql,/\$4::jsonb IS NULL/,
    'Der getrennte Speicherweg schützt vor zeitlich veralteten Standortänderungen');
});

test('Ungültige oder deaktivierte Standortauswahl wird ohne Datenänderung abgelehnt',async()=>{
  const pool={query:async()=>{throw Error('Ungültige Auswahl darf nicht gespeichert werden');}};
  const reply=(_res,status,data)=>({status,data});
  const bad=await save('/api/admin/angebote/7/standorte',{method:'PATCH'},{},
    async()=>({veranstaltungsorte:['Olpe','Olpe']}),reply,pool,validieren,async()=>true);
  assert.equal(bad.status,400);
  const inactive=await save('/api/admin/angebote/7/standorte',{method:'PATCH'},{},
    async()=>({veranstaltungsorte:['Olpe']}),reply,pool,validieren,async()=>false);
  assert.equal(inactive.status,400);
});

test('Datenbankmigration und beide Listen-Endpunkte verwenden die Mehrfachzuordnung',()=>{
  assert.match(server,/ADD COLUMN IF NOT EXISTS veranstaltungsorte JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(server,/SET veranstaltungsorte=jsonb_build_array\(veranstaltungsort\)/);
  assert.match(server,/FROM brilon_angebote\s+ORDER BY archiviert ASC/);
  assert.match(server,/veranstaltungsort,veranstaltungsorte,kapazitaet,verfuegbare_termine/);
  assert.match(server,/programmStandorteValidieren\(d\.veranstaltungsorte/);
  assert.match(server,/Dieses Programm ist für den ausgewählten Standort nicht freigegeben/);
  assert.match(server,/Das Programm wird an diesem Standort nicht angeboten/);
});

test('Programmbuchungen verschiedener Standorte werden getrennt geprüft',()=>{
  assert.match(server,/AND \(\$3::text IS NULL OR data->>'veranstaltungsort'=\$3/);
  assert.match(server,/AND \(data->>'veranstaltungsort'=\$2 OR data->>'veranstaltungsort' IS NULL\)/);
  assert.match(server,/bookingSite\]/);
});
