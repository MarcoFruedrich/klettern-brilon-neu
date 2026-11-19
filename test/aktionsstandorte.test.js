'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { aktionsstandorte, aktionAmStandortFreigegeben } = require('../lib/aktionsstandorte');

test('Unzugeordnete Sonderangebote sind an keinem Standort buchbar', () => {
  assert.deepEqual(aktionsstandorte({ titel: 'Ältere Aktion' }), []);
  assert.equal(aktionAmStandortFreigegeben({ titel: 'Ältere Aktion' }, 'Olpe'), false);
});

test('Einzel- und Mehrfachzuordnungen beschränken Sonderangebote auf gewählte Standorte', () => {
  const multi = { veranstaltungsorte: ['Brilon', 'Olpe'], veranstaltungsort: 'Brilon' };
  assert.deepEqual(aktionsstandorte(multi), ['Brilon', 'Olpe']);
  assert.equal(aktionAmStandortFreigegeben(multi, 'Olpe'), true);
  assert.equal(aktionAmStandortFreigegeben(multi, 'Rüthen'), false);
  assert.equal(aktionAmStandortFreigegeben({ veranstaltungsort: 'Sundern' }, 'Sundern'), true);
});
