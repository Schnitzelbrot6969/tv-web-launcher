/*
 * TV-Web-Launcher – tv.js
 * Wird vom TizenBrew-Modul (loader.js) in jede geoeffnete Webseite injiziert.
 * Aufgaben: Fernbedienungs-Navigation (Spatial Navigation), Zoom/CSS pro Domain,
 * Zurueck/Rot-Taste, Media-Tasten, Scrollen, Mauszeiger ausblenden.
 * Bewusst ES2017 ohne Abhaengigkeiten, damit es auf aelteren Tizen-Browsern laeuft.
 */
(function () {
  'use strict';
  if (window.top !== window) return; // nicht in iframes
  if (window.__TVL_ACTIVE) return;
  window.__TVL_ACTIVE = true;

  // ---------- Grundkonfiguration ----------
  var BASE = window.__TVL_BASE || (function () {
    try {
      var cs = document.currentScript;
      if (cs && cs.src) return new URL(cs.src).origin;
    } catch (e) { /* */ }
    return '';
  })();

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 10009, ESC: 27,
    RED: 403,
    PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, STOP: 413, FF: 417, RW: 412,
  };

  var UA = {
    desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    tv: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0) AppleWebKit/537.36 (KHTML, like Gecko) 108.0.5359.1/8.0 TV Safari/537.36',
  };

  function log() {
    try { console.log.apply(console, ['[TVL]'].concat([].slice.call(arguments))); } catch (e) { /* */ }
  }

  // Tasten bei Tizen registrieren (falls API vorhanden; TizenBrew registriert sie zusaetzlich)
  try {
    if (window.tizen && tizen.tvinputdevice) {
      ['ColorF0Red', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind'].forEach(function (k) {
        try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* */ }
      });
    }
  } catch (e) { /* */ }

  // ---------- Konfiguration (sites.json) beschaffen ----------
  // Quellen: 1) window.name (von der Kachelseite gesetzt, ueberlebt Domainwechsel)
  //          2) sessionStorage-Cache dieser Domain  3) direkt vom NAS (auf https-Seiten evtl. blockiert)
  var state = { sites: [], current: null, currentId: null, home: BASE ? BASE + '/tv' : '' };

  function readWindowName() {
    try {
      if (typeof window.name === 'string' && window.name.indexOf('tvl:') === 0) {
        return JSON.parse(window.name.slice(4));
      }
    } catch (e) { /* */ }
    return null;
  }

  function adopt(cfg) {
    if (!cfg) return false;
    if (cfg.sites && cfg.sites.length) state.sites = cfg.sites;
    if (cfg.base) {
      if (!BASE) BASE = cfg.base;
      state.home = cfg.base + '/tv';
    }
    if (cfg.current) state.currentId = cfg.current;
    return !!(cfg.sites && cfg.sites.length);
  }

  function cacheCfg() {
    try { sessionStorage.setItem('tvl_cfg', JSON.stringify({ base: BASE, current: state.currentId, sites: state.sites })); } catch (e) { /* */ }
  }

  var haveCfg = adopt(readWindowName());
  if (!haveCfg) {
    try { haveCfg = adopt(JSON.parse(sessionStorage.getItem('tvl_cfg') || 'null')); } catch (e) { /* */ }
  }
  if (haveCfg) cacheCfg();

  function hostMatches(siteUrl) {
    try {
      var a = new URL(siteUrl).hostname.replace(/^www\./, '');
      var b = location.hostname.replace(/^www\./, '');
      return a === b || b.slice(-(a.length + 1)) === '.' + a || a.slice(-(b.length + 1)) === '.' + b;
    } catch (e) { return false; }
  }

  function findSite() {
    var byId = null, byHost = null;
    state.sites.forEach(function (s) {
      if (s.id === state.currentId) byId = s;
      if (!byHost && hostMatches(s.url)) byHost = s;
    });
    // Aktuelle Kachel bevorzugen, solange keine andere Kachel besser zur Domain passt
    if (byId && (hostMatches(byId.url) || !byHost)) return byId;
    return byHost || byId;
  }

  // User-Agent so frueh wie moeglich ueberschreiben (wirkt nur auf Erkennung per JavaScript)
  function applyUserAgent(site) {
    if (!site || !UA[site.userAgent]) return;
    var ua = UA[site.userAgent];
    try {
      Object.defineProperty(navigator, 'userAgent', { get: function () { return ua; }, configurable: true });
      Object.defineProperty(navigator, 'appVersion', { get: function () { return ua.replace(/^Mozilla\//, ''); }, configurable: true });
      if (site.userAgent === 'desktop') {
        Object.defineProperty(navigator, 'platform', { get: function () { return 'Win32'; }, configurable: true });
      }
    } catch (e) { /* */ }
  }
  state.current = findSite();
  applyUserAgent(state.current);

  // ---------- Stile ----------
  var baseCss =
    'html, body, * { cursor: none !important; }' +
    '.tvl-focus { outline: 4px solid #ffc400 !important; outline-offset: 2px !important;' +
    ' box-shadow: 0 0 0 7px rgba(0,0,0,.65), 0 0 22px 6px rgba(255,196,0,.75) !important; border-radius: 4px; }' +
    '#tvl-toast { position: fixed; left: 50%; bottom: 48px; transform: translateX(-50%); z-index: 2147483647;' +
    ' background: rgba(20,20,24,.92); color: #fff; font: 600 26px/1.3 sans-serif; padding: 14px 28px;' +
    ' border-radius: 14px; box-shadow: 0 8px 30px rgba(0,0,0,.5); pointer-events: none; transition: opacity .3s; }';

  function addStyle(id, css) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      (document.head || document.documentElement).appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
  }

  function applySiteSettings() {
    var s = state.current;
    addStyle('tvl-base-style', baseCss);
    if (!s) return;
    var zoom = parseInt(s.zoom, 10) || 100;
    if (document.documentElement) document.documentElement.style.zoom = zoom !== 100 ? String(zoom / 100) : '';
    if (s.css) addStyle('tvl-site-style', s.css);
    if (s.js && !window.__TVL_SITE_JS_DONE) {
      window.__TVL_SITE_JS_DONE = true;
      try { (new Function(s.js))(); } catch (e) { log('Seiten-JS Fehler', e); }
    }
  }

  var toastTimer = null;
  function toast(msg, ms) {
    if (!document.body) return;
    var t = document.getElementById('tvl-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'tvl-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.opacity = '0'; }, ms || 2200);
  }

  // ---------- Spatial Navigation ----------
  var FOCUSABLE = [
    'a[href]', 'area[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
    '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]', '[contenteditable=""]',
    '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="tab"]', '[role="option"]',
    '[role="checkbox"]', '[role="switch"]', '[onclick]',
  ].join(',');

  var current = null;

  function isVisible(el, r) {
    if (r.width < 2 || r.height < 2) return false;
    if (el.disabled) return false;
    var cs = window.getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
    return true;
  }

  function candidates() {
    var list = document.querySelectorAll(FOCUSABLE);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      // verschachtelte Treffer vermeiden (z. B. a > span[role=button]); Eingabefelder immer zulassen
      var p = el.parentElement;
      if (p && p.closest && p.closest('a[href],button') && !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) continue;
      var r = el.getBoundingClientRect();
      if (!isVisible(el, r)) continue;
      out.push({ el: el, r: r });
    }
    return out;
  }

  function overlapGap(a1, a2, b1, b2) {
    if (b2 < a1) return a1 - b2;
    if (b1 > a2) return b1 - a2;
    return 0;
  }

  function distanceInDir(from, to, dir) {
    // Abstand zwischen den naechsten Kanten in Richtung + gewichteter Querversatz
    var fcx = from.left + from.width / 2, fcy = from.top + from.height / 2;
    var tcx = to.left + to.width / 2, tcy = to.top + to.height / 2;
    var main, cross;
    if (dir === 'right') {
      if (tcx <= fcx + 2 || to.right <= from.right) return null;
      main = Math.max(0, to.left - from.right);
      cross = overlapGap(from.top, from.bottom, to.top, to.bottom);
    } else if (dir === 'left') {
      if (tcx >= fcx - 2 || to.left >= from.left) return null;
      main = Math.max(0, from.left - to.right);
      cross = overlapGap(from.top, from.bottom, to.top, to.bottom);
    } else if (dir === 'down') {
      if (tcy <= fcy + 2 || to.bottom <= from.bottom) return null;
      main = Math.max(0, to.top - from.bottom);
      cross = overlapGap(from.left, from.right, to.left, to.right);
    } else {
      if (tcy >= fcy - 2 || to.top >= from.top) return null;
      main = Math.max(0, from.top - to.bottom);
      cross = overlapGap(from.left, from.right, to.left, to.right);
    }
    return main + cross * 2.5;
  }

  function isTextField(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
    if (el.tagName !== 'INPUT') return false;
    return /^(text|search|email|url|tel|password|number|)$/i.test(el.type || '');
  }

  function setFocus(el, opts) {
    if (current && current !== el) current.classList.remove('tvl-focus');
    current = el;
    if (!el) return;
    el.classList.add('tvl-focus');
    if (!isTextField(el)) {
      if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName)) {
        el.setAttribute('tabindex', '-1');
      }
      try { el.focus({ preventScroll: true }); } catch (e) { /* */ }
    } else if (document.activeElement && document.activeElement !== el && document.activeElement !== document.body) {
      // Textfeld nur markieren, die Bildschirmtastatur oeffnet sich erst mit OK
      try { document.activeElement.blur(); } catch (e) { /* */ }
    }
    if (!opts || opts.scroll !== false) scrollIntoViewIfNeeded(el);
  }

  function scrollIntoViewIfNeeded(el) {
    var r = el.getBoundingClientRect();
    var m = 80;
    if (r.top < m || r.bottom > window.innerHeight - m || r.left < 0 || r.right > window.innerWidth) {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); }
    }
  }

  function firstInView() {
    var c = candidates();
    var best = null, bestScore = Infinity;
    c.forEach(function (o) {
      if (o.r.bottom < 0 || o.r.top > window.innerHeight) return;
      var score = Math.max(0, o.r.top) * 2 + Math.max(0, o.r.left);
      if (score < bestScore) { bestScore = score; best = o.el; }
    });
    return best || (c[0] && c[0].el) || null;
  }

  function scrollTarget() {
    var el = current || document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    while (el && el !== document.body && el !== document.documentElement) {
      var cs = window.getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 10) return el;
      el = el.parentElement;
    }
    return null;
  }

  function scrollPage(dir) {
    var dy = dir === 'down' ? 1 : dir === 'up' ? -1 : 0;
    var dx = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
    var step = Math.round((dy ? window.innerHeight : window.innerWidth) * 0.55);
    var se = document.scrollingElement || document.documentElement;
    var before = se.scrollTop + se.scrollLeft;
    window.scrollBy({ top: dy * step, left: dx * step, behavior: 'smooth' });
    // Seite selbst scrollt nicht? Dann den scrollbaren Container verwenden
    setTimeout(function () {
      if (se.scrollTop + se.scrollLeft === before) {
        var t = scrollTarget();
        if (t) t.scrollBy({ top: dy * step, left: dx * step, behavior: 'smooth' });
      }
    }, 80);
  }

  function move(dir) {
    if (!current || !document.contains(current) || !current.getBoundingClientRect().width) {
      var f = firstInView();
      if (f) { setFocus(f); return; }
      scrollPage(dir);
      return;
    }
    var from = current.getBoundingClientRect();
    var best = null, bestD = Infinity;
    candidates().forEach(function (o) {
      if (o.el === current || o.el.contains(current) || current.contains(o.el)) return;
      var d = distanceInDir(from, o.r, dir);
      if (d !== null && d < bestD) { bestD = d; best = o; }
    });
    var limit = (dir === 'up' || dir === 'down') ? window.innerHeight * 0.8 : window.innerWidth;
    if (best && bestD <= limit) {
      setFocus(best.el);
    } else {
      // Kein Element in Reichweite: scrollen, danach ggf. Element im Bild waehlen
      scrollPage(dir);
      if (best && (dir === 'up' || dir === 'down')) {
        setTimeout(function () {
          var r = best.el.getBoundingClientRect();
          if (r.top > 60 && r.bottom < window.innerHeight - 60) setFocus(best.el, { scroll: false });
        }, 500);
      }
    }
  }

  function activate(el) {
    if (!el) return;
    if (isTextField(el) || el.tagName === 'SELECT') {
      el.focus();
      try { el.click(); } catch (e) { /* */ }
      return;
    }
    if (el.tagName === 'A' && el.target && el.target !== '_self' && el.href && !/^javascript:/i.test(el.href)) {
      location.href = el.href; // keine neuen Fenster auf dem TV
      return;
    }
    try { el.focus({ preventScroll: true }); } catch (e) { /* */ }
    var r = el.getBoundingClientRect();
    var opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (t) {
      try {
        var Ctor = (t.indexOf('pointer') === 0 && window.PointerEvent) ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ctor(t, opts));
      } catch (e) { /* */ }
    });
    el.click();
  }

  // window.open -> gleiches Fenster (Popups gibt es auf dem TV nicht)
  try {
    window.open = function (u) {
      if (u) location.href = new URL(u, location.href).toString();
      return null;
    };
  } catch (e) { /* */ }

  // ---------- Medien ----------
  function mainVideo() {
    var vids = [].slice.call(document.querySelectorAll('video, audio'));
    if (!vids.length) return null;
    vids.sort(function (a, b) {
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (rb.width * rb.height + (b.paused ? 0 : 1e7)) - (ra.width * ra.height + (a.paused ? 0 : 1e7));
    });
    return vids[0];
  }

  function media(code) {
    var v = mainVideo();
    if (!v) return false;
    var p;
    if (code === KEY.PLAYPAUSE) p = v.paused ? v.play() : v.pause();
    else if (code === KEY.PLAY) p = v.play();
    else if (code === KEY.PAUSE || code === KEY.STOP) v.pause();
    else if (code === KEY.FF) v.currentTime = Math.min(isFinite(v.duration) ? v.duration : Infinity, v.currentTime + 10);
    else if (code === KEY.RW) v.currentTime = Math.max(0, v.currentTime - 10);
    if (p && p.catch) p.catch(function () { /* Autoplay-Sperre */ });
    toast(code === KEY.FF ? '⏩ +10 s' : code === KEY.RW ? '⏪ −10 s' : v.paused ? '⏸ Pause' : '▶ Wiedergabe', 1200);
    return true;
  }

  // ---------- Zurueck / Startseite ----------
  function goHome() {
    var home = state.home || (BASE ? BASE + '/tv' : '');
    if (!home) { toast('Startseite unbekannt'); return; }
    location.href = home;
  }

  function normUrl(u) {
    try {
      var x = new URL(u, location.href);
      return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '')).toLowerCase();
    } catch (e) { return ''; }
  }

  function atAppStart() {
    var s = state.current;
    if (s && normUrl(s.url) === normUrl(location.href)) return true;
    if (BASE && document.referrer && document.referrer.indexOf(BASE + '/tv') === 0 && history.length <= 2) return true;
    return history.length <= 1;
  }

  function goBack() {
    // Vollbild verlassen hat Vorrang
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) { /* */ }
      return;
    }
    if (atAppStart()) { goHome(); return; }
    var startHref = location.href;
    var moved = false;
    var mark = function () { moved = true; };
    window.addEventListener('popstate', mark, { once: true });
    window.addEventListener('hashchange', mark, { once: true });
    window.addEventListener('pagehide', mark, { once: true });
    history.back();
    // Falls der Verlauf nichts bewirkt (z. B. Weiterleitungsschleife) -> Kachelseite
    setTimeout(function () {
      if (!moved && location.href === startHref) goHome();
    }, 1500);
  }

  // ---------- Tastatur ----------
  var backTimer = null;
  var DIRS = {};
  DIRS[KEY.LEFT] = 'left'; DIRS[KEY.RIGHT] = 'right'; DIRS[KEY.UP] = 'up'; DIRS[KEY.DOWN] = 'down';

  function stop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  function onKey(e) {
    if (window.__TVL_DISABLE) return;
    var code = e.keyCode;
    var ae = document.activeElement;
    var editing = isTextField(ae);
    var nativeNav = state.current && state.current.nav === 'native';

    if (code === KEY.RED) { stop(e); goHome(); return; }
    if (code === KEY.BACK || (code === KEY.ESC && !editing)) {
      stop(e);
      if (editing) { ae.blur(); if (current) setFocus(current, { scroll: false }); return; }
      // Smart Remote ohne Farbtasten: zweimal schnell Zurueck = Kachelseite.
      // Deshalb wird ein einzelnes Zurueck kurz verzoegert ausgefuehrt.
      if (backTimer) { clearTimeout(backTimer); backTimer = null; goHome(); return; }
      backTimer = setTimeout(function () { backTimer = null; goBack(); }, 450);
      return;
    }
    if (code === KEY.PLAY || code === KEY.PAUSE || code === KEY.PLAYPAUSE || code === KEY.STOP || code === KEY.FF || code === KEY.RW) {
      if (media(code)) stop(e);
      return;
    }
    if (nativeNav) return;

    var dir = DIRS[code];
    if (dir) {
      if (editing) {
        // Im Textfeld: links/rechts bewegt den Cursor, hoch/runter verlaesst das Feld
        if (dir === 'left' || dir === 'right') {
          try {
            var len = (ae.value || '').length, pos = ae.selectionStart;
            if (pos === null || (dir === 'left' && pos > 0) || (dir === 'right' && pos < len)) return;
          } catch (x) { return; }
        }
        ae.blur();
        if (current !== ae) setFocus(ae, { scroll: false });
      }
      if (ae && ae.tagName === 'SELECT' && ae === current && (dir === 'up' || dir === 'down') && ae.size > 1) return;
      stop(e);
      move(dir);
      return;
    }

    if (code === KEY.ENTER) {
      if (editing) return; // Formular normal absenden
      if (current && document.contains(current)) {
        stop(e);
        activate(current);
      } else {
        var f = firstInView();
        if (f) { stop(e); setFocus(f); }
      }
    }
  }

  window.addEventListener('keydown', onKey, true);

  // Fokus, den die Seite selbst setzt (z. B. Suchfeld), sichtbar uebernehmen
  document.addEventListener('focusin', function (ev) {
    var t = ev.target;
    if (t && t !== current && t.nodeType === 1 && t.matches && t.matches(FOCUSABLE)) {
      if (current) current.classList.remove('tvl-focus');
      current = t;
      t.classList.add('tvl-focus');
    }
  }, true);

  // ---------- Start ----------
  function isTilePage() {
    return !!document.querySelector('meta[name="tvl-tilepage"]');
  }

  function init() {
    if (isTilePage()) { window.removeEventListener('keydown', onKey, true); return; }
    applySiteSettings();
    // Konfiguration vom NAS nachladen (aktualisiert Zoom/CSS, falls window.name fehlt)
    if (BASE) {
      fetch(BASE + '/api/sites', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (data) {
        adopt({ base: BASE, sites: data.sites, current: state.currentId });
        var before = state.current;
        state.current = findSite();
        cacheCfg();
        if (!before && state.current) applyUserAgent(state.current);
        applySiteSettings();
      }).catch(function () { /* auf https-Seiten ggf. blockiert -> window.name genuegt */ });
    }
    setTimeout(function () {
      if (!current) { var f = firstInView(); if (f) setFocus(f, { scroll: false }); }
    }, 900);
    try {
      if (!sessionStorage.getItem('tvl_hint')) {
        sessionStorage.setItem('tvl_hint', '1');
        setTimeout(function () { toast('Zurück = vorherige Seite · 2× Zurück = Kacheln', 3500); }, 1200);
      }
    } catch (e) { /* */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  window.__TVL = { goHome: goHome, goBack: goBack, move: move, state: state, version: '1.0.0' };
  log('aktiv', BASE, state.current ? state.current.name : '(keine Seite zugeordnet)');
})();
