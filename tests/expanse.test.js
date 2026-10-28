// Phase 2B expanse: world, agents, primitives, fire/tool, social, persistence and migration checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../server/src/world.js';
import { DEFAULTS, deepMerge } from '../server/src/config.js';
import { Expanse, RECIPES } from '../server/src/expanse/engine.js';
import { CHUNK, BASE, T, generateChunk, NODE_KINDS } from '../server/src/expanse/terrain.js';
import { createMind, updateModel, predict, plan, LIMITS, recordEpisode, modelKey, OBSERVATION_VERSION, MEMORY_VERSION } from '../server/src/expanse/agent.js';
import { save, load, backup, restore, rollback, fromLegacySnapshot, migrateExpanse, readState, SNAPSHOT } from '../server/src/expanse/persist.js';
import { MIGRATIONS as LEGACY_MIGRATIONS } from '../server/src/migrations.js';
import { viewport, minimap } from '../server/src/expanse/view.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'expanse-'));
const mk = (seed = 11, n = 24, cfg = {}) => Expanse.create({ initialCount: n, ...cfg }, { seed });
// puts a creature in a controlled situation without running its brain
function stage(e, c, inv = {}) { c.inventory = { ...inv }; c.act = null; c.plan = null; c.hunger = 10; c.thirst = 10; c.warmth = 90; c.health = 100; c.energy = 90; }
function run(e, c, step, max = 200) {
  c.plan = { id: 0, tick: e.tick, source: 'test', steps: [step], predicted: [], actual: [], raw: [{ key: step.key ?? 'test|x|', label: step.label ?? 'WANDER', ...step }], idx: 0 };
  e.startStep(c);
  for (let i = 0; i < max && c.act; i++) { e.tick++; e.rebuildIndex(); e.stepAct(c); }
  return c.mind.plans.at(-1)?.actual.at(-1);
}
function freeSpot(e, x0, y0) { for (let r = 0; r < 20; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = x0 + dx, y = y0 + dy; if (e.passable(x, y) && !e.nodeAt(x, y) && !e.pileAt(x, y)) return { x, y }; } }

test('original 56x56 settlement terrain, IDs and coordinates are preserved', () => {
  const cfg = deepMerge(DEFAULTS, { world: { seed: 11, brainMode: 'mb-v1', initialSeedCount: 24 } });
  const w = World.create(cfg), e = mk(11);
  for (let y = 0; y < BASE; y++) for (let x = 0; x < BASE; x++) assert.equal(e.tile(x, y), w.tiles[y * BASE + x]);
  for (const t of w.trees) assert.equal(e.nodeAt(t.x, t.y)?.id, `t${t.id}`);
  for (const s of w.stones) assert.equal(e.nodeAt(s.x, s.y)?.id, `s${s.id}`);
  assert.deepEqual(e.creatures.map((c) => [c.id, c.x, c.y, c.name]), w.creatures.map((c) => [c.id, Math.round(c.x), Math.round(c.y), c.name]));
});

test('extent is at least 16x the settlement and contains all four biomes with distinct physics', () => {
  const e = mk(11), b = e.bounds();
  assert.ok((b.x1 - b.x0) * (b.y1 - b.y0) >= 16 * BASE * BASE);
  const biomes = new Set(), tiles = new Set();
  for (let y = b.y0; y < b.y1; y += 3) for (let x = b.x0; x < b.x1; x += 3) { biomes.add(e.biome(x, y)); tiles.add(e.tile(x, y)); }
  for (const k of ['temperate', 'arid', 'cold', 'coast']) assert.ok(biomes.has(k), k);
  for (const t of [T.SEA, T.SHALLOW, T.SNOW, T.DUNE, T.CLIFF]) assert.ok(tiles.has(t), `tile ${t}`);
  // temperature differs by biome
  const temp = (bio) => { for (let y = b.y0; y < b.y1; y += 5) for (let x = b.x0; x < b.x1; x += 5) if (e.biome(x, y) === bio && e.passable(x, y)) return e.ambient(x, y); };
  assert.ok(temp('cold') < temp('temperate') && temp('temperate') < temp('arid'));
});

