/*
 * TV-Web-Launcher – Hintergrunddienst fuer TizenBrew (laeuft auf dem TV in Node.js).
 * Stellt unter http://127.0.0.1:8096 einen kleinen Proxy zum NAS bereit (Liste + Icons).
 * Grund: Neuere Tizen-Firmware verweigert Webseiten in TizenBrew den direkten Zugriff auf
 * private IP-Adressen (ERR_ACCESS_DENIED); 127.0.0.1 ist dagegen immer erlaubt.
 * Bewusst ES5 – aeltere TVs haben Node 4.
 */
var http = require('http');
var urlLib = require('url');

var NAS = __NAS_LIST__;
var PORT = 8096;

function cors(headers) {
  headers = headers || {};
  headers['access-control-allow-origin'] = '*';
  headers['cache-control'] = 'no-store';
  return headers;
}

var server = http.createServer(function (req, res) {
  if (req.url === '/ping') {
    res.writeHead(200, cors({ 'content-type': 'application/json' }));
    res.end('{"ok":true}');
    return;
  }
  // Diagnose-Meldungen von tv.js an das NAS weiterreichen
  if (/^\/api\/log/.test(req.url) && (req.method === 'POST' || req.method === 'GET')) {
    var body = '';
    req.on('data', function (c) { if (body.length < 16384) body += c; });
    req.on('end', function () {
      res.writeHead(204, cors({}));
      res.end();
      NAS.forEach(function (base) {
        try {
          var t = urlLib.parse(base + req.url);
          var up = http.request({ hostname: t.hostname, port: t.port, path: t.path, method: req.method, headers: { 'content-type': 'application/json' } });
          up.on('error', function () { /* */ });
          up.setTimeout(4000, function () { up.abort(); });
          up.end(body);
        } catch (e) { /* */ }
      });
    });
    return;
  }
  // Nur lesende Pfade weiterreichen
  if (!/^\/(api\/sites|icons\/|health)/.test(req.url) || req.method !== 'GET') {
    res.writeHead(404, cors({ 'content-type': 'text/plain' }));
    res.end('not found');
    return;
  }
  var i = 0;
  function attempt() {
    if (i >= NAS.length) {
      res.writeHead(502, cors({ 'content-type': 'application/json' }));
      res.end('{"error":"NAS nicht erreichbar"}');
      return;
    }
    var target = urlLib.parse(NAS[i++] + req.url);
    var answered = false;
    var up = http.get({ hostname: target.hostname, port: target.port, path: target.path }, function (r) {
      answered = true;
      res.writeHead(r.statusCode, cors({ 'content-type': r.headers['content-type'] || 'application/octet-stream' }));
      r.pipe(res);
    });
    up.setTimeout(5000, function () { up.abort(); });
    up.on('error', function () { if (!answered) attempt(); });
  }
  attempt();
});

server.on('error', function () { /* Port belegt: Dienst laeuft bereits */ });
server.listen(PORT, '127.0.0.1');
