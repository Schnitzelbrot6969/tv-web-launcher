'use strict';
// TV-Web-Launcher – kleiner HTTP-Dienst ohne externe Abhaengigkeiten (Node >= 20).
// Liefert Admin-Oberflaeche, TV-Kachelseite, tv.js und die JSON-API aus.

const http = require('http');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8095', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SITES_FILE = path.join(DATA_DIR, 'sites.json');
const ICON_DIR = path.join(DATA_DIR, 'icons');
const EXAMPLE_FILE = path.join(__dirname, '..', 'sites.example.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

// ---------- Datenhaltung ----------

let sites = [];
let writeQueue = Promise.resolve();

function normalizeUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    return new URL(u).toString();
  } catch (e) {
    throw httpError(400, 'Ungueltige URL: ' + u);
  }
}

function normalizeSite(input, existing) {
  const s = Object.assign({}, existing || {});
  if (input.name !== undefined) s.name = String(input.name).trim().slice(0, 80);
  if (input.url !== undefined) s.url = normalizeUrl(input.url);
  if (input.icon !== undefined) s.icon = String(input.icon || '').trim();
  if (input.zoom !== undefined) {
    const z = parseInt(input.zoom, 10);
    s.zoom = Number.isFinite(z) ? Math.min(300, Math.max(50, z)) : 100;
  }
  if (input.css !== undefined) s.css = String(input.css || '');
  if (input.js !== undefined) s.js = String(input.js || '');
  if (input.userAgent !== undefined) {
    s.userAgent = ['default', 'desktop', 'tv'].includes(input.userAgent) ? input.userAgent : 'default';
  }
  if (input.nav !== undefined) s.nav = input.nav === 'native' ? 'native' : 'spatial';
  if (!s.id) s.id = crypto.randomBytes(6).toString('hex');
  if (s.nav === undefined) s.nav = 'spatial';
  if (s.zoom === undefined) s.zoom = 100;
  if (s.css === undefined) s.css = '';
  if (s.js === undefined) s.js = '';
  if (s.icon === undefined) s.icon = '';
  if (s.userAgent === undefined) s.userAgent = 'default';
  return s;
}

async function loadSites() {
  await fsp.mkdir(ICON_DIR, { recursive: true });
  try {
    const parsed = JSON.parse(await fsp.readFile(SITES_FILE, 'utf8'));
    sites = (Array.isArray(parsed) ? parsed : parsed.sites || []).map((s) => normalizeSite(s, s));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    // Erster Start: Beispiel-Liste uebernehmen, Icons im Hintergrund holen
    try {
      const ex = JSON.parse(await fsp.readFile(EXAMPLE_FILE, 'utf8'));
      sites = (ex.sites || ex).map((s) => normalizeSite(s));
    } catch (e2) {
      sites = [];
    }
    await saveSites();
    (async () => {
      for (const s of sites) if (!s.icon) s.icon = await resolveIcon(s);
      await saveSites();
    })().catch((err) => console.error('Icon-Abruf:', err.message));
  }
}

function saveSites() {
  // Schreibvorgaenge serialisieren, atomar per rename
  writeQueue = writeQueue.then(async () => {
    const tmp = SITES_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify({ version: 1, sites }, null, 2));
    await fsp.rename(tmp, SITES_FILE);
  });
  return writeQueue;
}

// ---------- Favicon holen ----------

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 8000);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
    });
  } finally {
    clearTimeout(t);
  }
}

function iconCandidatesFromHtml(html, baseUrl) {
  const out = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const rel = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(tag) || [])[1] || '';
    const href = (/\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag) || [])[1];
    if (!href || !/icon/i.test(rel) || /mask-icon/i.test(rel)) continue;
    const sizes = (/\bsizes\s*=\s*["']?([^"'>]+)/i.exec(tag) || [])[1] || '';
    const size = parseInt(sizes, 10) || (/apple-touch/i.test(rel) ? 180 : 16);
    try {
      out.push({ url: new URL(href.replace(/&amp;/g, '&'), baseUrl).toString(), size });
    } catch (e) { /* ignorieren */ }
  }
  out.sort((a, b) => b.size - a.size);
  return out.map((i) => i.url);
}