test('unvisited chunks generate reproducibly; revisited chunks keep modifications across save/load', () => {
  const a = generateChunk(11, 4, -3, null), b = generateChunk(11, 4, -3, null);
  assert.deepEqual(a, b);
  assert.notDeepEqual(generateChunk(12, 4, -3, null).tiles, a.tiles);
  const e = mk(11), ch = e.chunk(3, 3), n = ch.nodes[0];
  n.units = 0; n.t = e.tick; e.dirty(n.x, n.y);
  const dir = tmp(); save(dir, e);
  const r = load(dir);
  assert.equal(r.nodeAt(n.x, n.y).units, 0);
  assert.deepEqual(r.chunk(-4, 2).tiles, e.chunk(-4, 2).tiles); // never-saved chunk regenerates identically
});

test('no spawn traps: every initial creature can reach a large connected area', () => {
  for (const seed of [1, 2, 3]) {
    const e = mk(seed);
    for (const c of e.creatures.slice(0, 6)) {
      const seen = new Set([`${c.x},${c.y}`]), q = [[c.x, c.y]];
      while (q.length && seen.size < 600) { const [x, y] = q.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = `${x + dx},${y + dy}`; if (!seen.has(k) && e.passable(x + dx, y + dy)) { seen.add(k); q.push([x + dx, y + dy]); } } }
      assert.ok(seen.size >= 600, `creature ${c.id} seed ${seed} reaches ${seen.size}`);
    }
  }
});

test('item and node accounting is conserved over a full simulation (no free resources)', () => {
  const e = mk(5); e.run(1500);
  const h = e.holdings(), T_ = e.totals, items = new Set([...Object.keys(h), ...Object.keys(T_.gathered), ...Object.keys(T_.crafted)]);
  for (const it of items) {
    const expected = (T_.gathered[it] ?? 0) + (T_.crafted[it] ?? 0) - (T_.craftUsed[it] ?? 0) - (T_.eaten[it] ?? 0) - (T_.burnedItems[it] ?? 0) - (T_.built[it] ?? 0);
    assert.equal(h[it] ?? 0, expected, `item ${it}`);
  }
  // nodes: initial + regrown - gathered - burned = current (per generated chunk)
  let units = 0, initial = 0;
  for (const ch of e.chunks.values()) { const fresh = generateChunk(e.seed, ch.cx, ch.cy, e.base); for (const n of fresh.nodes) initial += n.units; for (const n of ch.nodes) units += e.settle(n).units; }
  const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
  assert.equal(units, initial + sum(T_.regrown) - sum(T_.gathered) - sum(T_.burnedNodes));
});

test('restart is exact: save/load mid-run equals an uninterrupted run', () => {
  const a = mk(9), b = mk(9);
  a.run(400); const dir = tmp(); save(dir, a);
  const a2 = load(dir); a2.run(300); b.run(700);
  const strip = (s) => JSON.stringify({ ...s, chunks: s.chunks.sort((x, y) => x.cx - y.cx || x.cy - y.cy) });
  assert.equal(strip(a2.toState()), strip(b.toState()));
});

test('outcome model, episodic memory and knowledge stay bounded', () => {
  const m = createMind();
  for (let i = 0; i < 500; i++) { updateModel(m, `k${i}|a|`, { reward: 1, success: true, duration: 2, energy: 1, produced: { [`it${i}`]: 1, x: 1, y: 2, z: 3 }, tick: i }); recordEpisode(m, { reward: i % 3, tick: i }); }
  assert.ok(Object.keys(m.model).length <= LIMITS.modelEntries);
  assert.ok(m.episodes.length <= LIMITS.episodes);
  for (const e of Object.values(m.model)) assert.ok(Object.keys(e.produced).length <= LIMITS.producedKinds);
  const e = mk(3); e.run(1200);
  for (const c of e.creatures) { assert.ok(Object.keys(c.mind.known).length <= LIMITS.knownNodes); assert.ok(c.mind.plans.length <= LIMITS.plans); assert.ok(c.mind.visited.length <= LIMITS.visited); }
});

