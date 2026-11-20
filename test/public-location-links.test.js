'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const script=fs.readFileSync(path.join(__dirname,'../site/app.js'),'utf8');
const start=script.indexOf('function angebotBuchungslink(');
const end=script.indexOf('// Teilnehmerzahl',start);
assert.ok(start>0&&end>start,'Website muss Link- und Buchungsübergabe bereitstellen');
const make=new Function('window','standortAuswahl','angebotAuswahl','angeboteCache',
  'angeboteFertig','angebotslinkAngewendet','geladeneAktionen','sonderaktionAnfragen','Event',
  script.slice(start,end)+'\nreturn {angebotBuchungslink,angebotslinkAnwenden};');

function fixture(search,channels=[]){
  const events=[];
  const standortAuswahl={
    options:['Jugendherberge Brilon','Olpe','Rüthen'].map(value=>({value})),
    value:'',
    dispatchEvent(){events.push(['standort',this.value]);}
  };
  const angebotAuswahl={value:'',dispatchEvent(){events.push(['programm',this.value]);}};
  const selected=[];
  const window={location:{origin:'https://example.test',search}};
  const angeboteCache=[{id:7,name:'Klettern pur',veranstaltungsort:'Jugendherberge Brilon',
    veranstaltungsorte:['Jugendherberge Brilon','Olpe','Rüthen']}];
  return {standortAuswahl,angebotAuswahl,events,selected,...make(
    window,standortAuswahl,angebotAuswahl,angeboteCache,true,false,channels,
    (...args)=>selected.push(args),Event
  )};
}

test('WhatsApp-Programm-Link übernimmt ausdrücklich gewählten Standort',()=>{
  const f=fixture('');
  const url=f.angebotBuchungslink('programm',7,'Rüthen');
  assert.equal(url,'/?programm=7&standort=R%C3%BCthen#buchung');
  assert.equal(f.angebotBuchungslink('programm',7),'/?programm=7#buchung');
});

test('Direkter Programm-Link stellt den freigegebenen Zielstandort im Formular wieder her',()=>{
  const f=fixture('?programm=7&standort=Olpe');
  f.angebotslinkAnwenden();
  assert.equal(f.standortAuswahl.value,'Olpe');
  assert.equal(f.angebotAuswahl.value,'Klettern pur');
  assert.deepEqual(f.events,[['standort','Olpe'],['programm','Klettern pur']]);
});

test('Manipulierter Standort in einem Programm-Link wird nicht übernommen',()=>{
  const f=fixture('?programm=7&standort=Nichtfreigegeben');
  f.angebotslinkAnwenden();
  assert.equal(f.standortAuswahl.value,'Jugendherberge Brilon');
});

test('Sonderaktions-Link gibt den Standort an die Aktion weiter',()=>{
  const f=fixture('?aktion=abc&standort=R%C3%BCthen',[{id:'abc',titel:'Kletteraktion'}]);
  f.angebotslinkAnwenden();
  assert.equal(f.selected.length,1);
  assert.equal(f.selected[0][0].id,'abc');
  assert.equal(f.selected[0][1],'Rüthen');
});

test('Sonderaktions-Buchungsformular prüft den Standort gegen die Aktionsstandorte',()=>{
  assert.match(script,/gueltigeOrte\.includes\(linkStandort\)/);
  assert.match(script,/alleStandorte\?'':standortFilter/);
});
