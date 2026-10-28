// HTTP + WebSocket API. Public read endpoints; wallet-session for visitor actions; developer-only mutation endpoints.
import http from 'node:http';
import { Auth, httpErr } from './auth.js';
import { acceptUpgrade } from './ws.js';
import { worldMeta, creatureDetail, compactCreature } from './view.js';
import { isAddress } from './wallet.js';

// Proxy trust: X-Forwarded-For is only read when TRUST_PROXY=1 AND the TCP peer is a trusted proxy address
// (default: loopback + private/Docker networks; override with TRUSTED_PROXIES). Only the RIGHT-MOST entry is used:
// it is the address our proxy itself saw, so client-supplied (spoofed) entries to its left are ignored.
const v4 = (ip) => { const m = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i.exec(ip ?? ''); return m ? m.slice(1).reduce((a, x) => a * 256 + Number(x), 0) : null; };
export function ipInCidr(ip, cidr) {
  const [net, bitsS] = cidr.split('/'), a = v4(ip), b = v4(net);
  if (a !== null && b !== null) { const bits = Number(bitsS ?? 32), size = 2 ** (32 - bits); return Math.floor(a / size) === Math.floor(b / size); }
  if (a === null && b === null) { const x = String(ip).toLowerCase(), n = net.toLowerCase(); return bitsS === undefined ? x === n : x.startsWith(n.replace(/::$/, ':')); }
  return false;
}
export const DEFAULT_TRUSTED_PROXIES = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1', 'fd00::/8'];
export function clientIp(req, cfg) {
  const peer = req.socket.remoteAddress;
  if (!cfg.server.trustProxy) return peer;
  const trusted = cfg.server.trustedProxies?.length ? cfg.server.trustedProxies : DEFAULT_TRUSTED_PROXIES;
  if (!trusted.some((c) => ipInCidr(peer, c))) return peer;
  const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : peer;
}