test('outcome model learns from transitions with shrinking uncertainty; planner chains on learned produced items only', () => {
  const m = createMind(), k = modelKey('combine', 'flint+stick');
  const p0 = predict(m, k);
  for (let i = 0; i < 10; i++) updateModel(m, k, { reward: 0.5, success: true, duration: 4, energy: 1, produced: { hand_axe: 1 }, tick: i });
  const p1 = predict(m, k); assert.ok(p1.sigma < p0.sigma); assert.equal(p1.produced.hand_axe, 1);
  updateModel(m, modelKey('gather', 'tree', 'tool'), { reward: 1, success: true, duration: 3, energy: 2, produced: { wood: 2 }, tick: 1 });
  const afford = (inv) => [{ prim: 'combine', key: k, consumes: ['flint', 'stick'] }, ...(inv.hand_axe ? [{ prim: 'gather', key: modelKey('gather', 'tree', 'tool') }] : [])];
  const seqs = plan(m, { inventory: { flint: 1, stick: 1 } }, afford, {});
  assert.ok(seqs.some((s) => s.steps.length === 2 && s.steps[1].prim === 'gather'), 'chained via learned hand_axe');
  const blank = plan(createMind(), { inventory: { flint: 1, stick: 1 } }, afford, {});
  assert.ok(!blank.some((s) => s.steps.some((x) => x.prim === 'gather')), 'unlearned outcome cannot be assumed');
});

test('planner compares all root affordances and does not enumerate away later primitive branches', () => {
  const e = mk(7), c = e.creatures[0], obs = e.perceive(c);
  c.home = { x: c.x + 20, y: c.y };
  c.inventory = { wood: 1, stick: 1, fiber: 1, stone: 1, flint: 1, berry: 1 };
  for (let i = 0; i < 10; i++) c.mind.known[`test-${i}`] = { x: c.x + 2 + i, y: c.y, kind: `node-${i}`, units: 3, t: 0 };
  c.mind.water.push({ x: c.x + 3, y: c.y + 3, t: 0 });
  const afford = e.affordances(c, obs), all = afford(c.inventory, null);
  const plans = plan(c.mind, { inventory: c.inventory }, afford, {});
  const starts = new Set(plans.map((p) => `${p.steps[0].prim}:${p.steps[0].purpose ?? ''}`));
  for (const expected of ['rest:', 'move:explore', 'move:home', 'inspect:', 'share:', 'socialize:']) {
    assert.ok(all.some((s) => `${s.prim}:${s.purpose ?? ''}`.startsWith(expected)), `affordance ${expected}`);
    assert.ok([...starts].some((s) => s.startsWith(expected)), `planner compares ${expected}`);
  }
  assert.deepEqual(plan(c.mind, { inventory: c.inventory }, (inv, prev) => afford(inv, prev).reverse(), {}).map((p) => p.steps), plans.map((p) => p.steps));
  const deep = plan(createMind(), { inventory: {} }, (_inv, prev) => prev ? [
    ...Array.from({ length: 9 }, (_, i) => ({ prim: 'gather', key: `gather-${i}`, label: 'GATHER_WOOD' })),
    { prim: 'combine', key: 'combine|late-pair|', label: 'GATHER_WOOD' },
  ] : [{ prim: 'inspect', key: 'inspect|root|', label: 'WANDER' }], { horizon: 2 });
  assert.ok(deep.some((p) => p.steps.length === 2 && p.steps[1].prim === 'combine'));
});

