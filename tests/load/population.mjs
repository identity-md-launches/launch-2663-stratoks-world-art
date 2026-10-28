// Population scaling: tick (simulation) + view/broadcast cost at different populations. node tests/load/population.mjs
import fs from 'node:fs';
import { World } from '../../server/src/world.js';
import { buildView } from '../../server/src/view.js';
import { DEFAULTS, deepMerge } from '../../server/src/config.js';
const out = [];
for (const n of [24, 100, 250, 500, 1000, 2000]) {
  const cfg = deepMerge(DEFAULTS, { world: { initialSeedCount: n, width: 56, height: 56 } });
  const w = World.create(cfg);
  for (let i = 0; i < 300; i++) w.step(); // warm-up, let behaviours diversify
  const sim = [], view = [];
  for (let i = 0; i < 600; i++) { const t0 = performance.now(); w.step(); const t1 = performance.now(); const v = buildView(w); let s = 0; for (const e of v.values()) s += JSON.stringify(e).length; const t2 = performance.now(); sim.push(t1 - t0); view.push(t2 - t1); }
  const q = (a, p) => { a = [...a].sort((x, y) => x - y); return +a[Math.floor(p * (a.length - 1))].toFixed(2); };
  const t = performance.now(); const bytes = JSON.stringify(w.toState()).length; const snapMs = +(performance.now() - t).toFixed(0);
  const row = { initialPopulation: n, populationAtEnd: w.creatures.length, simMs: { p50: q(sim, 0.5), p95: q(sim, 0.95), p99: q(sim, 0.99), max: q(sim, 1) }, viewSerializeMs: { p50: q(view, 0.5), p95: q(view, 0.95) }, snapshotBytes: bytes, snapshotMs: snapMs, rssMB: Math.round(process.memoryUsage().rss / 1048576), deathsDuringRun: w.totals.deaths };
  console.log(JSON.stringify(row)); out.push(row);
}
fs.writeFileSync(new URL('../results/population-scaling.json', import.meta.url), JSON.stringify(out, null, 1));
