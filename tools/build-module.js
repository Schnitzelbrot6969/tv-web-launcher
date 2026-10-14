'use strict';
// Erzeugt das TizenBrew-Modul (package.json + loader.js) im Nachbarordner ../tv-web-launcher-module.
// loader.js enthaelt tv.js vollstaendig eingebettet: Viele Webseiten sperren per CSP / Mixed-Content
// das Nachladen von http://<NAS>/tv.js. Code, den TizenBrew per DevTools-Protokoll ausfuehrt, ist davon nicht betroffen.
// Aufruf: NAS_URL=http://192.168.1.194:8095 node tools/build-module.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = process.env.MODULE_DIR || path.join(root, '..', 'tv-web-launcher-module');
const nasUrl = (process.env.NAS_URL || 'http://192.168.1.194:8095').replace(/\/+$/, '');
// Weitere Adresse des Containers (macvlan) – wird probiert, falls die erste nicht antwortet
const nasUrls = [nasUrl].concat((process.env.NAS_URL_ALT || 'http://192.168.1.230:8095').split(',').filter(Boolean));
const adminUrl = process.env.ADMIN_URL || 'http://192.168.1.230:8095';
// GitHub-Repo des Moduls (wird am TV eingegeben) – bewusst kurz
const moduleRepo = process.env.MODULE_REPO || 'Schnitzelbrot6969/tv';
// Neuere Tizen-Firmware verweigert TizenBrew das Oeffnen von http://<NAS-IP> (ERR_ACCESS_DENIED).
// Deshalb liefert TizenBrew die Kachelseite selbst lokal aus (127.0.0.1:8081 holt sie von jsDelivr).
const homeUrl = 'http://127.0.0.1:8081/module/' + encodeURIComponent('gh/' + moduleRepo) + '/tv.html';
const version = process.env.MODULE_VERSION || require(path.join(root, 'package.json')).version;
const tvJs = fs.readFileSync(path.join(root, 'public', 'tv.js'), 'utf8');

const loader = `/*
 * TV-Web-Launcher – TizenBrew-Loader (automatisch erzeugt von tools/build-module.js, nicht von Hand aendern)
 * NAS: ${nasUrl}  ·  Version ${version}
 * TizenBrew fuehrt diese Datei in jeder geladenen Seite aus (auch nach Wechsel auf fremde Domains).
 */
(function () {
  if (window.top !== window) return;
  var BASE = ${JSON.stringify(nasUrl)};
  function run() {
    if (!document.documentElement) { setTimeout(run, 15); return; }
    if (!window.__TVL_BASE) window.__TVL_BASE = BASE;
    if (!window.__TVL_HOME) window.__TVL_HOME = ${JSON.stringify(homeUrl)};
${tvJs.split('\n').map((l) => (l ? '    ' + l : l)).join('\n')}
  }
  run();
})();
`;

const pkg = {
  name: 'tv-web-launcher',
  version,
  description: 'TizenBrew-Modul: Kachel-Launcher fuer beliebige Webseiten (verwaltet auf dem NAS)',
  packageType: 'mods',
  appName: 'Web-Launcher',
  websiteURL: homeUrl,
  main: 'loader.js',
  // Leer lassen: TizenBrew bricht den Start ab, wenn registerKey fuer eine dem TV unbekannte Taste wirft
  // (z. B. Farbtasten bei der Smart Remote). tv.js registriert die Tasten selbst mit try/catch.
  keys: [],
  license: 'MIT',
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'loader.js'), loader);
const tileHtml = fs.readFileSync(path.join(root, 'public', 'tv.html'), 'utf8').replace('<head>', '<head>\n<script>window.__TVL_NAS = ' + JSON.stringify(nasUrls) + '; window.__TVL_ADMIN = ' + JSON.stringify(adminUrl) + ';</script>');
fs.writeFileSync(path.join(outDir, 'tv.html'), tileHtml);
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
console.log('Modul erzeugt in', outDir, '-> websiteURL', pkg.websiteURL);
