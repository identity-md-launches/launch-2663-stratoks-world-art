import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { World } from '../server/src/world.js';
import { DEFAULTS, deepMerge, loadConfig } from '../server/src/config.js';
import { createMushroom, encode, readout, reinforce, MB_PARAMS } from '../server/src/mushroom.js';
import { initializeBrains, scoreCandidate, setBrainMode, rewardAction } from '../server/src/controller.js';
import { decide, stepAct, endAct } from '../server/src/actions.js';
import { migrate } from '../server/src/migrations.js';
import { Service } from '../server/src/service.js';
import { restoreBackup } from '../server/src/store.js';
import { creatureDetail } from '../server/src/view.js';
import { testConfig, runTicks, startApp, api, wsClient, until } from './helpers.js';
import { experiment } from './experiments/mushroom-learning.mjs';
const cfg = mode => deepMerge(DEFAULTS, { world: { brainMode: mode, initialSeedCount: 2 } });
const neuralWeights = c => JSON.stringify([c.brain.mb.positive, c.brain.mb.negative]);

test('MB circuit: deterministic sparse expansion, opponent plasticity, bounded storage, independent state', () => {
  const a = createMushroom(5), b = createMushroom(5), d = createMushroom(6);
  assert.deepEqual(a, b); assert.notDeepEqual(a.projection, d.projection);
  const o = { features: [0.4, 0.2], x: 20, y: 30, width: 56, height: 56, cues: [1, 0, 0, 0] };
  const trace = encode(a, o); assert.equal(trace.active.length, MB_PARAMS.winners);
  assert.equal(new Set(trace.active).size, MB_PARAMS.winners);
  reinforce(a, 'EAT', trace, 1, 1, true);
  assert.ok(readout(a, 'EAT', trace) > 0); assert.equal(readout(b, 'EAT', trace), 0);
  for (let i = 0; i < 1000; i++) reinforce(a, 'EAT', trace, -2, i, true);
  assert.ok(readout(a, 'EAT', trace) < -1.9);
  assert.equal(readout(a, 'EAT', trace, true), 0);
  assert.equal(a.rewardHistory.length, MB_PARAMS.history);
  assert.equal(Object.keys(a.positive).length, 11);
  assert.ok(Object.values(a.positive).flat().every(v => v >= 0 && v <= 2));
});

test('schema 2 -> 3 adds metadata only; explicit activation retains legacy state and global RNG', () => {
  const w = World.create(cfg('legacy')); runTicks(w, 150);
  const s = JSON.parse(JSON.stringify(w.toState())); delete s.brainMode;
  for (const c of s.creatures) delete c.brain.version;
  const before = structuredClone(s), result = migrate({ schemaVersion: 2, state: s });
  assert.equal(result.to, 3); assert.equal(result.snap.state.brainMode, 'legacy');
  const legacy = World.fromState(cfg('legacy'), result.snap.state);
  const preserved = JSON.stringify(legacy.creatures), rng = legacy.rng.s;
  setBrainMode(legacy, 'mb-v1');
  assert.equal(legacy.rng.s, rng);
  assert.equal(legacy.id, before.id); assert.equal(legacy.tick, before.tick);
  const stripped = structuredClone(legacy.creatures); for (const c of stripped) delete c.brain.mb;
  assert.equal(JSON.stringify(stripped), preserved);
  assert.notDeepEqual(legacy.creatures[0].brain.mb.projection, legacy.creatures[1].brain.mb.projection);
  setBrainMode(legacy, 'legacy'); assert.equal(legacy.creatures[0].brain.mb.version, 1);
  legacy.creatures[0].brain.mb.version = 99;
  assert.throws(() => setBrainMode(legacy, 'mb-v1'), /unsupported/);
});

test('default legacy and explicit configuration validation; unset restart retains stored mode', () => {
  assert.equal(loadConfig({}, []).world.brainMode, 'legacy');
  assert.throws(() => loadConfig({ BRAIN_MODE: 'fly-conscious' }, []), /invalid brain mode/);
  assert.equal(loadConfig({ BRAIN_MODE: 'mb-v1' }, []).world.brainModeSource, 'env');
  const config = testConfig({ world: { brainMode: 'mb-v1', tickMs: 1000, catchup: { maxTicks: 0 } } });
  const a = new Service(config); a.start(); clearTimeout(a.timer); a.stop();
  const unset = deepMerge(config, { world: { brainMode: 'legacy', brainModeSource: 'default' } });
  const b = new Service(unset); b.start(); clearTimeout(b.timer);
  assert.equal(b.world.brainMode, 'mb-v1'); b.stop();
  unset.world.brainModeSource = 'file';
  const c = new Service(unset); c.start(); clearTimeout(c.timer);
  assert.equal(c.world.brainMode, 'legacy'); assert.ok(c.world.creatures.every(x => x.brain.mb)); c.stop();
});