async function downloadIcon(id, url) {
  const res = await fetchWithTimeout(url, 8000);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 64 || buf.length > 3 * 1024 * 1024) throw new Error('Icon-Groesse unplausibel');
  if (!/^image\//.test(type) && !/\.(png|ico|svg|jpe?g|webp|gif)(\?|$)/i.test(url)) throw new Error('Kein Bild: ' + type);
  let ext = { 'image/png': '.png', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico', 'image/svg+xml': '.svg', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[type];
  if (!ext) ext = (path.extname(new URL(url).pathname) || '.png').toLowerCase();
  const file = id + ext;
  for (const f of await fsp.readdir(ICON_DIR)) if (f.startsWith(id + '.')) await fsp.unlink(path.join(ICON_DIR, f)).catch(() => {});
  await fsp.writeFile(path.join(ICON_DIR, file), buf);
  return '/icons/' + file + '?v=' + Date.now().toString(36);
}

async function resolveIcon(site) {
  // 1. explizite Icon-URL, 2. Icons aus dem HTML, 3. /favicon.ico, 4. Google-Favicon-Dienst
  const tries = [];
  if (site.icon && /^https?:\/\//i.test(site.icon)) tries.push(site.icon);
  try {
    const res = await fetchWithTimeout(site.url, 8000);
    const html = (await res.text()).slice(0, 400000);
    tries.push(...iconCandidatesFromHtml(html, res.url || site.url));
  } catch (e) { /* Seite nicht erreichbar */ }
  try { tries.push(new URL('/favicon.ico', site.url).toString()); } catch (e) { /* */ }
  try { tries.push('https://www.google.com/s2/favicons?sz=128&domain=' + new URL(site.url).hostname); } catch (e) { /* */ }
  for (const u of tries) {
    try {
      return await downloadIcon(site.id, u);
    } catch (e) { /* naechster Kandidat */ }
  }
  return '';
}

// ---------- HTTP-Hilfen ----------

function httpError(status, msg) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'Cache-Control': 'no-store' }, headers || {}));
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': MIME['.json'], 'Access-Control-Allow-Origin': '*' });
}

async function readBody(req, limit) {
  limit = limit || 2 * 1024 * 1024;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw httpError(413, 'Anfrage zu gross');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw httpError(400, 'Ungueltiges JSON');
  }
}

function isAuthorized(req) {
  if (!ADMIN_PASSWORD) return true; // ohne Passwort ungeschuetzt (nur fuer lokale Tests)
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  const a = crypto.createHash('sha256').update(decoded.slice(0, i) + '\0' + decoded.slice(i + 1)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_USER + '\0' + ADMIN_PASSWORD).digest();
  return i >= 0 && crypto.timingSafeEqual(a, b);
}

