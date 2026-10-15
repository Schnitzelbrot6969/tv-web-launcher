'use strict';
// Gemeinsame Hilfen fuer die E2E-Tests (Zeiger fahren wie mit der Fernbedienung, Cookie-Knopf finden)
const CONSENT = /^(alle\s+)?(cookies\s+)?(akzeptieren|zustimmen|annehmen|erlauben|accept( all)?|einverstanden|ich stimme zu|alle akzeptieren|alles akzeptieren|alle cookies akzeptieren|akzeptieren und schliessen|akzeptieren und weiter|zustimmen und weiter|ok|verstanden|accept all cookies|allow all|agree|i agree|alle zulassen|alle annehmen|alle erlauben)$/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pointerPos(page) {
  return page.evaluate(() => {
    const c = document.getElementById('tvl-cursor');
    if (!c) return null;
    const m = c.style.transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
    return m ? [+m[1] + 6, +m[2] + 3] : null;
  }).catch(() => null);
}

async function moveTo(page, tx, ty) {
  for (let i = 0; i < 90; i++) {
    const p = await pointerPos(page);
    if (!p) { await sleep(400); continue; }
    const dx = tx - p[0], dy = ty - p[1];
    if (Math.abs(dx) < 27 && Math.abs(dy) < 27) return true; // ein Tipp = 52 px
    const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : (dy > 0 ? 'ArrowDown' : 'ArrowUp');
    await page.keyboard.press(key, { delay: 40 });
    await sleep(130);
  }
  return false;
}

// Zustimmungs-Knopf in allen Frames und offenen Shadow-Roots suchen
async function findConsent(page) {
  for (const fr of page.frames()) {
    let off = { x: 0, y: 0 };
    if (fr !== page.mainFrame()) {
      try {
        const h = await fr.frameElement();
        const b = await h.boundingBox();
        if (!b || b.width < 50 || b.height < 30) continue;
        off = { x: b.x, y: b.y };
      } catch (e) { continue; }
    }
    const r = await fr.evaluate((src) => {
      const re = new RegExp(src, 'i');
      const all = [];
      (function walk(root) {
        root.querySelectorAll('*').forEach((e) => { all.push(e); if (e.shadowRoot) walk(e.shadowRoot); });
      })(document);
      // echte Knoepfe zuerst, dann sonstige Elemente
      const rank = (e) => (e.tagName === 'BUTTON' || e.getAttribute('role') === 'button' || e.tagName === 'A') ? 0 : 1;
      all.sort((a, b) => rank(a) - rank(b));
      for (const e of all) {
        if (!/^(BUTTON|A|DIV|SPAN)$/.test(e.tagName) && e.getAttribute('role') !== 'button') continue;
        const t = (e.innerText || e.textContent || '').trim().replace(/\s+/g, ' ');
        if (t.length > 40 || !re.test(t)) continue;
        const rr = e.getBoundingClientRect();
        if (rr.width < 20 || rr.height < 12 || rr.bottom < 0 || rr.top > innerHeight) continue;
        return { x: rr.left + rr.width / 2, y: rr.top + rr.height / 2, w: rr.width, h: rr.height, text: t, tag: e.tagName };
      }
      return null;
    }, CONSENT.source).catch(() => null);
    if (r) return Object.assign(r, { x: r.x + off.x, y: r.y + off.y, frame: fr === page.mainFrame() ? 'haupt' : fr.url().slice(0, 60) });
  }
  return null;
}

module.exports = { CONSENT, sleep, pointerPos, moveTo, findConsent };