test('frozen learning, LEARNING=false, catchup and in-flight mode changes never alter neural weights', () => {
  const w = World.create(cfg('mb-v1')), c = w.creatures[0], f = new Array(12).fill(0.3);
  const trace = scoreCandidate(w, c, 'EAT', f).trace;
  const act = { type: 'EAT', brainMode: 'mb-v1', trace, f, u: 0 };
  rewardAction(w, c, act, 1); const before = neuralWeights(c);
  w.learning = false; rewardAction(w, c, act, -1); assert.equal(neuralWeights(c), before);
  w.learning = true; w.catchup = true; rewardAction(w, c, act, -1); assert.equal(neuralWeights(c), before);
  w.catchup = false; setBrainMode(w, 'mb-v1-frozen');
  rewardAction(w, c, act, -1); assert.equal(neuralWeights(c), before);
  rewardAction(w, c, { ...act, brainMode: 'mb-v1-frozen' }, -1); assert.equal(neuralWeights(c), before);
  setBrainMode(w, 'legacy'); rewardAction(w, c, act, -1); assert.equal(neuralWeights(c), before);
});

test('ten fixed seeds: acquisition, heldout freeze, reversal, causal lesion and exact restart', () => {
  for (const task of ['location', 'cue', 'threat']) {
    const on = [], frozen = [], lesion = [], reversed = [];
    for (let seed = 1; seed <= 10; seed++) {
      const r = experiment(seed, 'mb-v1', task), f = experiment(seed, 'mb-v1-frozen', task);
      assert.ok(r.restartStateIdentical && r.restartChoicesIdentical);
      assert.ok(r.phases.filter(p => p.phase.includes('heldout')).every(p => !p.weightsChanged));
      const val = (r, name) => r.phases.find(p => p.phase === name).fractionGood;
      on.push(val(r, 'acquisition-heldout')); frozen.push(val(f, 'acquisition-heldout'));
      lesion.push(val(r, 'reversal-lesion-heldout')); reversed.push(val(r, 'reversal-heldout'));
    }
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    assert.ok(mean(on) > mean(frozen) + 0.2, `${task}: acquisition gain`);
    assert.ok(mean(reversed) > mean(lesion) + 0.2, `${task}: causal reversal gain`);
  }
});

test('actual decision/execution uses candidate target associations and consumes shared world food', () => {
  const w = World.create(deepMerge(cfg('mb-v1'), { world: { initialSeedCount: 1 } }));
  const c = w.creatures[0]; c.x = 28; c.y = 28; c.hunger = 40; c.energy = 75;
  w.tiles.fill(0); w.trees = []; w.stones = []; w.shelters = []; w.rebuildBlocked();
  w.bushes = [{ id: 100, x: 24, y: 28, amount: 5, gift: null }, { id: 101, x: 32, y: 28, amount: 5, gift: null }];
  // Obtain exact real observations, then condition them. This isolates wiring causality
  // from ecology; rewards are synthetic here, execution and resource debit below are real.
  decide(w, c); c.act = null;
  const f = [0.4, 0.25, 0, 0.6, 1, 1, 0, 0, 0, 0, 0, 1];
  for (let i = 0; i < 80; i++) for (const b of w.bushes) {
    const { trace } = scoreCandidate(w, c, 'EAT', f, { target: b });
    reinforce(c.brain.mb, 'EAT', trace, b.id === 101 ? 2 : -2, i, true);
  }
  let chosen = 0;
  for (let i = 0; i < 100; i++) { decide(w, c); if (c.act.bush === 101) chosen++; c.act = null; }
  assert.ok(chosen > 80, `trained target chosen ${chosen}/100`);
  decide(w, c); assert.equal(c.act.type, 'EAT');
  const foodBefore = w.totalFood(), hungerBefore = c.hunger;
  for (let i = 0; i < 80 && c.act; i++) { w.tick++; stepAct(w, c); }
  assert.ok(w.totalFood() < foodBefore); assert.ok(c.hunger < hungerBefore);
  assert.ok(c.brain.mb.rewardHistory.at(-1).learned);
  const detail = creatureDetail(w, c);
  assert.equal(detail.brainBehavior.mode, 'mb-v1');
  assert.equal(detail.brainBehavior.decision.source, 'model');
  assert.ok(detail.brainBehavior.decision.candidates.some(x => x.preference !== 0));
  c.hunger = 90; decide(w, c);
  assert.equal(creatureDetail(w, c).brainBehavior.decision.source, 'reflex');
});

