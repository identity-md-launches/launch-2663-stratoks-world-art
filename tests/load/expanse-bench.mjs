// Phase 2B capacity benchmark: N creatures for T ticks (accelerated, no sleeping), 8 simulated viewers.
// usage: node tests/load/expanse-bench.mjs <creatures> <ticks> <out.json>
// Records per-tick wall time (p50/p95/p99/max), RSS samples, snapshot size, and the JSON payload a viewer
// would receive (viewport around a followed creature + inspector) every 5 ticks for 8 clients.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { Expanse } from '../../server/src/expanse/engine.js';
import { viewport, inspect } from '../../server/src/expanse/view.js';

const N = Number(process.argv[2] ?? 24), ticks = Number(process.argv[3] ?? 10000), out = process.argv[4];
const e = Expanse.create({ initialCount: N }, { seed: 4242 });
const durs = new Float64Array(ticks), rss = [], payload = [];
const pop = [];
for (let t = 0; t < ticks; t++) {
  const s = performance.now(); e.step(); durs[t] = performance.now() - s;
  if (t % 5 === 0) for (let k = 0; k < 8; k++) {
    const c = e.creatures[(k * 7) % Math.max(1, e.creatures.length)]; if (!c) continue;
    const msg = JSON.stringify({ view: viewport(e, c.x - 20, c.y - 12, 40, 24), inspector: k === 0 ? inspect(e, c.id) : undefined });
    if (t % 500 === 0) payload.push(msg.length);
  }
  if (t % 500 === 0) { rss.push(process.memoryUsage().rss); pop.push(e.creatures.length); }
}
const sorted = Array.from(durs).sort((a, b) => a - b), q = (p) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 1000) / 1000;
const snap = zlib.gzipSync(JSON.stringify(e.toState()));
const res = { creaturesStart: N, ticks, populationSamples: pop, populationEnd: e.creatures.length, births: e.totals.births, deaths: e.totals.deathsByCause, deferredDecisions: e.totals.deferred,
  tickMs: { mean: Math.round(durs.reduce((s, v) => s + v, 0) / ticks * 1000) / 1000, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1) },
  rssMiB: { max: Math.round(Math.max(...rss) / 1048576), samples: rss.map((r) => Math.round(r / 1048576)) },
  snapshotGzipBytes: snap.length, chunksGenerated: e.chunks.size, viewerPayloadBytes: { mean: Math.round(payload.reduce((s, v) => s + v, 0) / payload.length), max: Math.max(...payload) },
  clients: 8, node: process.version, arch: process.arch, cpus: (await import('node:os')).cpus().length, note: 'accelerated (no sleep); single process; no cgroup enforcement on this machine' };
console.log(JSON.stringify(res));
if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
