// Long headless simulation: usage node tests/load/long-sim.mjs [ticks=500000] [seed]
import fs from 'node:fs';
import { World } from '../../server/src/world.js';
import { DEFAULTS, deepMerge } from '../../server/src/config.js';
const TICKS = Number(process.argv[2] ?? 500000), seed = Number(process.argv[3] ?? 20260101);
const w = World.create(deepMerge(DEFAULTS, { world: { seed } }));
const lat = []; const rows = []; let peak = 0, peakRss = 0;
const t00 = performance.now();
for (let i = 1; i <= TICKS; i++) {
  const t0 = performance.now(); w.step(); lat.push(performance.now() - t0);
  const n = w.creatures.length; if (n > peak) peak = n;
  if (i % 25000 === 0) { const m = w.populationMetrics(); peakRss = Math.max(peakRss, process.memoryUsage().rss); rows.push({ tick: i, pop: m.population, food: m.food, bushes: m.bushes, shelters: m.sheltersComplete, births: m.births, deaths: m.deaths, causes: { ...m.deathsByCause }, rssMB: Math.round(process.memoryUsage().rss / 1048576) }); console.log(JSON.stringify(rows.at(-1))); }
  if (w.status === 'extinct') { console.log('EXTINCT at', i); break; }
}
lat.sort((a, b) => a - b); const q = (p) => +lat[Math.floor(p * (lat.length - 1))].toFixed(3);
const t1 = performance.now(); const json = JSON.stringify(w.toState()); const ms = performance.now() - t1;
const out = { ticksRun: w.tick, wallSeconds: +((performance.now() - t00) / 1000).toFixed(1), tickMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +lat.at(-1).toFixed(3) }, peakPopulation: peak, finalPopulation: w.creatures.length, status: w.status, snapshotBytes: json.length, snapshotSerializeMs: +ms.toFixed(1), peakRssMB: Math.round(peakRss / 1048576), totals: w.totals, history: rows };
fs.writeFileSync(new URL('../results/long-sim.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, history: undefined }));
