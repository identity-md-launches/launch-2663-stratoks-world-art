import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/src/world.js';
import { DEFAULTS, deepMerge } from '../server/src/config.js';
import { hash, runTicks } from './helpers.js';

const mk = (over = {}) => deepMerge(DEFAULTS, over);

test('deterministic: same seed gives identical state; different seed differs', () => {
  const a = World.create(mk()), b = World.create(mk()), c = World.create(mk({ world: { seed: 5 } }));
  runTicks(a, 1500); runTicks(b, 1500); runTicks(c, 1500);
  assert.equal(hash(a.toState()), hash(b.toState()));
  assert.notEqual(hash(a.toState()), hash(c.toState()));
});

test('initial seed of 24 is a seed, not a cap; autonomous feeding, gathering and building with real costs', () => {
  const w = World.create(mk());
  assert.equal(w.creatures.length, 24);
  const wood0 = w.trees.reduce((a, t) => a + t.wood, 0), stone0 = w.stones.reduce((a, t) => a + t.units, 0);
  runTicks(w, 4000);
  assert.ok(w.totals.eaten > 20, 'creatures ate');
  assert.ok(w.totals.sheltersBuilt >= 3, 'shelters completed: ' + w.totals.sheltersBuilt);
  const cost = DEFAULTS.world.shelterCost, done = w.totals.sheltersBuilt + w.totals.sheltersLost;
  const woodUsed = wood0 - w.trees.reduce((a, t) => a + t.wood, 0), stoneUsed = stone0 - w.stones.reduce((a, t) => a + t.units, 0);
  assert.ok(woodUsed + 40 >= cost.wood * w.totals.sheltersBuilt * 0.9, `wood consumed ${woodUsed}`); // regrowth offsets slightly
  assert.ok(stoneUsed >= cost.stone * w.totals.sheltersBuilt * 0.9, `stone consumed ${stoneUsed}`);
  const stages = new Set(w.events.filter((e) => e.type === 'shelter_stage').map((e) => e.stage));
  assert.ok(stages.has(1) && stages.has(2) && stages.has(3), 'visible stages 1..3 emitted');
  assert.ok(w.creatures.every((c) => c.hunger < 100 || c.health > 0));
});

test('reproduction needs adulthood, shelter and food; offspring grow before fertility; recovery period', () => {
  const w = World.create(mk());
  const violations = [];
  for (let i = 0; i < 20000; i++) {
    w.step();
    for (const c of w.creatures) {
      if ((c.pregnant || c.partner) && !w.isAdult(c)) violations.push(['minor mating/bond', c.id]);
      if (c.pregnant && c.cooldown <= 0 && c.pregnant.due - w.tick > DEFAULTS.world.gestation) violations.push(['no cooldown', c.id]);
    }
  }
  assert.deepEqual(violations, []);
  assert.ok(w.totals.births >= 5, 'births ' + w.totals.births);
  const births = w.events.filter((e) => e.type === 'birth');
  assert.ok(births.every((b) => b.parents.length === 2));
  // every birth gets a lifecycle callback record
  const rec = []; const w2 = World.create(mk()); w2.onRecord = (r) => rec.push(r); runTicks(w2, 12000);
  assert.equal(rec.filter((r) => r.kind === 'birth').length, w2.totals.births);
  assert.equal(rec.filter((r) => r.kind === 'death').length, w2.totals.deaths);
  assert.ok(rec.filter((r) => r.kind === 'death').every((r) => r.cause));
  const kid = w.creatures.find((c) => c.parents.length);
  if (kid) assert.ok(kid.generation >= 1);
});

test('scarcity suppresses reproduction, harms health, kills by starvation; extinction preserves history and stops births', () => {
  const cfg = mk({ world: { bush: { initial: 0, regrow: 0, spread: 0 }, initialSeedCount: 12 } });
  const w = World.create(cfg);
  const hist = []; let sawHealthLoss = false;
  for (let i = 0; i < 12000 && w.status === 'alive'; i++) { w.step(); if (w.creatures.some((c) => c.health < 100 && c.hunger >= 90)) sawHealthLoss = true; }
  assert.equal(w.status, 'extinct');
  assert.ok(sawHealthLoss);
  assert.equal(w.totals.births, 0, 'no births under scarcity');
  assert.ok((w.totals.deathsByCause.starvation ?? 0) > 0);
  const deaths = w.totals.deaths, histLen = w.history.length;
  runTicks(w, 500);
  assert.equal(w.totals.births, 0); assert.equal(w.totals.deaths, deaths); assert.equal(w.creatures.length, 0);
  assert.ok(w.graveyard.length === deaths && histLen > 0);
  assert.equal(w.events.filter((e) => e.type === 'extinction').length, 1);
});

