'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {encryptCode,decryptCode,pairingHash}=require('../lib/pruef-tablet');
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
