'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buchungsnummer}=require('../lib/buchungsnummer');
test('Nachname, Vorname und Veranstaltungstag',()=>assert.equal(buchungsnummer('Max Müller','2026-11-15'),'MUELLER-MAX-151126'));
test('Doppelte Namen erhalten Suffix',()=>assert.equal(buchungsnummer('Max Müller','2026-11-15',2),'MUELLER-MAX-151126-02'));
test('Ungültiges Datum wird abgelehnt',()=>assert.throws(()=>buchungsnummer('Max Müller','2026-02-30')));
test('Fehlender Nachname wird abgelehnt',()=>assert.throws(()=>buchungsnummer('Max','2026-11-15')));
