import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Service } from '../server/src/service.js';
import { Store, restoreBackup } from '../server/src/store.js';
import { migrate } from '../server/src/migrations.js';
import { startApp, api, login, wsClient, until, sleep, testConfig, hash, runTicks, DEV_KEY, VIS_KEY } from './helpers.js';
import { World } from '../server/src/world.js';

const step = (svc, n) => { for (let i = 0; i < n; i++) svc.tickOnce(); };

test('two clients share identical state; reconnect resyncs without duplicate events', async () => {
  const app = await startApp({ world: { tickMs: 20 } });
  try {
    const a = await wsClient(app.base), b = await wsClient(app.base);
    await until(() => a.tick > 10 && b.tick > 10);
    assert.ok(a.entities.size > 24);
    // pause to compare at an identical tick
    clearTimeout(app.svc.timer); app.svc.running = false;
    await sleep(100);
    assert.equal(a.tick, b.tick);
    assert.deepEqual([...a.entities.keys()].sort(), [...b.entities.keys()].sort());
    for (const [k, v] of a.entities) assert.deepEqual(v, b.entities.get(k));
    assert.equal(a.gaps, 0);
    const creatures = [...a.entities.values()].filter((e) => e.k.startsWith('c:')).length;
    assert.equal(creatures, app.svc.world.creatures.length);
    // reconnect with after=seq: events deduped by seq
    const lastSeq = Math.max(0, ...a.events.keys());
    app.svc.running = true; app.svc.due = performance.now(); app.svc.timer = setTimeout(() => {}, 0);
    step(app.svc, 3);
    const c = await wsClient(app.base, lastSeq - 5);
    await until(() => c.tick === app.svc.world.tick);
    const seqs = [...c.events.keys()]; assert.equal(new Set(seqs).size, seqs.length);
    assert.ok(seqs.every((s) => s > lastSeq - 5));
    a.ws.close(); b.ws.close(); c.ws.close();
  } finally { await app.stop(); }
});

test('unauthorized access to developer endpoints is rejected; visitor token is not enough', async () => {
  const app = await startApp();
  try {
    const body = { id: 'unauth-test-001', type: 'add_food', x: 20, y: 20, radius: 3, intensity: 0.5 };
    assert.equal((await api(app.base, 'POST', '/api/dev/interventions', { body })).status, 401);
    assert.equal((await api(app.base, 'POST', '/api/dev/interventions', { body, token: 'garbage' })).status, 401);
    const v = await login(app.base, VIS_KEY);
    assert.equal((await api(app.base, 'POST', '/api/dev/interventions', { body, token: v.json.token })).status, 403);
    assert.equal((await api(app.base, 'POST', '/api/dev/reset', { body: {}, token: v.json.token })).status, 403);
    assert.equal((await api(app.base, 'POST', '/api/dev/backup', {})).status, 401);
    assert.equal((await api(app.base, 'GET', '/api/dev/interventions', {})).status, 401);
    // bad WebSocket origin refused
    await assert.rejects(async () => { const ws = new WebSocket(app.base.replace('http', 'ws') + '/ws', { headers: { Origin: 'https://evil.test' } }); await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('refused')); }); });
  } finally { await app.stop(); }
});

test('duplicate intervention ids apply once, survive restart; id reuse with different body is rejected', async () => {
  const app = await startApp({ interventions: { cooldownTicks: { add_food: 0 } } });
  try {
    const dev = await login(app.base, DEV_KEY); const token = dev.json.token;
    clearTimeout(app.svc.timer); app.svc.running = false;
    const body = { id: 'dup-test-0001', type: 'add_food', x: 28, y: 28, radius: 8, intensity: 1 };
    const f0 = app.svc.world.totalFood();
    const r1 = await api(app.base, 'POST', '/api/dev/interventions', { body, token });
    assert.equal(r1.status, 200); assert.equal(r1.json.duplicate, false);
    const f1 = app.svc.world.totalFood(); assert.ok(f1 > f0);
    const r2 = await api(app.base, 'POST', '/api/dev/interventions', { body, token });
    assert.equal(r2.status, 200); assert.equal(r2.json.duplicate, true); assert.equal(app.svc.world.totalFood(), f1);
    assert.equal((await api(app.base, 'POST', '/api/dev/interventions', { body: { ...body, radius: 5 }, token })).status, 409);
    assert.equal((await api(app.base, 'POST', '/api/dev/interventions', { body: { ...body, id: 'x' }, token })).status, 400);
    assert.equal(app.svc.world.totals.interventions, 1);
    // durable record + restart: retry after "crash" is still a duplicate
    const lines = fs.readFileSync(path.join(app.dataDir, 'interventions.jsonl'), 'utf8').trim().split('\n'); assert.equal(lines.length, 1);
    const cfg = app.cfg; await app.stop();
    const svc2 = new Service(cfg, { log: () => {} }); svc2.start(); clearTimeout(svc2.timer); svc2.running = false;
    const dup = svc2.world.intervene(body, dev.json.address); assert.ok(dup.ok && dup.duplicate);
    assert.equal(svc2.world.totals.interventions, 1);
    svc2.stop();
  } catch (e) { await app.stop().catch(() => {}); throw e; }
});