test('energy costs block gathering, shelter construction and attacks without allowing negative energy', () => {
  const e = mk(17), c = e.creatures[0], target = e.creatures[1];
  stage(e, c, { wood: 4, stone: 2 }); c.energy = 0;
  const before = { ...c.inventory };
  const built = run(e, c, { prim: 'build' });
  assert.equal(built.reason, 'exhausted'); assert.equal(e.shelters.length, 0); assert.deepEqual(c.inventory, before); assert.equal(c.energy, 0);

  const tree = e.chunk(0, 0).nodes.find((n) => n.kind === 'tree' && n.units > 0);
  const spot = freeSpot(e, tree.x, tree.y); c.x = spot.x; c.y = spot.y; stage(e, c, {}); c.energy = 1.1;
  const units = tree.units;
  const gathered = run(e, c, { prim: 'gather', node: tree.id, kind: 'tree', x: tree.x, y: tree.y });
  assert.equal(gathered.reason, 'exhausted'); assert.equal(tree.units, units); assert.equal(c.energy, 1.1);

  target.x = c.x + 1; target.y = c.y; stage(e, c, {}); c.energy = 4.9;
  const health = target.health;
  const attacked = run(e, c, { prim: 'attack', target: target.id });
  assert.equal(attacked.reason, 'exhausted'); assert.equal(target.health, health); assert.equal(c.energy, 4.9);
});

test('shelter choices and mb features use only observed or individually remembered shelters', () => {
  const e = mk(11, 1), c = e.creatures[0], obs = e.perceive(c);
  assert.equal(obs.version, OBSERVATION_VERSION);
  assert.equal(obs.shelters.length, 0);
  const feature = e.features(c, obs)[5], afford = e.affordances(c, obs);
  e.shelters.push({ id: 99, x: c.x + 20, y: c.y, cap: 4, integrity: 100 });
  assert.equal(e.features(c, obs)[5], feature);
  assert.ok(!afford(c.inventory, null).some((s) => s.purpose === 'shelter'));
  const local = { id: 100, x: c.x + 2, y: c.y, cap: 4, integrity: 100 };
  e.shelters.push(local);
  const seen = e.perceive(c);
  assert.ok(seen.shelters.some((s) => s.id === local.id));
  assert.ok(c.mind.shelters.some((s) => s.id === local.id));
  assert.ok(e.features(c, seen)[5] === 0);
});

test('shelter materials fit the inventory limit and normal gather actions can build one', () => {
  const e = mk(19, 1), c = e.creatures[0];
  assert.ok(e.cfg.invCapacity >= 12);
  stage(e, c, {});
  const tree = e.chunk(0, 0).nodes.find((n) => n.kind === 'tree' && n.units >= 4);
  let spot = freeSpot(e, tree.x, tree.y); c.x = spot.x; c.y = spot.y;
  for (let i = 0; i < 4; i++) assert.equal(run(e, c, { prim: 'gather', node: tree.id, kind: 'tree', x: tree.x, y: tree.y }).success, true);
  const stone = e.chunk(0, 0).nodes.find((n) => n.kind === 'stone' && n.units >= 2);
  assert.ok(stone, 'legacy settlement has gatherable stone');
  spot = freeSpot(e, stone.x, stone.y); c.x = spot.x; c.y = spot.y;
  for (let i = 0; i < 2; i++) assert.equal(run(e, c, { prim: 'gather', node: stone.id, kind: 'stone', x: stone.x, y: stone.y }).success, true);
  assert.deepEqual(c.inventory, { wood: 4, stone: 2 });
  assert.equal(e.invWeight(c), 12);
  assert.equal(run(e, c, { prim: 'build' }).success, true);
  assert.equal(e.shelters.length, 1);
});

test('share affordances depend on observed neighbor data, and exhaustion deaths are attributed', () => {
  const e = mk(23), [a, b] = e.creatures; a.x = 30; a.y = 30; b.x = 31; b.y = 30; a.inventory = { berry: 2 }; e.rebuildIndex();
  const obs = e.perceive(a), afford = e.affordances(a, obs), before = afford(a.inventory, null).filter((s) => s.prim === 'share');
  b.hunger = 59; const low = afford(a.inventory, null).filter((s) => s.prim === 'share');
  b.hunger = 61; const high = afford(a.inventory, null).filter((s) => s.prim === 'share');
  assert.deepEqual(low, before); assert.deepEqual(high, before); assert.ok(before.length);
  a.energy = 0; a.health = 0.02; a.hunger = 65; a.thirst = 10; a.warmth = 90; a.injury = 0; a.act = null;
  e.needs(a); assert.ok(a.health < 0); assert.equal(a.deathCause, 'exhaustion');
});

