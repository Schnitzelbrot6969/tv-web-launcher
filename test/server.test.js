'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { iconCandidatesFromHtml, normalizeSite } = require('../src/server.js');

test('normalizeSite ergaenzt https, Standardwerte und begrenzt Zoom', () => {
  const s = normalizeSite({ name: ' Test ', url: 'example.org', zoom: '999', userAgent: 'x', nav: 'native' });
  assert.strictEqual(s.name, 'Test');
  assert.strictEqual(s.url, 'https://example.org/');
  assert.strictEqual(s.zoom, 300);
  assert.strictEqual(s.userAgent, 'default');
  assert.strictEqual(s.nav, 'native');
  assert.match(s.id, /^[a-f0-9]{12}$/);
});

test('normalizeSite behaelt id und Felder beim Bearbeiten', () => {
  const before = normalizeSite({ name: 'A', url: 'https://a.ch', css: 'x{}' });
  const after = normalizeSite({ zoom: 150 }, before);
  assert.strictEqual(after.id, before.id);
  assert.strictEqual(after.css, 'x{}');
  assert.strictEqual(after.zoom, 150);
});

test('iconCandidatesFromHtml bevorzugt grosse Icons und loest relative Pfade auf', () => {
  const html = '<link rel="icon" href="/fav.ico"><link rel="apple-touch-icon" sizes="180x180" href="img/apple.png"><link rel="mask-icon" href="/m.svg">';
  const list = iconCandidatesFromHtml(html, 'https://www.srf.ch/news/');
  assert.deepStrictEqual(list, ['https://www.srf.ch/news/img/apple.png', 'https://www.srf.ch/fav.ico']);
});
