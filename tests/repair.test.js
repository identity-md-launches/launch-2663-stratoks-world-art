// Phase 1.1 regressions: bounded event history (1), public rate limits (2), LEARNING policy (4),
// actor-aware intervention idempotency (5).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Service } from '../server/src/service.js';
import { Store, writerIsLive } from '../server/src/store.js';
import { loadConfig } from '../server/src/config.js';
import { migrate } from '../server/src/migrations.js';
import { clientIp } from '../server/src/http.js';
import { startApp, api, login, testConfig, tmpDir, wsClient, DEV_KEY, VIS_KEY, VIS2_KEY } from './helpers.js';
import { addressFromPrivateKey } from '../server/src/wallet.js';

const quiet = (svc) => { clearTimeout(svc.timer); clearInterval(svc.snapTimer); svc.running = false; };
const lines = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];

// Build a data dir whose durable event history is three ~5 MB logs (events.jsonl.2, .1, live) and whose committed
// snapshot covers all of it, with the in-memory ring holding only the newest events.
function bigHistory() {
  const cfg = testConfig({ persistence: { eventLogMaxBytes: 5_000_000, eventLogFiles: 3 } });
  const s = new Service(cfg, { log: () => {} }); s.start(); quiet(s); s.stop();
  const dir = cfg.server.dataDir, pad = 'x'.repeat(180);
  for (const f of fs.readdirSync(dir)) if (f.startsWith('events.jsonl')) fs.unlinkSync(path.join(dir, f));
  let seq = 0;
  for (const name of ['events.jsonl.2', 'events.jsonl.1', 'events.jsonl']) {
    const parts = []; let size = 0;
    while (size < (name === 'events.jsonl' ? 4_990_000 : 5_000_000)) { // live file just under the rotation threshold
      const l = JSON.stringify({ seq: ++seq, tick: seq, type: 'filler', pad }) + '\n'; parts.push(l); size += l.length; }
    fs.writeFileSync(path.join(dir, name), parts.join(''));
  }
  const st = new Store(dir, cfg.persistence); const snap = st.readSnapshot(path.join(dir, 'world.json')).state;
  snap.seq = seq; snap.events = Array.from({ length: 50 }, (_, i) => ({ seq: seq - 49 + i, tick: seq - 49 + i, type: 'filler', pad }));
  st.init(); st.save(snap); st.release();
  return { cfg, total: seq };
}

