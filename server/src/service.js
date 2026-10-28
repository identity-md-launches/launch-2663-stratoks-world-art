import { setBrainMode } from './controller.js';
// Tick loop, persistence cadence, broadcast hub, overload accounting. The simulation (world.js) knows nothing about this.
import os from 'node:os';
import crypto from 'node:crypto';
import { World } from './world.js';
import { Store } from './store.js';
import { buildView, tileRows, worldMeta } from './view.js';

export class Service {
  // `now` is an injectable wall clock (downtime catch-up, snapshot time, rate limits) so tests are deterministic.
  constructor(cfg, { log = () => {}, now = Date.now } = {}) {
    this.cfg = cfg; this.log = log; this.now = now; this.store = new Store(cfg.server.dataDir, cfg.persistence);
    this.clients = new Set(); this.cache = new Map(); this.msgN = 0;
    this.pendingRecords = { lifecycle: [], intervention: [] }; this.committedSeq = 0; this.publishedSeq = 0;
    // Deliberately changes on every process start. Clients that retain a cursor across a crash/restart can
    // distinguish a new durability epoch even if a legacy client had seen an uncommitted sequence number.
    this.bootEpoch = crypto.randomUUID();
    this.lat = []; this.latMax = 0; this.lagMs = 0; this.overloaded = false; this.skippedBroadcasts = 0;
    this.cpuPrev = process.cpuUsage(); this.cpuPrevT = process.hrtime.bigint(); this.cpuPct = 0;
    this.running = false; this.startedAt = now();
  }

