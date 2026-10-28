// Independently implemented reduced MB-inspired circuit. No biological wiring/data.
import { Rng, hashSeed } from './rng.js';
import { ACTIONS, clamp } from './brain.js';

export const MB_VERSION = 1;
export const MB_PARAMS = Object.freeze({ pn: 36, kc: 128, fanIn: 6, winners: 8, rate: 0.18, gain: 2.5, weightMax: 2, history: 16 });
export function createMushroom(seed) {
  const rng = new Rng(seed), projection = [];
  for (let k = 0; k < MB_PARAMS.kc; k++) {
    const inputs = [];
    while (inputs.length < MB_PARAMS.fanIn) { const i = rng.int(MB_PARAMS.pn); if (!inputs.includes(i)) inputs.push(i); }
    projection.push(inputs);
  }
  const weights = () => Object.fromEntries(ACTIONS.map(a => [a, new Array(MB_PARAMS.kc).fill(0)]));
  return { version: MB_VERSION, seed: seed >>> 0, rng: rng.s, projection, positive: weights(), negative: weights(), updates: 0, rewardHistory: [], last: null };
}
export function ensureMushroom(brain, worldSeed, id) {
  if (brain.mb && brain.mb.version !== MB_VERSION) throw new Error(`unsupported mushroom version ${brain.mb.version}`);
  brain.version ??= 1;
  brain.mb ??= createMushroom(hashSeed(`stratoks:mb-v1:${worldSeed}:${id}`));
  return brain.mb;
}
// PN channels: game needs/features (12), 4x4 coarse spatial cells (16),
// four externally supplied cue channels (4), hunger/satiety/energy/fatigue (4).
export function encode(mb, observation) {
  const x = new Array(MB_PARAMS.pn).fill(0);
  for (let i = 0; i < 12; i++) x[i] = clamp(observation.features[i] ?? 0, 0, 1);
  const px = clamp(Math.floor(observation.x / observation.width * 4), 0, 3);
  const py = clamp(Math.floor(observation.y / observation.height * 4), 0, 3);
  x[12 + py * 4 + px] = 1;
  for (let i = 0; i < 4; i++) x[28 + i] = clamp(observation.cues?.[i] ?? 0, 0, 1);
  x[32] = x[0]; x[33] = 1 - x[0]; x[34] = 1 - x[1]; x[35] = x[1];
  // Global top-k inhibition approximates sparse KC coding; deterministic index tie break.
  const ranked = mb.projection.map((inputs, i) => ({ i, v: inputs.reduce((s, j) => s + x[j], 0) }));
  ranked.sort((a, b) => b.v - a.v || a.i - b.i);
  return { pn: x, active: ranked.slice(0, MB_PARAMS.winners).filter(k => k.v > 0).map(k => k.i) };
}
export function readout(mb, action, trace, ablated = false) {
  if (ablated || !trace.active.length) return 0;
  return trace.active.reduce((s, i) => s + mb.positive[action][i] - mb.negative[action][i], 0) / trace.active.length;
}
export function reinforce(mb, action, trace, reward, tick, enabled, source = 'model') {
  if (!ACTIONS.includes(action)) return;
  const r = clamp(reward, -2, 2);
  const before = trace ? readout(mb, action, trace) : null;
  const plastic = enabled && !!trace?.active.length;
  if (plastic) {
    // Opponent valence channels: active KC synapses approach positive/negative US.
    // Action-specific compartments are an engineering abstraction, not fly action labels.
    for (const i of trace.active) {
      mb.positive[action][i] = clamp(mb.positive[action][i] + MB_PARAMS.rate * (Math.max(0, r) - mb.positive[action][i]), 0, MB_PARAMS.weightMax);
      mb.negative[action][i] = clamp(mb.negative[action][i] + MB_PARAMS.rate * (Math.max(0, -r) - mb.negative[action][i]), 0, MB_PARAMS.weightMax);
    }
    mb.updates++;
  }
  mb.rewardHistory.push({ tick, action, reward: r, prediction: before, learned: !!plastic, source });
  if (mb.rewardHistory.length > MB_PARAMS.history) mb.rewardHistory.shift();
}
export function pickMushroom(mb, candidates, temperature) {
  if (!candidates.length) throw new Error('cannot select from empty candidates');
  const rng = new Rng(1); rng.s = mb.rng;
  // Hierarchy: P(action) = softmax(max target utility per action), then
  // P(target | action) = softmax(target utility). Repeating a target cannot
  // buy action mass. Learned utilities still affect both stages. One uniform
  // draw is partitioned by action, then by target; its state remains persistent.
  // Candidates without an action label (the standalone two-site lab) share a group.
  const groups = new Map();
  for (const c of candidates) {
    if (!groups.has(c.a)) groups.set(c.a, []);
    groups.get(c.a).push(c);
  }
  const actions = [...groups.values()].map(targets => ({ targets, u: Math.max(...targets.map(c => c.u)) }));
  const max = Math.max(...actions.map(a => a.u));
  const weights = actions.map(a => Math.exp((a.u - max) / temperature));
  let r = rng.next() * weights.reduce((s, v) => s + v, 0);
  mb.rng = rng.s;
  for (let i = 0; i < actions.length; i++) {
    if (r <= weights[i] || i === actions.length - 1) {
      const { targets, u } = actions[i];
      const targetWeights = targets.map(c => Math.exp((c.u - u) / temperature));
      let t = r / weights[i] * targetWeights.reduce((s, v) => s + v, 0);
      for (let j = 0; j < targets.length; j++) { t -= targetWeights[j]; if (t <= 0) return targets[j]; }
      return targets.at(-1);
    }
    r -= weights[i];
  }
}