test('GET /api/events: three 5 MB logs, after=0 limit=1, concurrent requests are bounded and do not stall ticks', async () => {
  const { cfg, total } = bigHistory();
  const svc = new Service(cfg, { log: () => {} }); svc.start(); quiet(svc);
  const { createServer } = await import('../server/src/http.js');
  const server = createServer(svc); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(svc.store.segs.length, 3);
    // tick in the background while requests are served, recording tick latency + event-loop delay
    const lat = []; const h = monitorEventLoopDelay({ resolution: 1 }); h.enable();
    const ticker = setInterval(() => { const t = performance.now(); svc.tickOnce(); lat.push(performance.now() - t); }, 5);
    const heap0 = process.memoryUsage().heapUsed, b0 = svc.store.stats.bytesRead, t0 = performance.now();
    const N = 40, rs = [], memory = [];
    for (let k = 0; k < N; k += 4) rs.push(...await Promise.all([0, 1, 2, 3].map(async () => {
      const before = process.memoryUsage();
      const response = await api(base, 'GET', '/api/events?after=0&limit=1');
      const after = process.memoryUsage();
      memory.push({ heap: after.heapUsed - before.heapUsed, external: after.external - before.external });
      return response;
    })));
    const elapsed = performance.now() - t0; clearInterval(ticker); h.disable();
    const bytesPerReq = (svc.store.stats.bytesRead - b0) / N;
    for (const r of rs) { assert.equal(r.status, 200); assert.equal(r.json.events.length, 1); assert.equal(r.json.events[0].seq, 1); assert.equal(r.json.nextAfter, 1); assert.equal(r.json.source, 'log'); }
    assert.ok(bytesPerReq <= 64 * 1024, `bytes read per request ${bytesPerReq} must not scale with 15 MB history`);
    const p = (q) => { const s = [...lat].sort((a, b) => a - b); return s[Math.floor(q * (s.length - 1))] ?? 0; };
    const result = { historyBytes: 15_000_000, events: total, requests: N, concurrency: 4, bytesReadPerRequest: Math.round(bytesPerReq), linesParsedTotal: svc.store.stats.linesParsed, elapsedMs: Math.round(elapsed), tickP50Ms: +p(0.5).toFixed(2), tickP99Ms: +p(0.99).toFixed(2), eventLoopDelayMaxMs: +(h.max / 1e6).toFixed(2), heapDeltaMB: +((process.memoryUsage().heapUsed - heap0) / 1048576).toFixed(1) };
    const memoryRange = (key) => { const a = memory.map(x => x[key]).sort((a, b) => a - b); return { min: a[0], median: a[Math.floor(a.length / 2)], max: a.at(-1) }; };
    result.requestWindowMemoryBytes = { samples: memory.length, heap: memoryRange('heap'), external: memoryRange('external'), scope: 'whole-process deltas between each request start/end at concurrency 4; includes concurrent requests, ticking and GC, not isolated allocations or peak RSS' };
    if (process.env.EVENTS_RESULT) fs.writeFileSync(process.env.EVENTS_RESULT, JSON.stringify(result, null, 2));
    assert.ok(h.max / 1e6 < 200, `event loop stalled ${h.max / 1e6} ms`);

    // cursor pagination walks the whole history in order across both rotations and into the memory ring
    let after = 0, seen = 0, prev = 0, pages = 0;
    for (;;) {
      const r = await api(base, 'GET', `/api/events?after=${after}&limit=500`); assert.equal(r.status, 200);
      for (const e of r.json.events) { assert.equal(e.seq, prev + 1); prev = e.seq; seen++; }
      after = r.json.nextAfter; pages++;
      if (!r.json.hasMore || !r.json.events.length) break;
    }
    assert.ok(seen >= total, `walked ${seen} of ${total}`); assert.ok(pages > 100);
    // mid-history page is equally cheap
    const b1 = svc.store.stats.bytesRead; const mid = await api(base, 'GET', `/api/events?after=${Math.floor(total / 2)}&limit=10`);
    assert.equal(mid.json.events[0].seq, Math.floor(total / 2) + 1); assert.ok(svc.store.stats.bytesRead - b1 <= 64 * 1024);

    // validation
    for (const q of ['after=-1', 'after=abc', 'after=1.5', 'after=99999999999999999', 'limit=0', 'limit=501', 'limit=-3', 'limit=1e3', 'limit=']) {
      const r = await api(base, 'GET', `/api/events?${q}`); assert.equal(r.status, 400, q); assert.match(r.json.error, /^bad_(after|limit)$/);
    }
  } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); svc.stop(); }

  // restart: index rebuilt; same answers. Then rotation drops the oldest file: an honest retention gap is reported.
  const s2 = new Service(cfg, { log: () => {} }); s2.start(); quiet(s2);
  try {
    const a = await s2.readEvents(0, 1); assert.equal(a.events[0].seq, 1); assert.equal(a.gap, null);
    s2.store.appendEvents([{ seq: total + 1, tick: 1, type: 'filler', pad: 'y'.repeat(5_000_000) }]); // forces rotation
    const g = await s2.readEvents(0, 3);
    assert.ok(g.gap && g.gap.oldestAvailableSeq > 1, 'retention gap reported');
    assert.equal(g.events[0].seq, g.gap.oldestAvailableSeq);
  } finally { s2.stop(); }
});