test('disasters damage creatures and shelters; heal and food interventions help; bounds enforced', () => {
  const w = World.create(mk());
  runTicks(w, 3000);
  const sh = w.shelters.find((s) => s.stage >= 3); assert.ok(sh, 'has shelter');
  const integ = sh.integrity;
  // Measure actual fire damage, independent of births and concurrent healing.
  let fireDamage = 0;
  const damage = w.damage.bind(w);
  w.damage = (c, amount, cause) => {
    const before = c.health; damage(c, amount, cause);
    if (cause === 'fire') { assert.ok(c.health < before); fireDamage += before - c.health; }
  };
  const r = w.intervene({ id: 'fire-test-0001', type: 'fire', x: sh.x, y: sh.y, radius: 6, intensity: 1 }, '0xdev');
  assert.ok(r.ok);
  assert.equal(w.intervene({ id: 'cooldown-0001', type: 'fire', x: 5, y: 5, radius: 3, intensity: 0.5 }, 'x').status, 429, 'frequency bound');
  runTicks(w, 60);
  assert.ok(sh.integrity < integ || !w.shelters.includes(sh), 'shelter damaged');
  assert.ok(fireDamage > 0, 'fire damages creatures as well as shelters');
  runTicks(w, 200);
  const s2 = w.intervene({ id: 'storm-test-001', type: 'storm', x: 28, y: 28, radius: 8, intensity: 1 }, '0xdev');
  assert.ok(s2.ok);
  const hurt = w.creatures.filter((c) => c.health < 100).length; runTicks(w, 40);
  const lowest = w.creatures.reduce((m, c) => (c.health < m.health ? c : m));
  const heal = w.intervene({ id: 'heal-test-0001', type: 'heal_area', x: lowest.x, y: lowest.y, radius: 8, intensity: 1 }, '0xdev');
  assert.ok(heal.ok && heal.record.result.healed >= 1);
  const f0 = w.totalFood(); const af = w.intervene({ id: 'food-test-0001', type: 'add_food', x: 28, y: 28, radius: 8, intensity: 0.5 }, '0xdev');
  assert.ok(af.ok); assert.ok(w.totalFood() >= f0);
  // bounds
  assert.equal(w.intervene({ id: 'big-radius-001', type: 'fire', x: 5, y: 5, radius: 99, intensity: 0.5 }, 'x').status, 422);
  assert.equal(w.intervene({ id: 'big-intens-001', type: 'fire', x: 5, y: 5, radius: 3, intensity: 5 }, 'x').status, 422);
});

test('creatures react to fire (flee) and recover afterwards', () => {
  const w = World.create(mk());
  runTicks(w, 200);
  const c = w.creatures[0];
  w.intervene({ id: 'react-fire-001', type: 'fire', x: Math.round(c.x), y: Math.round(c.y), radius: 4, intensity: 1 }, 'x');
  let fled = false; for (let i = 0; i < 40; i++) { w.step(); if (w.creatures.some((x) => x.act?.type === 'FLEE')) fled = true; }
  assert.ok(fled, 'someone fled');
  runTicks(w, 1500);
  assert.ok(w.creatures.filter((x) => x.health > 80).length >= w.creatures.length * 0.7, 'recovery');
});

test('visitor wallets: helpful vs harmful opinions change approach/avoid; disabled learning does not', () => {
  const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40);
  const run = (learning) => {
    const w = World.create(mk({ world: { learning } }));
    runTicks(w, 300);
    for (let k = 0; k < 8; k++) {
      const c = w.creatures[0];
      w.visitorPresence(A, c.x, c.y); w.visitorAction(A, 'gift_food'); runTicks(w, 130);
      const d = w.creatures[0]; w.visitorPresence(B, d.x, d.y); w.visitorAction(B, 'startle'); runTicks(w, 250);
    }
    return w;
  };
  const on = run(true), off = run(false);
  const vals = (w) => { const n = w.creatures.filter((c) => c.brain.wallets[A] || c.brain.wallets[B]); return n; };
  const withOp = vals(on);
  assert.ok(withOp.length > 0);
  const meanA = withOp.reduce((s, c) => s + (c.brain.wallets[A]?.v ?? 0), 0) / withOp.length, meanB = withOp.reduce((s, c) => s + (c.brain.wallets[B]?.v ?? 0), 0) / withOp.length;
  assert.ok(meanA > 0.2 && meanB < -0.2, `opinions A=${meanA} B=${meanB}`);
  assert.equal(vals(off).length, 0, 'no opinions without learning');
  // memories exist regardless
  assert.ok(off.creatures.some((c) => c.memories.some((m) => m.kind === 'visitor_harm')));
  // behaviour: a creature with a negative opinion prefers AVOID over APPROACH
  const c = withOp.find((x) => (x.brain.wallets[B]?.v ?? 0) < -0.3);
  if (c) { const { visitorUtility } = awaitBrain; assert.ok(visitorUtility(c.brain, 'AVOID', c.brain.wallets[B].v) > visitorUtility(c.brain, 'APPROACH', c.brain.wallets[B].v)); }
});
import * as awaitBrain from '../server/src/brain.js';

test('learning changes weights; disabled keeps priors; speech is labelled template', () => {
  const on = World.create(mk()), off = World.create(mk({ world: { learning: false } }));
  const w0 = JSON.stringify(on.creatures.map((c) => c.brain.w));
  assert.equal(w0, JSON.stringify(off.creatures.map((c) => c.brain.w)), 'identical initial conditions');
  runTicks(on, 1500); runTicks(off, 1500);
  assert.ok(on.creatures.some((c) => c.brain.updates > 10));
  assert.ok(off.creatures.every((c) => c.brain.updates === 0));
  const bubbles = on.creatures.flatMap((c) => c.speech);
  assert.ok(bubbles.length > 5);
  const spoken = on.creatures.find((c) => c.bubble); if (spoken) assert.equal(spoken.bubble.kind, 'template');
});
