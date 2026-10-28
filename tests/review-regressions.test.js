import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { World } from '../server/src/world.js';
import { DEFAULTS, deepMerge } from '../server/src/config.js';
import { BRAIN_MODES, brainInspection } from '../server/src/controller.js';
import { decide, stepAct } from '../server/src/actions.js';
import { Service } from '../server/src/service.js';
import { Store } from '../server/src/store.js';

function clearing(mode, reverse, depleted = 9) {
  const w = World.create(deepMerge(DEFAULTS, { world: { brainMode: mode, initialSeedCount: 1 } })), c = w.creatures[0];
  Object.assign(c, { x: 20, y: 20, hunger: 85, energy: 75 }); w.tick = 100;
  w.tiles.fill(0); for (const k of ['trees', 'stones', 'shelters', 'fires', 'storms']) w[k] = [];
  w.rebuildBlocked(); c.places.food = [];
  const full = [{ id: 10, x: 21, y: 20, amount: 5 }, { id: 20, x: 31, y: 20, amount: 5 }];
  w.bushes = [...Array.from({ length: depleted }, (_, i) => ({ id: 100 + i, x: 23 + i % 3, y: 21 + Math.floor(i / 3), amount: 0 })), ...(reverse ? full.reverse() : full)];
  return { w, c };
}

for (const mode of BRAIN_MODES) {
  for (const reverse of [false, true]) {
    for (const depleted of [9, 10]) test(`${mode}: emergency sees both full sites beyond ${depleted} depleted sites; reverse=${reverse}`, () => {
      const { w, c } = clearing(mode, reverse, depleted);
      decide(w, c);
      assert.equal(c.act.type, 'EAT'); assert.equal(c.act.bush, 10);
      assert.equal(c.act.decisionSource, 'reflex');
      assert.equal(brainInspection(w, c).decision.source, 'reflex');
      assert.equal(brainInspection(w, c).decision.selectedTarget, 10);
      assert(c.places.food.length <= 10, 'the persistent learned memory cap remains separate');
      assert.equal(c.act.failed, undefined);
      for (let i = 0; i < 120 && c.act; i++) { w.tick++; stepAct(w, c); }
      assert.equal(c.act, null); assert(c.hunger < 85, 'the selected food is actually eaten');
    });
    test(`${mode}: emergency distance tie beyond the cap uses stable food id; reverse=${reverse}`, () => {
      const { w, c } = clearing(mode, reverse);
      w.bushes.find(b => b.id === 20).x = 19;
      decide(w, c); assert.equal(c.act.bush, 10); assert.equal(c.act.decisionSource, 'reflex');
    });
  }
  test(`${mode}: emergency unions remembered sites with all sensed sites and filters feasibility`, () => {
    const { w, c } = clearing(mode, true, 10);
    const remembered = { id: 30, x: 20, y: 35, amount: 5, tick: 90 };
    w.bushes.push({ ...remembered }); c.places.food = [{ ...remembered }];
    // Both visible sites are unusable; the remembered site is outside perception.
    w.bushes.find(b => b.id === 20).amount = 0;
    w.tiles[w.idx(21, 20)] = 1; w.rebuildBlocked();
    decide(w, c); assert.equal(c.act.bush, 30); assert.equal(c.act.decisionSource, 'reflex');
    assert.equal(c.act.failed, undefined);
    // Live observation of depletion overrides a formerly full remembered site.
    c.act = null; c.y = 34; w.bushes.find(b => b.id === 30).amount = 0;
    decide(w, c); assert.equal(c.act.type, 'WANDER'); assert.equal(c.act.decisionSource, 'rule');
  });
  test(`${mode}: non-emergency decisions retain the existing capped candidate memory`, () => {
    const { w, c } = clearing(mode, true); c.hunger = 40;
    decide(w, c);
    assert.equal(c.brain.inspection.source, 'model');
    assert.deepEqual(c.brain.inspection.candidates.filter(x => x.action === 'EAT').map(x => x.target), [20]);
    assert.equal(c.places.food.length, 10);
  });

  test(`${mode}: accepted-parent decision survives explicit startup switch and another restart without decide`, () => {
    const state = JSON.parse(gunzipSync(fs.readFileSync(new URL('./fixtures/accepted99e50b1-mb-decision.json.gz', import.meta.url))));
    const captured = structuredClone(state.creatures[0].brain.inspection);
    assert.equal(state.brainMode, 'mb-v1'); assert.equal(captured.mode, undefined);
    assert.equal(captured.activeKCs.length, 8); assert(captured.candidates.some(x => x.preference > 0));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratoks-review-restart-'));
    const cfg = deepMerge(DEFAULTS, { server: { dataDir }, world: { brainMode: mode, brainModeSource: 'file', catchup: { maxTicks: 0 } } });
    let svc;
    try {
      const store = new Store(dataDir, cfg.persistence); store.init(); store.save(state); store.release();
      for (let restart = 0; restart < 2; restart++) {
        svc = new Service(cfg); svc.start(); clearTimeout(svc.timer); clearInterval(svc.snapTimer);
        const c = svc.world.creatures[0], actual = brainInspection(svc.world, c);
        assert.equal(actual.mode, mode); assert.deepEqual(actual.decision, captured);
        assert.equal(c.stats.decisions, state.creatures[0].stats.decisions);
        assert.deepEqual(c.brain.mb.positive, state.creatures[0].brain.mb.positive);
        assert.deepEqual(c.brain.mb.negative, state.creatures[0].brain.mb.negative);
        svc.stop(); svc = null;
      }
    } finally { svc?.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); }
  });
}
