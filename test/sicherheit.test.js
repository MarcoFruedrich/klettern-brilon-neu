'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sameOriginMutation } = require('../lib/sicherheit');

const request = (method, origin, host='klettern.test', headers={}) => ({
  method,
  headers: { host, ...(origin ? {origin} : {}), ...headers },
  socket: { encrypted: false }
});

test('Sichere Admin-Leseanfragen benötigen keinen Origin-Header', () => {
  assert.equal(sameOriginMutation(request('GET', null)), true);
  assert.equal(sameOriginMutation(request('HEAD', null)), true);
});

test('Schreibanfragen akzeptieren nur denselben Host und dasselbe Protokoll', () => {
  assert.equal(sameOriginMutation(request('POST', 'http://klettern.test')), true);
  assert.equal(sameOriginMutation(request('PATCH', 'https://klettern.test', 'klettern.test', {'x-forwarded-proto':'https'})), true);
  assert.equal(sameOriginMutation(request('POST', 'https://evil.test')), false);
  assert.equal(sameOriginMutation(request('POST', 'https://klettern.test')), false);
  assert.equal(sameOriginMutation(request('POST', null)), false);
  assert.equal(sameOriginMutation(request('POST', 'null')), false);
});
