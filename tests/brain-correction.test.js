import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/src/world.js';
import { DEFAULTS, deepMerge } from '../server/src/config.js';
import { BRAIN_MODES, scoreCandidate, selectCandidate, rewardAction, setBrainMode, brainInspection } from '../server/src/controller.js';
import { decide, stepAct } from '../server/src/actions.js';
import { Service } from '../server/src/service.js';
import { restoreBackup } from '../server/src/store.js';
import { testConfig } from './helpers.js';
import { VIS_KEY } from './helpers.js';
import { addressFromPrivateKey } from '../server/src/wallet.js';
import { creatureDetail } from '../server/src/view.js';

const weights = c => JSON.stringify([c.brain.mb.positive, c.brain.mb.negative, c.brain.mb.updates]);
const features = new Array(12).fill(0.3);
function arena(mode, reverse = false) {
  const w = World.create(deepMerge(DEFAULTS, { world: { brainMode: mode, initialSeedCount: 1 } }));
  const c = w.creatures[0];
  c.x = 20; c.y = 20; c.hunger = 85; c.energy = 75;
  w.tiles.fill(0); w.trees = []; w.stones = []; w.shelters = []; w.fires = []; w.storms = []; w.rebuildBlocked();
  w.bushes = [{ id: 10, x: 21, y: 20, amount: 5 }, { id: 20, x: 31, y: 20, amount: 5 }];
  if (reverse) w.bushes.reverse();
  c.places.food = [];
  return { w, c };
}

for (const mode of BRAIN_MODES) {
  for (const reverse of [false, true]) test(`${mode}: starvation chooses distance 1 over 11, insertion reverse=${reverse}`, () => {
    const { w, c } = arena(mode, reverse);
    decide(w, c);
    assert.equal(c.act.bush, 10);
    assert.equal(c.act.decisionSource, 'reflex');
    assert.equal(brainInspection(w, c).decision.source, 'reflex');
    assert.equal(c.act.failed, undefined);
    for (let i = 0; i < 120 && c.act; i++) { w.tick++; stepAct(w, c); }
    assert.equal(c.act, null, 'eating completes within the bound');
    assert.ok(c.hunger < 85, 'food is actually consumed');
  });
  for (const reverse of [false, true]) test(`${mode}: starvation ties use food id, insertion reverse=${reverse}`, () => {
    const { w, c } = arena(mode, reverse);
    w.bushes.find(b => b.id === 20).x = 19;
    decide(w, c);
    assert.equal(c.act.bush, 10);
    assert.equal(c.act.decisionSource, 'reflex');
  });
  test(`${mode}: starvation skips unreachable and depleted food`, () => {
    const { w, c } = arena(mode);
    // Block a close food tile. The next full site is reachable through real pathfinding.
    w.tiles[w.idx(21, 20)] = 1; w.rebuildBlocked();
    w.bushes.unshift({ id: 5, x: 20, y: 21, amount: 0.1 });
    decide(w, c);
    assert.equal(c.act.bush, 20); assert.equal(c.act.failed, undefined);
    assert.equal(c.act.decisionSource, 'reflex');
  });
  test(`${mode}: unreachable food across a barrier is skipped; no reachable site triggers search`, () => {
    const { w, c } = arena(mode);
    // A walkable food tile enclosed by blocked neighbors, unlike a blocked goal.
    w.bushes[0].x = 23;
    for (let y = 19; y <= 21; y++) for (let x = 22; x <= 24; x++) if (x !== 23 || y !== 20) w.tiles[w.idx(x, y)] = 1;
    w.rebuildBlocked();
    decide(w, c); assert.equal(c.act.bush, 20); assert.equal(c.act.decisionSource, 'reflex');
    c.act = null; w.bushes[1].amount = 0;
    decide(w, c); assert.equal(c.act.type, 'WANDER'); assert.equal(c.act.decisionSource, 'rule');
  });
}

for (const mode of BRAIN_MODES.filter(m => m !== 'legacy')) {
  test(`${mode}: target count does not change equal-score action mass or learned action preference`, () => {
    const { w, c } = arena(mode);
    const initial = c.brain.mb.rng;
    const sample = (targets, u = 0) => {
      c.brain.mb.rng = initial;
      const choices = [];
      const candidates = [...Array.from({ length: targets }, (_, target) => ({ a: 'EAT', target, u })), { a: 'REST', u: 0 }, { a: 'WANDER', u: 0 }];
      for (let i = 0; i < 12000; i++) choices.push(selectCandidate(w, c, candidates).a);
      return choices;
    };
    const one = sample(1), many = sample(10);
    assert.ok(many.every((a, i) => a === one[i]), 'equal targets must not buy extra action probability');
    const count = a => a.filter(x => x === 'EAT').length;
    assert.ok(Math.abs(count(one) / one.length - 1 / 3) < 0.02);
    assert.ok(count(sample(10, 1)) / one.length > 0.88, 'meaningfully higher score must favor EAT');
  });
}

