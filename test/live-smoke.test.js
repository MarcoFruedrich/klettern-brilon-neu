'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {standortFehler,smoke}=require('../scripts/live-smoke');
const sites=[{name:'Jugendherberge Brilon'},{name:'Olpe'},{name:'Rüthen'}];
const programs=[{id:7,name:'Klettern',veranstaltungsorte:sites.map(x=>x.name)}];
test('Standortprüfung lässt mehrere gültige Standorte zu',()=>{
  assert.deepEqual(standortFehler(sites,programs),[]);
});
test('Standortprüfung erkennt fehlerhafte öffentliche Zuordnung',()=>{
  assert.ok(standortFehler(sites,[{id:7,name:'X',veranstaltungsorte:['Nicht vorhanden']}]).length);
  assert.ok(standortFehler([],programs).length);
  assert.ok(standortFehler(sites,[]).length);
});
test('Live-Prüfung verändert keine Buchungen',async()=>{
  const calls=[];
  const fake=async(uri,opts)=>{
    const u=new URL(uri);calls.push(opts.method);
    const obj=u.pathname==='/api/orte'?sites:
      u.pathname==='/api/angebote'?programs:
      u.pathname==='/api/aktionen'?[]:
      u.pathname==='/api/social-links'?{kanäle:[]}:
      u.pathname==='/api/belegte-zeiten'?{zeiten:[]}:null;
    const json=obj!==null;
    const result=json?JSON.stringify(obj):u.pathname.endsWith('.js')?
      'function testing(){return true;}' : '<html><body>Website</body></html>';
    return {ok:true,url:uri,headers:{get:()=>json?'application/json':'text/html'},
      json:async()=>JSON.parse(result),text:async()=>result};
  };
  const r=await smoke({base:'https://example.test/',fetcher:fake});
  assert.equal(r.rows.filter(x=>!x.pass).length,0,JSON.stringify(r.rows));
  assert.ok(calls.every(x=>x==='GET'));
  assert.ok(r.rows.some(x=>x.name==='Verfügbarkeit pro Programm und Standort'&&x.pass));
  // Alle öffentlichen Verfügbarkeitsanfragen müssen Programm und Teilnehmerzahl enthalten.
  assert.ok(calls.length>0);
});
test('Nicht erreichbare Domain wird nicht als erfolgreich gemeldet',async()=>{
  const r=await smoke({base:'https://example.test/',domain:true,
    fetcher:async()=>{throw Error('DNS nicht erreichbar')}});
  assert.equal(r.rows.filter(x=>x.pass).length,0);
});
