#!/usr/bin/env node
// Disposable local world + static component inspector. Never reads production config/data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, deepMerge } from '../src/config.js';
import { Service } from '../src/service.js';
import { createServer } from '../src/http.js';
const port = Number(process.argv[2] ?? 8880), origin = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratoks-isolated-demo-'));
const cfg = deepMerge(DEFAULTS, { server: { dataDir, host: '127.0.0.1', port: 0, allowedOrigins: [origin] }, world: { brainMode: 'mb-v1' } });
const svc = new Service(cfg); svc.start();
const worldServer = createServer(svc); await new Promise(r => worldServer.listen(0, '127.0.0.1', r));
const worldOrigin = `http://127.0.0.1:${worldServer.address().port}`;
const root = fileURLToPath(new URL('../../deploy/phase2a-demo/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const staticServer = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, origin).pathname); } catch { res.writeHead(400); return res.end(); }
  if (pathname === '/demo-config.json' || pathname === '/world/world-config.json') {
    const body = JSON.stringify({ httpUrl: worldOrigin, wsUrl: worldOrigin.replace('http:', 'ws:') + '/ws', isolated: true });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(body);
  }
  const file = path.resolve(root, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => staticServer.listen(port, '127.0.0.1', r));
console.log(`Isolated demo: ${origin}/ (temporary world, mb-v1; no production state loaded)`);
let closing = false;
const close = () => {
  if (closing) return; closing = true;
  staticServer.close(); worldServer.close(); staticServer.closeAllConnections(); worldServer.closeAllConnections();
  svc.stop(); fs.rmSync(dataDir, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
};
process.on('SIGINT', close); process.on('SIGTERM', close);
