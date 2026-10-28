// Aggregates raw expanse experiment runs (tests/results/expanse/raw/exp-*.json) into per-condition means and
// per-seed paired differences (full - frozen, full - no-planner). Prints JSON; no runs are filtered out.
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2] ?? 'tests/results/expanse/raw';
const runs = fs.readdirSync(dir).filter((f) => /^exp-\d+\.json$/.test(f)).flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f))).runs);
const metrics = {
  survivors: (r) => r.population.end, deaths: (r) => r.population.deaths, births: (r) => r.population.births,
  starvationDeaths: (r) => r.population.deathsByCause.starvation ?? 0, exposureDeaths: (r) => r.population.deathsByCause.exposure ?? 0,
  wentFar20: (r) => r.exploration.wentFar20, returnedHome: (r) => r.exploration.returnedHome, chunks: (r) => r.exploration.chunksGenerated,
  saltFails1: (r) => r.waterBarrier.saltDrinkFailuresFirstHalf, saltFails2: (r) => r.waterBarrier.saltDrinkFailuresSecondHalf,
  handAxeFound: (r) => r.tools.firstHandAxeTick !== null ? 1 : 0, handAxesCrafted: (r) => r.tools.crafted.hand_axe ?? 0, stoneClubs: (r) => r.tools.crafted.stone_club ?? 0,
  fireLighters: (r) => r.fire.creaturesWhoLitFire, firesLit: (r) => r.fire.firesLitEvents, shelters: (r) => r.fire.sheltersBuilt,
  berryBefore: (r) => r.reversal?.berryEatenBefore ?? null, berryAfter: (r) => r.reversal?.berryEatenAfter ?? null,
  reversalRatio: (r) => r.reversal ? r.reversal.berryEatenAfter / Math.max(1, r.reversal.berryEatenBefore) : null,
  predErr: (r) => r.planning.meanAbsPredictionError, multiStepPlans: (r) => r.planning.plansMultiStep,
  attacks: (r) => r.social.attack ?? 0, shares: (r) => r.social.share ?? 0, follows: (r) => r.social.follow ?? 0, refusals: (r) => r.social.refuse ?? 0,
};
const mean = (a) => { const v = a.filter((x) => x !== null && x !== undefined); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length * 1000) / 1000 : null; };
const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.round(Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) * 1000) / 1000 : null; };
const out = { runs: runs.length, seeds: [...new Set(runs.map((r) => r.seed))].length, conditions: {}, paired: {} };
for (const sc of ['main', 'cold']) for (const mode of ['full', 'frozen', 'no-planner']) {
  const rs = runs.filter((r) => r.scenario === sc && r.mode === mode);
  out.conditions[`${sc}/${mode}`] = Object.fromEntries(Object.entries(metrics).map(([k, f]) => [k, mean(rs.map(f))]));
}
for (const sc of ['main', 'cold']) for (const base of ['frozen', 'no-planner']) {
  const res = {};
  for (const [k, f] of Object.entries(metrics)) {
    const d = [];
    for (const r of runs.filter((x) => x.scenario === sc && x.mode === 'full')) { const b = runs.find((x) => x.scenario === sc && x.mode === base && x.seed === r.seed); if (b && f(r) !== null && f(b) !== null) d.push(f(r) - f(b)); }
    res[k] = { meanDiff: mean(d), sd: sd(d), fullBetterOrHigherSeeds: d.filter((x) => x > 0).length, lowerSeeds: d.filter((x) => x < 0).length, n: d.length };
  }
  out.paired[`${sc}: full - ${base}`] = res;
}
console.log(JSON.stringify(out, null, 1));
