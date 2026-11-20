'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {bildHochladenUndZuordnen}=require('../lib/medien-zuordnung');

function scenario({uploadError=null,dbRows=1,dbError=null,cleanupError=null}={}){
  const calls=[],files=new Map();
  const publicBase='https://beispiel.supabase.co/storage/v1/object/public/angebotsbilder/';
  const bucket={
    async upload(pfad,bild,opts){
      calls.push({kind:'upload',pfad,opts});
      if(uploadError)return {error:uploadError};
      files.set(pfad,Buffer.from(bild));
      return {data:{path:pfad},error:null};
    },
    getPublicUrl(pfad){return {data:{publicUrl:publicBase+pfad}};},
    async remove(paths){
      calls.push({kind:'remove',paths});
      if(cleanupError)return {error:cleanupError};
      for(const item of paths)files.delete(item);
      return {data:paths,error:null};
    }
  };
  const db=new Map(),logger={error(...args){calls.push({kind:'log',args});}};
  const image=Buffer.from('mock image: already validated and recoded');
  const save=async url=>{
    calls.push({kind:'assign',url});
    if(dbError)throw dbError;
    if(dbRows===1)db.set('offer-11',url);
    return {rowCount:dbRows};
  };
  const run=(pfad='11/test.jpg')=>bildHochladenUndZuordnen({
    bucket,pfad,bild:image,contentType:'image/jpeg',zuordnen:save,logger
  });
  return {run,db,files,calls,publicBase};
}

test('Programm-Upload speichert die Bilddatei und bestätigt erst danach die Datenbankzuordnung',async()=>{
  const x=scenario();
  const result=await x.run();
  assert.equal(result.status,200);
  assert.equal(result.success,true);
  assert.equal(x.db.get('offer-11'),x.publicBase+'11/test.jpg');
  assert.equal(x.files.has('11/test.jpg'),true);
  assert.deepEqual(x.calls.slice(0,2).map(c=>c.kind),['upload','assign']);
  const reloaded=await Promise.resolve(x.db.get('offer-11'));
  assert.equal(reloaded,result.bild_url,
    'Nach erneutem Laden muss dieselbe dauerhaft zugeordnete Bildadresse vorhanden sein');
});

test('Sonderaktionsbilder können über denselben sicheren Ablauf hochgeladen werden',async()=>{
  const x=scenario();
  const pfad='sonderaktionen/9a2b/special.webp';
  const result=await x.run(pfad);
  assert.equal(result.status,200);
  assert.equal(result.bild_url,x.publicBase+pfad);
  assert.equal(x.files.has(pfad),true);
});

test('Ist das Bildspeichern gescheitert, wird keine DB-Adresse hinterlegt',async()=>{
  const x=scenario({uploadError:new Error('Storage-Fehler')});
  const result=await x.run();
  assert.equal(result.status,502);
  assert.equal(result.success,undefined);
  assert.equal(x.db.size,0);
  assert.equal(x.calls.some(c=>c.kind==='assign'),false);
});

test('Beim eindeutig nicht gefundenen Programm wird nur das frisch hochgeladene Bild entfernt',async()=>{
  const x=scenario({dbRows:0});
  const result=await x.run();
  assert.equal(result.status,409);
  assert.equal(result.success,undefined);
  assert.equal(x.files.size,0);
  assert.deepEqual(x.calls.map(c=>c.kind),['upload','assign','remove']);
});

test('Bei einem unklaren DB-Fehler wird niemals ein möglicherweise zugeordnetes Bild gelöscht',async()=>{
  const x=scenario({dbError:Object.assign(new Error('Connection terminated'),{code:'ECONNRESET'})});
  const result=await x.run();
  assert.equal(result.status,503);
  assert.equal(result.unklar,true);
  assert.match(result.error,/bevor du erneut hochlädst/);
  assert.equal(x.files.has('11/test.jpg'),true);
  assert.equal(x.calls.some(c=>c.kind==='remove'),false);
});

test('Schlägt das Entfernen eines nicht zugeordneten Bildes fehl, wird niemals Erfolg gemeldet',async()=>{
  const x=scenario({dbRows:0,cleanupError:new Error('storage unavailable')});
  const result=await x.run();
  assert.equal(result.status,409);
  assert.equal(result.success,undefined);
  assert.equal(x.calls.some(c=>c.kind==='log'),true);
});

test('Beide HTTP-Routen verwenden die geprüfte Upload- und Zuordnungsfunktion',()=>{
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const program=server.slice(server.indexOf('const bildRoute = route.match('),
    server.indexOf('const aktionMedienBildRoute='));
  const special=server.slice(server.indexOf('const aktionsBildRoute = route.match('),
    server.indexOf("return reply(res,404,{error:'Nicht gefunden.'})",server.indexOf('const aktionsBildRoute = route.match(')));
  for(const section of [program,special]){
    assert.match(section,/bildHochladenUndZuordnen\(\{/);
    assert.match(section,/zuordnen:url=>pool\.query\(/);
  }
  assert.match(server,/SELECT id,name,beschreibung,dauer,preise,bild_url,kategorie,zielgruppe/,
    'Die öffentliche Programm-API muss das gespeicherte Bild zurückgeben');
});
