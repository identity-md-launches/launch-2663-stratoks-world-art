// Unmodified full ecology: no trial resets, forced actions, refill, culling or tuned resources.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { World } from '../../server/src/world.js';
import { DEFAULTS, deepMerge } from '../../server/src/config.js';
const ticks = Number(process.argv[2] ?? 5000), seeds = Number(process.argv[3] ?? 10);
const started = performance.now();
const rows = [];
for (let seed = 1; seed <= seeds; seed++) {
  const baseline = World.create(deepMerge(DEFAULTS, { world: { seed } })).toState();
  for (const mode of ['legacy', 'mb-v1', 'mb-v1-frozen', 'mb-v1-ablated']) {
    const cfg = deepMerge(DEFAULTS, { world: { seed, brainMode: mode } });
    // Identical recovered initial world including personality, family, needs and legacy weights.
    const state = structuredClone(baseline); state.brainMode = mode;
    const w = World.fromState(cfg, state);
    const initialLegacyWeightsHash = crypto.createHash('sha256').update(JSON.stringify(w.creatures.map(c=>c.brain.w))).digest('hex');
    let hungry = 0, creatureTicks = 0, model = 0, reflex = 0, rule = 0, previousDecisions = new Map();
    for (let t = 0; t < ticks; t++) {
      w.step();
      for (const c of w.creatures) {
        hungry += +(c.hunger > 70); creatureTicks++;
        const last = c.brain.inspection;
        if (last && previousDecisions.get(c.id) !== last.tick) {
          previousDecisions.set(c.id, last.tick);
          if (last.source === 'model') model++; else if (last.source === 'reflex') reflex++; else rule++;
        }
      }
    }
    rows.push({ seed, mode, ticks, initialLegacyWeightsHash, ...w.populationMetrics(), hungryFraction: hungry / creatureTicks, decisionSources: { model, reflex, rule }, neuralUpdates: w.creatures.reduce((s,c)=>s+(c.brain.mb?.updates??0),0), legacyUpdates: w.creatures.reduce((s,c)=>s+c.brain.updates,0) });
  }
}
const mean = a=>a.reduce((s,v)=>s+v,0)/a.length;
const sd = a=>Math.sqrt(mean(a.map(v=>(v-mean(a))**2)));
const summary=[];
for(const mode of ['legacy','mb-v1','mb-v1-frozen','mb-v1-ablated']) for(const metric of ['population','births','deaths','food','sheltersComplete','hungryFraction']) {
 const values=rows.filter(r=>r.mode===mode).map(r=>r[metric]);summary.push({mode,metric,mean:mean(values),sd:sd(values),min:Math.min(...values),max:Math.max(...values)});
}
const sourceHashes = Object.fromEntries(['actions', 'controller', 'mushroom', 'brain', 'config', 'world'].map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(new URL(`../../server/src/${name}.js`, import.meta.url))).digest('hex')]));
fs.writeFileSync(process.argv[4] ?? new URL('../results/phase2a/ecology.json',import.meta.url),JSON.stringify({ elapsedMs: performance.now() - started, sourceHashes, protocol:{ticks,seeds,initialPopulation:24,worldConfig:DEFAULTS.world,interventions:'none',learningTrials:'none; entirely autonomous ecology'},summary,rows },null,2)+'\n');
console.table(summary);