test('event reads beyond the concurrency cap get an honest 503, not unbounded queued disk work', async () => {
  const { cfg } = bigHistory();
  const svc = new Service(deepCfg(cfg, { persistence: { maxConcurrentEventReads: 1 } }), { log: () => {} }); svc.start(); quiet(svc);
  try {
    const rs = await Promise.allSettled([svc.readEvents(0, 500), svc.readEvents(0, 500)]);
    assert.equal(rs[0].status, 'fulfilled'); assert.equal(rs[1].status, 'rejected'); assert.ok(rs[1].reason.busy);
  } finally { svc.stop(); }
});
const deepCfg = (a, b) => { const c = structuredClone(a); for (const k of Object.keys(b)) Object.assign(c[k], b[k]); return c; };

test('rate limits: creature detail and list share the public limiter, 429 has Retry-After, recovery after window', async () => {
  let t = 1_700_000_000_000; const now = () => t;
  const app = await startApp({ server: { rateLimit: { publicGet: 5, windowMs: 10_000 } } }, { manualTicks: true, now });
  try {
    quiet(app.svc);
    const id = app.svc.world.creatures[0].id;
    for (let i = 0; i < 5; i++) assert.equal((await api(app.base, 'GET', `/api/creatures/${id}`)).status, 200);
    const r = await fetch(`${app.base}/api/creatures/${id}`);
    assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '10'); assert.equal((await r.json()).error, 'rate_limited');
    assert.equal((await api(app.base, 'GET', '/api/creatures')).status, 429, 'list endpoint is limited too');
    assert.equal((await api(app.base, 'GET', '/api/creatures/999999')).status, 429, 'unknown ids are limited before lookup');
    assert.equal((await api(app.base, 'GET', '/health')).status, 200, 'container health check is not limited');
    t += 10_000;
    assert.equal((await api(app.base, 'GET', `/api/creatures/${id}`)).status, 200, 'recovers after the window');
    assert.equal((await api(app.base, 'GET', '/api/creatures')).status, 200);
  } finally { await app.stop(); }
});

const getXff = (base, p, xff) => new Promise((res, rej) => http.get(base + p, { headers: { 'X-Forwarded-For': xff } }, (r) => { r.resume(); r.on('end', () => res(r.statusCode)); }).on('error', rej));

test('spoofed X-Forwarded-For cannot bypass limits (Caddy deployment: TRUST_PROXY=1, proxy on private network)', async () => {
  let t = 1_700_000_000_000;
  const app = await startApp({ server: { trustProxy: true, rateLimit: { publicGet: 3, windowMs: 60_000 } } }, { manualTicks: true, now: () => t });
  try {
    quiet(app.svc);
    // Client rotates a forged left-most entry; the proxy-observed address (right-most) is the same every time.
    const codes = []; for (let i = 0; i < 6; i++) codes.push(await getXff(app.base, '/api/creatures', `10.0.0.${i}, 203.0.113.7`));
    assert.deepEqual(codes, [200, 200, 200, 429, 429, 429]);
    assert.equal(await getXff(app.base, '/api/creatures', '198.51.100.9'), 200, 'a different real client has its own bucket');
  } finally { await app.stop(); }
  // If the TCP peer is not a trusted proxy (server port reached directly), X-Forwarded-For is ignored entirely.
  const cfg = testConfig({ server: { trustProxy: true, trustedProxies: ['10.9.9.9/32'] } });
  assert.equal(clientIp({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '1.2.3.4' } }, cfg), '127.0.0.1');
  cfg.server.trustedProxies = []; cfg.server.trustProxy = false;
  assert.equal(clientIp({ socket: { remoteAddress: '172.18.0.3' }, headers: { 'x-forwarded-for': '1.2.3.4' } }, cfg), '172.18.0.3');
  cfg.server.trustProxy = true;
  assert.equal(clientIp({ socket: { remoteAddress: '::ffff:172.18.0.3' }, headers: { 'x-forwarded-for': 'spoof, 1.2.3.4' } }, cfg), '1.2.3.4');
  assert.equal(clientIp({ socket: { remoteAddress: '8.8.8.8' }, headers: { 'x-forwarded-for': '1.2.3.4' } }, cfg), '8.8.8.8');
});