test('observation bounds exclude remote cue changes', () => {
  const w = World.create(cfg('mb-v1')), c = w.creatures[0], f = new Array(12).fill(0);
  c.x = 28; c.y = 28;
  const before = scoreCandidate(w, c, 'REST', f).sensed;
  w.fires.push({ x: 1, y: 1, r: 2 }); w.bushes.push({ x: 1, y: 1, amount: 5, gift: true });
  assert.deepEqual(scoreCandidate(w, c, 'REST', f).sensed, before);
  assert.equal(scoreCandidate(w, c, 'EAT', f, { target: { x: 1, y: 1 } }).sensed.visible, false);
});

test('exact neural/RNG/action retention through service restart, backup restore, and rollback on copied world', () => {
  let now = 1_800_000_000_000;
  const config = testConfig({ world: { brainMode: 'mb-v1', tickMs: 1000, catchup: { maxTicks: 0 } } });
  const make = conf => { const s = new Service(conf, { now: () => now }); s.start(); clearTimeout(s.timer); return s; };
  const s = make(config); runTicks(s.world, 700); s.snapshot(true);
  const saved = JSON.parse(JSON.stringify(s.world.toState()));
  const backup = s.store.backup('neural'); s.stop();
  const r = make(config);
  assert.deepEqual(r.world.toState(), saved);
  runTicks(s.world, 100); runTicks(r.world, 100); assert.equal(JSON.stringify(r.world.toState()), JSON.stringify(s.world.toState()));
  r.stop(); restoreBackup(config.server.dataDir, backup);
  const restored = make(config); assert.deepEqual(restored.world.toState(), saved); restored.stop();
  const copyCfg = testConfig({ world: { brainMode: 'legacy', brainModeSource: 'file', catchup: { maxTicks: 0 } } });
  fs.cpSync(config.server.dataDir, copyCfg.server.dataDir, { recursive: true });
  const originalFile = fs.readFileSync(path.join(config.server.dataDir, 'world.json'));
  const copy = make(copyCfg);
  assert.equal(copy.world.brainMode, 'legacy');
  assert.equal(copy.world.id, saved.id); assert.equal(copy.world.tick, saved.tick);
  assert.deepEqual(copy.world.creatures.map(c => c.brain.mb), saved.creatures.map(c => c.brain.mb));
  assert.deepEqual(copy.world.creatures.map(c => c.brain.w), saved.creatures.map(c => c.brain.w));
  runTicks(copy.world, 40); copy.stop();
  assert.deepEqual(fs.readFileSync(path.join(config.server.dataDir, 'world.json')), originalFile);
});

test('two actual clients see same server decisions; inspector is read-only and no mode mutation API exists', async () => {
  const app = await startApp({ world: { brainMode: 'mb-v1', tickMs: 1000 } }, { manualTicks: true });
  const clients = [];
  try {
    clients.push(await wsClient(app.base), await wsClient(app.base));
    for (let i = 0; i < 20; i++) app.svc.tickOnce();
    assert.ok(await until(() => clients.every(c => c.tick === app.svc.world.tick)));
    assert.deepEqual([...clients[0].entities], [...clients[1].entities]);
    const id = app.svc.world.creatures[0].id;
    const a = await api(app.base, 'GET', `/api/creatures/${id}`), b = await api(app.base, 'GET', `/api/creatures/${id}`);
    assert.deepEqual(a.json.brainBehavior, b.json.brainBehavior);
    assert.equal(a.json.brainBehavior.mode, 'mb-v1');
    const denial = await api(app.base, 'POST', '/api/dev/brain-mode', { body: { mode: 'legacy' } });
    assert.ok([401, 403, 404].includes(denial.status));
    assert.equal(app.svc.world.brainMode, 'mb-v1');
  } finally { for (const c of clients) c.ws.close(); await app.stop(); }
});

test('actual health loss supplies punishment to the stored sensory eligibility', () => {
  const w = World.create(cfg('mb-v1')), c = w.creatures[0];
  const f = [0.4, 0.25, 0, 0.6, 1, 0, 0, 0, 0, 0, 0, 1];
  const scored = scoreCandidate(w, c, 'EAT', f);
  c.act = { type: 'EAT', brainMode: 'mb-v1', trace: scored.trace, f, u: scored.u, decisionSource: 'model', start: { h: c.hunger, e: c.energy, hp: c.health, tick: w.tick }, bonus: 0 };
  w.damage(c, 30, 'fire'); w.tick++; endAct(w, c, 'completed');
  const value = readout(c.brain.mb, 'EAT', scored.trace);
  assert.ok(value < 0, 'injury must condition negative target value');
  const reward = c.brain.mb.rewardHistory.at(-1);
  assert.ok(reward.reward < 0 && reward.learned); assert.equal(reward.source, 'model');
});
