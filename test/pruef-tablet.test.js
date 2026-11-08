'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {encryptCode,decryptCode,pairingHash,createTabletService}=require('../lib/pruef-tablet');
const crypto=require('node:crypto');
test('Tablet codes encrypted at rest with authenticated AES-GCM and random IV',()=>{
  const secret=crypto.randomBytes(32).toString('hex');
  const a=encryptCode('000013',secret),b=encryptCode('000013',secret);
  assert.notEqual(a,b,'Identical codes use independent encryption nonces');
  assert.ok(!a.includes('000013'));
  assert.equal(decryptCode(a,secret),'000013');
  assert.throws(()=>decryptCode(a,crypto.randomBytes(32).toString('hex')));
  const parts=a.split('.');
  parts[2]=Buffer.from('tampered').toString('hex');
  assert.throws(()=>decryptCode(parts.join('.'),secret),'Authenticated ciphertext rejects tampering');
});
test('Kopplungscodes HMAC-protected, secret-dependent and strictly 8 digits',()=>{
  const key=crypto.randomBytes(32).toString('hex');
  assert.match(pairingHash('00001234',key),/^[a-f0-9]{64}$/);
  assert.notEqual(pairingHash('00001234',key),pairingHash('00001235',key));
  assert.notEqual(pairingHash('00001234',key),pairingHash('00001234',crypto.randomBytes(32).toString('hex')));
  assert.throws(()=>pairingHash('1234',key));
  assert.throws(()=>encryptCode('foo',key));
});

test('Tablet-Standort steuert alle veröffentlichten Werbeprogramme serverseitig',async()=>{
  const queries=[];
  const pool={query:async(sql,args=[])=>{
    queries.push({sql,args});
    if(sql.includes('SELECT id FROM brilon_orte'))return {rowCount:1,rows:[{id:2}]};
    if(sql.includes('UPDATE brilon_pruef_tablets SET ort_id'))return {rowCount:1,rows:[{id:'tablet-1',ort_id:2}]};
    if(sql.includes('JOIN brilon_angebote'))return {rowCount:1,rows:[{name:'Klettern in Brilon'}]};
    throw Error('Unerwartete Abfrage: '+sql);
  }};
  const service=createTabletService({pool});
  assert.deepEqual(await service.chooseSite('tablet-1',2),{id:'tablet-1',ort_id:2});
  const offers=await service.siteOffers('tablet-1');
  assert.deepEqual(offers,[{name:'Klettern in Brilon'}]);
  const query=queries.find(q=>q.sql.includes('JOIN brilon_angebote'));
  assert.deepEqual(query.args,['tablet-1']);
  for(const expression of ['JOIN brilon_orte o ON o.id=t.ort_id AND o.aktiv=true',
    "a.veranstaltungsorte ? o.name",'a.archiviert=false','a.aktiv=true',
    'a.veroeffentlicht=true','a.buchbar=true','t.aktiv=true']){
    assert.ok(query.sql.includes(expression),'Standort-Werbebedingung fehlt: '+expression);
  }
});
test('Deaktivierter Werbestandort kann zurückgesetzt, aber nicht willkürlich zugewiesen werden',async()=>{
  const queries=[];
  const pool={query:async(sql,args=[])=>{
    queries.push({sql,args});
    if(sql.includes('SELECT id FROM brilon_orte'))return {rowCount:0,rows:[]};
    if(sql.includes('UPDATE brilon_pruef_tablets SET ort_id'))
      return {rowCount:1,rows:[{id:'tablet-1',ort_id:args[1]}]};
    throw Error('Unerwartete Abfrage');
  }};
  const service=createTabletService({pool});
  assert.equal(await service.chooseSite('tablet-1',999),null);
  assert.equal(queries.some(q=>q.sql.includes('UPDATE brilon_pruef_tablets')),false);
  assert.deepEqual(await service.chooseSite('tablet-1',null),{id:'tablet-1',ort_id:null});
});