  start() {
    this.store.init();
    const loaded = this.store.load();
    if (loaded) {
      // Crash recovery: the snapshot is the commit point; log records past its seq belong to an uncommitted future.
      this.recovery = this.store.recover(loaded.state.seq);
      for (const [n, m] of Object.entries(this.recovery.moved)) this.log('warn', `recovery: moved ${m.lines} uncommitted record(s) after seq ${loaded.state.seq} from ${n} to ${m.orphanFile}`);
      this.world = World.fromState(this.cfg, loaded.state);
      this.log('info', `loaded world ${this.world.id} at tick ${this.world.tick}${loaded.usedFallback ? ' (from previous snapshot)' : ''}${loaded.migratedFrom !== undefined && loaded.migratedFrom < 3 ? ` (migrated from schema ${loaded.migratedFrom})` : ''}`);
      this.#wire();
      this.#applyLearningPolicy();
      this.#catchup(loaded.savedAtWall);
    } else {
      this.recovery = { committedSeq: 0, moved: {} };
      this.world = World.create(this.cfg);
      this.log('info', `created NEW world ${this.world.id} with ${this.world.creatures.length} initial Stratoks`);
      this.#wire();
      this.#applyLearningPolicy();
    }
    this.snapshot(true); // commit recovery/catch-up/learning-policy results before serving
    this.#prime();
    this.running = true;
    this.due = performance.now() + this.cfg.world.tickMs;
    this.timer = setTimeout(() => this.#loop(), this.cfg.world.tickMs);
    this.snapTimer = setInterval(() => this.snapshot(), this.cfg.persistence.snapshotEveryMs);
    this.snapTimer.unref?.();
  }
  #prime() { this.cache = new Map(); for (const [k, v] of buildView(this.world)) this.cache.set(k, { s: JSON.stringify(v), v }); }
  // LEARNING policy for an existing world (documented in server/docs/LEARNING.md):
  //  * explicitly configured (env LEARNING or config file world.learning): applied on start. Weights, memories and
  //    wallet opinions are kept untouched; only whether further updates happen changes. Recorded as a
  //    `learning_changed` event and in world.learningLog.
  //  * not configured: the world keeps its stored setting, and the log says so.
  #applyLearningPolicy() {
    if (this.cfg.world.brainModeSource !== 'default' && this.cfg.world.brainModeSource) setBrainMode(this.world, this.cfg.world.brainMode, this.cfg.world.brainModeSource);
    const w = this.world, src = this.cfg.world.learningSource ?? 'default', want = !!this.cfg.world.learning;
    let action = 'unchanged';
    if (src !== 'default' && want !== w.learning) {
      const from = w.learning; w.learning = want; action = want ? 'enabled' : 'disabled';
      (w.learningLog ??= []).push({ tick: w.tick, from, to: want, source: src });
      w.emit('learning_changed', { from, to: want, source: src, note: 'weights, memories and wallet opinions preserved' });
      this.log('warn', `LEARNING ${action} for existing world ${w.id} by ${src} configuration (weights and memories preserved)`);
    } else if (src === 'default' && want !== w.learning) {
      this.log('info', `LEARNING not configured: world ${w.id} keeps its stored setting learning=${w.learning}`);
    }
    this.learningPolicy = { enabled: w.learning, configured: src === 'default' ? null : want, source: src, action, policy: 'explicit LEARNING applies on restart without erasing weights/memory; unset keeps the stored world setting', log: (w.learningLog ?? []).slice(-10) };
  }
  #wire() {
    this.world.onRecord = (r) => this.pendingRecords[r.kind === 'intervention' ? 'intervention' : 'lifecycle'].push(r);
  }
  // Downtime policy: world time is PAUSED while the server is down. On restart at most catchup.maxTicks ticks are
  // simulated, with non-lethal damage and no births, so an outage can never kill the population in one burst.
  #catchup(savedAtWall) {
    const down = Math.max(0, this.now() - savedAtWall), c = this.cfg.world.catchup;
    const n = Math.min(c.maxTicks, Math.floor(down / this.cfg.world.tickMs));
    if (down > this.cfg.world.tickMs * 5) {
      for (let i = 0; i < n; i++) this.world.step({ catchup: !c.lethal });
      this.world.catchup = false;
      this.world.emit('downtime', { downSeconds: Math.round(down / 1000), ticksSimulated: n, maxTicks: c.maxTicks, policy: 'world time paused during downtime; capped non-lethal catch-up' });
      this.log('warn', `downtime ${Math.round(down / 1000)}s: simulated ${n} catch-up ticks (cap ${c.maxTicks}), remaining downtime not simulated`);
    }
  }

  #loop() {
    if (!this.running) return;
    const t0 = performance.now();
    this.tickOnce();
    const t1 = performance.now(), cost = t1 - t0, T = this.cfg.world.tickMs;
    this.#record(cost);
    // Overload policy: never burst-catch-up, never drop creatures. If late, the world simply runs slower (time dilation).
    this.due += T; this.lagMs = Math.max(0, t1 - this.due);
    if (this.lagMs > T) this.due = t1;
    this.timer = setTimeout(() => this.#loop(), Math.max(0, this.due - performance.now()));
  }
  tickOnce() {
    this.world.step();
    this.#flushEvents();
    const p95 = this.#pct(0.95);
    this.overloaded = p95 > this.cfg.world.tickMs * 0.8 || this.lagMs > this.cfg.world.tickMs;
    if (this.overloaded && this.world.tick % 2 === 1) { this.skippedBroadcasts++; return; } // shed rendering work, not simulation
    this.broadcast();
  }
  #flushEvents() {
    // Preserve queues on every append failure.  Store append methods roll back a partial line, so retrying this
    // exact queue is safe and cannot create a second lifecycle/intervention/event record.
    for (const [kind, append] of [['lifecycle', 'appendLifecycle'], ['intervention', 'appendIntervention']]) {
      const q = this.pendingRecords[kind];
      while (q.length) { this.store[append](q[0]); q.shift(); }
    }
    const evs = this.world.pendingEvents();
    if (evs.length) { this.store.appendEvents(evs); this.world.acknowledgeEvents(evs.length); }
  }
  #record(ms) {
    this.lat.push(ms); if (this.lat.length > 600) this.lat.shift(); this.latMax = Math.max(this.latMax, ms);
    const now = process.hrtime.bigint(), cpu = process.cpuUsage(this.cpuPrev);
    if (now - this.cpuPrevT > 5_000_000_000n) { this.cpuPct = Math.round(((cpu.user + cpu.system) / 1000) / (Number(now - this.cpuPrevT) / 1e6) * 1000) / 10; this.cpuPrev = process.cpuUsage(); this.cpuPrevT = now; }
  }
  #pct(p) { if (!this.lat.length) return 0; const s = [...this.lat].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }

  broadcast() {
    const next = buildView(this.world), upsert = [], rm = [], newCache = new Map();
    for (const [k, v] of next) { const str = JSON.stringify(v); newCache.set(k, { s: str, v }); if (this.cache.get(k)?.s !== str) upsert.push(v); }
    for (const k of this.cache.keys()) if (!newCache.has(k)) rm.push(k);
    this.cache = newCache;
    // Do not publish a cursor past the snapshot commit point.  The entities are live presentation data, but
    // event cursors are durable API state and must never be reused after a crash rewind.
    const events = this.world.events.filter((e) => e.seq > this.publishedSeq && e.seq <= this.committedSeq);
    if (events.length) this.publishedSeq = events.at(-1).seq;
    if (!this.clients.size) return;
    const msg = JSON.stringify({ type: 'delta', n: ++this.msgN, tick: this.world.tick, seq: this.committedSeq, liveSeq: this.world.seq, epoch: this.bootEpoch, serverTime: Date.now(), upsert, remove: rm, events, meta: worldMeta(this.world, this.cfg), health: this.health() });
    for (const c of this.clients) {
      if (c.backlog > this.cfg.server.maxWsBufferBytes) { c.close(1013); this.clients.delete(c); continue; } // drop slow viewer, never creatures
      c.send(msg);
    }
  }
  snapshotMessage(afterSeq = 0) {
    const w = this.world;
    const entities = [...this.cache.values()].map((e) => e.v);
    const events = w.events.filter((e) => e.seq > afterSeq && e.seq <= this.committedSeq).slice(-200);
    return JSON.stringify({ type: 'snapshot', n: this.msgN, tick: w.tick, seq: this.committedSeq, liveSeq: w.seq, epoch: this.bootEpoch, serverTime: Date.now(), world: { ...worldMeta(w, this.cfg), tiles: tileRows(w) }, entities, events, history: w.history.slice(-300), health: this.health(), demoMode: this.cfg.server.demoMode });
  }
  // Paginated event history: seq > after, ascending, <= limit. Recent events come from the in-memory ring (binary
  // search); older ones from the indexed durable log (bounded async read). Never scans all of history per request.
  // `gap` reports a retention gap: events after `after` and before `oldestAvailableSeq` were rotated away.
  async readEvents(after, limit) {
    const ring = this.world.events.filter((e) => e.seq <= this.committedSeq), latestSeq = this.committedSeq;
    const oldest = Math.min(this.store.oldestEventSeq() ?? Infinity, ring[0]?.seq ?? Infinity);
    let events, source;
    if (ring.length && after + 1 >= ring[0].seq) {
      let lo = 0, hi = ring.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ring[m].seq <= after) lo = m + 1; else hi = m; }
      events = ring.slice(lo, lo + limit); source = 'memory';
    } else {
      events = await this.store.readEvents(after, limit, this.committedSeq); source = 'log';
      if (events.length < limit && ring.length) { // continue seamlessly into the ring if the log page ran out
        const last = events.length ? events[events.length - 1].seq : after;
        for (const e of ring) { if (events.length >= limit) break; if (e.seq > last && e.seq <= latestSeq) events.push(e); }
      }
    }
    const gap = Number.isFinite(oldest) && after + 1 < oldest ? { requestedAfter: after, oldestAvailableSeq: oldest, note: 'older events were removed by log rotation' } : null;
    const nextAfter = events.length ? events[events.length - 1].seq : Math.max(after, gap ? oldest - 1 : after);
    return { events, latestSeq, committedSeq: this.committedSeq, epoch: this.bootEpoch, nextAfter, hasMore: nextAfter < latestSeq, gap, source };
  }
  addClient(conn, afterSeq) {
    if (this.clients.size >= this.cfg.server.maxWsClients) { conn.close(1013); return false; }
    this.clients.add(conn); conn.onclose = () => this.clients.delete(conn);
    conn.send(this.snapshotMessage(afterSeq));
    return true;
  }

  health() {
    const mem = process.memoryUsage();
    return {
      ok: this.running, tick: this.world?.tick, status: this.world?.status, uptimeSec: Math.round((this.now() - this.startedAt) / 1000),
      tickLatencyMs: { p50: r(this.#pct(0.5)), p95: r(this.#pct(0.95)), p99: r(this.#pct(0.99)), max: r(this.latMax), budget: this.cfg.world.tickMs },
      lagMs: Math.round(this.lagMs), overloaded: this.overloaded, skippedBroadcasts: this.skippedBroadcasts,
      cpuPercent: this.cpuPct, rssMB: Math.round(mem.rss / 1048576), heapMB: Math.round(mem.heapUsed / 1048576),
      clients: this.clients.size, population: this.world?.creatures.length,
      overloadPolicy: 'simulation slows (time dilation) and broadcasts are thinned; creatures are never removed to save CPU',
    };
  }
  // Flush pending events first so the committed snapshot never has a seq whose event is not on disk.
  snapshot(required = false) {
    try {
      this.#flushEvents();
      const bytes = this.store.save(this.world.toState(), this.now());
      this.committedSeq = this.world.seq;
      return bytes;
    }
    catch (e) { this.log('error', 'snapshot failed: ' + e.message); if (required) throw Object.assign(e, { durability: true }); }
  }
  resetWorld(opts) { // authenticated developer reset only (caller checks auth + confirmation)
    const old = this.world;
    this.snapshot();
    const archived = this.store.archiveWorld(`${old.id}-${Date.now()}`);
    const nw = World.create(this.cfg, { resetCount: old.resetCount + 1, seed: opts.seed ?? this.cfg.world.seed + old.resetCount + 1, initialCount: opts.initialSeedCount, id: `world-${Date.now()}-${old.resetCount + 1}` });
    this.world = nw; this.#wire(); this.snapshot(true); this.#prime();
    nw.emit('reset', { previous: old.id, archived: archived.split('/').pop() });
    return { worldId: nw.id, archived };
  }
  stop() {
    this.running = false; clearTimeout(this.timer); clearInterval(this.snapTimer);
    if (this.world) this.snapshot();
    for (const c of this.clients) c.close(1001);
    this.store.release();
  }
}
const r = (x) => Math.round(x * 100) / 100;