test('WebSocket upgrade and resync share the public-read budget and close on resync abuse', async () => {
  let t = 1_700_000_000_000;
  const app = await startApp({ server: { rateLimit: { publicGet: 3, windowMs: 60_000 } } }, { manualTicks: true, now: () => t });
  try {
    quiet(app.svc);
    const ws = await wsClient(app.base);
    ws.ws.send(JSON.stringify({ type: 'resync', after: 0 })); // bucket 2
    ws.ws.send(JSON.stringify({ type: 'resync', after: 0 })); // bucket 3
    const closed = new Promise((resolve) => { ws.ws.onclose = () => resolve(true); });
    ws.ws.send(JSON.stringify({ type: 'resync', after: 0 })); // exceeds the same bucket
    assert.equal(await Promise.race([closed, new Promise((r) => setTimeout(() => r(false), 1000))]), true);
    // The same limit is checked before the WebSocket handshake, too.
    await assert.rejects(async () => {
      const x = new WebSocket(app.base.replace('http', 'ws') + '/ws');
      await new Promise((resolve, reject) => { x.onopen = resolve; x.onerror = () => reject(new Error('rate limited')); });
    }, /rate limited/);
  } finally { await app.stop(); }
});

test('event API and WebSocket snapshots expose only committed cursors across a crash/restart', async () => {
  const cfg = testConfig({ world: { tickMs: 1000 } });
  const s1 = new Service(cfg, { log: () => {} }); s1.start(); quiet(s1);
  const committed = s1.committedSeq, epoch = s1.bootEpoch;
  for (let i = 0; i < 80 && s1.world.seq === committed; i++) s1.tickOnce();
  assert.ok(s1.world.seq > committed, 'test needs an uncommitted event');
  const before = await s1.readEvents(committed, 10);
  assert.deepEqual(before.events, []); assert.equal(before.latestSeq, committed);
  assert.equal(JSON.parse(s1.snapshotMessage(committed)).seq, committed);
  // SIGKILL-like release: event lines exist but the snapshot remains at committed.
  s1.store.release();
  const s2 = new Service(cfg, { log: () => {} }); s2.start(); quiet(s2);
  const iv = s2.world.intervene({ id: 'cursor-restart-01', type: 'storm', x: 20, y: 20, radius: 3, intensity: 0.5 }, '0xdeveloper');
  assert.equal(iv.ok, true); s2.snapshot(true);
  const after = await s2.readEvents(committed, 10);
  assert.equal(after.events[0].type, 'intervention');
  assert.equal(after.events[0].seq, committed + 1);
  assert.notEqual(after.epoch, epoch, 'clients can additionally reset state when a process boot changes');
  s2.stop();
});

test('HTTP intervention retry returns 503 until failed event or ledger append is repaired', async () => {
  const app = await startApp({ interventions: { cooldownTicks: { add_food: 0 } } }, { manualTicks: true });
  const original = fs.writeSync;
  try {
    quiet(app.svc);
    const token = (await login(app.base, DEV_KEY)).json.token;
    const submit = (body) => api(app.base, 'POST', '/api/dev/interventions', { body, token });
    const eventFd = app.svc.store.fds['events.jsonl']; let fail = true;
    fs.writeSync = function (fd, ...args) { if (fd === eventFd && fail) { fail = false; const e = new Error('ENOSPC'); e.code = 'ENOSPC'; throw e; } return original.call(this, fd, ...args); };
    const a = { id: 'http-event-fail-01', type: 'add_food', x: 28, y: 28, radius: 4, intensity: 0.5 };
    assert.equal((await submit(a)).status, 503);
    fs.writeSync = original;
    const ar = await submit(a); assert.equal(ar.status, 200); assert.equal(ar.json.duplicate, true);
    assert.equal(lines(path.join(app.dataDir, 'events.jsonl')).filter((x) => x.type === 'intervention' && x.id === a.id).length, 1);

    const ledgerFd = app.svc.store.fds['interventions.jsonl']; fail = true;
    fs.writeSync = function (fd, ...args) { if (fd === ledgerFd && fail) { fail = false; const e = new Error('ENOSPC'); e.code = 'ENOSPC'; throw e; } return original.call(this, fd, ...args); };
    const b = { ...a, id: 'http-ledger-fail2', x: 29 };
    assert.equal((await submit(b)).status, 503);
    fs.writeSync = original;
    const br = await submit(b); assert.equal(br.status, 200); assert.equal(br.json.duplicate, true);
    assert.equal(lines(path.join(app.dataDir, 'interventions.jsonl')).filter((x) => x.record.id === b.id).length, 1);
  } finally { fs.writeSync = original; await app.stop(); }
});

