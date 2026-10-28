// Phase 2B discovery experiments: 10 fixed seeds x 3 conditions (full, frozen, no-planner).
// usage: node tests/experiments/expanse-experiments.mjs <ticks> <out.json> [seedFrom seedTo]
// Scenario "main" (settlement start, berries become harmful at tick ticks/2 = reward reversal) and
// scenario "cold" (same population relocated into the cold highlands). All raw per-run metrics are written.
import fs from 'node:fs';
import { Expanse } from '../../server/src/expanse/engine.js';

const ticks = Number(process.argv[2] ?? 3000), out = process.argv[3] ?? 'expanse-experiments.json';
const seeds = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010].slice(Number(process.argv[4] ?? 0), Number(process.argv[5] ?? 10));
const MODES = ['full', 'frozen', 'no-planner'];

function coldStart(e) {
  const b = e.bounds();
  for (let y = -20; y > b.y0 + 4; y--) for (let x = 10; x < 46; x++) {
    if (e.biome(x, y) !== 'cold' || !e.passable(x, y)) continue;
    let ok = 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (e.passable(x + dx, y + dy)) ok++;
    if (ok < 40) continue;
    for (const c of e.creatures) { let p = { x, y }; for (let k = 0; k < 30; k++) { const tx = x + e.rng.int(7) - 3, ty = y + e.rng.int(7) - 3; if (e.passable(tx, ty)) { p = { x: tx, y: ty }; break; } } c.x = p.x; c.y = p.y; c.home = { ...p }; }
    return { x, y };
  }
  return null;
}
function runOne(seed, mode, scenario) {
  const rev = scenario === 'main' ? { item: 'berry', fromTick: Math.floor(ticks / 2) } : null;
  const e = Expanse.create({ initialCount: 24, mode, rewardReversal: rev }, { seed });
  const start = scenario === 'cold' ? coldStart(e) : null;
  const homes = new Map(e.creatures.map((c) => [c.id, { ...c.home }]));
  const maxAway = new Map(), returned = new Set();
  const berryEats = [0, 0], berryGathers = [0, 0], salt = [0, 0], noPath = [0, 0];
  const t0 = Date.now(); let lastEaten = 0;
  for (let t = 1; t <= ticks; t++) {
    e.step();
    const half = t <= ticks / 2 ? 0 : 1;
    const eaten = e.totals.eaten.berry ?? 0; berryEats[half] += eaten - lastEaten; lastEaten = eaten;
    if (t % 10 === 0) for (const c of e.creatures) {
      const h = homes.get(c.id); if (!h) continue;
      const d = Math.max(Math.abs(c.x - h.x), Math.abs(c.y - h.y));
      if (d > (maxAway.get(c.id) ?? 0)) maxAway.set(c.id, d);
      if ((maxAway.get(c.id) ?? 0) >= 20 && d <= 8) returned.add(c.id);
    }
    if (t % 50 === 0) for (const c of e.creatures) for (const p of c.mind.plans) for (const a of p.actual) {
      if (p._counted) continue;
      if (a.reason === 'salt-water') salt[half]++; if (a.reason === 'no-path') noPath[half]++;
    }
    if (t % 50 === 0) for (const c of e.creatures) for (const p of c.mind.plans) p._counted = true;
  }
  const crafted = e.totals.crafted, discoveries = e.discoveries;
  const firstAxe = discoveries.find((d) => d.what.includes('hand_axe'))?.tick ?? null;
  const fireBy = new Set(discoveries.filter((d) => d.what.startsWith('fire')).map((d) => d.by));
  const plans = e.creatures.flatMap((c) => c.mind.plans);
  const err = plans.filter((p) => p.actual.length).map((p) => Math.abs(p.predictedReward - p.actualReward));
  const exploreCells = e.creatures.map((c) => c.mind.visited.length);
  return {
    seed, mode, scenario, ticks, ms: Date.now() - t0, coldStart: start,
    population: { start: 24, end: e.creatures.length, births: e.totals.births, deaths: e.totals.deaths, deathsByCause: e.totals.deathsByCause },
    exploration: { chunksGenerated: e.chunks.size, meanVisitedCells: avg(exploreCells), wentFar20: [...maxAway.values()].filter((d) => d >= 20).length, returnedHome: returned.size, maxDistance: Math.max(0, ...maxAway.values()) },
    waterBarrier: { saltDrinkFailuresFirstHalf: salt[0], saltDrinkFailuresSecondHalf: salt[1], noPathFirstHalf: noPath[0], noPathSecondHalf: noPath[1] },
    tools: { crafted, firstHandAxeTick: firstAxe, handAxeHolders: e.creatures.filter((c) => c.inventory.hand_axe).length, discoveries: summarizeDiscoveries(discoveries) },
    fire: { creaturesWhoLitFire: fireBy.size, firesLitEvents: e.events.filter((x) => x.type === 'fire_lit').length, burnedNodes: e.totals.burnedNodes, burnedItems: e.totals.burnedItems, sheltersBuilt: e.shelters.length },
    reversal: rev ? { berryEatenBefore: berryEats[0], berryEatenAfter: berryEats[1], berryGathered: e.totals.gathered.berry ?? 0 } : null,
    planning: { decisions: e.totals.decisions, reflex: e.totals.reflex, deferred: e.totals.deferred, meanAbsPredictionError: avg(err), plansMultiStep: plans.filter((p) => p.steps.length > 1).length, plansSampled: plans.length },
    social: countBy(e.social.map((s) => s.type)), leadership: e.leadership().slice(0, 3),
    needsEnd: { hunger: avg(e.creatures.map((c) => c.hunger)), thirst: avg(e.creatures.map((c) => c.thirst)), warmth: avg(e.creatures.map((c) => c.warmth)), health: avg(e.creatures.map((c) => c.health)) },
  };
}
function summarizeDiscoveries(ds) { const m = {}; for (const d of ds) { m[d.what] ??= { creatures: 0, selfFound: 0, first: d.tick }; m[d.what].creatures++; if (d.selfFound) m[d.what].selfFound++; } return m; }
function countBy(a) { const m = {}; for (const x of a) m[x] = (m[x] ?? 0) + 1; return m; }
function avg(a) { return a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length * 1000) / 1000 : null; }

const runs = [];
for (const seed of seeds) for (const scenario of ['main', 'cold']) for (const mode of MODES) {
  const r = runOne(seed, mode, scenario); runs.push(r);
  console.log(JSON.stringify({ seed, scenario, mode, ms: r.ms, end: r.population.end, deaths: r.population.deathsByCause, axe: r.tools.firstHandAxeTick, fire: r.fire.creaturesWhoLitFire, rev: r.reversal }));
}
fs.writeFileSync(out, JSON.stringify({ node: process.version, ticks, seeds, modes: MODES, generated: new Date().toISOString(), runs }, null, 1));
