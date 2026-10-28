// Brain interface v1. Mode changes are operator startup configuration, never client writes.
import { ensureMushroom, encode, readout, reinforce, MB_PARAMS, pickMushroom } from './mushroom.js';
import { utility, innateUtility, visitorUtility, learn, softmaxPick } from './brain.js';
export const BRAIN_MODES = ['legacy', 'mb-v1', 'mb-v1-frozen', 'mb-v1-ablated'];
export function validateBrainMode(mode) {
  if (!BRAIN_MODES.includes(mode)) throw new Error(`invalid brain mode ${mode}`);
  return mode;
}
export function initializeBrains(w) {
  w.brainMode ??= 'legacy'; validateBrainMode(w.brainMode);
  for (const c of w.creatures) {
    c.brain.version ??= 1;
    if (c.brain.version !== 1) throw new Error(`unsupported brain interface ${c.brain.version}`);
    if (w.brainMode !== 'legacy') ensureMushroom(c.brain, w.seed, c.id);
  }
}
export function setBrainMode(w, mode, source = 'operator') {
  validateBrainMode(mode);
  const from = w.brainMode ?? 'legacy';
  w.brainMode = mode; initializeBrains(w);
  if (from !== mode) w.emit('brain_mode_changed', { from, to: mode, source, note: 'legacy weights retained; new circuit initialized independently, no equivalent learning transfer' });
}
export function observation(w, c, features, target = c) {
  const visible = Math.hypot(c.x - target.x, c.y - target.y) <= w.cfg.world.perceptionRadius;
  const localFood = visible ? w.bushes.filter(b => Math.hypot(target.x - b.x, target.y - b.y) <= 2 && Math.hypot(c.x - b.x, c.y - b.y) <= w.cfg.world.perceptionRadius) : [];
  const hazard = visible ? w.hazardAt(target) : { danger: 0, storm: 0 };
  return { features: features.slice(), x: target.x, y: target.y, width: w.W, height: w.H,
    cues: [localFood.some(b => b.amount >= 0.5) ? 1 : 0, hazard.danger, hazard.storm, localFood.some(b => b.gift) ? 1 : 0], visible };

}
export function scoreCandidate(w, c, a, features, { target, wallet } = {}) {
  if ((w.brainMode ?? 'legacy') === 'legacy') return { u: wallet !== undefined ? visitorUtility(c.brain, a, wallet) : utility(c.brain, a, features) };
  const mb = ensureMushroom(c.brain, w.seed, c.id), sensed = observation(w, c, features, target);
  const trace = encode(mb, sensed), preference = readout(mb, a, trace, w.brainMode === 'mb-v1-ablated');
  const innate = innateUtility(a, features, c.personality) + (wallet !== undefined ? (a === 'APPROACH' ? 3 : -3) * wallet : 0);
  return { u: innate + MB_PARAMS.gain * preference, trace, sensed, preference, innate };
}
export function selectCandidate(w, c, candidates) {
  return w.brainMode === 'legacy' || !w.brainMode ? softmaxPick(w.rng, candidates, w.cfg.world.temperature)
    : pickMushroom(c.brain.mb, candidates, w.cfg.world.temperature);
}
export function rewardAction(w, c, act, reward) {
  const mode = act.brainMode ?? 'legacy', enabled = w.learning && !w.catchup && mode === (w.brainMode ?? 'legacy');
  if (mode === 'legacy') {
    if (enabled) learn(c.brain, act.type, act.f, act.u, reward, w.cfg.world.learningRate);
    else { c.brain.rewardSum += reward; c.brain.rewardN++; }
  } else {
    reinforce(c.brain.mb, act.type, act.trace, reward, w.tick, enabled && mode === 'mb-v1', act.decisionSource ?? 'model');
    const outcome = c.brain.mb.rewardHistory.at(-1);
    if (outcome) { outcome.mode = mode; if (mode === 'mb-v1-ablated') outcome.prediction = 0; }
    c.brain.rewardSum += reward; c.brain.rewardN++;
  }
}
export function plasticityEnabled(w) {
  return !!w.learning && !w.catchup && ['legacy', 'mb-v1'].includes(w.brainMode ?? 'legacy');
}
export function brainInspection(w, c) {
  const mb = c.brain.mb;
  return { interfaceVersion: 1, mode: w.brainMode ?? 'legacy', circuitVersion: mb?.version ?? null,
    learningEnabled: plasticityEnabled(w), updates: (w.brainMode ?? 'legacy') === 'legacy' ? c.brain.updates : mb?.updates ?? 0,
    decision: c.brain.inspection ?? null, rewardHistory: mb?.rewardHistory ?? [],
    note: 'Reduced fly-inspired circuit. Game actions, spatial cues, personality and wallet memory are engineered abstractions.' };
}