test('restart recovery: same world, learned state retained, no reseed, no duplicate world_created', () => {
  const cfg = testConfig({ world: { tickMs: 1000 } });
  const s1 = new Service(cfg, { log: () => {} }); s1.start(); clearTimeout(s1.timer);
  step(s1, 2500);
  const id = s1.world.id, ids = s1.world.creatures.map((c) => c.id), brains = JSON.stringify(s1.world.creatures.map((c) => c.brain)), tick = s1.world.tick;
  const mem = JSON.stringify(s1.world.creatures.map((c) => [c.memories, c.relationships]));
  assert.ok(s1.world.creatures.some((c) => c.brain.updates > 0));
  s1.stop();
  const s2 = new Service(cfg, { log: () => {} }); s2.start(); clearTimeout(s2.timer);
  assert.equal(s2.world.id, id); assert.deepEqual(s2.world.creatures.map((c) => c.id), ids);
  assert.equal(JSON.stringify(s2.world.creatures.map((c) => c.brain)), brains);
  assert.equal(JSON.stringify(s2.world.creatures.map((c) => [c.memories, c.relationships])), mem);
  assert.equal(s2.world.tick, tick);
  assert.equal(s2.world.events.filter((e) => e.type === 'world_created').length, 1);
  assert.ok(s2.world.creatures.length > 0);
  // continued determinism: resumed world equals an uninterrupted run
  const ref = World.create(cfg); runTicks(ref, 2500);
  runTicks(s2.world, 300); runTicks(ref, 300);
  assert.equal(hash(s2.world.toState().creatures), hash(ref.toState().creatures));
  s2.stop();
});

test('corrupt snapshots never trigger a silent new world; fallback to previous snapshot works', () => {
  // Controlled clock: no wall-time passes between save and restart unless the test advances it explicitly.
  let t = 1_800_000_000_000; const now = () => t;
  const cfg = testConfig();
  const s1 = new Service(cfg, { log: () => {}, now }); s1.start(); clearTimeout(s1.timer); step(s1, 50); s1.snapshot(); step(s1, 50); s1.snapshot();
  clearInterval(s1.snapTimer); s1.running = false; s1.store.release(); // crash-like stop: no final snapshot
  const dir = cfg.server.dataDir;
  const prevTick = JSON.parse(fs.readFileSync(path.join(dir, 'world.prev.json'), 'utf8')).state.tick;
  assert.equal(prevTick, 50);
  fs.writeFileSync(path.join(dir, 'world.json'), '{"broken":');
  const s2 = new Service(cfg, { log: () => {}, now }); s2.start(); clearTimeout(s2.timer);
  assert.equal(s2.world.tick, 50, 'recovered exactly the world.prev.json state, no catch-up with a frozen clock');
  assert.ok(fs.readdirSync(path.join(dir, 'recovery')).some((n) => n.startsWith('world.json.unreadable')), 'unreadable snapshot kept as evidence');
  s2.stop();
  // Explicit catch-up assertion: 30 ticks of downtime (> 5-tick threshold) after a corrupt latest snapshot.
  const s2b = new Service(cfg, { log: () => {}, now }); s2b.start(); clearTimeout(s2b.timer); s2b.stop();
  fs.copyFileSync(path.join(dir, 'world.json'), path.join(dir, 'world.prev.json')); fs.writeFileSync(path.join(dir, 'world.json'), 'garbage');
  t += 30 * cfg.world.tickMs;
  const s2c = new Service(cfg, { log: () => {}, now }); s2c.start(); clearTimeout(s2c.timer);
  assert.equal(s2c.world.tick, 50 + 30, 'fallback + exactly the elapsed catch-up ticks');
  assert.equal(s2c.world.events.filter((e) => e.type === 'downtime').at(-1).ticksSimulated, 30);
  s2c.stop();
  fs.writeFileSync(path.join(dir, 'world.json'), 'x'); fs.writeFileSync(path.join(dir, 'world.prev.json'), 'y');
  const s3 = new Service(cfg, { log: () => {} });
  assert.throws(() => s3.start(), /Refusing to create a new world/);
});

test('downtime: capped, non-lethal catch-up; no mass death after a long outage', () => {
  const cfg = testConfig({ world: { tickMs: 1000, initialSeedCount: 10 } });
  const s1 = new Service(cfg, { log: () => {} }); s1.start(); clearTimeout(s1.timer);
  for (const c of s1.world.creatures) { c.hunger = 99; c.health = 5; }
  s1.world.creatures.forEach((c) => (c.act = null));
  s1.snapshot(); s1.store.save(s1.world.toState(), Date.now() - 7 * 24 * 3600 * 1000); s1.store.release();
  const s2 = new Service(cfg, { log: () => {} }); s2.start(); clearTimeout(s2.timer);
  assert.equal(s2.world.tick, s1.world.tick + cfg.world.catchup.maxTicks, 'only maxTicks simulated');
  assert.equal(s2.world.creatures.length, 10, 'nobody died during catch-up');
  const ev = s2.world.events.find((e) => e.type === 'downtime'); assert.ok(ev && ev.ticksSimulated === cfg.world.catchup.maxTicks);
  s2.stop();
});

