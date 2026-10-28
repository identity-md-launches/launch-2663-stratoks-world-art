// Phase 2B agent foundation (versioned interfaces). What is LEARNED here: the per-creature outcome model
// (success, reward, duration, energy and produced items of each (action, argument, context) seen in the
// creature's own or observed transitions) and the mb-v1 circuit weights. What is DESIGNED: the primitive set,
// affordance enumeration, need-based reward, reflexes, and the planner's search procedure.
export const OBSERVATION_VERSION = 1;
export const MEMORY_VERSION = 1;
export const MODEL_VERSION = 1;
export const PLANNER_VERSION = 1;
export const LIMITS = Object.freeze({ episodes: 48, modelEntries: 96, producedKinds: 3, knownNodes: 40, knownWater: 6, visited: 384, plans: 8, horizon: 3, beam: 5, branch: 7 });

// ---------------- bounded episodic memory ----------------
export function recordEpisode(mind, ep) {
  mind.episodes.push(ep);
  if (mind.episodes.length > LIMITS.episodes) {
    // drop the least salient of the older half (|reward| + novelty), keeping the newest 8 always
    let wi = 0, wv = Infinity;
    for (let i = 0; i < mind.episodes.length - 8; i++) { const e = mind.episodes[i]; const v = Math.abs(e.reward) + (e.novel ? 1 : 0) + i * 1e-4; if (v < wv) { wv = v; wi = i; } }
    mind.episodes.splice(wi, 1);
  }
}

// ---------------- outcome model ----------------
// key = `${action}|${arg}|${ctx}`. Running mean/variance (Welford) of reward, plus means of cost and outcome.
export function createMind() {
  return { version: MODEL_VERSION, model: {}, total: 0, episodes: [], known: {}, water: [], visited: [], plans: [], discoveries: [], lastPlan: null };
}
export function modelKey(action, arg, ctx = '') { return `${action}|${arg}|${ctx}`; }
export function updateModel(mind, key, o, weight = 1) {
  let e = mind.model[key];
  if (!e) {
    const keys = Object.keys(mind.model);
    if (keys.length >= LIMITS.modelEntries) { // evict least-supported, oldest entry
      let worst = keys[0]; for (const k of keys) { const m = mind.model[k]; const w = mind.model[worst]; if (m.n - m.last * 1e-6 < w.n - w.last * 1e-6) worst = k; }
      delete mind.model[worst];
    }
    e = mind.model[key] = { n: 0, ok: 0, r: 0, m2: 0, dur: 0, energy: 0, produced: {}, last: 0, own: 0 };
  }
  e.n += weight; if (weight >= 1) e.own++;
  const d = o.reward - e.r; e.r += weight * d / e.n; e.m2 += weight * d * (o.reward - e.r);
  e.ok += weight * ((o.success ? 1 : 0) - e.ok) / e.n;
  e.dur += weight * (o.duration - e.dur) / e.n;
  e.energy += weight * (o.energy - e.energy) / e.n;
  for (const [item, q] of Object.entries(o.produced ?? {})) e.produced[item] = (e.produced[item] ?? 0) + weight * q;
  const pk = Object.keys(e.produced);
  if (pk.length > LIMITS.producedKinds) { pk.sort((a, b) => e.produced[a] - e.produced[b]); delete e.produced[pk[0]]; }
  e.last = o.tick ?? 0; mind.total += weight;
}
// Prediction with uncertainty. Unknown entries use a weak designed prior: reward 0, duration 4, energy 1, sigma 1.
export function predict(mind, key) {
  const e = mind.model[key];
  if (!e || e.n < 0.2) return { n: 0, reward: 0, sigma: 1, success: 0.5, duration: 4, energy: 1, produced: {} };
  const variance = e.n > 1 ? e.m2 / (e.n - 1) : 1;
  const produced = {}; for (const [k, v] of Object.entries(e.produced)) produced[k] = v / e.n;
  return { n: e.n, reward: e.r, sigma: Math.sqrt(Math.max(variance, 0.01) / (e.n + 1)) + 0.5 / (e.n + 1), success: e.ok, duration: e.dur, energy: e.energy, produced };
}

// ---------------- planner ----------------
// Candidate sequences are built by beam search over affordances. Each step's feasibility after the first is decided
// by PREDICTED inventory (produced items learned by the model) - never by querying the simulator or rule tables.
// value = sum(reward + bonus*sigma - lambda*duration - mu*energy) * success, discounted by gamma per step.
export function plan(mind, start, affordFn, opts) {
  const { bonus = 0.5, lambda = 0.02, mu = 0.02, gamma = 0.9, horizon = LIMITS.horizon, enabled = true } = opts;
  const first = affordFn(start.inventory, null).slice(0, 24);
  const score = (step, key) => { const p = predict(mind, key); return { p, v: (p.reward + bonus * p.sigma) * p.success - lambda * p.duration - mu * p.energy }; };
  let beam = first.map((s) => { const { p, v } = score(s, s.key); return { steps: [s], preds: [p], value: v, inv: applyPred(start.inventory, s, p) }; });
  const all = beam.slice();
  if (enabled) {
    for (let d = 1; d < horizon; d++) {
      beam.sort((a, b) => b.value - a.value); beam = beam.slice(0, LIMITS.beam);
      const next = [];
      for (const b of beam) for (const s of affordFn(b.inv, b.steps.at(-1)).slice(0, LIMITS.branch)) {
        if (s.firstOnly) continue;
        const { p, v } = score(s, s.key);
        next.push({ steps: [...b.steps, s], preds: [...b.preds, p], value: b.value + Math.pow(gamma, d) * v, inv: applyPred(b.inv, s, p) });
      }
      all.push(...next); beam = next;
    }
  }
  return all;
}
function applyPred(inv, step, p) {
  const out = { ...inv };
  for (const it of step.consumes ?? []) out[it] = Math.max(0, (out[it] ?? 0) - 1);
  for (const [it, q] of Object.entries(p.produced)) if (q >= 0.35) out[it] = (out[it] ?? 0) + Math.max(1, Math.round(q));
  return out;
}

// ---------------- individually acquired map knowledge ----------------
export function rememberNode(mind, node, tick) {
  mind.known[node.id] = { x: node.x, y: node.y, kind: node.kind, units: node.units, t: tick };
  const ids = Object.keys(mind.known);
  if (ids.length > LIMITS.knownNodes) { let o = ids[0]; for (const id of ids) if (mind.known[id].t < mind.known[o].t) o = id; delete mind.known[o]; }
}
export function rememberWater(mind, x, y, tick) {
  const near = mind.water.find((w) => Math.abs(w.x - x) + Math.abs(w.y - y) < 6);
  if (near) { near.t = tick; return; }
  mind.water.push({ x, y, t: tick });
  if (mind.water.length > LIMITS.knownWater) { mind.water.sort((a, b) => b.t - a.t); mind.water.length = LIMITS.knownWater; }
}
export function markVisited(mind, x, y) {
  const k = `${x >> 3},${y >> 3}`;
  const i = mind.visited.indexOf(k);
  if (i >= 0) mind.visited.splice(i, 1);
  mind.visited.push(k);
  if (mind.visited.length > LIMITS.visited) mind.visited.shift();
  return i < 0;
}
