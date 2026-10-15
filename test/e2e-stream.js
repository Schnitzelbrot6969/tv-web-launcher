'use strict';
// Streaming-Seiten wie auf dem TV bedienen: Cookie-Fenster, Suche (Feld per OK, Text, Enter),
// Video aus den Ergebnissen per OK oeffnen, 2x OK = Vollbild, Zurueck verlaesst Vollbild.
// Aufruf: node test/e2e-stream.js <pfad-zu-playwright> <pfad-zu-loader.js> [url ...]
const fs = require('fs');
const { chromium } = require(process.argv[2]);
const loader = fs.readFileSync(process.argv[3], 'utf8');
const { sleep, pointerPos, moveTo, findConsent } = require('./e2e-lib');

const SITES = process.argv.slice(4).length ? process.argv.slice(4) : [
  'https://www.youtube.com/',
  'https://www.srf.ch/play/tv',
  'https://www.ardmediathek.de/',
  'https://www.zdf.de/',
  'https://www.arte.tv/de/',
  'https://www.dailymotion.com/',
  'https://www.twitch.tv/',
];
const HOME = 'http://127.0.0.1:8097/fixture.html?HOME=1';
const QUERY = 'tagesschau';

const results = [];
function ok(site, name, pass, info) {
  results.push({ site, name, pass, info });
  console.log((pass ? 'OK   ' : 'FEHL ') + site + ' | ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
}

// Sichtbares Suchfeld oder Such-Knopf finden (auch im Shadow-DOM)
function findSearch(page) {
  return page.evaluate(() => {
    const all = [];
    (function walk(root) { root.querySelectorAll('*').forEach((e) => { all.push(e); if (e.shadowRoot) walk(e.shadowRoot); }); })(document);
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 12 && r.height > 12 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; };
    const onTop = (e) => { const r = e.getBoundingClientRect(); const t = window.__TVL_DBG.deepAt(r.left + r.width / 2, r.top + r.height / 2); for (let n = t; n; n = n.parentElement || (n.getRootNode && n.getRootNode().host)) if (n === e) return true; return false; };
    const lab = (e) => [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('placeholder'), e.getAttribute('name'), e.id, e.innerText].join(' ');
    const field = all.find((e) => e.tagName === 'INPUT' && /^(search|text|)$/i.test(e.type) && /such|search|query|^q$/i.test(lab(e)) && vis(e) && onTop(e));
    if (field) { const r = field.getBoundingClientRect(); return { kind: 'feld', x: r.left + Math.min(40, r.width / 2), y: r.top + r.height / 2 }; }
    const btn = all.find((e) => /^(BUTTON|A)$/.test(e.tagName) || e.getAttribute('role') === 'button' ? (/such|search/i.test(lab(e)) && (e.innerText || '').trim().length < 20 && vis(e) && onTop(e)) : false);
    if (btn) { const r = btn.getBoundingClientRect(); return { kind: 'knopf', x: r.left + r.width / 2, y: r.top + r.height / 2, label: lab(btn).trim().slice(0, 40) }; }
    return null;
  });
}

