'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {decodeBase32,totpCode,verifyTotp}=require('../lib/totp');

const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('TOTP decodiert Base32 und entspricht dem RFC-4226-Sechsstellencode',()=>{
  assert.equal(decodeBase32(secret).toString(),'12345678901234567890');
  assert.equal(totpCode(secret,1),'287082');
});

test('TOTP akzeptiert nur den engen Zeitbereich und genau sechs Ziffern',()=>{
  assert.equal(verifyTotp(secret,'287082',59000),1);
  assert.equal(verifyTotp(secret,'287082',120000),null);
  assert.equal(verifyTotp(secret,'28708',59000),null);
});

test('TOTP-Schlüssel außerhalb Base32 oder unter 128 Bit werden abgelehnt',()=>{
  assert.throws(()=>decodeBase32('NOT-A-SECRET!'),/Base32/);
  assert.throws(()=>decodeBase32('AAAA'),/128 Bit/);
});
