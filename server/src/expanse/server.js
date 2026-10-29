// Headless, viewer-independent Phase 2B service: ticks the expanse on a timer, persists periodically and exposes
// READ-ONLY JSON endpoints. There are no write endpoints; every non-GET request is rejected (405).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Expanse } from './engine.js';
import { save, load, SNAPSHOT } from './persist.js';
import { viewport, minimap, inspect, frame } from './view.js';

export function startExpanse({ dataDir, seed, tickMs = 1000, saveEveryTicks = 300, port = 8788, host = '127.0.0.1', initialCount = 24, allowedOrigins = [] }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const world = fs.existsSync(path.join(dataDir, SNAPSHOT)) ? load(dataDir) : Expanse.create({ initialCount }, { seed });
  if (!fs.existsSync(path.join(dataDir, SNAPSHOT))) save(dataDir, world);
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return; busy = true; // late ticks slow the world down; no burst catch-up, nobody is removed
    try { world.step(); if (world.tick % saveEveryTicks === 0) save(dataDir, world); } finally { busy = false; }
  }, tickMs);
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    res.setHeader('vary', 'Origin');
    if (origin && allowedOrigins.includes(origin)) res.setHeader('access-control-allow-origin', origin);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'application/json' }); return res.end('{"error":"read-only"}'); }
    const u = new URL(req.url, 'http://x'), q = (k, d) => Number(u.searchParams.get(k) ?? d);
    let body;
    if (u.pathname === '/api/expanse/frame') body = frame(world, { x: q('x', 0), y: q('y', 0), w: q('w', 48), h: q('h', 32), creature: u.searchParams.has('creature') ? q('creature', 0) : null });
    else if (u.pathname === '/api/expanse/info') body = { tick: world.tick, seed: world.seed, mode: world.mode, population: world.creatures.length, bounds: world.bounds(), summary: world.summary(), leadership: world.leadership().slice(0, 5) };
    else if (u.pathname === '/api/expanse/view') body = viewport(world, q('x', 0), q('y', 0), q('w', 48), q('h', 32));
    else if (u.pathname === '/api/expanse/minimap') body = minimap(world);
    else if (u.pathname.startsWith('/api/expanse/creature/')) body = inspect(world, Number(u.pathname.split('/').pop()));
    else if (u.pathname === '/api/expanse/discoveries') body = { discoveries: world.discoveries.slice(-200), social: world.social.slice(-100) };
    else if (u.pathname === '/healthz') body = { ok: true, tick: world.tick };
    if (body === undefined || body === null) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not found"}'); }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body));
  });
  server.listen(port, host);
  const stop = () => new Promise((r) => { clearInterval(timer); save(dataDir, world); server.close(() => r()); });
  return { world, server, stop };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env;
  const svc = startExpanse({ dataDir: env.EXPANSE_DATA_DIR ?? './data-expanse', seed: Number(env.WORLD_SEED ?? 20260101), tickMs: Number(env.TICK_MS ?? 1000), port: Number(env.PORT ?? 8788), host: env.HOST ?? '0.0.0.0',
    initialCount: Number(env.INITIAL_SEED_COUNT ?? 24), allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean) });
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => svc.stop().then(() => process.exit(0)));
}