function requireAuth(req, res) {
  if (isAuthorized(req)) return true;
  send(res, 401, 'Anmeldung erforderlich', {
    'WWW-Authenticate': 'Basic realm="TV-Web-Launcher Admin", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  return false;
}

async function serveFile(res, file, extraHeaders) {
  try {
    const data = await fsp.readFile(file);
    send(res, 200, data, Object.assign({ 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' }, extraHeaders || {}));
  } catch (e) {
    send(res, 404, 'Nicht gefunden', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

function publicSites() {
  return sites.map((s) => ({ id: s.id, name: s.name, url: s.url, icon: s.icon, zoom: s.zoom, css: s.css, js: s.js, userAgent: s.userAgent, nav: s.nav }));
}

// ---------- Routing ----------

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const m = req.method;

  if (m === 'OPTIONS') {
    return send(res, 204, '', { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': '*' });
  }

  // --- oeffentlich (TV) ---
  if (m === 'GET' && p === '/') return send(res, 302, '', { Location: '/tv' });
  if (m === 'GET' && (p === '/tv' || p === '/tv/')) return serveFile(res, path.join(PUBLIC_DIR, 'tv.html'));
  if (m === 'GET' && p === '/tv.js') return serveFile(res, path.join(PUBLIC_DIR, 'tv.js'), { 'Access-Control-Allow-Origin': '*' });
  if (m === 'GET' && p === '/api/sites') return sendJson(res, 200, { sites: publicSites() });
  if (m === 'GET' && p === '/health') return sendJson(res, 200, { ok: true, sites: sites.length });
  if (m === 'GET' && p.startsWith('/icons/')) {
    return serveFile(res, path.join(ICON_DIR, path.basename(p)), { 'Cache-Control': 'max-age=86400', 'Access-Control-Allow-Origin': '*' });
  }

  // --- Admin (Passwort) ---
  if (p === '/admin' || p === '/admin/' || p.startsWith('/api/admin/')) {
    if (!requireAuth(req, res)) return;
  }
  if (m === 'GET' && (p === '/admin' || p === '/admin/')) return serveFile(res, path.join(PUBLIC_DIR, 'admin.html'));

  if (p === '/api/admin/sites' && m === 'GET') return sendJson(res, 200, { sites });

  if (p === '/api/admin/sites' && m === 'POST') {
    const body = await readBody(req);
    if (!body.name || !body.url) throw httpError(400, 'Name und URL sind Pflicht');
    const site = normalizeSite(body);
    site.icon = await resolveIcon(site);
    sites.push(site);
    await saveSites();
    return sendJson(res, 201, { site });
  }

  let mm = /^\/api\/admin\/sites\/([a-f0-9]+)$/.exec(p);
  if (mm && m === 'PUT') {
    const idx = sites.findIndex((s) => s.id === mm[1]);
    if (idx < 0) throw httpError(404, 'Eintrag nicht gefunden');
    const body = await readBody(req);
    const before = sites[idx];
    const site = normalizeSite(body, before);
    const newIconUrl = body.icon !== undefined && body.icon !== before.icon && /^https?:/i.test(site.icon);
    const urlChangedWithoutIcon = site.url !== before.url && !body.icon;
    if (!site.icon || newIconUrl || urlChangedWithoutIcon) site.icon = await resolveIcon(urlChangedWithoutIcon ? Object.assign({}, site, { icon: '' }) : site);
    sites[sites.indexOf(before)] = site;
    await saveSites();
    return sendJson(res, 200, { site });
  }
  if (mm && m === 'DELETE') {
    const idx = sites.findIndex((s) => s.id === mm[1]);
    if (idx < 0) throw httpError(404, 'Eintrag nicht gefunden');
    const [gone] = sites.splice(idx, 1);
    for (const f of await fsp.readdir(ICON_DIR)) if (f.startsWith(gone.id + '.')) await fsp.unlink(path.join(ICON_DIR, f)).catch(() => {});
    await saveSites();
    return sendJson(res, 200, { ok: true });
  }

  mm = /^\/api\/admin\/sites\/([a-f0-9]+)\/refresh-icon$/.exec(p);
  if (mm && m === 'POST') {
    const site = sites.find((s) => s.id === mm[1]);
    if (!site) throw httpError(404, 'Eintrag nicht gefunden');
    site.icon = await resolveIcon(Object.assign({}, site, { icon: '' }));
    await saveSites();
    return sendJson(res, 200, { site });
  }

  if (p === '/api/admin/order' && m === 'POST') {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const byId = new Map(sites.map((s) => [s.id, s]));
    const reordered = ids.map((id) => byId.get(id)).filter(Boolean);
    sites.forEach((s) => { if (!reordered.includes(s)) reordered.push(s); });
    sites = reordered;
    await saveSites();
    return sendJson(res, 200, { sites });
  }

  if (p === '/api/admin/export' && m === 'GET') {
    return send(res, 200, JSON.stringify({ version: 1, exported: new Date().toISOString(), sites }, null, 2), {
      'Content-Type': MIME['.json'],
      'Content-Disposition': 'attachment; filename="tv-launcher-sites.json"',
    });
  }

  if (p === '/api/admin/import' && m === 'POST') {
    const body = await readBody(req);
    const list = Array.isArray(body) ? body : body.sites;
    if (!Array.isArray(list)) throw httpError(400, 'Datei enthaelt keine Liste "sites"');
    const append = url.searchParams.get('mode') === 'append';
    const known = new Set(sites.map((s) => s.id));
    const imported = list
      .filter((s) => s && s.url && s.name)
      .map((s) => normalizeSite(Object.assign({}, s, { icon: /^https?:/i.test(s.icon || '') ? s.icon : '' }), { id: append && known.has(s.id) ? undefined : s.id }));
    sites = append ? sites.concat(imported) : imported;
    await saveSites();
    // Icons im Hintergrund neu holen (lokale Icon-Dateien gehoeren evtl. zu anderer Instanz)
    (async () => {
      for (const s of imported) s.icon = await resolveIcon(s);
      await saveSites();
    })().catch((err) => console.error('Icon-Abruf:', err.message));
    return sendJson(res, 200, { sites });
  }

  send(res, 404, 'Nicht gefunden', { 'Content-Type': 'text/plain; charset=utf-8' });
}

async function main() {
  await loadSites();
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      if (!res.headersSent) sendJson(res, status, { error: e.message });
      else res.end();
    });
  });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`TV-Web-Launcher laeuft auf Port ${PORT} (Daten: ${DATA_DIR}, Admin-Passwort ${ADMIN_PASSWORD ? 'gesetzt' : 'NICHT gesetzt'})`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { iconCandidatesFromHtml, normalizeSite };
