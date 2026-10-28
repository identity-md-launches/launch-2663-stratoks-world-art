// Controlled component experiment: real brain interface, synthetic two-site task.
// This is NOT a natural ecology survival experiment. No reflexes or wallet rules.
import fs from 'node:fs';
import crypto from 'node:crypto';
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
import { World } from '../../server/src/world.js';
import { DEFAULTS, deepMerge } from '../../server/src/config.js';
import { scoreCandidate, selectCandidate, rewardAction, setBrainMode } from '../../server/src/controller.js';
import { Rng } from '../../server/src/rng.js';

const MODES = ['legacy', 'mb-v1', 'mb-v1-frozen', 'mb-v1-ablated'];
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => Math.sqrt(mean(a.map(x => (x - mean(a)) ** 2)));
export function experiment(seed, mode, task = 'location') {
  const cfg = deepMerge(DEFAULTS, { world: { seed, initialSeedCount: 1, brainMode: mode } });
  let w = World.create(cfg), c = w.creatures[0];
  c.x = 28; c.y = 28;
  // Equal food, need, distance and innate value. Only spatial (or cue) identity differs.
  w.bushes = [{ id: 1, x: 24, y: 28, amount: 5 }, { id: 2, x: 32, y: 28, amount: 5 }];
  w.fires = []; w.storms = [];
  if (task === 'cue') {
    // Same coarse spatial bin. A visible fire marks one candidate;
    // outcome contingencies are counterbalanced, so the experiment measures association,
    // not an inborn fire preference. No emergency reflex is called in this component task.
    w.bushes[0].x = 29; w.bushes[1].x = 34;
    w.fires = [{ id: 1, x: 29, y: 28, r: 1, intensity: 0.6, left: 10000 }];
  }
  const env = new Rng(seed * 917 + 5);
  const rewardedSite = env.int(2); // counterbalance which site predicts food/punishment
  const features = [0.4, 0.25, 0, 0.6, 1, 0, 0, 0, 0, 0, 0, 1];
  let tick = 0;
  function candidates(heldout = false) {
    const f = features.slice(); if (heldout) f[0] = 0.45;
    return w.bushes.map((b, site) => {
      const score = scoreCandidate(w, c, 'EAT', f, { target: b });
      return { a: 'EAT', site, ...score };
    });
  }
  function trial(phase, n, learning) {
    const selections = [], rewards = [];
    const rngBefore = mode === 'legacy' ? w.rng.s : c.brain.mb.rng;
    const before = JSON.stringify(mode === 'legacy' ? c.brain.w : [c.brain.mb.positive, c.brain.mb.negative]);
    const prev = w.learning; w.learning = learning;
    for (let i = 0; i < n; i++) {
      w.tick = ++tick;
      const cand = candidates(phase.includes('heldout'));
      // 20% forced balanced exposure during training prevents exploration collapse;
      // held-out choices are exclusively model-selected. Record exposures separately.
      const forced = learning && i % 5 === 0;
      const pick = forced ? cand[env.int(2)] : selectCandidate(w, c, cand);
      const correct = phase.startsWith('reversal') ? 1 - rewardedSite : rewardedSite;
      const chosenGood = pick.site === correct;
      const reward = task === 'threat' ? (chosenGood ? 0 : -1.5) : (chosenGood ? 1.25 : -0.75);
      const noisy = learning && env.next() < 0.1 ? -reward : reward;
      rewardAction(w, c, { type: 'EAT', brainMode: mode, trace: pick.trace, f: features, u: pick.u }, noisy);
      selections.push({ site: pick.site, good: chosenGood, forced }); rewards.push(noisy);
    }
    w.learning = prev;
    const after = JSON.stringify(mode === 'legacy' ? c.brain.w : [c.brain.mb.positive, c.brain.mb.negative]);
    return { phase, trials: n, neuralUpdates: c.brain.mb?.updates ?? 0, legacyUpdates: c.brain.updates, fractionGood: mean(selections.map(s => +s.good)), autonomousFractionGood: mean(selections.filter(s => !s.forced).map(s => +s.good)), meanReward: mean(rewards), weightsChanged: before !== after, weightsBeforeSha256: digest(before), weightsAfterSha256: digest(after), rngBefore, rngAfter: mode === 'legacy' ? w.rng.s : c.brain.mb.rng, rewards,
      choices: selections.map(s => s.site), forcedTrials: selections.flatMap((s, i) => s.forced ? [i] : []) };
  }
  const baseline = trial('baseline-heldout', 100, false);
  const acquisition = trial('acquisition', 300, true);
  const heldout = trial('acquisition-heldout', 200, false);
  const saved = JSON.parse(JSON.stringify(w.toState()));
  const clone = World.fromState(cfg, saved);
  const savedStateSha256 = digest(saved), restoredStateSha256 = digest(clone.toState());
  const restartStateIdentical = JSON.stringify(clone.toState()) === JSON.stringify(saved);
  const uninterrupted = trial('restart-heldout', 100, false);
  w = clone; c = w.creatures[0]; tick = w.tick;
  const restarted = trial('restart-heldout', 100, false);
  const restartChoicesIdentical = JSON.stringify(uninterrupted.choices) === JSON.stringify(restarted.choices);
  const reversal = trial('reversal', 400, true);
  const reversalHeldout = trial('reversal-heldout', 200, false);
  // Post-training lesion retains trained weights but removes their contribution to scores.
  const retainedMode = w.brainMode;
  if (mode !== 'legacy') setBrainMode(w, 'mb-v1-ablated', 'experiment-lesion');
  const lesion = trial('reversal-lesion-heldout', 200, false);
  w.brainMode = retainedMode;
  return { seed, mode, task, rewardedSite, savedStateSha256, restoredStateSha256, restartStateIdentical, restartChoicesIdentical, phases: [baseline, acquisition, heldout, restarted, reversal, reversalHeldout, lesion] };
}
export function runExperiments(seeds = 10) {
  const rows = [];
  for (let seed = 1; seed <= seeds; seed++) for (const task of ['location', 'cue', 'threat']) for (const mode of MODES) rows.push(experiment(seed, mode, task));
  const summary = [];
  for (const task of ['location', 'cue', 'threat']) for (const mode of MODES) for (const phase of ['baseline-heldout', 'acquisition-heldout', 'reversal-heldout', 'reversal-lesion-heldout']) {
    const selected = rows.filter(r => r.mode === mode && r.task === task);
    const vals = selected.map(r => r.phases.find(p => p.phase === phase).fractionGood);
    summary.push({ task, mode, phase, n: vals.length, mean: mean(vals), sd: sd(vals), min: Math.min(...vals), max: Math.max(...vals), failuresBelow60Percent: vals.filter(v => v < 0.6).length });
  }
  return { protocol: { seeds: Array.from({ length: seeds }, (_, i) => i + 1), modelParameters: 'server/src/mushroom.js:MB_PARAMS', acquisitionTrials: 300, reversalTrials: 400, trainingNoise: 0.1, forcedExposureFraction: 0.2, heldoutLearning: false, heldoutHunger: 0.45, trainingHunger: 0.4, task: 'synthetic two-site component task with equal innate scores; no reflexes' }, summary, rows };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const started = performance.now();
  const results = runExperiments(Number(process.argv[2] ?? 10));
  results.elapsedMs = performance.now() - started;
  results.sourceHashes = Object.fromEntries(['actions', 'controller', 'mushroom', 'brain', 'config', 'world'].map(name => [name, digest(fs.readFileSync(new URL(`../../server/src/${name}.js`, import.meta.url), 'utf8'))]));
  fs.mkdirSync(new URL('../results/phase2a/', import.meta.url), { recursive: true });
  fs.writeFileSync(process.argv[3] ?? new URL('../results/phase2a/learning.json', import.meta.url), JSON.stringify(results) + '\n');
  console.table(results.summary);
  if (results.rows.some(r => !r.restartStateIdentical || !r.restartChoicesIdentical || r.phases.some(p => p.phase.includes('heldout') && p.weightsChanged))) process.exitCode = 1;
}