test('backup and restore bring back an earlier state; tampered backup is refused', () => {
  const cfg = testConfig();
  const s = new Service(cfg, { log: () => {} }); s.start(); clearTimeout(s.timer); step(s, 300); s.snapshot();
  const dir = s.store.backup('b1'); const tick = s.world.tick, h = hash(s.world.toState().creatures);
  step(s, 400); s.snapshot(); assert.notEqual(s.world.tick, tick); s.stop();
  assert.throws(() => { fs.appendFileSync(path.join(dir, 'world.json'), ' '); restoreBackup(cfg.server.dataDir, dir); }, /checksum/);
  fs.writeFileSync(path.join(dir, 'world.json'), fs.readFileSync(path.join(dir, 'world.json'), 'utf8').trimEnd());
  // rebuild a clean backup (the tampering above was reverted by trimming the appended space)
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const res = restoreBackup(cfg.server.dataDir, dir); assert.ok(res.previousMovedTo);
  const s2 = new Service(cfg, { log: () => {} }); s2.start(); clearTimeout(s2.timer);
  assert.equal(s2.world.tick >= tick && s2.world.tick <= tick + cfg.world.catchup.maxTicks, true);
  s2.stop();
  assert.ok(fs.existsSync(path.join(cfg.server.dataDir, 'archive')));
});

test('schema migration from legacy v0 snapshot; newer schemas refused', () => {
  const snap = { schemaVersion: 0, state: { creatures: [{ id: 1, hp: 77 }], totals: {} } };
  const { snap: out, from, to } = migrate(snap);
  assert.equal(from, 0); assert.equal(to, 3); assert.equal(out.state.creatures[0].health, 77); assert.equal(out.state.totals.interventions, 0);
  assert.throws(() => migrate({ schemaVersion: 99, state: {} }), /newer/);
});

test('developer reset: requires auth + confirmation; archives; extinct world stays extinct until then', async () => {
  const app = await startApp({ world: { initialSeedCount: 3, bush: { initial: 0, regrow: 0, spread: 0 }, hungerRate: 5 } });
  try {
    clearTimeout(app.svc.timer); app.svc.running = false;
    for (let i = 0; i < 4000 && app.svc.world.status === 'alive'; i++) app.svc.tickOnce();
    assert.equal(app.svc.world.status, 'extinct');
    const oldId = app.svc.world.id;
    step(app.svc, 100); assert.equal(app.svc.world.totals.births, 0);
    const dev = await login(app.base, DEV_KEY);
    assert.equal((await api(app.base, 'POST', '/api/dev/reset', { body: { confirm: 'yes' }, token: dev.json.token })).status, 400);
    const ok = await api(app.base, 'POST', '/api/dev/reset', { body: { confirm: `RESET ${oldId}`, initialSeedCount: 5 }, token: dev.json.token });
    assert.equal(ok.status, 200);
    assert.notEqual(app.svc.world.id, oldId); assert.equal(app.svc.world.creatures.length, 5);
    assert.ok(fs.readdirSync(path.join(app.dataDir, 'archive')).length >= 1);
  } finally { await app.stop(); }
});

test('visitor endpoints over HTTP: gift and startle with wallet sessions', async () => {
  const app = await startApp({ world: { visitor: { giftCooldown: 5, harmCooldown: 5 } } });
  try {
    clearTimeout(app.svc.timer); app.svc.running = false;
    const v = await login(app.base, VIS_KEY); const token = v.json.token;
    assert.equal((await api(app.base, 'POST', '/api/visitor/action', { body: { type: 'gift_food' } })).status, 401);
    const c = app.svc.world.creatures[0];
    assert.equal((await api(app.base, 'POST', '/api/visitor/presence', { body: { x: c.x, y: c.y }, token })).status, 200);
    assert.equal((await api(app.base, 'POST', '/api/visitor/action', { body: { type: 'gift_food' }, token })).status, 200);
    assert.equal((await api(app.base, 'POST', '/api/visitor/action', { body: { type: 'gift_food' }, token })).status, 429);
    assert.equal((await api(app.base, 'POST', '/api/visitor/action', { body: { type: 'startle' }, token })).status, 200);
    const d = await api(app.base, 'GET', `/api/creatures/${app.svc.world.creatures.find((x) => x.memories.length)?.id ?? c.id}`);
    assert.equal(d.status, 200); assert.ok(d.json.note.includes('template'));
    const st = await api(app.base, 'GET', '/api/status'); assert.ok(st.json.tickLatencyMs && st.json.world.population >= 24);
  } finally { await app.stop(); }
});
