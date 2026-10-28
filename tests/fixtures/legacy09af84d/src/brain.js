// Lightweight local learning: per-creature contextual bandit with linear utilities + per-wallet value estimates.
// See server/docs/LEARNING.md. No network, no external AI.
export const ACTIONS = ['EAT', 'REST', 'GATHER_WOOD', 'GATHER_STONE', 'BUILD', 'SOCIALIZE', 'MATE', 'WANDER', 'FLEE', 'APPROACH', 'AVOID'];
export const FEATURES = ['hunger', 'tired', 'hurt', 'foodProx', 'foodKnown', 'homeless', 'carrying', 'siteNeed', 'socialProx', 'danger', 'storm', 'lonely'];
export const NF = FEATURES.length;

// Hand-written prior: bias, then weights per FEATURES entry. Deliberately coarse; learning refines it.
const PRIOR = {
  EAT:          [-0.6, 3.0, 0, 0, 0.8, 0.6, 0, 0, 0, 0, -1, 0, 0],
  REST:         [-0.5, -0.5, 2.4, 1.0, 0, 0, 0, 0, 0, 0, -1, 1.2, 0],
  GATHER_WOOD:  [0.1, -1.8, -1.0, -1.0, 0, 0, 0.8, -0.8, 0.4, 0, -2, -1, 0],
  GATHER_STONE: [-0.1, -1.8, -1.0, -1.0, 0, 0, 0.8, -0.8, 0.4, 0, -2, -1, 0],
  BUILD:        [-0.2, -1.8, -1.0, -1.0, 0, 0, 0.6, 1.8, 1.2, 0, -2, -1, 0],
  SOCIALIZE:    [0.2, -1.5, -0.8, 0, 0, 0, 0, 0, 0, 0.6, -1, -1, 1.0],
  MATE:         [1.2, -2, -1, -1, 0, 0, -1, 0, 0, 0.5, -2, -1, 0.3],
  WANDER:       [0.1, -1.2, -0.6, 0, 0, -0.4, 0, 0, 0, 0, -1, -1, 0.2],
  FLEE:         [-1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0],
  APPROACH:     [-0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  AVOID:        [-1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};
const WALLET_GAIN = 3.0;

export function createBrain(rng, personality) {
  const w = {};
  for (const a of ACTIONS) {
    const p = PRIOR[a].slice();
    for (let i = 0; i < p.length; i++) p[i] += rng.gauss() * 0.3; // individual variation (same draws whether learning is on or off)
    w[a] = p;
  }
  w.GATHER_WOOD[0] += (personality.diligence - 0.5) * 1.0; w.GATHER_STONE[0] += (personality.diligence - 0.5) * 1.0;
  w.BUILD[0] += (personality.diligence - 0.5) * 1.0;
  w.SOCIALIZE[0] += (personality.sociability - 0.5) * 1.2;
  w.WANDER[0] += (personality.curiosity - 0.5) * 1.2;
  w.FLEE[0] -= (personality.boldness - 0.5) * 1.0;
  w.APPROACH[0] += (personality.boldness - 0.5) * 1.0;
  return { w, wallets: {}, updates: 0, rewardSum: 0, rewardN: 0 };
}

export function inheritBrain(rng, a, b, blend, mutation, personality) {
  const kid = createBrain(rng, personality);
  for (const act of ACTIONS) {
    for (let i = 0; i < kid.w[act].length; i++) {
      const pm = ((a?.w[act][i] ?? kid.w[act][i]) + (b?.w[act][i] ?? kid.w[act][i])) / 2;
      kid.w[act][i] = kid.w[act][i] * (1 - blend) + pm * blend + rng.gauss() * mutation;
    }
  }
  return kid;
}

export function utility(brain, action, f, c) {
  const p = brain.w[action];
  let u = p[0];
  for (let i = 0; i < NF; i++) u += p[i + 1] * f[i];
  return u;
}
export function walletValue(brain, addr) { return brain.wallets[addr]?.v ?? 0; }
// APPROACH / AVOID utilities depend on the learned opinion v in [-1,1] of the nearest visitor wallet.
export function visitorUtility(brain, action, v) {
  const p = brain.w[action];
  return action === 'APPROACH' ? p[0] + WALLET_GAIN * v : p[0] - WALLET_GAIN * v;
}

export function softmaxPick(rng, items, temperature) {
  let max = -Infinity;
  for (const it of items) if (it.u > max) max = it.u;
  let sum = 0;
  const ws = items.map((it) => { const e = Math.exp((it.u - max) / temperature); sum += e; return e; });
  let r = rng.next() * sum;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// Reward-driven update: w_a += lr * (reward - predictedUtility) * features. Applied only if learning enabled.
export function learn(brain, action, f, predicted, reward, lr) {
  brain.updates++; brain.rewardSum += reward; brain.rewardN++;
  if (action === 'APPROACH' || action === 'AVOID') { // bias only; the wallet opinion carries the context
    brain.w[action][0] = clamp(brain.w[action][0] + lr * (reward - predicted) * 0.5, -6, 6);
    return;
  }
  const p = brain.w[action];
  const err = clamp(reward - predicted, -3, 3);
  p[0] = clamp(p[0] + lr * err, -6, 6);
  for (let i = 0; i < NF; i++) p[i + 1] = clamp(p[i + 1] + lr * err * f[i], -6, 6);
}

// Exponential-average opinion of a wallet, target in [-1,1].
export function updateWallet(brain, addr, target, rate, tick, maxWallets = 32) {
  let e = brain.wallets[addr];
  if (!e) {
    const keys = Object.keys(brain.wallets);
    if (keys.length >= maxWallets) { // evict the weakest opinion (smallest |v|, then oldest)
      keys.sort((x, y) => Math.abs(brain.wallets[x].v) - Math.abs(brain.wallets[y].v) || brain.wallets[x].last - brain.wallets[y].last);
      delete brain.wallets[keys[0]];
    }
    e = brain.wallets[addr] = { v: 0, n: 0, last: tick };
  }
  e.v = clamp(e.v + rate * (target - e.v), -1, 1); e.n++; e.last = tick;
  return e.v;
}
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