test('followers pay terrain movement time and energy like other walkers', () => {
  const e = mk(7), b = e.bounds(); let run = null;
  for (let y = b.y0; y < b.y1 && !run; y++) for (let x = b.x0; x < b.x1 && !run; x++) if ([0, 1, 2, 3, 4].every((i) => e.tile(x + i, y) === T.SHALLOW)) run = { x, y };
  assert.ok(run, 'seed has a five tile shallow run');
  const [f, leader] = e.creatures;
  Object.assign(f, { x: run.x, y: run.y, hunger: 10, thirst: 10, warmth: 90, energy: 80 });
  Object.assign(leader, { x: run.x + 4, y: run.y, act: { prim: 'rest' } });
  f.following = { id: leader.id, until: e.tick + 1000 }; e.rebuildIndex();
  e.followStep(f); e.followStep(f); assert.equal(f.x, run.x);
  e.followStep(f); assert.equal(f.x, run.x + 1); assert.equal(e.moveCost(f.x, f.y), 3);
  assert.ok(Math.abs(f.energy - 79.76) < 1e-9);
});

test('leadership and read-only world views leave persisted state unchanged', () => {
  const e = mk(29), c = e.creatures[0]; c.followers = { 5: 0 }; e.tick = 5000;
  const node = e.chunk(0, 0).nodes.find((n) => n.kind === 'bush');
  node.units = 0; node.t = 0; e.dirty(node.x, node.y);
  const before = JSON.stringify(e.toState());
  assert.deepEqual(e.leadership(), []); assert.deepEqual(c.followers, { 5: 0 });
  e.summary(); viewport(e, -20, -20, 48, 32); minimap(e);
  assert.equal(JSON.stringify(e.toState()), before);
});

test('affordances use only individually acquired knowledge (no omniscient coordinates)', () => {
  const e = mk(4), c = e.creatures[0]; c.mind = createMind();
  const obs = e.perceive(c), steps = e.affordances(c, obs)(c.inventory, null);
  for (const s of steps.filter((s) => s.prim === 'gather')) assert.ok(Math.max(Math.abs(s.x - c.x), Math.abs(s.y - c.y)) <= obs.radius);
  c.x += 0; const far = e.chunk(4, 4).nodes[0]; assert.ok(!steps.some((s) => s.node === far.id));
});

test('gathering requires reach; the hand_axe (learned combine) doubles wood yield per step and speeds it', () => {
  const e = mk(6), c = e.creatures[0];
  const tree = e.chunk(0, 0).nodes.find((n) => n.kind === 'tree' && n.units >= 4);
  const spot = freeSpot(e, tree.x, tree.y); c.x = spot.x; c.y = spot.y; stage(e, c, {});
  const bare = run(e, c, { prim: 'gather', node: tree.id, kind: 'tree', x: tree.x, y: tree.y });
  assert.equal(bare.produced.wood, 1);
  stage(e, c, { flint: 1, stick: 1 });
  const comb = run(e, c, { prim: 'combine', a: 'flint', b: 'stick' }); assert.equal(comb.produced.hand_axe, 1);
  const bad = (stage(e, c, { flint: 1, stone: 1 }), run(e, c, { prim: 'combine', a: 'flint', b: 'stone' })); assert.equal(bad.success, false);
  stage(e, c, { hand_axe: 1 }); c.x = spot.x; c.y = spot.y;
  const tool = run(e, c, { prim: 'gather', node: tree.id, kind: 'tree', x: tree.x, y: tree.y });
  assert.equal(tool.produced.wood, 2); assert.ok(tool.duration < bare.duration);
  assert.equal(RECIPES['flint+stick'], 'hand_axe');
});

