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
    return {ok:!u.pathname.startsWith('/api/admin/'),status:u.pathname.startsWith('/api/admin/')?401:200,
      url:uri,headers:{get:()=>json?'application/json':'text/html'},
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

test('Leere aktive Standorte sind sichtbar, aber zerstören keine funktionsfähigen Buchungskalender',async()=>{
  const real=[{name:'Olpe'},{name:'Rüthen'}],calls=[];
  const reply=async(uri,options)=>{
    calls.push(uri);
    const url=new URL(uri),p=url.pathname;
    const data=p==='/api/orte'?real:
      p==='/api/angebote'?[{id:3,name:'Klettern',veranstaltungsorte:['Olpe'],gruppenstufen:[{min:5,max:15,dauer:120}],dauer_modus:'gruppenstufe'}]:
      p==='/api/aktionen'?[]:
      p==='/api/social-links'?{kanäle:[]}:
      p==='/api/belegte-zeiten'?{zeiten:[]}:null;
    const json=data!==null,content=json?JSON.stringify(data):p.endsWith('.js')?
      'function test(){return true;}' : '<html><body>OK</body></html>';
    return {ok:!url.pathname.startsWith('/api/admin/'),status:url.pathname.startsWith('/api/admin/')?401:200,
      url:uri,headers:{get:()=>json?'application/json':'text/html'},
      json:async()=>JSON.parse(content),text:async()=>content};
  };
  const result=await smoke({base:'https://example.test/',fetcher:reply});
  assert.equal(result.rows.filter(x=>!x.pass).length,0,JSON.stringify(result.rows));
  assert.ok(result.warnings.some(x=>x.includes('Rüthen')));
  const calendar=calls.find(x=>x.includes('/api/belegte-zeiten?'));
  assert.match(calendar,/angebot=Klettern/);
  assert.match(calendar,/teilnehmer=5/);
  assert.match(calendar,/programmdauer=120/);
});
