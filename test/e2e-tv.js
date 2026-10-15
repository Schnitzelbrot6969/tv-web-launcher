'use strict';
// End-to-End-Test wie auf dem TV: echter Chromium (1920x1080), loader.js wird wie bei TizenBrew
// in jede Seite injiziert, Tasten werden als echte Tastendruecke gesendet.
// Aufruf: node test/e2e-tv.js <pfad-zu-playwright> <pfad-zu-loader.js>
const fs = require('fs');
const { chromium } = require(process.argv[2]);
const loader = fs.readFileSync(process.argv[3], 'utf8');

const HOME = 'http://127.0.0.1:8097/fixture.html?HOME=1';
const cfg = { base: 'http://127.0.0.1:8097', home: HOME, current: 'srf', sites: [
  { id: 'srf', name: 'SRF', url: 'https://www.srf.ch/news', zoom: 125, nav: 'pointer', css: '', js: '' },
  { id: 'w3', name: 'W3', url: 'https://www.w3schools.com/html/html5_video.asp', zoom: 125, nav: 'pointer', css: '', js: '' },
  { id: 'fx', name: 'FX', url: 'http://127.0.0.1:8097/fixture.html', zoom: 150, nav: 'pointer', css: '', js: '' },
] };

const results = [];
function ok(name, pass, info) { results.push({ name, pass, info }); console.log((pass ? 'OK   ' : 'FEHL ') + name + (info ? '  ' + JSON.stringify(info) : '')); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pointerPos(page) {
  return page.evaluate(() => {
    const c = document.getElementById('tvl-cursor');
    if (!c) return null;
    const m = c.style.transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
    return m ? [+m[1] + 6, +m[2] + 3] : null;
  });
}

// Zeiger mit Tipp-Druecken zu einem Ziel fahren (wie ein Mensch mit der Fernbedienung)
async function moveTo(page, tx, ty) {
  for (let i = 0; i < 80; i++) {
    const p = await pointerPos(page);
    if (!p) return false;
    const dx = tx - p[0], dy = ty - p[1];
    if (Math.abs(dx) < 27 && Math.abs(dy) < 27) return true; // ein Tipp = 52 px
    const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : (dy > 0 ? 'ArrowDown' : 'ArrowUp');
    await page.keyboard.press(key, { delay: 40 });
    await sleep(140);
  }
  return false;
}

// Fein anfahren: einzelne Tipps mit Pause > 400 ms (Schritt bleibt klein)
async function moveToFine(page, tx, ty) {
  await moveTo(page, tx, ty);
  for (let i = 0; i < 30; i++) {
    const p = await pointerPos(page);
    const dx = tx - p[0], dy = ty - p[1];
    if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8) return true;
    const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : (dy > 0 ? 'ArrowDown' : 'ArrowUp');
    await page.keyboard.press(key, { delay: 30 });
    await sleep(450);
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'msedge', args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'de-CH' });
  await ctx.addInitScript({ content: loader });
  const page = await ctx.newPage();

  // Startseite (wie Kachelseite) setzt window.name
  await page.goto(HOME);
  await page.evaluate((c) => { window.name = 'tvl:' + JSON.stringify(c); }, cfg);

  // ---------- Zoom 150 %: sichtbarer Zeiger = Klickpunkt; doppeltes OK-Signal der Smart Remote = ein Klick ----------
  await page.evaluate((c) => { c.current = 'fx'; window.name = 'tvl:' + JSON.stringify(c); }, cfg);
  await page.goto('http://127.0.0.1:8097/fixture.html', { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  const cb = await page.evaluate(() => { const r = document.getElementById('cnt').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await moveToFine(page, cb.x, cb.y);
  await sleep(250);
  const vis = await page.evaluate(() => {
    const c = document.getElementById('tvl-cursor').getBoundingClientRect();
    const tip = [c.left + 6, c.top + 3];
    const e = window.__TVL_DBG.findClickable(window.__TVL_DBG.ptr.x, window.__TVL_DBG.ptr.y);
    return { tip: tip.map(Math.round), ptr: [Math.round(window.__TVL_DBG.ptr.x), Math.round(window.__TVL_DBG.ptr.y)], ziel: e && e.id };
  });
  ok('Zoom 150 %: sichtbare Zeigerspitze = Klickpunkt', Math.abs(vis.tip[0] - vis.ptr[0]) < 3 && Math.abs(vis.tip[1] - vis.ptr[1]) < 3 && vis.ziel === 'cnt', vis);
  await page.keyboard.down('Enter'); await sleep(200);
  await page.keyboard.down('Enter'); await sleep(60);
  await page.keyboard.up('Enter');
  await sleep(400);
  const n = await page.evaluate(() => document.getElementById('cnt').dataset.n);
  ok('OK mit doppeltem Signal = genau ein Klick', n === '1', { klicks: n });
  // Eng stehende Links (16 px Zeilenabstand) gezielt treffen
  let tightOk = 0;
  for (const i of [3, 4, 8]) {
    const r = await page.evaluate((i) => { const b = document.getElementById('t' + i).getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; }, i);
    await moveToFine(page, r.x, r.y);
    await sleep(250);
    const hit = await page.evaluate(() => { const e = window.__TVL_DBG.findClickable(window.__TVL_DBG.ptr.x, window.__TVL_DBG.ptr.y); return e && e.id; });
    await page.keyboard.press('Enter', { delay: 40 });
    await sleep(300);
    const title = await page.title();
    if (hit === 't' + i && title === 'tight-' + i) tightOk++;
    else console.log('   eng', i, hit, title);
  }
  ok('Eng stehende Links (16 px) einzeln treffbar', tightOk === 3, { getroffen: tightOk + '/3' });
  await page.evaluate((c) => { c.current = 'srf'; window.name = 'tvl:' + JSON.stringify(c); }, cfg);

  // ---------- SRF: Cookie-Fenster im Shadow-DOM ----------
  await page.goto('https://www.srf.ch/news', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  ok('Zeiger sichtbar auf SRF', !!(await pointerPos(page)));
  // Cookie-Fenster erscheint verzoegert
  for (let i = 0; i < 20; i++) {
    const has = await page.evaluate(() => { const h = document.getElementById('usercentrics-cmp-ui'); return !!(h && h.shadowRoot && [...h.shadowRoot.querySelectorAll('button')].some((x) => /alle akzeptieren/i.test(x.innerText) && x.getBoundingClientRect().width > 0)); });
    if (has) break;
    await sleep(750);
  }
  const btn = await page.evaluate(() => {
    const host = document.getElementById('usercentrics-cmp-ui');
    if (!host || !host.shadowRoot) return null;
    const b = [...host.shadowRoot.querySelectorAll('button')].find((x) => /alle akzeptieren/i.test(x.innerText));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  });
  ok('SRF Cookie-Knopf gefunden', !!btn, btn);
  if (btn) {
    // absichtlich knapp an den oberen Rand des Knopfes zielen (wie auf dem Foto)
    await moveTo(page, btn.x + btn.w / 2 - 10, btn.y - btn.h / 2 + 2);
    await sleep(200);
    const outlined = await page.evaluate(() => {
      const host = document.getElementById('usercentrics-cmp-ui');
      const b = [...host.shadowRoot.querySelectorAll('button')].find((x) => /alle akzeptieren/i.test(x.innerText));
      return b.style.outline;
    });
    ok('Gelbe Umrandung auf "Alle akzeptieren" (nicht auf dem Fenster)', /255, 196, 0/.test(outlined), { outlined });
    await page.keyboard.press('Enter', { delay: 40 });
    await sleep(1500);
    const gone = await page.evaluate(() => {
      const host = document.getElementById('usercentrics-cmp-ui');
      if (!host || !host.shadowRoot) return true;
      const b = [...host.shadowRoot.querySelectorAll('button')].find((x) => /alle akzeptieren/i.test(x.innerText));
      return !b || b.getBoundingClientRect().width === 0;
    });
    ok('Cookie-Fenster nach OK geschlossen', gone);
  }

  // ---------- Fluessiges Halten ----------
  const p0 = await pointerPos(page);
  await page.keyboard.down('ArrowDown');
  const samples = [];
  for (let i = 0; i < 8; i++) { await sleep(60); samples.push((await pointerPos(page))[1]); }
  await page.keyboard.up('ArrowDown');
  const steps = samples.map((v, i) => v - (i ? samples[i - 1] : p0[1]));
  ok('Halten bewegt fluessig (jedes 60ms-Intervall > 0)', steps.slice(3).every((s) => s > 0 || samples[samples.length - 1] >= 1070), { steps, p0, last: samples[samples.length - 1], url: page.url().slice(0, 60) });

  // ---------- Link klicken, Zurueck, 3x Zurueck ----------
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  const link = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/news/"]')].find((x) => { const r = x.getBoundingClientRect(); return r.width > 80 && r.height > 15 && r.top > 250 && r.top < 900; });
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { x: r.left + Math.min(40, r.width / 2), y: r.top + r.height / 2, href: a.href };
  });
  ok('Nachrichten-Link gefunden', !!link, link && link.href);
  if (link) {
    const before = page.url();
    await moveTo(page, link.x, link.y);
    await sleep(200);
    await page.keyboard.press('Enter', { delay: 40 });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await sleep(2500);
    ok('Link per OK geoeffnet', page.url() !== before, { url: page.url() });
    // Zurueck kommt in TizenBrew als Escape
    await page.keyboard.press('Escape');
    await sleep(2500);
    ok('Zurueck (Escape) fuehrt zur vorherigen Seite', /srf\.ch\/news\/?$/.test(page.url()) || page.url() === before, { url: page.url() });
    await page.keyboard.press('Escape'); await sleep(120);
    await page.keyboard.press('Escape'); await sleep(120);
    await page.keyboard.press('Escape');
    await sleep(3000);
    ok('3x Zurueck fuehrt zur Kachelseite', page.url().indexOf('HOME=1') >= 0, { url: page.url() });
  }

  // ---------- Video: 2x OK = Vollbild ----------
  await page.evaluate((c) => { c.current = 'w3'; window.name = 'tvl:' + JSON.stringify(c); }, cfg);
  await page.goto('https://www.w3schools.com/html/html5_video.asp', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  const vid = await page.evaluate(() => {
    const v = [...document.querySelectorAll('video')].find((x) => x.getBoundingClientRect().width > 200);
    if (!v) return null;
    v.scrollIntoView({ block: 'center' });
    return true;
  });
  ok('Video gefunden', !!vid);
  if (vid) {
    await sleep(600);
    const v2 = await page.evaluate(() => { const v = [...document.querySelectorAll('video')].find((x) => x.getBoundingClientRect().width > 200); const r = v.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await moveTo(page, v2.x, v2.y);
    await page.keyboard.press('Enter', { delay: 30 }); await sleep(120);
    await page.keyboard.press('Enter', { delay: 30 });
    await sleep(1200);
    const fs1 = await page.evaluate(() => { let f = document.fullscreenElement; let how = 'echt'; if (!f) { f = document.querySelector('.tvl-pfs'); how = 'ersatz'; } if (!f) return null; const r = f.getBoundingClientRect(); return f.tagName + ' ' + getComputedStyle(f).objectFit + ' ' + how + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); });
    ok('2x OK auf Video = Vollbild (Video, object-fit contain)', !!fs1 && /VIDEO contain .* 1920x1080/.test(fs1), { fs1 });
    await page.keyboard.press('Escape');
    await sleep(800);
    const fs2 = await page.evaluate(() => !!(document.fullscreenElement || document.querySelector('.tvl-pfs')));
    ok('Zurueck verlaesst das Vollbild', !fs2);
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
