// Integrated client + disposable loopback world. No production env/config/data is read.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Service } from '../../server/src/service.js';
import { DEFAULTS, deepMerge } from '../../server/src/config.js';
import { createServer } from '../../server/src/http.js';
const port = Number(process.argv[2] ?? 4174);
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Port must be 0–65535.');
const root = fileURLToPath(new URL('../../dist/', import.meta.url));
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Build the static client first: node web/scripts/task.mjs build');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
let worldOrigin = '';
const preview = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  if (pathname === '/') { res.writeHead(302, { Location: '/preview/' }); return res.end(); }
  if (pathname === '/preview/world-config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(req.method === 'HEAD' ? '' : JSON.stringify({ httpUrl: worldOrigin, wsUrl: worldOrigin.replace('http:', 'ws:') + '/ws', isolated: true }));
  }
  const file = path.resolve(root, pathname.replace(/^\/preview\//, '') || 'index.html');
  if (!pathname.startsWith('/preview/') || !file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => preview.listen(port, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${preview.address().port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratoks-client-demo-'));
const cfg = deepMerge(DEFAULTS, { server: { host: '127.0.0.1', port: 0, dataDir, allowedOrigins: [origin], demoMode: true }, world: { brainMode: 'mb-v1' } });
const svc = new Service(cfg, { log: () => {} }); svc.start();
const server = createServer(svc); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
worldOrigin = `http://127.0.0.1:${server.address().port}`;
console.log(`Isolated integrated demo: ${origin}/preview/`);
console.log('Open in two tabs. Temporary mb-v1 world; one-second ticks. Ctrl-C discards this demo.');
let closing = false;
const close = () => {
  if (closing) return; closing = true;
  svc.stop(); for (const s of [preview, server]) { s.close(); s.closeAllConnections(); }
  fs.rmSync(dataDir, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
};
process.on('SIGINT', close); process.on('SIGTERM', close);
