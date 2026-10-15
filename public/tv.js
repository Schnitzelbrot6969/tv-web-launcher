/*
 * TV-Web-Launcher – tv.js
 * Wird vom TizenBrew-Modul (loader.js) in jede geoeffnete Webseite injiziert.
 * Aufgaben: Fernbedienungs-Navigation (Spatial Navigation), Zoom/CSS pro Domain,
 * Zurueck/Rot-Taste, Media-Tasten, Scrollen, Mauszeiger ausblenden.
 * Bewusst ES2017 ohne Abhaengigkeiten, damit es auf aelteren Tizen-Browsern laeuft.
 */
(function () {
  'use strict';
  // In iframes (Cookie-Banner, eingebettete Videoplayer) nur Klicks des Mauszeigers entgegennehmen
  if (window.top !== window) {
    if (window.__TVL_FRAME) return;
    window.__TVL_FRAME = true;
    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || (d.tvl !== 'click' && d.tvl !== 'hover' && d.tvl !== 'leave')) return;
      var el = d.tvl === 'leave' ? null : deepAt(d.x, d.y);
      var child = el && el.tagName === 'IFRAME' ? el : null;
      var prev = window.__TVL_HF;
      if (prev && prev !== child) { try { prev.contentWindow.postMessage({ tvl: 'leave' }, '*'); } catch (e) { /* */ } }
      window.__TVL_HF = child;
      if (child) {
        // verschachteltes iframe: weiterreichen
        highlight(null);
        var r = child.getBoundingClientRect();
        try { child.contentWindow.postMessage({ tvl: d.tvl, x: d.x - r.left, y: d.y - r.top }, '*'); } catch (e) { /* */ }
        return;
      }
      if (d.tvl === 'leave') { highlight(null); return; }
      if (d.tvl === 'hover') { highlight(findClickable(d.x, d.y)); return; }
      if (el) fireClick(el, d.x, d.y, false);
    });
    // Fernbedienungs-Tasten an die Hauptseite weiterleiten (Zeiger, OK, Zurueck, Medientasten)
    var fwdKey = function (ev) {
      if (window.__TVL_DISABLE) return;
      var code = ev.keyCode;
      var back = code === 10009 || code === 27 || ev.key === 'Escape' || ev.key === 'XF86Back';
      if (!(back || code === 13 || code === 19 || (code >= 37 && code <= 40) || code >= 400)) return;
      var a = document.activeElement;
      while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
      if (isTextField(a)) {
        // Tippen im Feld nicht stoeren; Zurueck schliesst nur die Tastatur
        if (back && ev.type === 'keydown') { a.blur(); ev.preventDefault(); ev.stopPropagation(); }
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      try { window.top.postMessage({ tvl: 'key', type: ev.type, keyCode: code, key: ev.key }, '*'); } catch (e) { /* */ }
    };
    window.addEventListener('keydown', fwdKey, true);
    window.addEventListener('keyup', fwdKey, true);
    return;
  }
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
  var state = { sites: [], current: null, currentId: null, home: window.__TVL_HOME || (BASE ? BASE + '/tv' : '') };

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
    if (cfg.base && !BASE) BASE = cfg.base;
    if (cfg.home) state.home = cfg.home;
    else if (cfg.base && !window.__TVL_HOME) state.home = cfg.base + '/tv';
    if (cfg.current) state.currentId = cfg.current;
    return !!(cfg.sites && cfg.sites.length);
  }

  function cacheCfg() {
    try { sessionStorage.setItem('tvl_cfg', JSON.stringify({ base: BASE, home: state.home, current: state.currentId, sites: state.sites })); } catch (e) { /* */ }
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
    '.tvl-focus { outline: 4px solid #ffc400 !important; outline-offset: 2px !important;' +
    ' box-shadow: 0 0 0 7px rgba(0,0,0,.65), 0 0 22px 6px rgba(255,196,0,.75) !important; border-radius: 4px; }' +
    'video:fullscreen, video:-webkit-full-screen { object-fit: contain !important; width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; background: #000 !important; }' +
    // Ersatz-Vollbild, falls der Browser echtes Vollbild verweigert
    '.tvl-pfs { position: fixed !important; left: 0 !important; top: 0 !important; width: 100vw !important; height: 100vh !important;' +
    ' max-width: none !important; max-height: none !important; margin: 0 !important; object-fit: contain !important; background: #000 !important;' +
    ' z-index: 2147483646 !important; transform: none !important; }' +
    '.tvl-pfs-anc { transform: none !important; filter: none !important; perspective: none !important; contain: none !important;' +
    ' will-change: auto !important; z-index: 2147483646 !important; overflow: visible !important; }' +
    'html.tvl-pfs-on, html.tvl-pfs-on body { overflow: hidden !important; }' +
    'html.tvl-pfs-on body { zoom: 1 !important; }' +
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
    // Zoom nur auf <body>: Zeiger und Hinweis haengen direkt an <html> und bleiben unskaliert,
    // sonst steht der sichtbare Zeiger woanders als der Klickpunkt (Zoom 125 % = 25 % daneben)
    if (document.documentElement && document.documentElement.style.zoom) document.documentElement.style.zoom = '';
    addStyle('tvl-zoom-style', zoom !== 100 ? 'body { zoom: ' + (zoom / 100) + ' !important; }' : '');
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
      document.documentElement.appendChild(t);
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

  // Aktives Element, auch innerhalb von Shadow-DOM (Suchfelder in Web-Components)
  function deepActive() {
    var a = document.activeElement, guard = 0;
    while (a && a.shadowRoot && a.shadowRoot.activeElement && guard++ < 10) a = a.shadowRoot.activeElement;
    return a;
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
  // Videos auch in Shadow-DOM-Playern finden (z. B. ZDF, viele Web-Component-Player)
  function mediaElements(sel) {
    var out = [].slice.call(document.querySelectorAll(sel));
    var stack = [document], guard = 0;
    while (stack.length && guard++ < 200) {
      var root = stack.pop();
      var all = root.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var sr = all[i].shadowRoot;
        if (sr) { out = out.concat([].slice.call(sr.querySelectorAll(sel))); stack.push(sr); }
      }
    }
    return out;
  }

  function mainVideo() {
    var vids = mediaElements('video, audio');
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
    remoteLog('goHome', { home: home, hist: history.length });
    var from = location.href;
    location.href = home;
    // Falls die Navigation blockiert wird: im Verlauf bis zur Kachelseite zurueckspringen
    setTimeout(function () {
      if (location.href !== from) return;
      remoteLog('goHome-fallback', { hist: history.length });
      if (history.length > 2) history.go(-(history.length - 2)); else history.back();
    }, 1800);
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
    if (state.home && document.referrer && document.referrer.indexOf(state.home) === 0 && history.length <= 2) return true;
    return history.length <= 1;
  }

  function goBack() {
    // Vollbild verlassen hat Vorrang
    if (pfs.v) { exitPseudoFs(); return; }
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

  // ---------- Mauszeiger-Modus (Standard) ----------
  // Pfeiltasten bewegen einen sichtbaren Zeiger, gedrueckt halten beschleunigt, OK klickt.
  // Am Bildschirmrand wird die Seite bzw. der scrollbare Bereich unter dem Zeiger gescrollt.
  var ptr = { x: 0, y: 0, el: null, speed: 0, lastKey: 0, lastDir: '' };

  function navMode() {
    var n = state.current && state.current.nav;
    if (n === 'native') return 'native';
    if (n === 'focus') return 'focus';
    return 'pointer';
  }

  function ensureCursor() {
    if (ptr.el && document.contains(ptr.el)) return ptr.el;
    if (!document.body) return null;
    var c = document.createElement('div');
    c.id = 'tvl-cursor';
    // Ohne innerHTML aufbauen (Seiten wie YouTube erzwingen "Trusted Types")
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '40'); svg.setAttribute('height', '40'); svg.setAttribute('viewBox', '0 0 24 24');
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M4 2l16 9.5-7 1.3 4.2 7.6-3 1.6-4.2-7.7L4 19z');
    path.setAttribute('fill', '#fff'); path.setAttribute('stroke', '#000');
    path.setAttribute('stroke-width', '1.6'); path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    c.appendChild(svg);
    c.style.cssText = 'position:fixed;left:0;top:0;width:40px;height:40px;z-index:2147483647;pointer-events:none;' +
      'filter:drop-shadow(0 0 4px rgba(0,0,0,.7)) drop-shadow(0 0 10px rgba(255,196,0,.6));transition:opacity .2s;will-change:transform';
    document.documentElement.appendChild(c);
    ptr.el = c;
    if (!ptr.x && !ptr.y) { ptr.x = window.innerWidth / 2; ptr.y = window.innerHeight / 2; }
    drawCursor();
    return c;
  }

  function drawCursor() {
    if (ptr.el) ptr.el.style.transform = 'translate(' + Math.round(ptr.x - 6) + 'px,' + Math.round(ptr.y - 3) + 'px)';
  }

  // Element unter dem Zeiger – auch innerhalb von Shadow-DOM (z. B. Cookie-Banner von Usercentrics)
  function deepAt(x, y) {
    var el = document.elementFromPoint(x, y);
    var guard = 0;
    while (el && el.shadowRoot && guard++ < 10) {
      var inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  // Element oder naechster Vorfahre, auch ueber Shadow-Grenzen hinweg
  function closestDeep(el, sel) {
    while (el) {
      if (el.nodeType === 1 && el.matches && el.matches(sel)) return el;
      el = el.parentElement || (el.getRootNode && el.getRootNode().host) || null;
    }
    return null;
  }

  // Elemente fuer Hover-Menues informieren
  var lastHover = null;
  // Echte Bedienelemente (Dialog-Container mit tabindex zaehlen bewusst nicht dazu)
  function clickableSel() { return 'button, a[href], input:not([type="hidden"]), select, textarea, summary, label, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"], [role="option"], [onclick]'; }

  function tooBig(r) { return r.width * r.height > window.innerWidth * window.innerHeight * 0.25; }

  // Klickbares Element zu einem Treffer: echte Bedienelemente (Link, Knopf ...) oder
  // Elemente, die die Seite selbst als klickbar markiert (Mauszeiger "Hand", z. B. div mit onclick)
  function clickableOf(el) {
    var c = closestDeep(el, clickableSel());
    if (c && !tooBig(c.getBoundingClientRect())) return c;
    var p = null, n = el, depth = 0;
    while (n && depth++ < 8) {
      if (n.nodeType === 1) {
        var cur = '';
        try { cur = window.getComputedStyle(n).cursor; } catch (e) { /* */ }
        if (cur === 'pointer') { if (tooBig(n.getBoundingClientRect())) break; p = n; } else if (p) break;
      }
      n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
    }
    return p;
  }

  // Pruefpunkte rund um den Zeiger (Magnet, Radius 32 px), nach Abstand sortiert
  function probes() {
    if (probes.list) return probes.list;
    var list = [];
    for (var dy = -32; dy <= 32; dy += 8) {
      for (var dx = -32; dx <= 32; dx += 8) {
        if (dx * dx + dy * dy <= 32 * 32) list.push([dx, dy, dx * dx + dy * dy]);
      }
    }
    list.sort(function (a, b) { return a[2] - b[2]; });
    probes.list = list;
    return list;
  }

  // Bedienelement unter oder knapp neben dem Zeiger.
  // Es zaehlen nur Elemente, die an der Stelle wirklich sichtbar oben liegen (Treffertest),
  // damit z. B. ein Cookie-Fenster nicht die Links darunter "durchlaesst".
  function findClickable(x, y) {
    var el = deepAt(x, y);
    var direct = el ? clickableOf(el) : null;
    if (direct) return direct;
    var best = null, bestD = Infinity, seen = [], PROBES = probes();
    var W = window.innerWidth, H = window.innerHeight;
    for (var i = 0; i < PROBES.length; i++) {
      var px = x + PROBES[i][0], py = y + PROBES[i][1];
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      // weiter entfernte Pruefpunkte koennen kein naeheres Element mehr liefern
      if (best && Math.sqrt(PROBES[i][2]) - 8 > bestD) break;
      var hit = deepAt(px, py);
      var c = hit ? clickableOf(hit) : null;
      if (!c || seen.indexOf(c) >= 0) continue;
      seen.push(c);
      var r = c.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || tooBig(r)) continue;
      var ddx = x < r.left ? r.left - x : (x > r.right ? x - r.right : 0);
      var ddy = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
      var d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < bestD) { bestD = d; best = c; }
    }
    // Kein Ersatz ueber tabindex: Dialog-Container (z. B. Cookie-Fenster) wuerden sonst umrandet
    return best;
  }
  // Klickbares Element unter dem Zeiger gelb umranden (auch im Shadow-DOM, daher inline)
  function highlight(target) {
    var hl = highlight.st || (highlight.st = { el: null, outline: '', shadow: '' });
    if (hl.el === target) return;
    if (hl.el) { hl.el.style.outline = hl.outline; hl.el.style.boxShadow = hl.shadow; }
    hl.el = target || null;
    if (!target) return;
    hl.outline = target.style.outline; hl.shadow = target.style.boxShadow;
    target.style.outline = '4px solid #ffc400';
    target.style.boxShadow = '0 0 18px 4px rgba(255,196,0,.7)';
  }
  var hoverGap = 60;
  function hoverAt() {
    var t0 = performance.now();
    var el = deepAt(ptr.x, ptr.y);
    var frame = el && el.tagName === 'IFRAME' ? el : null;
    relayHover(frame, ptr.x, ptr.y);
    highlight(frame ? null : findClickable(ptr.x, ptr.y));
    // Langsame Geraete: Erkennung seltener ausfuehren, damit der Zeiger fluessig bleibt
    hoverGap = Math.max(60, Math.min(250, (performance.now() - t0) * 6));
    if (!el || el === lastHover) return;
    var opts = { bubbles: true, cancelable: true, view: window, clientX: ptr.x, clientY: ptr.y };
    try {
      if (lastHover) lastHover.dispatchEvent(new MouseEvent('mouseout', opts));
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new MouseEvent('mousemove', opts));
    } catch (e) { /* */ }
    lastHover = el;
  }

  function scrollableAt(x, y, dy, dx) {
    var el = document.elementFromPoint(x, y);
    while (el && el !== document.body && el !== document.documentElement) {
      var cs = window.getComputedStyle(el);
      if (dy && /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) {
        if ((dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) || (dy < 0 && el.scrollTop > 0)) return el;
      }
      if (dx && /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 4) return el;
      el = el.parentElement;
    }
    return null;
  }

  // Fluessige Bewegung: solange eine Pfeiltaste gedrueckt ist, gleitet der Zeiger pro Bildschirm-Frame
  // weiter und wird dabei schneller. Mehrere Tasten gleichzeitig = schraeg.
  var held = { left: false, right: false, up: false, down: false };
  var lastEvt = { left: 0, right: 0, up: 0, down: 0 };
  var anim = null, lastFrame = 0, holdStart = 0, lastHoverAt = 0, sawKeyUp = false;
  var nudge = { x: 0, y: 0 };  // Rest-Strecke eines Antippens (wird weich abgefahren)
  var TAP_STEP = 52;           // px pro kurzem Antippen
  var HOLD_DELAY = 220;        // ab dann gilt die Taste als gehalten
  var MIN_SPEED = 0.9;         // px pro ms zu Beginn des Haltens
  var MAX_SPEED = 2.8;         // px pro ms nach ca. 1 s Halten

  function anyHeld() { return held.left || held.right || held.up || held.down; }

  function pointerKeyDown(dir) {
    if (!ensureCursor()) return;
    var now = performance.now();
    if (!held[dir]) {
      // Neuer Tastendruck: sofort ein deutlicher Schritt
      if (dir === 'left') nudge.x -= TAP_STEP;
      if (dir === 'right') nudge.x += TAP_STEP;
      if (dir === 'up') nudge.y -= TAP_STEP;
      if (dir === 'down') nudge.y += TAP_STEP;
    }
    if (!anyHeld()) holdStart = now;
    held[dir] = true;
    lastEvt[dir] = now;
    if (!anim) { lastFrame = now; anim = requestAnimationFrame(pointerFrame); }
  }

  function pointerKeyUp(dir) {
    sawKeyUp = true;
    held[dir] = false;
  }

  function pointerFrame(t) {
    var dt = Math.min(48, Math.max(1, t - lastFrame));
    lastFrame = t;
    // Sicherheit: kommt kein keyup (manche Fernbedienungen), Taste nach Pause in den Wiederholungen loslassen
    var timeout = sawKeyUp ? 1500 : 650;
    ['left', 'right', 'up', 'down'].forEach(function (d) { if (held[d] && t - lastEvt[d] > timeout) held[d] = false; });
    var hx = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    var hy = (held.down ? 1 : 0) - (held.up ? 1 : 0);
    var hasNudge = Math.abs(nudge.x) > 0.5 || Math.abs(nudge.y) > 0.5;
    if (!hx && !hy && !hasNudge) { anim = null; hoverAt(); return; }
    // 1) Antipp-Schritt weich abfahren (ca. 90 ms)
    var dx = 0, dy = 0;
    if (hasNudge) {
      var part = Math.min(1, dt / 90 * 1.6);
      dx += nudge.x * part; dy += nudge.y * part;
      nudge.x -= nudge.x * part; nudge.y -= nudge.y * part;
      if (Math.abs(nudge.x) < 0.5) nudge.x = 0;
      if (Math.abs(nudge.y) < 0.5) nudge.y = 0;
    }
    // 2) Gehaltene Taste: fluessig weitergleiten und beschleunigen
    var heldFor = t - holdStart;
    var speed = 0;
    if ((hx || hy) && heldFor > HOLD_DELAY) {
      var held01 = Math.min(1, (heldFor - HOLD_DELAY) / 900);
      speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * held01 * held01;
      var len = Math.sqrt(hx * hx + hy * hy);
      dx += hx / len * speed * dt; dy += hy / len * speed * dt;
    }
    if (!speed) speed = 1.2;
    var W = window.innerWidth, H = window.innerHeight, edge = 4;
    var nx = ptr.x + dx, ny = ptr.y + dy;
    // Am Rand: Seite (oder scrollbaren Bereich unter dem Zeiger) fluessig scrollen
    var sx = 0, sy = 0;
    if (ny > H - edge && hy > 0) sy = Math.max(6, speed * dt * 1.6);
    if (ny < edge && hy < 0) sy = -Math.max(6, speed * dt * 1.6);
    if (nx > W - edge && hx > 0) sx = Math.max(6, speed * dt * 1.6);
    if (nx < edge && hx < 0) sx = -Math.max(6, speed * dt * 1.6);
    if (sx || sy) {
      var target = scrollableAt(ptr.x, ptr.y, sy, sx);
      if (target) target.scrollBy(sx, sy); else window.scrollBy(sx, sy);
    }
    ptr.x = Math.max(2, Math.min(W - 2, nx));
    ptr.y = Math.max(2, Math.min(H - 2, ny));
    drawCursor();
    if (t - lastHoverAt > hoverGap) { lastHoverAt = t; hoverAt(); }
    anim = requestAnimationFrame(pointerFrame);
  }

  function videoAt(x, y) {
    var el = deepAt(x, y);
    if (!el) return null;
    if (el.tagName === 'VIDEO') return el;
    // Videoplayer legen oft Bedien-Ebenen ueber das Video
    var vids = mediaElements('video');
    for (var i = 0; i < vids.length; i++) {
      var r = vids[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && r.width > 200) return vids[i];
    }
    return null;
  }

  // Ersatz-Vollbild: Video per CSS ueber die ganze Seite legen
  var pfs = { v: null, anc: [] };
  function enterPseudoFs(v) {
    exitPseudoFs();
    pfs.v = v;
    v.classList.add('tvl-pfs');
    for (var a = v.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      a.classList.add('tvl-pfs-anc');
      pfs.anc.push(a);
    }
    document.documentElement.classList.add('tvl-pfs-on');
    remoteLog('fullscreen-css', {});
  }
  function exitPseudoFs() {
    if (!pfs.v) return;
    pfs.v.classList.remove('tvl-pfs');
    pfs.anc.forEach(function (a) { a.classList.remove('tvl-pfs-anc'); });
    pfs = { v: null, anc: [] };
    document.documentElement.classList.remove('tvl-pfs-on');
  }

  function toggleFullscreen(v) {
    if (pfs.v) { exitPseudoFs(); return; }
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) { /* */ }
      return;
    }
    var req = v.requestFullscreen || v.webkitRequestFullscreen || v.webkitEnterFullscreen;
    if (!req) { enterPseudoFs(v); return; }
    try {
      var p = req.call(v);
      if (p && p.catch) p.catch(function () { enterPseudoFs(v); });
      else setTimeout(function () { if (!document.fullscreenElement && !document.webkitFullscreenElement) enterPseudoFs(v); }, 400);
    } catch (e) { enterPseudoFs(v); }
  }

  // Klick wie mit einer Maus: Bedienelement unter/neben dem Punkt (gleiches Ziel wie die gelbe Umrandung)
  function fireClick(el, x, y, isTop) {
    var found = findClickable(x, y);
    var target = found || el;
    if (found) {
      // Ereignisse auf das Ziel und dessen Mitte richten, falls der Zeiger knapp daneben liegt
      var fr = found.getBoundingClientRect();
      if (x < fr.left || x > fr.right || y < fr.top || y > fr.bottom) {
        x = fr.left + fr.width / 2; y = fr.top + fr.height / 2;
        var inner = deepAt(x, y);
        el = (inner && (inner === found || found.contains(inner))) ? inner : found;
      } else if (!(el === found || found.contains(el))) {
        el = found;
      }
    }
    var link = closestDeep(target, 'a[href]');
    if (isTop && link && link.target && link.target !== '_self' && !/^javascript:/i.test(link.href)) { location.href = link.href; return; }
    if (isTop) remoteLog('click', { tag: target.tagName, text: (target.innerText || target.value || '').trim().slice(0, 40), x: Math.round(x), y: Math.round(y) });
    // Ereignisfolge wie bei einer echten Maus (pointerId, pointerType "mouse", detail).
    // Manche Seiten (z. B. ZDF, React-Aria) reagieren sonst nicht auf den Klick.
    var base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, button: 0 };
    var fire = function (type, buttons, detail) {
      var o = {};
      for (var k in base) o[k] = base[k];
      o.buttons = buttons;
      try {
        if (type.indexOf('pointer') === 0 && window.PointerEvent) {
          o.pointerId = 1; o.pointerType = 'mouse'; o.isPrimary = true; o.width = 1; o.height = 1; o.pressure = buttons ? 0.5 : 0;
          return el.dispatchEvent(new PointerEvent(type, o));
        }
        if (type.indexOf('pointer') === 0) return true;
        o.detail = detail;
        return el.dispatchEvent(new MouseEvent(type, o));
      } catch (e) { return true; }
    };
    fire('pointerover', 0, 0); fire('pointerenter', 0, 0); fire('mouseover', 0, 0);
    fire('pointermove', 0, 0); fire('mousemove', 0, 0);
    fire('pointerdown', 1, 0);
    var downOk = fire('mousedown', 1, 1);
    var field = closestDeep(el, 'input, textarea, select, [contenteditable="true"], [contenteditable=""]');
    if (field) { field.focus(); } else if (downOk) { try { target.focus({ preventScroll: true }); } catch (e) { /* */ } }
    fire('pointerup', 0, 0);
    fire('mouseup', 0, 1);
    // Klick auf das Element unter dem Punkt; er steigt zum Bedienelement auf (Links, Knoepfe, Labels)
    fire('click', 0, 1);
  }

  // iframes (Cookie-Fenster, Player) bekommen Zeigerposition und Klick per Nachricht
  var hoverFrame = null;
  function relayHover(frame, x, y) {
    if (hoverFrame && hoverFrame !== frame) { try { hoverFrame.contentWindow.postMessage({ tvl: 'leave' }, '*'); } catch (e) { /* */ } }
    hoverFrame = frame;
    if (!frame) return;
    var r = frame.getBoundingClientRect();
    try { frame.contentWindow.postMessage({ tvl: 'hover', x: x - r.left, y: y - r.top }, '*'); } catch (e) { /* */ }
  }

  // Auf einem Video wartet der erste OK-Druck kurz: kommt ein zweiter, gibt es nur Vollbild
  // (ohne vorher Pause/Wiedergabe umzuschalten), sonst wird normal geklickt.
  var pendingClick = null;
  function pointerClick() {
    if (!ensureCursor()) return;
    var x = ptr.x, y = ptr.y;
    var v = videoAt(x, y);
    // Eingebetteter Player (iframe, z. B. Dailymotion, Vimeo): das iframe als Ganzes in Vollbild
    var under = deepAt(x, y);
    if (!v && under && under.tagName === 'IFRAME' && under.getBoundingClientRect().width > 300) v = under;
    if (ptr.el) { ptr.el.style.opacity = '.4'; setTimeout(function () { ptr.el.style.opacity = '1'; }, 120); }
    if (v) {
      if (pendingClick) { clearTimeout(pendingClick); pendingClick = null; toggleFullscreen(v); return; }
      pendingClick = setTimeout(function () { pendingClick = null; clickAt(x, y); }, 550);
      return;
    }
    clickAt(x, y);
  }

  function clickAt(x, y) {
    var el = deepAt(x, y);
    if (!el) return;
    if (el.tagName === 'IFRAME') {
      var r = el.getBoundingClientRect();
      try { el.contentWindow.postMessage({ tvl: 'click', x: x - r.left, y: y - r.top }, '*'); } catch (e) { /* */ }
      remoteLog('click-iframe', { src: (el.src || '').slice(0, 80) });
      return;
    }
    fireClick(el, x, y, true);
  }

  // ---------- Diagnose: Ereignisse an das NAS melden (ueber den Dienst auf dem TV) ----------
  var logCount = 0;
  function remoteLog(type, data) {
    if (logCount++ > 120) return;
    var payload = { t: Date.now(), v: window.__TVL_VERSION || '', type: type, url: location.href.slice(0, 120), data: data || {} };
    var bases = ['http://127.0.0.1:8096', BASE].filter(function (b, i, a) { return b && a.indexOf(b) === i; });
    bases.forEach(function (b) {
      try {
        fetch(b + '/api/log', { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) }).catch(function () {
          try { new Image().src = b + '/api/log?d=' + encodeURIComponent(JSON.stringify(payload)); } catch (e) { /* */ }
        });
      } catch (e) { /* */ }
    });
  }
  window.__TVL_LOG = remoteLog;
  window.__TVL_DBG = { findClickable: function (x, y) { return findClickable(x, y); }, deepAt: function (x, y) { return deepAt(x, y); }, ptr: ptr };

  // ---------- Tastatur ----------
  var backTimer = null;
  var backCount = 0;
  var keyLogCount = 0;
  var DIRS = {};
  DIRS[KEY.LEFT] = 'left'; DIRS[KEY.RIGHT] = 'right'; DIRS[KEY.UP] = 'up'; DIRS[KEY.DOWN] = 'down';

  function stop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  // Die Smart Remote schickt bei einem OK-Druck oft zwei keydown (zweites nach ~200 ms ohne keyup dazwischen)
  var enter = { lastDown: 0, upSince: true, everUp: false };
  function isEnterRepeat(e) {
    var now = Date.now();
    var gap = now - enter.lastDown;
    var rep = !!e.repeat || (enter.everUp ? (!enter.upSince && gap < 600) : gap < 260);
    if (!rep) { enter.lastDown = now; enter.upSince = false; }
    return rep;
  }

  function onKey(e) {
    if (window.__TVL_DISABLE) return;
    var code = e.keyCode;
    var ae = deepActive();
    var editing = isTextField(ae);
    var mode = navMode();
    var nativeNav = mode === 'native';

    if (keyLogCount++ < 40) remoteLog('key', { code: code, key: e.key, mode: mode, editing: editing });

    if (code === KEY.RED) { stop(e); goHome(); return; }
    // Zurueck: Tizen liefert je nach Umgebung 10009 oder (in TizenBrew) Escape/27
    var isBack = code === KEY.BACK || code === KEY.ESC || e.key === 'Escape' || e.key === 'XF86Back' || e.key === 'Back' || e.key === 'GoBack' || e.key === 'BrowserBack';
    if (isBack) {
      stop(e);
      // Erst ein offenes Textfeld verlassen (Bildschirmtastatur schliessen)
      if (editing) { try { ae.blur(); } catch (x) { /* */ } if (mode === 'focus' && current) setFocus(current, { scroll: false }); return; }
      // Smart Remote ohne Farbtasten: dreimal schnell Zurueck = Kachelseite.
      // Deshalb wird Zurueck kurz verzoegert ausgefuehrt (1x oder 2x = eine Seite zurueck).
      backCount++;
      clearTimeout(backTimer);
      if (backCount >= 3) { backCount = 0; backTimer = null; goHome(); return; }
      backTimer = setTimeout(function () { backTimer = null; backCount = 0; goBack(); }, 550);
      return;
    }
    if (code === KEY.PLAY || code === KEY.PAUSE || code === KEY.PLAYPAUSE || code === KEY.STOP || code === KEY.FF || code === KEY.RW) {
      if (media(code)) stop(e);
      return;
    }
    if (nativeNav) return;

    var dir = DIRS[code];
    if (mode === 'pointer') {
      if (dir) {
        // Im Textfeld: links/rechts bewegt die Schreibmarke
        if (editing && (dir === 'left' || dir === 'right')) {
          try {
            var l = (ae.value || '').length, p = ae.selectionStart;
            if (p === null || (dir === 'left' && p > 0) || (dir === 'right' && p < l)) return;
          } catch (x) { return; }
        }
        if (editing) ae.blur();
        stop(e);
        pointerKeyDown(dir);
        return;
      }
      if (code === KEY.ENTER) {
        if (editing) return; // Formular normal absenden
        stop(e);
        if (isEnterRepeat(e)) return;
        pointerClick();
      }
      return;
    }

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
        if (isEnterRepeat(e)) return;
        activate(current);
      } else {
        var f = firstInView();
        if (f) { stop(e); setFocus(f); }
      }
    }
  }

  window.addEventListener('keydown', onKey, true);
  // Loslassen der Pfeiltasten beendet die Zeigerbewegung
  function onKeyUp(e) {
    if (e.keyCode === KEY.ENTER) { enter.upSince = true; enter.everUp = true; }
    if (window.__TVL_DISABLE || navMode() !== 'pointer') return;
    var dir = DIRS[e.keyCode];
    if (dir) { pointerKeyUp(dir); stop(e); }
  }
  window.addEventListener('keyup', onKeyUp, true);
  // Liegt der Fokus in einem iframe (Cookie-Fenster, Player), kommen die Tasten dort an.
  // tv.js im iframe leitet sie hierher weiter.
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.tvl !== 'key') return;
    var fake = { keyCode: d.keyCode, key: d.key, preventDefault: function () {}, stopPropagation: function () {}, stopImmediatePropagation: function () {} };
    if (d.type === 'keydown') onKey(fake); else onKeyUp(fake);
  });

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
        adopt({ base: BASE, home: state.home, sites: data.sites, current: state.currentId });
        var before = state.current;
        state.current = findSite();
        cacheCfg();
        if (!before && state.current) applyUserAgent(state.current);
        applySiteSettings();
      }).catch(function () { /* auf https-Seiten ggf. blockiert -> window.name genuegt */ });
    }
    setTimeout(function () {
      if (navMode() === 'pointer') ensureCursor();
      else if (navMode() === 'focus' && !current) { var f = firstInView(); if (f) setFocus(f, { scroll: false }); }
    }, 900);
    // Manche Seiten ersetzen beim Aufbau den ganzen Seiteninhalt: Zeiger dann sofort wieder einsetzen
    setInterval(function () {
      if (navMode() === 'pointer' && document.body && !(ptr.el && document.contains(ptr.el))) ensureCursor();
    }, 700);
    try {
      if (!sessionStorage.getItem('tvl_hint')) {
        sessionStorage.setItem('tvl_hint', '1');
        setTimeout(function () { toast(navMode() === 'pointer' ? 'Pfeile = Zeiger · OK = Klick · 2× OK auf Video = Vollbild · 3× Zurück = Kacheln' : 'Zurück = vorherige Seite · 3× Zurück = Kacheln', 4500); }, 1200);
      }
    } catch (e) { /* */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  window.__TVL = { goHome: goHome, goBack: goBack, move: move, state: state, version: '1.0.0' };
  log('aktiv', BASE, state.current ? state.current.name : '(keine Seite zugeordnet)');
})();