test('fire: ignition needs fuel + flint struck with stone; warms, burns, spreads and is extinguished', () => {
  const e = mk(8), c = e.creatures[0];
  const s = freeSpot(e, 28, 28); c.x = s.x; c.y = s.y; stage(e, c, { wood: 2, flint: 1 });
  e.weather.rain = false;
  run(e, c, { prim: 'place', item: 'wood' }); run(e, c, { prim: 'place', item: 'wood' });
  assert.equal(e.pileAt(c.x, c.y).items.wood, 2);
  stage(e, c, { flint: 1 }); assert.ok(run(e, c, { prim: 'carry', item: 'wood' }).success); assert.equal(c.inventory.wood, 1); assert.equal(e.pileAt(c.x, c.y).items.wood, 1);
  run(e, c, { prim: 'place', item: 'wood' });
  assert.equal(run(e, c, { prim: 'use', item: 'flint', on: 'pile' }).reason, 'no-ignition'); // no striker stone
  let lit = false;
  for (let i = 0; i < 40 && !lit; i++) { stage(e, c, { flint: 1, stone: 1 }); lit = run(e, c, { prim: 'use', item: 'flint', on: 'pile' }).success; }
  assert.ok(lit); const f = e.fires.at(-1); assert.equal(f.fuel, 12);
  assert.ok(e.fireWarmth(c.x, c.y) >= 20);
  const h0 = c.health; e.needs(c); assert.ok(c.health <= h0 - 3, 'standing in fire burns'); assert.equal(c.deathCause ?? 'burns', 'burns');
  // spread to an adjacent tree, deterministic over enough ticks in dry weather
  const tree = e.chunk(0, 0).nodes.find((n) => n.kind === 'tree' && n.units > 0 && !e.fires.length || n.kind === 'tree' && n.units > 0);
  f.fuel = 1e6; const f2 = { id: 99, x: tree.x + 1, y: tree.y, fuel: 1000, lit: e.tick }; e.fires.push(f2);
  for (let i = 0; i < 3000 && tree.units > 0; i++) { e.tick++; e.weather.rain = false; e.stepFires(); }
  assert.equal(tree.units, 0); assert.ok(e.totals.burnedNodes.wood > 0);
  // smother with a non-fuel item
  stage(e, c, { stone: 2 }); c.x = f.x; c.y = f.y - 1;
  if (!e.passable(c.x, c.y)) { const q = freeSpot(e, f.x, f.y - 1); c.x = q.x; c.y = q.y; }
  f.fuel = 6; const sm = run(e, c, { prim: 'use', item: 'stone', on: 'fire', fire: f.id, x: f.x, y: f.y });
  assert.ok(sm.success); assert.ok(!e.fires.includes(f));
  // runs out of fuel
  const f3 = { id: 100, x: 0, y: 0, fuel: 0.03, lit: e.tick }; e.fires.push(f3); e.stepFires(); e.stepFires(); assert.ok(!e.fires.includes(f3));
});

test('social: attacks need range, cost energy, injure; death only through the health rule; refusal and reputation', () => {
  const e = mk(10), [a, b, o] = e.creatures;
  stage(e, a, {}); stage(e, b, {}); b.x = a.x + 5; b.y = a.y; o.x = a.x; o.y = a.y + 1;
  if (!e.passable(b.x, b.y)) { const q = freeSpot(e, b.x, b.y); b.x = q.x; b.y = q.y; }
  const e0 = a.energy; let hits = 0;
  for (let i = 0; i < 20; i++) { const r = run(e, a, { prim: 'attack', target: b.id }); if (r?.success) hits++; assert.ok(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1); b.act = null; if (b.health <= 0) break; }
  assert.ok(hits > 0 && a.energy < e0 && b.injury > 0);
  assert.ok((o.reputation[a.id] ?? 0) < 0, 'observer lowered its opinion of the attacker');
  if (b.health > 0) { b.health = 0.01; b.injury = 10; b.lastDamage = { cause: 'injury' }; e.needs(b); }
  e.lifecycle(); assert.ok(!e.creatures.includes(b)); assert.equal(e.graveyard.at(-1).cause, 'injury');
  // follow is voluntary and can be refused by the target
  stage(e, o, {}); o.relationships[a.id] = -0.9;
  const r = run(e, a, { prim: 'follow', target: o.id }); assert.equal(r.reason, 'refused');
  o.relationships[a.id] = 0.5; assert.ok(run(e, a, { prim: 'follow', target: o.id }).success);
  assert.equal(e.leadership()[0].id, o.id);
  // share transfers an item (no creation)
  stage(e, a, { berry: 1 }); const before = e.holdings().berry ?? 0; run(e, a, { prim: 'share', target: o.id, item: 'berry' }); assert.equal(o.inventory.berry, 1); assert.equal(e.holdings().berry, before);
});