const activeIsText = (page) => page.evaluate(() => {
  let a = document.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
});

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'msedge', args: ['--disable-blink-features=AutomationControlled', '--autoplay-policy=no-user-gesture-required'] });
  for (const url of SITES) {
    const site = new URL(url).hostname.replace(/^www\./, '');
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'de-CH' });
    await ctx.addInitScript({ content: loader });
    const page = await ctx.newPage();
    try {
      await page.goto(HOME);
      await page.evaluate((u) => {
        window.name = 'tvl:' + JSON.stringify({ base: 'http://127.0.0.1:8097', home: location.href, current: 's', sites: [{ id: 's', name: 'S', url: u, nav: 'pointer' }] });
      }, url);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(7000);
      ok(site, 'Zeiger sichtbar', !!(await pointerPos(page)));

      const c = await findConsent(page);
      if (c) {
        await moveTo(page, c.x, c.y);
        await page.keyboard.press('Enter', { delay: 40 });
        await sleep(5000);
        const still = await findConsent(page);
        ok(site, 'Cookie "' + c.text + '" per OK', !still || still.text !== c.text || Math.abs(still.y - c.y) > 5, { frame: c.frame });
      }

      // Suche
      let s = await findSearch(page);
      if (s && s.kind === 'knopf') {
        await moveTo(page, s.x, s.y);
        await page.keyboard.press('Enter', { delay: 40 });
        await sleep(1500);
        if (!(await activeIsText(page))) s = await findSearch(page);
        else s = { kind: 'offen' };
      }
      if (!s || s.kind === 'knopf') { ok(site, 'Suchfeld gefunden', false, s); }
      else {
        if (s.kind === 'feld') {
          await moveTo(page, s.x, s.y);
          await page.keyboard.press('Enter', { delay: 40 });
          await sleep(800);
        }
        const focused = await activeIsText(page);
        ok(site, 'Suchfeld per OK aktiviert', focused);
        if (focused) {
          const before = page.url();
          await page.keyboard.type(QUERY, { delay: 60 });
          await page.keyboard.press('Enter', { delay: 40 });
          await sleep(5000);
          const changed = page.url() !== before || await page.evaluate((q) => document.body.innerText.toLowerCase().split(q).length > 3, QUERY);
          ok(site, 'Suche ausgefuehrt', changed, { url: page.url().slice(0, 90) });
        }
      }

      // Video aus der Seite oeffnen (bis zu 3 Klicks: Ergebnis -> Sendung -> Folge)
      const playerInfo = () => page.evaluate(() => {
        const vids = [];
        (function walk(root) { root.querySelectorAll('video').forEach((e) => vids.push(e)); root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) walk(e.shadowRoot); }); })(document);
        const vs = vids.filter((x) => x.getBoundingClientRect().width > 300)
          .concat([...document.querySelectorAll('iframe')].filter((x) => x.getBoundingClientRect().width > 300 && /player|embed/i.test(x.src)));
        if (!vs.length) return null;
        const x = vs[0], r = x.getBoundingClientRect();
        return { tag: x.tagName, cx: r.left + r.width / 2, cy: r.top + r.height / 2, playing: x.paused === undefined ? null : !x.paused };
      });
      const pickLink = (tried) => page.evaluate((tried) => {
        const d = window.__TVL_DBG;
        const VID = /watch\?v=|\/video\/|\/videos\/[A-Za-z0-9-]{5,}|\/play\/[a-z0-9-]+\/[a-z0-9-]+|\/folge|vimeo\.com\/\d+/i;
        const cand = [...document.querySelectorAll('a[href]')].filter((a) => {
          if (tried.indexOf(a.href) >= 0 || /\/suche|\/search|login|anmeld|konto|account/i.test(a.href) || !/^https?:/.test(a.href)) return false;
          const r = a.getBoundingClientRect();
          const py = r.top + Math.min(r.height / 2, 40);
          if (py < 140 || py > innerHeight - 160 || r.left < 0 || r.right > innerWidth) return false;
          if (VID.test(a.href) ? (r.width < 80 || r.height < 30) : (r.width < 150 || r.height < 60 || !a.querySelector('img, picture'))) return false;
          const t = d.deepAt(r.left + r.width / 2, py);
          for (let n = t; n; n = n.parentElement) if (n === a) return true;
          return false;
        });
        cand.sort((x, y) => (VID.test(y.href) ? 1 : 0) - (VID.test(x.href) ? 1 : 0));
        const a = cand[0];
        if (!a) return null;
        const r = a.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 40), href: a.href };
      }, tried);
      // Zuerst ab den Suchergebnissen, sonst ab der Startseite (Suchergebnisse sind je nach Seite leer)
      let v = await playerInfo();
      const tried = [];
      for (let round = 0; round < 2 && !v; round++) {
      if (round === 1) { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); await sleep(7000); v = await playerInfo(); }
      for (let hop = 0; hop < 3 && !v; hop++) {
        let vlink = null;
        for (let w = 0; w < 6 && !vlink; w++) { vlink = await pickLink(tried); if (!vlink) await sleep(1500); }
        if (!vlink) break;
        tried.push(vlink.href);
        await moveTo(page, vlink.x, vlink.y);
        await page.keyboard.press('Enter', { delay: 40 });
        await sleep(9000);
        v = await playerInfo();
        if (v) break;
        // Sendungsseite: "Abspielen"-Knopf drucken wie ein Mensch
        const play = await page.evaluate(() => {
          const all = [];
          (function walk(root) { root.querySelectorAll('button, a, [role="button"]').forEach((e) => all.push(e)); root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) walk(e.shadowRoot); }); })(document);
          const b = all.find((e) => {
            const t = ((e.innerText || '') + ' ' + (e.getAttribute('aria-label') || '')).trim();
            const r = e.getBoundingClientRect();
            return /abspielen|jetzt ansehen|ansehen|play|weiterschauen|folge \d/i.test(t) && t.length < 60 && r.width > 30 && r.top > 80 && r.bottom < innerHeight - 80;
          });
          if (!b) return null;
          const r = b.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        if (play) {
          await moveTo(page, play.x, play.y);
          await page.keyboard.press('Enter', { delay: 40 });
          await sleep(8000);
          v = await playerInfo();
        }
      }
      }
      ok(site, 'Video per OK geoeffnet (Player da)', !!v, { url: page.url().slice(0, 90), v });
      {
        if (v) {
          await moveTo(page, v.cx, Math.max(150, Math.min(v.cy, 900)));
          await page.keyboard.press('Enter', { delay: 30 }); await sleep(120);
          await page.keyboard.press('Enter', { delay: 30 });
          await sleep(1500);
          const fsInfo = await page.evaluate(() => {
            let f = document.fullscreenElement || document.querySelector('.tvl-pfs');
            if (!f) return null;
            const r = f.getBoundingClientRect();
            return f.tagName + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
          });
          ok(site, '2x OK = Vollbild', !!fsInfo && /1920x1080/.test(fsInfo), { fsInfo });
          if (v.tag === 'VIDEO' && v.playing) {
            const playing = await page.evaluate(() => { const vids = []; (function walk(root) { root.querySelectorAll('video').forEach((e) => vids.push(e)); root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) walk(e.shadowRoot); }); })(document); return vids.some((x) => !x.paused); });
            ok(site, 'Video laeuft im Vollbild weiter (keine Pause durch 2x OK)', playing);
          }
          await page.keyboard.press('Escape');
          await sleep(1200);
          const still = await page.evaluate(() => !!(document.fullscreenElement || document.querySelector('.tvl-pfs')));
          ok(site, 'Zurueck verlaesst Vollbild', !still);
        }
      }
    } catch (e) {
      ok(site, 'Seite getestet', false, String(e).slice(0, 160));
    }
    await ctx.close();
  }
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
