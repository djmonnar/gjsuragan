'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '.tmp', 'manual-preview');
const host = '127.0.0.1';
const port = 4173;
const blockedRequests = [];
let servedRequests = 0;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value, null, 2));
}

function safeFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded === '/'
    ? 'index.html'
    : `${decoded.replace(/^\/+/, '')}${decoded.endsWith('/') ? 'index.html' : ''}`;
  const target = path.resolve(root, relative);
  const withinRoot = target === root || target.startsWith(root + path.sep);
  return withinRoot ? target : null;
}

const server = http.createServer((req, res) => {
  const hostHeader = String(req.headers.host || '').split(':')[0].toLowerCase();
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostHeader)) {
    sendJson(res, 403, { ok: false, error: 'localhost only' });
    return;
  }

  if (req.url === '/__safety/status') {
    sendJson(res, 200, {
      projectId: 'demo-gjsuragan-safety',
      productionAccess: 'BLOCKED',
      blockedRequestCount: blockedRequests.length,
      blockedRequests,
      servedRequests
    });
    return;
  }

  if (req.url === '/__safety/report' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { blockedRequests.push(JSON.parse(body || '{}')); }
      catch (_) { blockedRequests.push({ kind: 'invalid-report', body: body.slice(0, 500) }); }
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  const file = safeFile(req.url || '/');
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Not found');
    return;
  }
  servedRequests += 1;
  res.writeHead(200, {
    'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store, max-age=0',
    'Content-Security-Policy': [
      "default-src 'self' data: blob: https:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:* https://*.naver.com https://*.naver.net https://*.kakao.com https://*.daum.net",
      "worker-src 'self' blob:"
    ].join('; ')
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, host, () => {
  console.log(`MANUAL SAFETY PREVIEW server: http://${host}:${port}`);
});