test('a stale numeric PID-1 lock is not considered live by an offline one-shot container/tool', () => {
  const dir = tmpDir('stale-pid');
  fs.writeFileSync(path.join(dir, 'server.lock'), String(process.pid));
  assert.equal(writerIsLive(dir), false);
});

test('LEARNING: explicit change applies on restart without erasing weights/memory; unset keeps stored; invalid fails startup', () => {
  const cfg = testConfig({ world: { tickMs: 1000 } });
  const run = (over, n) => {
    const c = structuredClone(cfg); Object.assign(c.world, over);
    const s = new Service(c, { log: () => {} }); s.start(); quiet(s);
    const before = s.world.creatures.reduce((a, x) => a + x.brain.updates, 0);
    for (let i = 0; i < n; i++) s.tickOnce();
    const after = s.world.creatures.reduce((a, x) => a + x.brain.updates, 0);
    const out = { learning: s.world.learning, policy: s.learningPolicy, updates: after - before, brains: JSON.stringify(s.world.creatures.map((x) => [x.id, x.brain.w])), mem: JSON.stringify(s.world.creatures.map((x) => x.memories)), events: s.world.events.filter((e) => e.type === 'learning_changed').length };
    s.stop(); return out;
  };
  const a = run({}, 2000); assert.equal(a.learning, true); assert.ok(a.updates > 0);
  // disable explicitly: applied, learned weights + memories identical right after restart, no further updates
  const c = structuredClone(cfg); c.world.learning = false; c.world.learningSource = 'env';
  const s = new Service(c, { log: () => {} }); s.start(); quiet(s);
  assert.equal(s.world.learning, false); assert.equal(s.learningPolicy.action, 'disabled');
  assert.equal(JSON.stringify(s.world.creatures.map((x) => [x.id, x.brain.w])), a.brains, 'weights preserved');
  assert.equal(JSON.stringify(s.world.creatures.map((x) => x.memories)), a.mem, 'memories preserved');
  s.stop();
  const b = run({ learning: false, learningSource: 'env' }, 1500);
  assert.equal(b.learning, false); assert.equal(b.updates, 0, 'no learning updates while disabled'); assert.equal(b.policy.action, 'unchanged');
  // not configured: keeps stored (disabled) and says so in status
  const d = run({ learning: true, learningSource: 'default' }, 200); assert.equal(d.learning, false); assert.equal(d.policy.source, 'default'); assert.equal(d.updates, 0);
  // re-enable explicitly
  const e = run({ learning: true, learningSource: 'file' }, 1500); assert.equal(e.learning, true); assert.ok(e.updates > 0); assert.equal(e.policy.action, 'enabled');
  assert.equal(e.events, 2, 'both changes recorded as learning_changed events');
  // config parsing
  assert.equal(loadConfig({ LEARNING: '0' }, []).world.learningSource, 'env');
  assert.equal(loadConfig({ LEARNING: 'true' }, []).world.learning, true);
  assert.equal(loadConfig({}, []).world.learningSource, 'default');
  assert.throws(() => loadConfig({ LEARNING: 'off' }, []), /LEARNING=off is invalid: use LEARNING=1/);
});

