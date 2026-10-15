'use strict';
// Prueft die Zeiger-Bedienung auf vielen echten Webseiten wie auf dem TV:
// Cookie-Fenster wegklicken, Erkennung der Bedienelemente, Link per OK oeffnen, Zurueck.
// Aufruf: node test/e2e-sites.js <pfad-zu-playwright> <pfad-zu-loader.js> [url ...]
const fs = require('fs');
const { chromium } = require(process.argv[2]);
const loader = fs.readFileSync(process.argv[3], 'utf8');
const { sleep, pointerPos, moveTo, findConsent } = require('./e2e-lib');

const SITES = process.argv.slice(4).length ? process.argv.slice(4) : [
  'https://www.srf.ch/news',
  'https://de.wikipedia.org/wiki/Wikipedia:Hauptseite',
  'https://www.meteoschweiz.admin.ch/',
  'https://www.20min.ch/',
  'https://www.blick.ch/',
  'https://www.watson.ch/',
  'https://www.nzz.ch/',
  'https://www.youtube.com/',
  'https://www.srf.ch/play/tv',
];
const HOME = 'http://127.0.0.1:8097/fixture.html?HOME=1';

const results = [];
function ok(site, name, pass, info) {
  results.push({ site, name, pass, info });
  console.log((pass ? 'OK   ' : 'FEHL ') + site + ' | ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
}
(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'msedge', args: ['--disable-blink-features=AutomationControlled'] });
  for (const url of SITES) {
    const site = new URL(url).hostname.replace(/^www\./, '') + new URL(url).pathname.replace(/\/$/, '');
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

      // 1) Cookie-Fenster
      const c = await findConsent(page);
      if (c) {
        const moved = await moveTo(page, c.x, c.y);
        await sleep(250);
        const c2 = await findConsent(page);
        const pp = await pointerPos(page);
        const hl = c.frame === 'haupt' ? await page.evaluate(() => {
          const all = [];
          (function walk(root) { root.querySelectorAll('*').forEach((e) => { all.push(e); if (e.shadowRoot) walk(e.shadowRoot); }); })(document);
          const e = all.find((x) => /255, 196, 0/.test(x.style.outline));
          return e ? (e.innerText || '').trim().slice(0, 40) : null;
        }) : '(im Frame)';
        await page.keyboard.press('Enter', { delay: 40 });
        await sleep(5000); // manche Seiten laden nach der Zustimmung neu
        const still = await findConsent(page);
        const gone = !still || Math.abs(still.x - c.x) > 5 || Math.abs(still.y - c.y) > 5 || still.text !== c.text;
        ok(site, 'Cookie-Fenster "' + c.text + '" per OK geschlossen', gone, { frame: c.frame, umrandet: hl, moved, ziel: [Math.round(c.x), Math.round(c.y)], jetzt: c2 && [Math.round(c2.x), Math.round(c2.y)], zeiger: pp && pp.map(Math.round) });
      } else {
        ok(site, 'kein Cookie-Fenster sichtbar', true);
      }

      // 2) Erkennung: jedes sichtbare Bedienelement muss unter dem Zeiger erkannt werden
      const cov = await page.evaluate(() => {
        const d = window.__TVL_DBG;
        if (!d) return { err: 'kein tv.js' };
        const sel = 'a[href], button, [role="button"], input:not([type="hidden"]), select, summary, [onclick]';
        const list = [];
        (function walk(root) { root.querySelectorAll(sel).forEach((e) => list.push(e)); root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) walk(e.shadowRoot); }); })(document);
        let total = 0, hit = 0;
        const miss = [];
        const inside = (a, b) => { for (let n = b; n; n = n.parentElement || (n.getRootNode && n.getRootNode().host)) if (n === a) return true; return false; };
        for (const e of list) {
          const r = e.getBoundingClientRect();
          if (r.width < 8 || r.height < 8 || r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const top = d.deepAt(cx, cy);
          if (!top || !(inside(e, top))) continue; // verdeckt -> zaehlt nicht
          total++;
          const f = d.findClickable(cx, cy);
          if (f && (f === e || inside(e, f) || inside(f, e))) hit++;
          else if (miss.length < 5) miss.push(e.tagName + ' "' + (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30) + '" -> ' + (f ? f.tagName + ' "' + (f.innerText || '').trim().slice(0, 20) + '"' : 'nichts'));
        }
        return { total, hit, miss };
      });
      ok(site, 'Bedienelemente erkannt ' + cov.hit + '/' + cov.total, !cov.err && cov.total > 0 && cov.hit === cov.total, cov.miss && cov.miss.length ? cov.miss : undefined);

      // 3) Einen Link per OK oeffnen und mit Zurueck zurueckkehren
      const link = await page.evaluate(() => {
        const d = window.__TVL_DBG;
        const host = location.hostname;
        const links = [];
        (function walk(root) { root.querySelectorAll('a[href]').forEach((e) => links.push(e)); root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) walk(e.shadowRoot); }); })(document);
        const inside = (a, b) => { for (let n = b; n; n = n.parentElement || (n.getRootNode && n.getRootNode().host)) if (n === a) return true; return false; };
        const cand = links.filter((a) => {
          const r = a.getBoundingClientRect();
          const py = r.top + Math.min(r.height / 2, 25);
          if (r.width < 40 || r.height < 14 || py < 140 || py > innerHeight - 160 || r.left < 0 || r.right > innerWidth) return false;
          if (!/^https?:/.test(a.href) || a.href.split('#')[0] === location.href.split('#')[0]) return false;
          try { if (new URL(a.href).hostname !== host) return false; } catch (e) { return false; }
          const top = d.deepAt(r.left + Math.min(30, r.width / 2), py);
          return top && inside(a, top);
        });
        const a = cand[Math.floor(cand.length / 3)];
        if (!a) return null;
        const r = a.getBoundingClientRect();
        return { x: r.left + Math.min(30, r.width / 2), y: r.top + Math.min(r.height / 2, 25), href: a.href };
      });
      if (!link) { ok(site, 'Link zum Testen gefunden', false); }
      else {
        const before = page.url();
        await moveTo(page, link.x, link.y);
        await sleep(200);
        await page.keyboard.press('Enter', { delay: 40 });
        await sleep(3500);
        const after = page.url();
        ok(site, 'Link per OK geoeffnet', after !== before, { soll: link.href.slice(0, 80), ist: after.slice(0, 80) });
        if (after !== before) {
          await page.keyboard.press('Escape');
          await sleep(3500);
          ok(site, 'Zurueck fuehrt zurueck', page.url().split('#')[0] === before.split('#')[0], { ist: page.url().slice(0, 80) });
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