test('salt water does not quench thirst; water barriers block walking (no teleport)', () => {
  const e = mk(12), c = e.creatures[0], b = e.bounds();
  let sea = null; for (let y = b.y0; y < b.y1 && !sea; y++) for (let x = b.x0; x < b.x1 && !sea; x++) if (e.tile(x, y) === T.SEA && e.passable(x - 1, y)) sea = { x, y };
  assert.ok(sea); c.x = sea.x - 1; c.y = sea.y; stage(e, c, {}); c.thirst = 50;
  const r = run(e, c, { prim: 'use', on: 'water', x: sea.x, y: sea.y }); assert.equal(r.reason, 'salt-water'); assert.ok(c.thirst > 50);
  assert.equal(e.passable(sea.x, sea.y), false);
});

test('legacy Phase 2A snapshot migrates without resetting brains, ids or history; newer schema refused', () => {
  const cfg = deepMerge(DEFAULTS, { world: { seed: 21, brainMode: 'mb-v1', initialSeedCount: 12 } });
  const w = World.create(cfg); for (let i = 0; i < 300; i++) w.step();
  const snap = { schemaVersion: 3, state: structuredClone(w.toState()) };
  const e = fromLegacySnapshot(snap);
  for (const c of w.creatures) { const m = e.getCreature(c.id); assert.ok(m); assert.deepEqual(m.brain.mb.positive, c.brain.mb.positive); assert.equal(m.name, c.name); assert.deepEqual(m.memories, c.memories); }
  assert.equal(e.tick, w.tick); e.run(200); assert.ok(e.tick === w.tick + 200);
  // expanse v1 -> v2
  const st = e.toState(); st.schema = 1; for (const c of st.creatures) { delete c.warmth; delete c.reputation; c.knownNodes = c.mind.known; c.mind.known = {}; delete c.mind.shelters; delete c.mind.memoryVersion; }
  const m = migrateExpanse(st); assert.equal(m.from, 1); assert.equal(m.to, 3);
  const e2 = Expanse.fromState(m.state); assert.equal(e2.creatures[0].warmth, 90); assert.ok(Object.keys(e2.creatures[0].mind.known).length > 0);
  assert.deepEqual(e2.creatures[0].mind.shelters, []); assert.equal(e2.creatures[0].mind.memoryVersion, MEMORY_VERSION);
  assert.equal(e2.cfg.invCapacity, 12);
  const old2 = e.toState(); old2.schema = 2; old2.cfg.invCapacity = 10;
  for (const c of old2.creatures) { c.energy = -55; delete c.mind.shelters; delete c.mind.memoryVersion; }
  const m2 = migrateExpanse(old2); assert.equal(m2.from, 2); assert.equal(m2.to, 3);
  const e3 = Expanse.fromState(m2.state); assert.equal(e3.cfg.invCapacity, 12); assert.equal(e3.creatures[0].energy, 0);
  assert.deepEqual(e3.creatures[0].mind.episodes, e.creatures[0].mind.episodes);
  assert.throws(() => migrateExpanse({ ...e.toState(), schema: 99 }), /newer/);
  assert.ok(LEGACY_MIGRATIONS);
});