test('GET /api/status reports the learning policy', async () => {
  const app = await startApp({}, { manualTicks: true });
  try { const r = await api(app.base, 'GET', '/api/status'); assert.equal(r.json.learning, true); assert.equal(r.json.learningPolicy.enabled, true); assert.match(r.json.learningPolicy.policy, /explicit LEARNING/); }
  finally { await app.stop(); }
});

test('intervention idempotency is scoped to world + authenticated actor + id, persisted across restart', async () => {
  const devB = addressFromPrivateKey(VIS2_KEY);
  const app = await startApp({ auth: { developerWallets: [addressFromPrivateKey(DEV_KEY), devB] }, interventions: { cooldownTicks: { add_food: 0 } } }, { manualTicks: true });
  try {
    quiet(app.svc);
    const A = (await login(app.base, DEV_KEY)).json, B = (await login(app.base, VIS2_KEY)).json;
    assert.equal(B.role, 'developer');
    const body = { id: 'shared-id-0001', type: 'add_food', x: 28, y: 28, radius: 4, intensity: 0.5 };
    const a1 = await api(app.base, 'POST', '/api/dev/interventions', { body, token: A.token });
    assert.equal(a1.status, 200); assert.equal(a1.json.duplicate, false); assert.equal(a1.json.record.actor, A.address);
    const a2 = await api(app.base, 'POST', '/api/dev/interventions', { body, token: A.token });
    assert.equal(a2.json.duplicate, true, 'same actor + same payload: applied once');
    assert.equal((await api(app.base, 'POST', '/api/dev/interventions', { body: { ...body, x: 10 }, token: A.token })).status, 409, 'same actor, changed payload: conflict');
    const b1 = await api(app.base, 'POST', '/api/dev/interventions', { body, token: B.token });
    assert.equal(b1.status, 200); assert.equal(b1.json.duplicate, false, 'second actor is never handed the first actor\'s record');
    assert.equal(b1.json.record.actor, devB);
    assert.equal(app.svc.world.totals.interventions, 2);
    const list = await api(app.base, 'GET', '/api/dev/interventions', { token: A.token });
    assert.deepEqual(list.json.interventions.map((r) => r.actor), [A.address, devB]);
    // visitor wallet still forbidden
    const v = (await login(app.base, VIS_KEY)).json; assert.equal((await api(app.base, 'POST', '/api/dev/interventions', { body, token: v.token })).status, 403);
    const cfg = app.cfg; await app.stop();
    const s2 = new Service(cfg, { log: () => {} }); s2.start(); quiet(s2);
    assert.equal(s2.world.intervene(body, A.address).duplicate, true);
    assert.equal(s2.world.intervene(body, devB.toUpperCase().replace('0X', '0x')).duplicate, true, 'actor key is case-insensitive');
    assert.equal(s2.world.totals.interventions, 2); s2.stop();
  } catch (e) { await app.stop().catch(() => {}); throw e; }
});

test('schema v1 -> v2 migration re-keys existing intervention IDs to their original actor', () => {
  const rec = { id: 'legacy-id-0001', request: { type: 'fire', x: 1, y: 1, radius: 1, intensity: 1 }, actor: '0xAbC', appliedTick: 5 };
  const { snap, from, to } = migrate({ schemaVersion: 1, state: { interventions: { 'legacy-id-0001': rec, 'orphan-0002': { id: 'orphan-0002' } }, interventionOrder: ['legacy-id-0001', 'orphan-0002'] } });
  assert.equal(from, 1); assert.equal(to, 3);
  assert.deepEqual(snap.state.interventionOrder, ['0xabc:legacy-id-0001', 'legacy-unknown:orphan-0002']);
  assert.equal(snap.state.interventions['0xabc:legacy-id-0001'].migratedFromKey, 'legacy-id-0001');
});