test('mb-v1: conditional target choices retain unequal learned circuit preferences below emergency hunger', () => {
  const { w, c } = arena('mb-v1'); c.hunger = 40; c.x = 28; c.y = 28;
  // Locations cross a PN spatial boundary. Use the real scoring + reward interface.
  w.bushes = [{ id: 10, x: 24, y: 28, amount: 5 }, { id: 20, x: 32, y: 28, amount: 5 }];
  decide(w, c); c.act = null;
  const f = c.brain.inspection.sensed.features;
  for (let i = 0; i < 100; i++) for (const b of w.bushes) {
    const scored = scoreCandidate(w, c, 'EAT', f, { target: b });
    rewardAction(w, c, { type: 'EAT', brainMode: 'mb-v1', trace: scored.trace, f, u: scored.u }, b.id === 20 ? 2 : -2);
  }
  const candidates = w.bushes.map(b => ({ a: 'EAT', target: b.id, ...scoreCandidate(w, c, 'EAT', f, { target: b }) }));
  assert.ok(candidates[1].preference > candidates[0].preference + 0.5);
  let preferred = 0;
  for (let i = 0; i < 2000; i++) preferred += +(selectCandidate(w, c, candidates).target === 20);
  assert.ok(preferred > 1800, `preferred learned target ${preferred}/2000`);
  for (const reverse of [false, true]) {
    if (reverse) w.bushes.reverse();
    c.places.food = [];
    let far = 0;
    for (let i = 0; i < 100; i++) { decide(w, c); far += +(c.act.bush === 20); assert.equal(c.act.decisionSource, 'model'); c.act = null; }
    assert.ok(far > 75, `non-emergency learned target retained ${far}/100`);
  }
});

test('ablated control: no circuit learning, zero contribution, accurate flags, retained weights on resumption', () => {
  const { w, c } = arena('mb-v1');
  const scored = scoreCandidate(w, c, 'EAT', features);
  const act = { type: 'EAT', brainMode: 'mb-v1', trace: scored.trace, f: features, u: scored.u };
  rewardAction(w, c, act, 1); const before = weights(c);
  setBrainMode(w, 'mb-v1-ablated');
  assert.equal(brainInspection(w, c).learningEnabled, false);
  assert.equal(scoreCandidate(w, c, 'EAT', features).preference, 0);
  for (let i = 0; i < 40; i++) rewardAction(w, c, { ...act, brainMode: 'mb-v1-ablated' }, -1);
  assert.equal(weights(c), before);
  assert.ok(c.brain.mb.rewardHistory.every(r => r.learned === false));
  assert.ok(c.brain.mb.rewardHistory.every(r => r.mode === 'mb-v1-ablated' && r.prediction === 0));
  setBrainMode(w, 'mb-v1'); assert.equal(weights(c), before);
  rewardAction(w, c, { ...act, brainMode: 'mb-v1-ablated' }, -1);
  assert.equal(weights(c), before, 'ablation-started actions cannot learn after switching back');
  rewardAction(w, c, act, -1); assert.notEqual(weights(c), before);
});

test('ablated restart and backup/restore preserve matrices, counters and suspended in-flight learning', t => {
  const cfg = testConfig({ world: { brainMode: 'mb-v1', brainModeSource: 'file', catchup: { maxTicks: 0 }, tickMs: 1000 } });
  const opened = []; t.after(() => opened.forEach(s => s.stop()));
  const open = config => { const s = new Service(config, { now: () => 1800000000000, log: () => {} }); s.start(); clearTimeout(s.timer); opened.push(s); return s; };
  const s = open(cfg), c = s.world.creatures[0];
  const scored = scoreCandidate(s.world, c, 'EAT', features);
  const act = { type: 'EAT', brainMode: 'mb-v1', trace: scored.trace, f: features, u: scored.u };
  rewardAction(s.world, c, act, 1); const before = weights(c);
  setBrainMode(s.world, 'mb-v1-ablated'); s.snapshot(true);
  const backup = s.store.backup('ablated'); s.stop();
  const unset = deepMerge(cfg, { world: { brainModeSource: 'default' } });
  const r = open(unset);
  assert.equal(r.world.brainMode, 'mb-v1-ablated'); assert.equal(weights(r.world.creatures[0]), before);
  assert.equal(brainInspection(r.world, r.world.creatures[0]).learningEnabled, false);
  rewardAction(r.world, r.world.creatures[0], { ...act, brainMode: 'mb-v1-ablated' }, -2);
  assert.equal(weights(r.world.creatures[0]), before); r.stop();
  restoreBackup(cfg.server.dataDir, backup);
  const restored = open(unset);
  assert.equal(weights(restored.world.creatures[0]), before);
  restored.stop();
  const active = open(cfg);
  assert.equal(active.world.brainMode, 'mb-v1'); assert.equal(weights(active.world.creatures[0]), before);
  rewardAction(active.world, active.world.creatures[0], act, -1);
  assert.notEqual(weights(active.world.creatures[0]), before); active.stop();
});

test('inspector reports disabled plasticity during catch-up and in frozen/ablated modes', () => {
  for (const mode of BRAIN_MODES) {
    const { w, c } = arena(mode);
    assert.equal(brainInspection(w, c).learningEnabled, !['mb-v1-frozen', 'mb-v1-ablated'].includes(mode));
    assert.equal(creatureDetail(w, c).learning.enabled, brainInspection(w, c).learningEnabled);
    w.catchup = true; assert.equal(brainInspection(w, c).learningEnabled, false);
    w.catchup = false; w.learning = false; assert.equal(brainInspection(w, c).learningEnabled, false);
  }
});

for (const mode of ['mb-v1-frozen', 'mb-v1-ablated']) test(`${mode}: independent wallet memory still follows LEARNING`, () => {
  for (const enabled of [false, true]) {
    const { w, c } = arena(mode); w.learning = enabled;
    const wallet = addressFromPrivateKey(VIS_KEY); w.bushes[0].gift = wallet;
    const before = weights(c);
    decide(w, c);
    for (let i = 0; i < 120 && c.act; i++) { w.tick++; stepAct(w, c); }
    assert.equal(!!c.brain.wallets[wallet], enabled);
    assert.equal(weights(c), before, 'wallet memory must not change circuit weights');
    assert.ok(c.brain.mb.rewardHistory.every(r => !r.learned));
  }
});