test('backup, restore and rollback operate on copies and never discard data', () => {
  const dir = tmp(), bdir = tmp(), e = mk(13);
  e.run(100); save(dir, e); const man = backup(dir, bdir);
  e.run(100); save(dir, e); e.run(50); save(dir, e);
  assert.equal(load(dir).tick, 250);
  rollback(dir); assert.equal(load(dir).tick, 200);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('rolled-back-')));
  restore(bdir, dir); const r = load(dir); assert.equal(r.tick, man.tick);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('pre-restore-')));
  const body = fs.readFileSync(path.join(dir, SNAPSHOT)); body[body.length - 5] ^= 0xff; fs.writeFileSync(path.join(dir, SNAPSHOT), body);
  assert.throws(() => load(dir), /checksum/);
  assert.ok(readState(path.join(bdir, SNAPSHOT)).creatures.length > 0);
});

test('decisions connect mb-v1 and the planner and record prediction vs actual', () => {
  const e = mk(14); e.run(600);
  const plans = e.creatures.flatMap((c) => c.mind.plans);
  assert.ok(plans.length > 20);
  const p = plans.find((x) => x.source === 'planner+mb-v1');
  assert.ok(p && p.predicted.length === p.steps.length && p.actual.length >= 1 && typeof p.mbPreference === 'number');
  assert.ok(e.creatures.some((c) => c.brain.mb.updates > 0), 'mb-v1 plasticity active');
  const f = mk(14, 24, { mode: 'frozen' }); f.run(600);
  assert.ok(f.creatures.every((c) => c.brain.mb.updates === 0 && Object.keys(c.mind.model).length === 0));
  const n = mk(14, 24, { mode: 'no-planner' }); n.run(300);
  assert.ok(n.creatures.flatMap((c) => c.mind.plans).every((x) => x.steps.length === 1));
});

test('read-only service: runs without viewers, two clients see the same world, writes are rejected, restart resumes', async () => {
  const { startExpanse } = await import('../server/src/expanse/server.js');
  const dir = tmp(), port = 18788 + Math.floor(Math.random() * 1000);
  const svc = startExpanse({ dataDir: dir, seed: 31, tickMs: 5, saveEveryTicks: 20, port, initialCount: 12 });
  await new Promise((r) => setTimeout(r, 300));
  const get = (p) => fetch(`http://127.0.0.1:${port}${p}`).then((r) => r.json());
  const t1 = svc.world.tick; assert.ok(t1 > 10, 'ticks without any viewer');
  const [a, b] = await Promise.all([get('/api/expanse/info'), get('/api/expanse/info')]);
  assert.equal(a.seed, b.seed); assert.equal(a.bounds.x1, b.bounds.x1);
  const c = svc.world.creatures[0];
  const insp = await get(`/api/expanse/creature/${c.id}`); assert.equal(insp.id, c.id); assert.ok('observation' in insp && 'recentPlans' in insp);
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) { const r = await fetch(`http://127.0.0.1:${port}/api/expanse/info`, { method: m }); assert.equal(r.status, 405); }
  const before = svc.world.tick; await svc.stop();
  const svc2 = startExpanse({ dataDir: dir, seed: 999, tickMs: 1000, port: port + 1, initialCount: 3 });
  assert.equal(svc2.world.seed, 31); assert.equal(svc2.world.tick, before); assert.equal(svc2.world.creatures.length, svc.world.creatures.length);
  await svc2.stop();
});

test('GET /api/expanse/info leaves the saved world state unchanged', async () => {
  const { startExpanse } = await import('../server/src/expanse/server.js');
  const svc = startExpanse({ dataDir: tmp(), seed: 37, tickMs: 60_000, port: 0, host: '127.0.0.1', initialCount: 4 });
  await new Promise((resolve) => svc.server.once('listening', resolve));
  svc.world.tick = 5000; svc.world.creatures[0].followers = { 5: 0 };
  const before = JSON.stringify(svc.world.toState()), port = svc.server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/expanse/info`);
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).leadership, []);
  assert.deepEqual(svc.world.creatures[0].followers, { 5: 0 });
  assert.equal(JSON.stringify(svc.world.toState()), before);
  await svc.stop();
});
