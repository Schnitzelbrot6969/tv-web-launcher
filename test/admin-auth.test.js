'use strict';
// Anmeldung am Admin: Passwort, gemerkter Browser (Cookie), Einmal-Link, CSRF-Schutz.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = 'http://127.0.0.1:' + PORT;
const AUTH = 'Basic ' + Buffer.from('admin:testpw').toString('base64');
let srv, dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvl-auth-'));
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dataDir, ADMIN_PASSWORD: 'testpw' }),
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/health'); return; } catch (e) { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('Server startet nicht');
});

test.after(() => {
  srv.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const cookieOf = (r) => ((r.headers.get('set-cookie') || '').match(/tvl_dev=([^;]+)/) || [])[1];

test('ohne Anmeldung und mit falschem Passwort gesperrt', async () => {
  assert.strictEqual((await fetch(BASE + '/admin')).status, 401);
  const bad = 'Basic ' + Buffer.from('admin:falsch').toString('base64');
  assert.strictEqual((await fetch(BASE + '/admin', { headers: { Authorization: bad } })).status, 401);
});

test('Passwort-Login merkt den Browser, Cookie reicht danach', async () => {
  const r = await fetch(BASE + '/admin', { headers: { Authorization: AUTH } });
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const tok = cookieOf(r);
  assert.ok(tok && tok.length === 43);
  assert.strictEqual((await fetch(BASE + '/api/admin/sites', { headers: { Cookie: 'tvl_dev=' + tok } })).status, 200);
  assert.strictEqual((await fetch(BASE + '/api/admin/sites', { headers: { Cookie: 'tvl_dev=' + 'A'.repeat(43) } })).status, 401);
  // Auf dem NAS liegt nur der Hash
  await new Promise((res) => setTimeout(res, 200));
  const file = fs.readFileSync(path.join(dataDir, 'devices.json'), 'utf8');
  assert.ok(!file.includes(tok));
});

test('aendernde Aufrufe von fremder Herkunft werden abgelehnt', async () => {
  const body = JSON.stringify({ name: 'x', url: 'https://x.ch' });
  const h = { Authorization: AUTH, 'Content-Type': 'application/json' };
  const evil = await fetch(BASE + '/api/admin/sites', { method: 'POST', body, headers: Object.assign({ Origin: 'http://evil.example' }, h) });
  assert.strictEqual(evil.status, 403);
  const own = await fetch(BASE + '/api/admin/sites', { method: 'POST', body, headers: Object.assign({ Origin: BASE }, h) });
  assert.strictEqual(own.status, 201);
});

test('Einmal-Link: nur mit Anmeldung erzeugbar, genau einmal einloesbar, Entfernen sperrt', async () => {
  assert.strictEqual((await fetch(BASE + '/api/admin/devices/enroll', { method: 'POST' })).status, 401);
  const { url } = await (await fetch(BASE + '/api/admin/devices/enroll', { method: 'POST', headers: { Authorization: AUTH } })).json();
  const r1 = await fetch(BASE + url, { redirect: 'manual' });
  assert.strictEqual(r1.status, 302);
  const tok = cookieOf(r1);
  assert.ok(tok);
  assert.strictEqual((await fetch(BASE + url, { redirect: 'manual' })).status, 403);
  const list = await (await fetch(BASE + '/api/admin/devices', { headers: { Cookie: 'tvl_dev=' + tok } })).json();
  const me = list.devices.find((d) => d.current);
  assert.ok(me && !('hash' in me));
  const del = await fetch(BASE + '/api/admin/devices/' + me.id, { method: 'DELETE', headers: { Cookie: 'tvl_dev=' + tok } });
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await fetch(BASE + '/api/admin/sites', { headers: { Cookie: 'tvl_dev=' + tok } })).status, 401);
});

test('TV-Kacheln bleiben ohne Anmeldung erreichbar', async () => {
  assert.strictEqual((await fetch(BASE + '/api/sites')).status, 200);
});