export function createServer(service) {
  const cfg = service.cfg, auth = new Auth(cfg), buckets = new Map();
  const RL = { windowMs: 60_000, publicGet: 600, auth: 20, presence: 120, action: 30, maxBuckets: 50_000, ...(cfg.server.rateLimit ?? {}) };
  const now = () => service.now();
  // Fixed-window limiter. On overflow, expired buckets are evicted, then the oldest; never a global reset
  // (clearing every bucket would let a flood of fresh keys reset everybody's limits).
  const limited = (ip, key, max) => {
    const k = key + '|' + ip, t = now(); let b = buckets.get(k);
    if (!b || t - b.t >= RL.windowMs) { buckets.delete(k); b = { t, n: 0 }; }
    b.n++; buckets.set(k, b);
    if (buckets.size > RL.maxBuckets) {
      for (const [kk, bb] of buckets) if (t - bb.t >= RL.windowMs) buckets.delete(kk);
      for (const kk of buckets.keys()) { if (buckets.size <= RL.maxBuckets) break; buckets.delete(kk); }
    }
    if (b.n > max) throw Object.assign(httpErr(429, 'rate_limited'), { retryAfterSec: Math.max(1, Math.ceil((b.t + RL.windowMs - t) / 1000)), extra: { limit: max, windowMs: RL.windowMs } });
  };
  const ipOf = (req) => clientIp(req, cfg);
  const intParam = (q, name, def, min, max) => {
    const raw = q.get(name); if (raw === null) return def;
    if (!/^\d{1,16}$/.test(raw)) throw Object.assign(httpErr(400, `bad_${name}`), { extra: { min, max } });
    const n = Number(raw); if (!Number.isSafeInteger(n) || n < min || n > max) throw Object.assign(httpErr(400, `bad_${name}`), { extra: { min, max } });
    return n;
  };

  async function body(req) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > 8192) throw httpErr(413, 'body_too_large'); chunks.push(c); }
    if (!n) return {};
    try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!j || typeof j !== 'object') throw 0; return j; } catch { throw httpErr(400, 'bad_json'); }
  }
  const session = (req) => auth.session((req.headers.authorization ?? '').replace(/^Bearer /, ''));
  const requireDev = (req) => { const s = session(req); if (!s) throw httpErr(401, 'auth_required'); if (s.role !== 'developer') throw httpErr(403, 'developer_only'); return s; };
  const requireWallet = (req) => { const s = session(req); if (!s) throw httpErr(401, 'auth_required'); return s; };

  // Acknowledge only after the snapshot containing the change is committed. If the save fails the outcome is
  // reported honestly as not durable (503): retrying with the same id is safe and applies at most once.
  const durable = () => { try { service.snapshot(true); } catch { throw Object.assign(httpErr(503, 'not_durable_retry_same_id'), { retryAfterSec: 5 }); } };
  const routes = {
    'GET /health': () => { const h = service.health(); return { ok: h.ok, tick: h.tick, status: h.status, overloaded: h.overloaded }; },
    'GET /api/status': () => ({ ...service.health(), world: worldMeta(service.world, cfg), demoMode: cfg.server.demoMode, learning: service.world.learning, learningPolicy: service.learningPolicy }),
    'GET /api/world': () => JSON.parse(service.snapshotMessage()),
    'GET /api/creatures': () => ({ tick: service.world.tick, creatures: service.world.creatures.map((c) => compactCreature(service.world, c)) }),
    'GET /api/history': (q) => ({ history: service.world.history.slice(-intParam(q, 'limit', 600, 1, 2000)) }),
    'GET /api/graveyard': (q) => ({ deaths: service.world.graveyard.slice(-intParam(q, 'limit', 100, 1, 500)) }),
    // Cursor pagination: pass the returned nextAfter as the next `after`. after: 0..2^53-1, limit: 1..500.
    'GET /api/events': async (q) => {
      const after = intParam(q, 'after', 0, 0, Number.MAX_SAFE_INTEGER), limit = intParam(q, 'limit', 100, 1, 500);
      try { return await service.readEvents(after, limit); }
      catch (e) { if (e.busy) throw Object.assign(httpErr(503, 'event_history_busy'), { retryAfterSec: 1 }); throw e; }
    },
    'POST /api/auth/nonce': async (q, req) => {
      limited(ipOf(req), 'auth', RL.auth);
      const b = await body(req); return auth.issueNonce(String(b.address ?? ''), req.headers.origin);
    },
    'POST /api/auth/verify': async (q, req) => {
      limited(ipOf(req), 'auth', RL.auth);
      return auth.verify(await body(req), req.headers.origin);
    },
    'POST /api/visitor/presence': async (q, req) => {
      const s = requireWallet(req); limited(s.addr, 'pres', RL.presence);
      const b = await body(req); const x = Number(b.x), y = Number(b.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw httpErr(400, 'bad_numbers');
      return { ok: service.world.visitorPresence(s.addr, x, y) };
    },
    'POST /api/visitor/action': async (q, req) => {
      const s = requireWallet(req); limited(s.addr, 'vact', RL.action);
      const b = await body(req); const r = service.world.visitorAction(s.addr, String(b.type));
      if (!r.ok) throw Object.assign(httpErr(r.error === 'cooldown' || r.error === 'wallet_harm_cap' ? 429 : 400, r.error), { extra: r });
      return r;
    },
    'POST /api/dev/interventions': async (q, req) => {
      const s = requireDev(req); const b = await body(req);
      const r = service.world.intervene(b, s.addr);
      if (!r.ok) throw Object.assign(httpErr(r.status, r.error), { extra: r });
      durable(); // Require durable state even for a retry after an earlier failed save.
      return { duplicate: r.duplicate, record: r.record };
    },
    'GET /api/dev/interventions': (q, req) => { requireDev(req); const w = service.world; return { interventions: w.interventionOrder.slice(-100).map((id) => w.interventions[id]) }; },
    'POST /api/dev/backup': (q, req) => { requireDev(req); durable(); return { path: service.store.backup() }; },
    'POST /api/dev/reset': async (q, req) => {
      const s = requireDev(req); const b = await body(req);
      if (b.confirm !== `RESET ${service.world.id}`) throw httpErr(400, 'confirm_required');
      const n = b.initialSeedCount === undefined ? undefined : Number(b.initialSeedCount);
      if (n !== undefined && !(Number.isInteger(n) && n >= 1 && n <= 200)) throw httpErr(400, 'bad_initial_seed_count');
      const seed = b.seed === undefined ? undefined : Number(b.seed);
      if (seed !== undefined && !Number.isInteger(seed)) throw httpErr(400, 'bad_seed');
      service.log('warn', `developer reset by ${s.addr}`);
      return service.resetWorld({ initialSeedCount: n, seed });
    },
  };

  const cors = (req, res) => {
    const o = req.headers.origin;
    if (o && auth.originAllowed(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); }
  };
  const send = (res, status, obj) => { const s = JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(s); };

  const server = http.createServer(async (req, res) => {
    cors(req, res);
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      // Every public read, including /api/creatures/:id, passes the same limiter BEFORE any serialization work.
      if (req.method === 'GET' && url.pathname !== '/health') limited(ipOf(req), 'get', RL.publicGet);
      const m = /^\/api\/creatures\/(\d{1,12})$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const id = Number(m[1]), c = service.world.getCreature(id);
        if (c) return send(res, 200, creatureDetail(service.world, c));
        const g = service.world.graveyard.find((x) => x.id === id);
        return g ? send(res, 200, { dead: true, ...g }) : send(res, 404, { error: 'not_found' });
      }
      const h = routes[`${req.method} ${url.pathname}`];
      if (!h) return send(res, 404, { error: 'not_found' });
      send(res, 200, await h(url.searchParams, req));
    } catch (e) {
      if (!e.status) { service.log('error', e.stack ?? String(e)); return send(res, 500, { error: 'internal_error' }); }
      if (e.retryAfterSec) res.setHeader('Retry-After', String(e.retryAfterSec));
      send(res, e.status, { error: e.code ?? e.message, ...(e.retryAfterSec ? { retryAfterSec: e.retryAfterSec } : {}), ...(e.extra ?? {}) });
    }
  });
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    const o = req.headers.origin;
    if (url.pathname !== '/ws' || (o && !auth.originAllowed(o))) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
    // A WebSocket snapshot/resync is the same expensive public read as GET /api/world.  Charge the shared
    // per-client bucket before the handshake, so a client already throttled over HTTP cannot upgrade around it.
    try { limited(ipOf(req), 'get', RL.publicGet); }
    catch (e) {
      const retry = e.retryAfterSec ? `Retry-After: ${e.retryAfterSec}\r\n` : '';
      socket.write(`HTTP/1.1 ${e.status ?? 429} Too Many Requests\r\n${retry}Connection: close\r\n\r\n`);
      return socket.destroy();
    }
    const conn = acceptUpgrade(req, socket); if (!conn) return;
    const after = Number(url.searchParams.get('after') ?? 0) || 0;
    if (!service.addClient(conn, after)) return;
    conn.onmessage = (txt) => {
      let m; try { m = JSON.parse(txt); } catch { return; }
      if (m.type === 'resync') {
        try { limited(ipOf(req), 'get', RL.publicGet); }
        catch { return conn.close(1013); } // WebSocket has no HTTP 429 response after upgrade.
        if (conn.backlog > cfg.server.maxWsBufferBytes) return conn.close(1013);
        const after = Number(m.after);
        if (!Number.isSafeInteger(after) || after < 0) return conn.close(1008);
        conn.send(service.snapshotMessage(after));
      }
      else if (m.type === 'ping') conn.send(JSON.stringify({ type: 'pong', serverTime: Date.now(), tick: service.world.tick }));
    };
  });
  server.auth = auth;
  return server;
}
