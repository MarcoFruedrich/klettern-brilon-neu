'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const script=fs.readFileSync(path.join(__dirname,'../site/social-links-public.js'),'utf8');

function browserFixture(fetchImpl){
  const contacts={
    children:[],
    replaceChildren(){this.children=[];},
    append(...nodes){this.children.push(...nodes);}
  };
  const elements=[],shareButtons=[],windowHandlers={},documentHandlers={};
  const document={
    hidden:false,
    getElementById(id){return id==='social-contact-links'?contacts:null;},
    querySelector(selector){
      if(selector!=='#social-whatsapp-button')return null;
      return elements.find(node=>node.id==='social-whatsapp-button')||null;
    },
    querySelectorAll(selector){
      return selector==='[data-social-channel-action]'?shareButtons:[];
    },
    createElement(tag){
      return {tag,attributes:{},dataset:{},hidden:false,
        setAttribute(k,v){this.attributes[k]=v;},
        remove(){const i=elements.indexOf(this);if(i>=0)elements.splice(i,1);}};
    },
    createTextNode(value){return {textContent:value};},
    body:{append(node){elements.push(node);}},
    addEventListener(event,handler){documentHandlers[event]=handler;}
  };
  const window={addEventListener(event,handler){windowHandlers[event]=handler;}};
  vm.runInNewContext(script,{document,window,fetch:fetchImpl,console:{warn(){}}});
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  return {
    contacts,elements,document,window,shareButtons,windowHandlers,documentHandlers,flush,
    links:()=>contacts.children.filter(item=>item.tag==='a')
  };
}

test('Öffentliche Multimedia-Buttons sind ohne ausdrückliche Aktivierung unsichtbar',async()=>{
  const channels=[
    {id:'whatsapp',url:'https://wa.me/4912345678',aktiv:false},
    {id:'instagram',url:'https://instagram.com/atelier',aktiv:false},
    {id:'youtube',url:'https://youtube.com/@test',aktiv:false}
  ];
  const view=browserFixture(async()=>({ok:true,json:async()=>({kanäle:channels})}));
  await view.flush();
  assert.deepEqual(view.links(),[]);
  assert.equal(view.elements.length,0);
});

test('Nur aktivierte Social-Media-Kanäle haben sichtbare Buttons',async()=>{
  const channels=[
    {id:'whatsapp',url:'https://wa.me/4912345678',aktiv:true},
    {id:'instagram',url:'https://instagram.com/atelier',aktiv:false},
    {id:'youtube',url:'https://youtube.com/@test',aktiv:true},
    {id:'facebook',url:'http://facebook.com/unsafe',aktiv:true},
    {id:'unknown',url:'https://example.com',aktiv:true}
  ];
  const view=browserFixture(async()=>({ok:true,json:async()=>({kanäle:channels})}));
  await view.flush();
  assert.deepEqual(view.links().map(x=>x.dataset.socialChannel),['whatsapp','youtube']);
  assert.equal(view.elements.length,1);
  assert.equal(view.elements[0].id,'social-whatsapp-button');
});

test('Nach Deaktivieren im Verwaltungstab verschwinden Links und WhatsApp-Float beim Zurückwechseln',async()=>{
  let channels=[{id:'whatsapp',url:'https://wa.me/4912345678',aktiv:true}];
  const view=browserFixture(async()=>({ok:true,json:async()=>({kanäle:channels})}));
  await view.flush();
  assert.equal(view.links().length,1);
  assert.equal(view.elements.length,1);
  channels=[{id:'whatsapp',url:'https://wa.me/4912345678',aktiv:false}];
  view.windowHandlers.focus();
  await view.flush();
  assert.equal(view.links().length,0);
  assert.equal(view.elements.length,0);
});

test('Ungültige oder fehlgeschlagene Einstellungen blenden zuvor sichtbare Buttons aus',async()=>{
  let response={ok:true,json:async()=>({kanäle:[{id:'youtube',url:'https://youtube.com/@test',aktiv:true}]})};
  const view=browserFixture(async()=>response);
  await view.flush();
  assert.equal(view.links().length,1);
  response={ok:false,json:async()=>({})};
  view.documentHandlers.visibilitychange();
  await view.flush();
  assert.equal(view.links().length,0);
});

test('Verspätete Netzwerkantwort darf eine inzwischen deaktivierte Schaltfläche nicht wiederherstellen',async()=>{
  let finishOld;
  const oldResponse=new Promise(resolve=>{finishOld=resolve;});
  let count=0;
  const view=browserFixture(async()=>{
    count++;
    if(count===1)return oldResponse;
    return {ok:true,json:async()=>({kanäle:[]})};
  });
  view.windowHandlers.focus();
  await view.flush();
  assert.equal(view.links().length,0);
  finishOld({ok:true,json:async()=>({kanäle:[{id:'whatsapp',url:'https://wa.me/4912345678',aktiv:true}]})});
  await view.flush();
  assert.equal(view.links().length,0);
  assert.equal(view.elements.length,0);
});

test('WhatsApp-Teilen auf Programm- und Tagesangebotskarten folgt demselben Verwaltungsschalter',async()=>{
  let channels=[{id:'whatsapp',url:'https://wa.me/4912345678',aktiv:false}];
  const view=browserFixture(async()=>({ok:true,json:async()=>({kanäle:channels})}));
  await view.flush();

  const publicApp=fs.readFileSync(path.join(__dirname,'../site/app.js'),'utf8');
  const start=publicApp.indexOf('function whatsappTeilButton(');
  const end=publicApp.indexOf('// Tages- und Sonderangebote',start);
  assert.ok(start>0&&end>start,'WhatsApp-Teilfunktion auf Angeboten ist vorhanden');
  const createShare=new Function('document','window','whatsappTeilLink',
    publicApp.slice(start,end)+String.fromCharCode(10)+'return whatsappTeilButton;')(
    view.document,view.window,()=>'https://api.whatsapp.com/send?text=probe');

  const programShare=createShare('Klettern','Information','/#buchung');
  const specialShare=createShare('Kletteraktion','Information','/#aktionen');
  view.shareButtons.push(programShare,specialShare);
  assert.equal(programShare.hidden,true);
  assert.equal(specialShare.hidden,true);
  channels=[{id:'whatsapp',url:'https://wa.me/4912345678',aktiv:true}];
  view.windowHandlers.focus();
  await view.flush();
  assert.equal(programShare.hidden,false);
  assert.equal(specialShare.hidden,false);
  channels=[{id:'whatsapp',url:'https://wa.me/4912345678',aktiv:false}];
  view.windowHandlers.focus();
  await view.flush();
  assert.equal(programShare.hidden,true);
  assert.equal(specialShare.hidden,true);
  assert.equal(view.elements.length,0,'Auch die schwebende WhatsApp-Schaltfläche wird ausgeblendet');
});
