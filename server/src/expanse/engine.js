// Phase 2B "expanse" engine: authoritative, viewer-independent simulation of the extended chunked world.
// Pure: no I/O, no wall clock; all randomness from the world's seeded Rng (persisted).
import { Rng, hashSeed } from '../rng.js';
import { createBrain, inheritBrain, innateUtility, clamp } from '../brain.js';
import { ensureMushroom, encode, readout, reinforce, pickMushroom, MB_PARAMS } from '../mushroom.js';
import { World } from '../world.js';
import { DEFAULTS, deepMerge } from '../config.js';
import { CHUNK, BASE, T, MOVE_COST, FRESH, SALT, NODE_KINDS, CLIMATE, generateChunk, settleNode, chunkKey, chunkOf } from './terrain.js';
import { createMind, recordEpisode, modelKey, updateModel, predict, plan, rememberNode, rememberWater, markVisited, LIMITS, OBSERVATION_VERSION, PLANNER_VERSION } from './agent.js';

export const EXPANSE_SCHEMA = 2;
export const MODES = ['full', 'frozen', 'no-planner'];
// Designer-defined material rules. Agents are NOT given this table: they only see generic affordances
// (combine any two held items, use any held item on a target) and learn results from transitions.
export const RECIPES = { 'flint+stick': 'hand_axe', 'stick+stone': 'stone_club', 'fiber+stick': 'bundle' };
export const FOOD = { berry: { hunger: 20 }, shellfish: { hunger: 26 }, cactus_fruit: { hunger: 10, thirst: 22 }, lichen: { hunger: 8 } };
export const FUEL = { wood: 6, stick: 2, fiber: 1, bundle: 4 };
export const WEIGHT = { wood: 2, stone: 2 };
const TOOL_GATHER = new Set(['tree', 'deadfall', 'driftwood', 'scrub']);
const SYL = ['ka', 'to', 'mi', 'ru', 'ne', 'so', 'la', 'bo', 'zi', 'pe', 'du', 'fa', 'ye', 'gu', 'ha', 'vi'];

export const EXPANSE_DEFAULTS = {
  radiusChunks: 4,          // chunks added on every side of the 2x2-chunk settlement: (2+2r)^2/4 = 25x area at r=4
  initialCount: 24, mode: 'full', learning: true,
  maxDecisionsPerTick: 64, perception: 7, nightPerception: 5, dayLength: 1200,
  hungerRate: 0.045, thirstRate: 0.06, adultAge: 1500, elderAge: 14000, lifespanBase: 20000,
  invCapacity: 10, eventRing: 400, socialRing: 300, graveyardMax: 5000, historyEvery: 100, historyMax: 1000,
  rewardReversal: null,     // { item:'berry', fromTick } makes that food harmful from fromTick (experiment hook)
  planner: { bonus: 0.6, lambda: 0.03, mu: 0.02, gamma: 0.9, scale: 1.0 },
  observeWeight: 0.3,
};

export class Expanse {
  constructor(cfg) { this.cfg = deepMerge(EXPANSE_DEFAULTS, cfg ?? {}); }

  // ---------------- creation ----------------
  static create(cfg = {}, opts = {}) {
    const e = new Expanse(cfg);
    const seed = opts.seed ?? cfg.seed ?? DEFAULTS.world.seed;
    // The preserved settlement is produced by the unchanged Phase 2A generator (same seed => same terrain & IDs).
    const legacyCfg = deepMerge(DEFAULTS, { world: { seed, brainMode: 'mb-v1', initialSeedCount: e.cfg.initialCount } });
    const legacy = opts.legacyWorld ?? World.create(legacyCfg);
    e.initFrom(seed, legacy.toState ? legacy.toState() : legacy);
    return e;
  }
  initFrom(seed, s) {
    this.seed = seed; this.schema = EXPANSE_SCHEMA; this.rng = new Rng(hashSeed(`stratoks:expanse:${seed}`));
    this.tick = s.tick ?? 0; this.seq = 0; this.mode = this.cfg.mode; this.learning = this.cfg.learning;
    this.base = { tiles: typeof s.tiles === 'string' ? Uint8Array.from(Buffer.from(s.tiles, 'base64')) : Uint8Array.from(s.tiles), trees: s.trees, stones: s.stones, bushes: s.bushes };
    this.chunks = new Map(); this.fires = []; this.shelters = []; this.events = []; this.social = []; this.discoveries = []; this.history = [];
    this.graveyard = (s.graveyard ?? []).slice(-this.cfg.graveyardMax);
    this.nextId = { creature: s.nextId?.creature ?? 1, fire: 1, shelter: 1, pile: 1, plan: 1 };
    this.totals = { births: 0, deaths: 0, deathsByCause: {}, gathered: {}, regrown: {}, eaten: {}, burnedNodes: {}, burnedItems: {}, built: {}, crafted: {}, craftUsed: {}, decisions: 0, deferred: 0, planned: 0, reflex: 0, ...(s.legacyTotals ? { legacy: s.legacyTotals } : {}) };
    this.weather = { rain: false, until: 0 };
    for (const sh of s.shelters ?? []) if (sh.complete || sh.stage === 3 || sh.done) this.shelters.push({ id: this.nextId.shelter++, x: sh.x, y: sh.y, cap: 4, integrity: sh.integrity ?? 100, legacyId: sh.id });
    this.creatures = (s.creatures ?? []).map((c) => this.adoptCreature(c));
    this.emit('expanse_created', { seed, chunks: this.extentChunks(), note: 'Phase 2B extension around the preserved 56x56 settlement' });
  }
  // Keeps all legacy fields (ids, coordinates, brain incl. mb-v1 weights, memories, relationships, personality).
  adoptCreature(c) {
    c.thirst ??= 20; c.warmth ??= 90; c.injury ??= 0; c.inventory ??= {}; c.reputation ??= {}; c.relationships ??= {};
    c.mind ??= createMind(); c.plan ??= null; c.act = null; c.path = []; c.following ??= null; c.followers ??= {};
    c.home ??= { x: Math.round(c.x), y: Math.round(c.y) }; c.x = Math.round(c.x); c.y = Math.round(c.y);
    c.lifespan ??= this.cfg.lifespanBase; c.cooldown ??= 0; c.stats ??= {}; c.stats.moved ??= 0; c.carrying = null;
    if (c.inside !== undefined) delete c.inside;
    ensureMushroom(c.brain, this.seed, c.id);
    return c;
  }
  extentChunks() { const r = this.cfg.radiusChunks; return { cx0: -r, cx1: 1 + r, cy0: -r, cy1: 1 + r }; }
  bounds() { const e = this.extentChunks(); return { x0: e.cx0 * CHUNK, y0: e.cy0 * CHUNK, x1: (e.cx1 + 1) * CHUNK, y1: (e.cy1 + 1) * CHUNK }; }

  // ---------------- chunks / terrain access ----------------
  chunk(cx, cy) {
    const e = this.ext ??= this.extentChunks();
    if (cx < e.cx0 || cx > e.cx1 || cy < e.cy0 || cy > e.cy1) return null;
    const fk = (cy + 512) * 1024 + cx + 512;
    this.fast ??= new Map();
    let ch = this.fast.get(fk);
    if (ch) return ch;
    const k = chunkKey(cx, cy);
    ch = this.chunks.get(k);
    if (!ch) { ch = generateChunk(this.seed, cx, cy, this.base); this.indexChunk(ch); this.chunks.set(k, ch); }
    this.fast.set(fk, ch);
    return ch;
  }
  indexChunk(ch) { ch.at = new Map(); for (const n of ch.nodes) ch.at.set(n.y * 100000 + n.x, n); ch.pileAt = new Map(); for (const p of ch.piles) ch.pileAt.set(p.y * 100000 + p.x, p); }
  chunkAt(x, y) { return this.chunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK)); }
  tile(x, y) { const ch = this.chunkAt(x, y); if (!ch) return T.CLIFF; return ch.tiles[(y - ch.cy * CHUNK) * CHUNK + (x - ch.cx * CHUNK)]; }
  biome(x, y) { const ch = this.chunkAt(x, y); return ch ? ch.biome[(y - ch.cy * CHUNK) * CHUNK + (x - ch.cx * CHUNK)] : 'cold'; }
  nodeAt(x, y) { const ch = this.chunkAt(x, y); const n = ch?.at.get(y * 100000 + x); return n ? this.settle(n) : null; }
  pileAt(x, y) { return this.chunkAt(x, y)?.pileAt.get(y * 100000 + x) ?? null; }
  settle(n) { const before = n.units; settleNode(n, this.tick); if (n.units > before) { const it = NODE_KINDS[n.kind].item; this.totals.regrown[it] = (this.totals.regrown[it] ?? 0) + n.units - before; } return n; }
  moveCost(x, y) {
    const c = MOVE_COST[this.tile(x, y)]; if (c === Infinity) return Infinity;
    const n = this.chunkAt(x, y).at.get(y * 100000 + x);
    if (n && NODE_KINDS[n.kind].blocks && n.units > 0) return Infinity;
    return c;
  }
  passable(x, y) { return this.moveCost(x, y) !== Infinity; }
  nodesNear(x, y, r) {
    const out = [];
    for (let cy = Math.floor((y - r) / CHUNK); cy <= Math.floor((y + r) / CHUNK); cy++) for (let cx = Math.floor((x - r) / CHUNK); cx <= Math.floor((x + r) / CHUNK); cx++) {
      const ch = this.chunk(cx, cy); if (!ch) continue;
      for (const n of ch.nodes) if (Math.abs(n.x - x) <= r && Math.abs(n.y - y) <= r) out.push(this.settle(n));
    }
    return out;
  }
  dirty(x, y) { const ch = this.chunkAt(x, y); if (ch) ch.dirty = true; }

  // ---------------- climate ----------------
  daylight() { return Math.sin(2 * Math.PI * (this.tick % this.cfg.dayLength) / this.cfg.dayLength); }
  ambient(x, y) {
    const b = CLIMATE[this.biome(x, y)], tl = this.tile(x, y);
    let t = b.t + b.swing * this.daylight();
    if (tl === T.SNOW) t -= 3; if (tl === T.SHALLOW || tl === T.STREAM) t -= 6; if (this.weather.rain) t -= 3;
    return t;
  }
  fireWarmth(x, y) { let w = 0; for (const f of this.fires) { const d = Math.max(Math.abs(f.x - x), Math.abs(f.y - y)); if (d <= 1) w = Math.max(w, 20); else if (d <= 3) w = Math.max(w, 10); } return w; }
  shelterAt(x, y) { return this.shelters.find((s) => s.x === x && s.y === y) ?? null; }
  effectiveTemp(c) { let t = this.ambient(c.x, c.y) + this.fireWarmth(c.x, c.y); if (this.shelterAt(c.x, c.y)) t = Math.max(t, 17); return t; }

  // ---------------- events ----------------
  emit(type, data = {}) { const ev = { seq: ++this.seq, tick: this.tick, type, ...data }; this.events.push(ev); if (this.events.length > this.cfg.eventRing) this.events.shift(); return ev; }
  socialEvent(type, actor, target, result) {
    const ev = { tick: this.tick, type, actor: actor.id, target: target?.id ?? null, result };
    this.social.push(ev); if (this.social.length > this.cfg.socialRing) this.social.shift();
    // Reputation: every creature that can perceive the act updates its own opinion of the actor.
    const delta = { share: 0.08, help: 0.05, attack: -0.15, threaten: -0.06, refuse: -0.02, follow: 0.02 }[type] ?? 0;
    if (delta) for (const o of this.creaturesNear(actor.x, actor.y, this.cfg.perception)) if (o !== actor) o.reputation[actor.id] = clamp((o.reputation[actor.id] ?? 0) + delta, -1, 1);
    return ev;
  }

  // ---------------- creatures ----------------
  newName() { const r = this.rng; const n = SYL[r.int(16)] + SYL[r.int(16)] + (r.next() < 0.5 ? SYL[r.int(16)] : ''); return n[0].toUpperCase() + n.slice(1); }
  newCreature({ x, y, sex, age, parents = [], parentsObj = [] }) {
    const r = this.rng, personality = { boldness: r.next(), sociability: r.next(), diligence: r.next(), curiosity: r.next(), caution: r.next() };
    const brain = parentsObj.length ? inheritBrain(r, parentsObj[0]?.brain, parentsObj[1]?.brain, 0.5, 0.05, personality) : createBrain(r, personality);
    const c = { id: this.nextId.creature++, name: this.newName(), sex, age, bornTick: this.tick - age, x, y, face: 1, hunger: 20, thirst: 20, energy: 80, health: 100, warmth: 90,
      personality, brain, lifespan: Math.round(this.cfg.lifespanBase * r.range(0.8, 1.2)), parents, generation: parentsObj.length ? 1 + Math.max(...parentsObj.map((p) => p.generation ?? 0)) : 0,
      relationships: {}, memories: [], stats: { eaten: 0, gathered: 0, built: 0, social: 0, hurt: 0, offspring: 0, decisions: 0, moved: 0 }, partner: null, cooldown: 0, pregnant: null };
    return this.adoptCreature(c);
  }
  getCreature(id) { return this.creatures.find((c) => c.id === id); }
  rebuildIndex() { this.grid = new Map(); for (const c of this.creatures) { const k = `${c.x >> 4},${c.y >> 4}`; let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(c); } }
  creaturesNear(x, y, r) {
    if (!this.grid) this.rebuildIndex();
    const out = [];
    for (let gy = (y - r) >> 4; gy <= (y + r) >> 4; gy++) for (let gx = (x - r) >> 4; gx <= (x + r) >> 4; gx++) for (const c of this.grid.get(`${gx},${gy}`) ?? []) if (Math.abs(c.x - x) <= r && Math.abs(c.y - y) <= r && c.health > 0) out.push(c);
    return out;
  }
  invWeight(c) { let w = 0; for (const [k, n] of Object.entries(c.inventory)) w += (WEIGHT[k] ?? 1) * n; return w; }
  addItem(c, item, n = 1) { c.inventory[item] = (c.inventory[item] ?? 0) + n; }
  takeItem(c, item, n = 1) { if ((c.inventory[item] ?? 0) < n) return false; c.inventory[item] -= n; if (!c.inventory[item]) delete c.inventory[item]; return true; }
  isAdult(c) { return c.age >= this.cfg.adultAge; }

  // ---------------- perception & observation (interface v1) ----------------
  perceive(c) {
    const r = this.daylight() < -0.3 ? this.cfg.nightPerception : this.cfg.perception, m = c.mind;
    const nodes = this.nodesNear(c.x, c.y, r).filter((n) => !n.dead);
    for (const n of nodes) rememberNode(m, n, this.tick);
    for (const id of Object.keys(m.known)) { const k = m.known[id]; if (Math.abs(k.x - c.x) <= r && Math.abs(k.y - c.y) <= r && !nodes.some((n) => n.id === id)) delete m.known[id]; }
    let fresh = null, salt = null;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const t = this.tile(c.x + dx, c.y + dy);
      if (FRESH.has(t) && (!fresh || Math.abs(dx) + Math.abs(dy) < fresh.d)) fresh = { x: c.x + dx, y: c.y + dy, d: Math.abs(dx) + Math.abs(dy) };
      if (SALT.has(t) && (!salt || Math.abs(dx) + Math.abs(dy) < salt.d)) salt = { x: c.x + dx, y: c.y + dy, d: Math.abs(dx) + Math.abs(dy) };
    }
    if (fresh) rememberWater(m, fresh.x, fresh.y, this.tick);
    const novel = markVisited(m, c.x, c.y);
    const others = this.creaturesNear(c.x, c.y, r).filter((o) => o !== c).slice(0, 8);
    const fires = this.fires.filter((f) => Math.abs(f.x - c.x) <= r && Math.abs(f.y - c.y) <= r);
    const piles = []; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const p = this.pileAt(c.x + dx, c.y + dy); if (p) piles.push(p); }
    const obs = {
      version: OBSERVATION_VERSION, tick: this.tick, radius: r, novelCell: novel,
      self: { x: c.x, y: c.y, hunger: c.hunger, thirst: c.thirst, energy: c.energy, health: c.health, warmth: c.warmth, injury: c.injury, inventory: { ...c.inventory }, temp: Math.round(this.effectiveTemp(c) * 10) / 10 },
      ambient: { biome: this.biome(c.x, c.y), tile: this.tile(c.x, c.y), daylight: Math.round(this.daylight() * 100) / 100, rain: this.weather.rain },
      nodes: nodes.map((n) => ({ id: n.id, kind: n.kind, x: n.x, y: n.y, units: n.units })).slice(0, 24),
      water: fresh ? { x: fresh.x, y: fresh.y } : null, saltWater: salt ? { x: salt.x, y: salt.y } : null,
      fires: fires.map((f) => ({ id: f.id, x: f.x, y: f.y })), piles: piles.map((p) => ({ id: p.id, x: p.x, y: p.y, items: { ...p.items } })),
      creatures: others.map((o) => ({ id: o.id, x: o.x, y: o.y, act: o.act?.prim ?? null, health: Math.round(o.health), holding: Object.keys(o.inventory).slice(0, 3) })),
    };
    c.lastObs = obs;
    return obs;
  }
  features(c, obs) {
    const foodKinds = new Set(['bush', 'cactus', 'shellfish', 'lichen']);
    const foodNear = obs.nodes.some((n) => foodKinds.has(n.kind) && n.units > 0), foodKnown = Object.values(c.mind.known).some((k) => foodKinds.has(k.kind));
    const fireOn = this.fires.some((f) => f.x === c.x && f.y === c.y);
    return [c.hunger / 100, 1 - c.energy / 100, 1 - c.health / 100, foodNear ? 1 : 0, foodKnown ? 1 : 0, this.shelters.length ? 0 : 1, this.invWeight(c) / this.cfg.invCapacity, 0,
      obs.creatures.length ? 1 : 0, fireOn || c.injury > 0 ? 1 : 0, this.weather.rain ? 1 : 0, obs.creatures.length ? 0 : 1];
  }
  cues(c, obs) { return [c.thirst / 100, 1 - c.warmth / 100, obs.fires.length ? 1 : 0, c.inventory.hand_axe ? 1 : 0]; }

  // ---------------- affordances (interface v1) ----------------
  // Generic: every visible/known node can be gathered/inspected, any two held item kinds can be combined, any held
  // item can be used on self, a nearby fire or a pile, or placed. No recipe or ignition rule is consulted here.
  affordances(c, obs) {
    const ctxTool = c.inventory.hand_axe ? 'tool' : 'bare';
    const nearest = new Map();
    for (const [id, k] of Object.entries(c.mind.known)) {
      if (k.units <= 0) continue;
      const d = Math.max(Math.abs(k.x - c.x), Math.abs(k.y - c.y));
      const cur = nearest.get(k.kind); if (!cur || d < cur.d) nearest.set(k.kind, { id, ...k, d });
    }
    const pileHere = this.pileAt(c.x, c.y), fireNear = obs.fires.slice().sort((a, b) => Math.max(Math.abs(a.x - c.x), Math.abs(a.y - c.y)) - Math.max(Math.abs(b.x - c.x), Math.abs(b.y - c.y)))[0];
    const water = c.mind.water.slice().sort((a, b) => Math.abs(a.x - c.x) + Math.abs(a.y - c.y) - Math.abs(b.x - c.x) - Math.abs(b.y - c.y))[0];
    return (inv, prev) => {
      const out = [];
      const full = Object.entries(inv).reduce((s, [k, n]) => s + (WEIGHT[k] ?? 1) * n, 0) >= this.cfg.invCapacity;
      const held = Object.keys(inv).filter((k) => inv[k] > 0).sort();
      const tool = inv.hand_axe ? 'tool' : ctxTool === 'tool' && inv.hand_axe !== 0 ? 'tool' : 'bare';
      for (const it of held) if (FOOD[it] !== undefined || it === 'berry') out.push({ prim: 'use', item: it, on: 'self', key: modelKey('use', `${it}@self`), consumes: [it], label: 'EAT' });
      if (!full) for (const n of nearest.values()) out.push({ prim: 'gather', node: n.id, kind: n.kind, x: n.x, y: n.y, key: modelKey('gather', n.kind, TOOL_GATHER.has(n.kind) ? tool : ''), label: ['stone', 'flint'].includes(n.kind) ? 'GATHER_STONE' : ['bush', 'cactus', 'shellfish', 'lichen'].includes(n.kind) ? 'EAT' : 'GATHER_WOOD' });
      if (water) out.push({ prim: 'use', item: null, on: 'water', x: water.x, y: water.y, key: modelKey('drink', 'known-fresh'), label: 'EAT' });
      if (obs.saltWater && !prev) out.push({ prim: 'use', item: null, on: 'water', x: obs.saltWater.x, y: obs.saltWater.y, key: modelKey('drink', 'sea'), label: 'EAT', firstOnly: true });
      for (let i = 0; i < held.length; i++) for (let j = i + 1; j < held.length; j++) out.push({ prim: 'combine', a: held[i], b: held[j], key: modelKey('combine', `${held[i]}+${held[j]}`), consumes: [], label: 'GATHER_WOOD' });
      for (const it of held) {
        if (FUEL[it]) out.push({ prim: 'place', item: it, key: modelKey('place', it, pileHere ? 'pile' : 'ground'), consumes: [it], label: 'GATHER_WOOD' });
        if (prev?.prim === 'place' || pileHere) out.push({ prim: 'use', item: it, on: 'pile', key: modelKey('use', `${it}@pile`), consumes: [it], label: 'GATHER_WOOD' });
        if (fireNear) out.push({ prim: 'use', item: it, on: 'fire', fire: fireNear.id, x: fireNear.x, y: fireNear.y, key: modelKey('use', `${it}@fire`), consumes: [it], label: 'GATHER_WOOD' });
      }
      if (pileHere && !full && !prev) for (const it of Object.keys(pileHere.items).slice(0, 3)) out.push({ prim: 'carry', item: it, key: modelKey('carry', it), label: 'GATHER_WOOD' });
      if ((inv.wood ?? 0) >= 4 && (inv.stone ?? 0) >= 2) out.push({ prim: 'build', key: modelKey('build', 'shelter'), consumes: ['wood', 'wood', 'wood', 'wood', 'stone', 'stone'], label: 'BUILD' });
      if (!prev) {
        out.push({ prim: 'rest', key: modelKey('rest', fireNear ? 'fire' : this.shelterAt(c.x, c.y) ? 'shelter' : 'open', this.biome(c.x, c.y)), label: 'REST', x: fireNear?.x, y: fireNear?.y });
        const sh = this.nearestShelter(c);
        if (sh && (sh.x !== c.x || sh.y !== c.y)) out.push({ prim: 'move', x: sh.x, y: sh.y, purpose: 'shelter', key: modelKey('move', 'to-shelter', this.weather.rain ? 'rain' : ''), label: 'REST' });
        out.push({ prim: 'move', purpose: 'explore', key: modelKey('move', 'explore', this.biome(c.x, c.y)), label: 'WANDER' });
        if (Math.max(Math.abs(c.home.x - c.x), Math.abs(c.home.y - c.y)) > 12) out.push({ prim: 'move', x: c.home.x, y: c.home.y, purpose: 'home', key: modelKey('move', 'home'), label: 'WANDER' });
        for (const n of obs.nodes.slice(0, 3)) if (!c.mind.model[modelKey('inspect', n.kind)]) out.push({ prim: 'inspect', node: n.id, kind: n.kind, x: n.x, y: n.y, key: modelKey('inspect', n.kind), label: 'WANDER' });
        for (const o of obs.creatures.slice(0, 3)) this.socialAffordances(c, o, inv, out);
      }
      return out;
    };
  }
  socialAffordances(c, o, inv, out) {
    const other = this.getCreature(o.id); if (!other) return;
    const rel = c.relationships[o.id] ?? 0, rep = c.reputation[o.id] ?? 0;
    const food = Object.keys(inv).find((k) => FOOD[k] && inv[k] > 0);
    if (food && other.hunger > 60) out.push({ prim: 'share', target: o.id, item: food, key: modelKey('share', food, rel > 0.3 ? 'friend' : 'other'), consumes: [food], label: 'SOCIALIZE' });
    if (!c.following && rep > 0.05 && this.isAdult(other)) out.push({ prim: 'follow', target: o.id, key: modelKey('follow', rep > 0.3 ? 'reputable' : 'known'), label: 'SOCIALIZE' });
    out.push({ prim: 'socialize', target: o.id, key: modelKey('socialize', rel > 0.3 ? 'friend' : 'other'), label: 'SOCIALIZE' });
    const competing = c.hunger > 55 && other.act?.prim === 'gather';
    if ((competing || (c.lastAttacker === o.id)) && this.isAdult(c)) {
      out.push({ prim: 'threaten', target: o.id, key: modelKey('threaten', competing ? 'food' : 'retaliate'), label: 'APPROACH' });
      out.push({ prim: 'attack', target: o.id, key: modelKey('attack', competing ? 'food' : 'retaliate', inv.stone_club || inv.hand_axe ? 'armed' : 'bare'), label: 'APPROACH' });
    }
    if (c.lastAttacker === o.id || c.threatenedBy === o.id) out.push({ prim: 'flee', from: o.id, key: modelKey('flee', 'threat'), label: 'FLEE' });
  }
  nearestShelter(c) { let best = null, bd = 30; for (const s of this.shelters) { const d = Math.max(Math.abs(s.x - c.x), Math.abs(s.y - c.y)); if (d < bd) { bd = d; best = s; } } return best; }

  // ---------------- decision ----------------
  wellbeing(c) { return -(c.hunger + c.thirst) / 25 + Math.min(c.warmth, 80) / 25 + c.health / 20 + c.energy / 100; }
  decide(c) {
    const obs = this.perceive(c), f = this.features(c, obs), cues = this.cues(c, obs);
    const mb = ensureMushroom(c.brain, this.seed, c.id), b = this.bounds();
    const trace = encode(mb, { features: f, cues, x: c.x - b.x0, y: c.y - b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });
    const afford = this.affordances(c, obs);
    let reflex = null;
    // Reflexes (designed, labelled source 'reflex'): escape fire; drink/eat when critical and a known source exists.
    if (this.fires.some((f2) => Math.max(Math.abs(f2.x - c.x), Math.abs(f2.y - c.y)) === 0)) reflex = [{ prim: 'move', purpose: 'escape', key: modelKey('move', 'escape'), label: 'FLEE' }];
    else if (c.thirst > 88 && c.mind.water.length) reflex = afford(c.inventory, null).filter((s) => s.key === modelKey('drink', 'known-fresh')).slice(0, 1);
    else if (c.hunger > 88) { const eat = afford(c.inventory, null).filter((s) => s.label === 'EAT' && s.prim !== 'use' || (s.prim === 'use' && s.on === 'self')); if (eat.length) reflex = [eat.find((s) => s.on === 'self') ?? eat[0]]; }
    if (reflex && !reflex.length) reflex = null;
    let chosen, cands;
    const P = this.cfg.planner, planning = this.mode !== 'no-planner';
    if (reflex) { chosen = { steps: reflex, preds: reflex.map((s) => predict(c.mind, s.key)), value: 0, source: 'reflex' }; this.totals.reflex++; }
    else {
      const seqs = plan(c.mind, { inventory: c.inventory }, afford, { ...P, bonus: P.bonus * (0.5 + c.personality.curiosity), enabled: planning, horizon: planning ? LIMITS.horizon : 1 });
      if (!seqs.length) seqs.push({ steps: [{ prim: 'rest', key: modelKey('rest', 'open'), label: 'REST' }], preds: [predict(c.mind, 'rest|open|')], value: 0 });
      const mbOn = this.mode !== 'none';
      cands = seqs.map((s) => {
        const a = s.steps[0].label, innate = innateUtility(a, f, c.personality) + this.needBias(c, s.steps[0]);
        const pref = mbOn ? readout(mb, a, trace, false) : 0;
        return { a, u: innate + MB_PARAMS.gain * pref + (planning ? P.scale * s.value : 0), seq: s, innate, pref };
      });
      const pick = pickMushroom(mb, cands, 0.35);
      chosen = { ...pick.seq, source: planning ? 'planner+mb-v1' : 'mb-v1', u: pick.u, innate: pick.innate, pref: pick.pref };
      this.totals.planned++;
    }
    this.totals.decisions++; c.stats.decisions++;
    const pl = { id: this.nextId.plan++, tick: this.tick, source: chosen.source, steps: chosen.steps.map(describe), predicted: chosen.preds.map((p) => ({ reward: r3(p.reward), sigma: r3(p.sigma), success: r3(p.success), duration: r3(p.duration), n: r3(p.n) })),
      value: r3(chosen.value ?? 0), utility: r3(chosen.u ?? 0), mbPreference: r3(chosen.pref ?? 0), alternatives: cands ? cands.length : 0, actual: [], plannerVersion: PLANNER_VERSION, trace, raw: chosen.steps, idx: 0 };
    c.plan = pl;
    this.startStep(c);
  }
  // Designed homeostatic bias so drives are coupled to needs regardless of learning (documented heuristic).
  needBias(c, s) {
    if (s.key.startsWith('drink|')) return c.thirst / 30 - 1;
    if (s.prim === 'use' && s.on === 'self') return c.hunger / 30 - 1;
    if (s.prim === 'gather' && FOOD[NODE_KINDS[s.kind]?.item]) return c.hunger / 40 - 0.8;
    if (s.prim === 'rest') return (1 - c.energy / 100) * 2 + (s.key.includes('fire') || s.key.includes('shelter') ? (1 - c.warmth / 100) * 2 : 0) - 0.6;
    if (s.label === 'GATHER_WOOD' || s.label === 'GATHER_STONE' || s.prim === 'build') return (1 - c.warmth / 100) * 1.5 - 0.3;
    return 0;
  }
  startStep(c) {
    const p = c.plan, s = p?.raw[p.idx];
    if (!s) { this.finishPlan(c); return; }
    c.act = { ...s, started: this.tick, before: { wb: this.wellbeing(c), energy: c.energy, inv: { ...c.inventory } }, work: 0, path: null };
    if (s.prim === 'move' && s.purpose === 'explore') { const t = this.exploreTarget(c); c.act.x = t.x; c.act.y = t.y; }
    if (s.prim === 'move' && s.purpose === 'escape') { const t = this.freeNeighbor(c, (x, y) => !this.fires.some((f) => f.x === x && f.y === y)); c.act.x = t?.x ?? c.x; c.act.y = t?.y ?? c.y; }
    if (s.prim === 'flee') { const o = this.getCreature(s.from); const dx = Math.sign(c.x - (o?.x ?? c.x)) || 1, dy = Math.sign(c.y - (o?.y ?? c.y)) || 1; c.act.x = c.x + dx * 6; c.act.y = c.y + dy * 6; c.act.prim = 'move'; c.act.purpose = 'flee'; c.act.wasFlee = true; }
  }
  exploreTarget(c) {
    // prefer a direction whose 8x8 cell has not been visited by this creature (own knowledge only)
    const b = this.bounds(); let best = null, bs = -Infinity;
    for (let k = 0; k < 8; k++) {
      const a = this.rng.next() * Math.PI * 2, d = 8 + this.rng.int(10), x = clamp(Math.round(c.x + Math.cos(a) * d), b.x0 + 1, b.x1 - 2), y = clamp(Math.round(c.y + Math.sin(a) * d), b.y0 + 1, b.y1 - 2);
      const s = (c.mind.visited.includes(`${x >> 3},${y >> 3}`) ? 0 : 1) + this.rng.next() * 0.5;
      if (s > bs) { bs = s; best = { x, y }; }
    }
    return best;
  }
  freeNeighbor(c, ok) { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && this.passable(c.x + dx, c.y + dy) && ok(c.x + dx, c.y + dy)) return { x: c.x + dx, y: c.y + dy }; return null; }

  // ---------------- path finding (bounded A*, terrain costs) ----------------
  findPath(fx, fy, gx, gy, adj, limit = 2500) {
    const done = (x, y) => adj ? Math.max(Math.abs(x - gx), Math.abs(y - gy)) <= 1 : x === gx && y === gy;
    if (done(fx, fy)) return [];
    const key = (x, y) => (y + 4096) * 8192 + x + 4096;
    const g = new Map([[key(fx, fy), 0]]), prev = new Map(), heap = [[Math.max(Math.abs(gx - fx), Math.abs(gy - fy)), fx, fy]];
    let n = 0;
    while (heap.length && n++ < limit) {
      const [, x, y] = hpop(heap), kc = key(x, y), gc = g.get(kc);
      if (done(x, y)) { const path = []; let k = kc; while (k !== key(fx, fy)) { path.push([k % 8192 - 4096, Math.floor(k / 8192) - 4096]); k = prev.get(k); } return path.reverse(); }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy, mc = this.moveCost(nx, ny);
        if (mc === Infinity) continue;
        if (dx && dy && (!this.passable(x + dx, y) || !this.passable(x, y + dy))) continue;
        const ng = gc + mc * (dx && dy ? 1.4 : 1), kn = key(nx, ny);
        if (ng < (g.get(kn) ?? Infinity)) { g.set(kn, ng); prev.set(kn, kc); hpush(heap, [ng + Math.max(Math.abs(gx - nx), Math.abs(gy - ny)), nx, ny]); }
      }
    }
    return null;
  }

  // ---------------- step execution ----------------
  stepAct(c) {
    const a = c.act;
    const target = this.actTarget(c, a);
    if (target === false) return this.endStep(c, false, 'target-gone');
    if (target) {
      const reach = Math.max(Math.abs(target.x - c.x), Math.abs(target.y - c.y));
      const need = a.prim === 'move' ? 0 : a.prim === 'threaten' ? 3 : 1;
      if (reach > need) {
        if (a.prim === 'move' && a.wasFlee && reach <= 0) return this.endStep(c, true);
        if (!a.path || a.retarget) { a.path = this.findPath(c.x, c.y, target.x, target.y, a.prim !== 'move'); a.retarget = false; if (!a.path) return this.endStep(c, false, 'no-path'); }
        if (this.tick - a.started > 400) return this.endStep(c, false, 'too-far');
        return this.walk(c, a);
      }
      if (a.prim === 'move') return this.endStep(c, true);
    }
    a.work++;
    return this.perform(c, a, target);
  }
  walk(c, a) {
    if (!a.path.length) { a.retarget = true; return; }
    const [nx, ny] = a.path[0], mc = this.moveCost(nx, ny);
    if (mc === Infinity) { a.retarget = true; a.blocked = (a.blocked ?? 0) + 1; if (a.blocked > 3) this.endStep(c, false, 'blocked'); return; }
    c.moveProgress = (c.moveProgress ?? 0) + 1;
    if (c.moveProgress < mc) return;
    c.moveProgress = 0; a.path.shift();
    c.face = nx > c.x ? 1 : nx < c.x ? -1 : c.face; c.x = nx; c.y = ny; c.stats.moved++;
    c.energy -= 0.08 * mc + 0.01 * this.invWeight(c);
    if (c.stats.moved % 6 === 0) { const novel = markVisited(c.mind, c.x, c.y); if (novel) a.novel = (a.novel ?? 0) + 1; }
  }
  actTarget(c, a) {
    switch (a.prim) {
      case 'move': return { x: a.x, y: a.y };
      case 'gather': case 'inspect': { const n = this.nodeAt(a.x, a.y); return n && n.id === a.node && !n.dead ? n : false; }
      case 'use': if (a.on === 'water') return { x: a.x, y: a.y }; if (a.on === 'fire') { const f = this.fires.find((q) => q.id === a.fire); return f ?? false; } return null;
      case 'share': case 'follow': case 'socialize': case 'threaten': case 'attack': { const o = this.getCreature(a.target); if (!o) return false; if (a.path && (Math.abs(o.x - a.lx) + Math.abs(o.y - a.ly) > 2)) a.retarget = true; a.lx = o.x; a.ly = o.y; return o; }
      default: return null;
    }
  }
  perform(c, a, target) {
    switch (a.prim) {
      case 'rest': {
        const shelter = !!this.shelterAt(c.x, c.y), fire = this.fireWarmth(c.x, c.y) > 0;
        c.energy = Math.min(100, c.energy + (shelter || fire ? 1.0 : 0.5)); if (c.injury) c.injury = Math.max(0, c.injury - 2);
        if (a.work >= 20 || c.energy >= 100) return this.endStep(c, true);
        return;
      }
      case 'inspect': { rememberNode(c.mind, target, this.tick); return this.endStep(c, true, null, { info: target.kind }); }
      case 'gather': {
        const tool = !!c.inventory.hand_axe && TOOL_GATHER.has(target.kind);
        const dur = tool ? 3 : 6;
        if (a.work < dur) return;
        const item = NODE_KINDS[target.kind].item, units = Math.min(tool ? 2 : 1, target.units);
        const fits = Math.floor((this.cfg.invCapacity - this.invWeight(c)) / (WEIGHT[item] ?? 1)), q = Math.min(units, fits);
        c.energy -= 1.2 * Math.max(1, q);
        if (q <= 0) return this.endStep(c, false, 'inventory-full');
        target.units -= q; target.t = target.units + q >= NODE_KINDS[target.kind].max ? this.tick : target.t; this.dirty(target.x, target.y);
        this.addItem(c, item, q); this.totals.gathered[item] = (this.totals.gathered[item] ?? 0) + q; c.stats.gathered += q;
        rememberNode(c.mind, target, this.tick);
        if (NODE_KINDS[target.kind].blocks && target.units === 0) this.emit('node_depleted', { node: target.id });
        return this.endStep(c, true, null, { produced: { [item]: q } });
      }
      case 'combine': {
        if (a.work < 4) return;
        c.energy -= 1;
        if (!c.inventory[a.a] || !c.inventory[a.b]) return this.endStep(c, false, 'missing-item');
        const out = RECIPES[`${a.a}+${a.b}`];
        if (!out) return this.endStep(c, false, 'no-result');
        this.takeItem(c, a.a); this.takeItem(c, a.b); this.addItem(c, out);
        for (const it of [a.a, a.b]) this.totals.craftUsed[it] = (this.totals.craftUsed[it] ?? 0) + 1;
        this.totals.crafted[out] = (this.totals.crafted[out] ?? 0) + 1;
        this.discover(c, `combine:${a.a}+${a.b}->${out}`);
        return this.endStep(c, true, null, { produced: { [out]: 1 } });
      }
      case 'place': {
        if (a.work < 2) return;
        if (!this.takeItem(c, a.item)) return this.endStep(c, false, 'missing-item');
        let p = this.pileAt(c.x, c.y);
        if (!p) { const ch = this.chunkAt(c.x, c.y); p = { id: `p${this.nextId.pile++}`, x: c.x, y: c.y, items: {} }; ch.piles.push(p); ch.pileAt.set(c.y * 100000 + c.x, p); }
        p.items[a.item] = (p.items[a.item] ?? 0) + 1; this.dirty(c.x, c.y);
        return this.endStep(c, true);
      }
      case 'carry': {
        const p = this.pileAt(c.x, c.y);
        if (!p || !p.items[a.item]) return this.endStep(c, false, 'nothing-there');
        if (this.invWeight(c) + (WEIGHT[a.item] ?? 1) > this.cfg.invCapacity) return this.endStep(c, false, 'inventory-full');
        p.items[a.item]--; if (!p.items[a.item]) delete p.items[a.item]; this.removePileIfEmpty(p); this.addItem(c, a.item); this.dirty(c.x, c.y);
        return this.endStep(c, true, null, { produced: { [a.item]: 1 } });
      }
      case 'build': {
        if (a.work < 30) return;
        c.energy -= 6;
        if ((c.inventory.wood ?? 0) < 4 || (c.inventory.stone ?? 0) < 2 || this.shelters.some((s) => Math.max(Math.abs(s.x - c.x), Math.abs(s.y - c.y)) < 2) || this.fires.some((f) => f.x === c.x && f.y === c.y)) return this.endStep(c, false, 'cannot-build');
        this.takeItem(c, 'wood', 4); this.takeItem(c, 'stone', 2);
        this.totals.built.wood = (this.totals.built.wood ?? 0) + 4; this.totals.built.stone = (this.totals.built.stone ?? 0) + 2;
        const s = { id: this.nextId.shelter++, x: c.x, y: c.y, cap: 4, integrity: 100, builder: c.id, tick: this.tick };
        this.shelters.push(s); c.home = { x: c.x, y: c.y }; c.stats.built++;
        const far = Math.hypot(c.x - BASE / 2, c.y - BASE / 2) > 40;
        this.emit('shelter_built', { shelter: s.id, by: c.id, x: c.x, y: c.y, biome: this.biome(c.x, c.y), newSettlement: far });
        if (far && !this.shelters.some((o) => o !== s && Math.hypot(o.x - s.x, o.y - s.y) < 15)) this.discover(c, `settlement:${s.x >> 4},${s.y >> 4}`);
        return this.endStep(c, true);
      }
      case 'use': return this.performUse(c, a, target);
      case 'share': {
        if (!this.takeItem(c, a.item)) return this.endStep(c, false, 'missing-item');
        this.addItem(target, a.item);
        target.relationships[c.id] = clamp((target.relationships[c.id] ?? 0) + 0.25, -1, 1); c.relationships[target.id] = clamp((c.relationships[target.id] ?? 0) + 0.1, -1, 1);
        this.socialEvent('share', c, target, 'given'); c.stats.social++;
        return this.endStep(c, true, null, { social: 0.3 * c.personality.sociability + ((c.parents.includes(target.id) || target.parents?.includes(c.id)) ? 0.3 : 0) });
      }
      case 'socialize': {
        if (a.work < 8) return;
        c.relationships[target.id] = clamp((c.relationships[target.id] ?? 0) + 0.06, -1, 1); target.relationships[c.id] = clamp((target.relationships[c.id] ?? 0) + 0.04, -1, 1);
        c.stats.social++; return this.endStep(c, true, null, { social: 0.2 * c.personality.sociability });
      }
      case 'follow': {
        // The target decides: refusing is its own choice from its relationship to the follower (no assigned ruler).
        if ((target.relationships[c.id] ?? 0) < -0.15 || target.health < 30) { this.socialEvent('refuse', target, c, 'refused'); c.relationships[target.id] = clamp((c.relationships[target.id] ?? 0) - 0.1, -1, 1); return this.endStep(c, false, 'refused'); }
        c.following = { id: target.id, until: this.tick + 200 }; target.followers[c.id] = this.tick;
        this.socialEvent('follow', c, target, 'accepted');
        return this.endStep(c, true, null, { social: 0.1 });
      }
      case 'threaten': {
        c.energy -= 2;
        const yields = target.personality.boldness * target.health < c.personality.boldness * c.health;
        target.threatenedBy = c.id; target.relationships[c.id] = clamp((target.relationships[c.id] ?? 0) - 0.2, -1, 1);
        this.socialEvent('threaten', c, target, yields ? 'target-yielded' : 'target-stood');
        if (yields && target.act?.prim === 'gather') { this.interrupt(target, 'threatened'); }
        return this.endStep(c, yields, yields ? null : 'stood-ground');
      }
      case 'attack': return this.performAttack(c, target);
    }
    return this.endStep(c, false, 'unknown');
  }
  performUse(c, a, target) {
    if (a.on === 'water') {
      if (a.work < 3) return;
      const t = this.tile(a.x, a.y);
      if (FRESH.has(t)) { c.thirst = Math.max(0, c.thirst - 45); rememberWater(c.mind, a.x, a.y, this.tick); return this.endStep(c, true, null, { drank: 'fresh' }); }
      if (SALT.has(t)) { c.thirst = Math.min(100, c.thirst + 8); c.health -= 2; return this.endStep(c, false, 'salt-water'); }
      return this.endStep(c, false, 'no-water');
    }
    if (a.work < 2) return;
    if (!c.inventory[a.item]) return this.endStep(c, false, 'missing-item');
    if (a.on === 'self') {
      const fd = FOOD[a.item]; if (!fd) { c.energy -= 0.5; return this.endStep(c, false, 'inedible'); }
      this.takeItem(c, a.item); this.totals.eaten[a.item] = (this.totals.eaten[a.item] ?? 0) + 1; c.stats.eaten++;
      const rev = this.cfg.rewardReversal;
      if (rev && rev.item === a.item && this.tick >= rev.fromTick) { c.hunger = Math.max(0, c.hunger - 4); c.health -= 10; return this.endStep(c, true, null, { toxic: true }); }
      c.hunger = Math.max(0, c.hunger - fd.hunger); if (fd.thirst) c.thirst = Math.max(0, c.thirst - fd.thirst);
      return this.endStep(c, true);
    }
    if (a.on === 'pile') {
      const p = this.pileAt(c.x, c.y); c.energy -= 1.5;
      if (!p) return this.endStep(c, false, 'no-pile');
      // Ignition rule (designed physics): striking flint while also holding stone, onto a pile with fuel.
      if (a.item !== 'flint' || !c.inventory.stone) return this.endStep(c, false, 'no-ignition');
      const fuel = Object.entries(p.items).reduce((s, [k, n]) => s + (FUEL[k] ?? 0) * n, 0);
      if (fuel <= 0) return this.endStep(c, false, 'no-fuel');
      const wet = this.weather.rain || [T.SNOW, T.SHALLOW].includes(this.tile(c.x, c.y));
      const pIgnite = clamp((0.3 + (p.items.fiber || p.items.bundle ? 0.35 : 0)) * (wet ? 0.25 : 1) * (this.biome(c.x, c.y) === 'arid' ? 1.3 : 1), 0, 0.95);
      if (this.rng.next() >= pIgnite) return this.endStep(c, false, 'no-spark-caught');
      for (const [k, n] of Object.entries(p.items)) if (FUEL[k]) { this.totals.burnedItems[k] = (this.totals.burnedItems[k] ?? 0) + n; delete p.items[k]; }
      this.removePileIfEmpty(p);
      this.fires.push({ id: this.nextId.fire++, x: c.x, y: c.y, fuel, lit: this.tick, by: c.id });
      this.discover(c, 'fire:strike-flint-on-fuel');
      this.emit('fire_lit', { by: c.id, x: c.x, y: c.y, fuel });
      return this.endStep(c, true, null, { fire: true });
    }
    if (a.on === 'fire') {
      const f = target; c.energy -= 1;
      this.takeItem(c, a.item);
      if (FUEL[a.item]) { f.fuel += FUEL[a.item]; this.totals.burnedItems[a.item] = (this.totals.burnedItems[a.item] ?? 0) + 1; return this.endStep(c, true, null, { fed: true }); }
      // anything non-flammable smothers (sand/stone/soil-like)
      this.dropToPile(f.x, f.y, a.item); f.fuel -= 8; if (f.fuel <= 0) this.extinguish(f, 'smothered');
      return this.endStep(c, true, null, { smothered: true });
    }
    return this.endStep(c, false, 'no-effect');
  }
  performAttack(c, target) {
    // Range 1 (reach), energy cost, hit chance, damage; injuries bleed. Death only via the health rule.
    c.energy -= 5;
    const armed = c.inventory.stone_club ? 7 : c.inventory.hand_axe ? 5 : 0;
    const hit = this.rng.next() < 0.65 + 0.2 * (c.personality.boldness - target.personality.boldness);
    target.lastAttacker = c.id; target.relationships[c.id] = clamp((target.relationships[c.id] ?? 0) - 0.5, -1, 1);
    let dmg = 0;
    if (hit) { dmg = 5 + this.rng.int(6) + armed; target.health -= dmg; target.injury = Math.min(400, target.injury + 60 + dmg * 10); target.stats.hurt++; target.lastDamage = { cause: 'injury', by: c.id, tick: this.tick }; }
    this.socialEvent('attack', c, target, hit ? `hit:${dmg}` : 'missed');
    if (target.act && target.act.prim !== 'attack') this.interrupt(target, 'attacked');
    return this.endStep(c, hit, hit ? null : 'missed', { social: 0 });
  }
  interrupt(c, why) { if (c.act) this.endStep(c, false, `interrupted:${why}`); c.plan = null; }
  dropToPile(x, y, item, n = 1) {
    let p = this.pileAt(x, y); const ch = this.chunkAt(x, y);
    if (!p) { p = { id: `p${this.nextId.pile++}`, x, y, items: {} }; ch.piles.push(p); ch.pileAt.set(y * 100000 + x, p); }
    p.items[item] = (p.items[item] ?? 0) + n; ch.dirty = true;
  }
  removePileIfEmpty(p) { if (Object.keys(p.items).length) return; const ch = this.chunkAt(p.x, p.y); ch.piles.splice(ch.piles.indexOf(p), 1); ch.pileAt.delete(p.y * 100000 + p.x); }
  extinguish(f, why) { const i = this.fires.indexOf(f); if (i >= 0) this.fires.splice(i, 1); this.emit('fire_out', { fire: f.id, why }); }
  discover(c, what) {
    const first = !this.discoveries.some((d) => d.what === what), own = !c.mind.discoveries.includes(what);
    if (own) { c.mind.discoveries.push(what); if (c.mind.discoveries.length > 24) c.mind.discoveries.shift(); }
    if (own) { this.discoveries.push({ tick: this.tick, what, by: c.id, firstInWorld: first, selfFound: !c.mind.observedFrom?.includes(what) }); if (this.discoveries.length > 500) this.discoveries.shift(); }
  }

  endStep(c, success, reason = null, extra = {}) {
    const a = c.act; if (!a) return;
    c.act = null;
    const duration = this.tick - a.started + 1, energy = a.before.energy - c.energy;
    const produced = {}; for (const [k, n] of Object.entries(c.inventory)) { const d = n - (a.before.inv[k] ?? 0); if (d > 0) produced[k] = d; }
    const items = Object.values(produced).reduce((s, v) => s + v, 0);
    // Reward = change of need-based wellbeing (designed) + small designed drives (acquisition, novelty, social).
    const novelItem = Object.keys(produced).some((k) => !c.mind.seenItems?.includes(k));
    if (novelItem) { c.mind.seenItems ??= []; for (const k of Object.keys(produced)) if (!c.mind.seenItems.includes(k)) c.mind.seenItems.push(k); }
    const reward = clamp(this.wellbeing(c) - a.before.wb + 0.12 * items + (novelItem ? 0.4 : 0) + (a.novel ? 0.05 * a.novel : 0) + (extra.social ?? 0) + (extra.fire ? 0.3 : 0) - (success ? 0 : 0.1), -2, 2);
    const outcome = { tick: this.tick, success, reward, duration, energy, produced };
    const learn = this.learning && this.mode !== 'frozen';
    if (learn) updateModel(c.mind, a.key, outcome);
    const pl = c.plan;
    if (pl) {
      if (pl.idx === 0 && pl.trace) reinforce(c.brain.mb, a.label, pl.trace, reward, this.tick, learn, pl.source === 'reflex' ? 'reflex' : 'model');
      pl.actual.push({ step: pl.idx, success, reason, reward: r3(reward), duration, energy: r3(energy), produced });
    }
    recordEpisode(c.mind, { tick: this.tick, key: a.key, success, reward: r3(reward), duration, produced, reason, x: c.x, y: c.y, novel: novelItem });
    // Social observation: nearby creatures see the act and its visible result and update their OWN model at low weight.
    if (learn && (items > 0 || extra.fire || reason === 'no-result' || reason === 'salt-water' || extra.toxic) && a.prim !== 'move') {
      for (const o of this.creaturesNear(c.x, c.y, this.cfg.perception)) if (o !== c) {
        // the actor's context (e.g. visibly holding a tool) is part of what is observed, so the same key applies
        updateModel(o.mind, a.key, { ...outcome, reward: outcome.reward - (this.wellbeing(c) - a.before.wb) * 0.5 }, this.cfg.observeWeight);
        if (extra.fire || a.prim === 'combine') { o.mind.observedFrom ??= []; const w = a.prim === 'combine' ? `combine:${a.a}+${a.b}->${RECIPES[`${a.a}+${a.b}`]}` : 'fire:strike-flint-on-fuel'; if (!o.mind.observedFrom.includes(w)) { o.mind.observedFrom.push(w); if (o.mind.observedFrom.length > 16) o.mind.observedFrom.shift(); } }
      }
    }
    if (pl) {
      if (!success) { this.finishPlan(c); return; }
      pl.idx++;
      if (pl.idx < pl.raw.length) this.startStep(c); else this.finishPlan(c);
    }
  }
  finishPlan(c) {
    const pl = c.plan; if (!pl) return;
    const rec = { id: pl.id, tick: pl.tick, source: pl.source, steps: pl.steps, predicted: pl.predicted, value: pl.value, utility: pl.utility, mbPreference: pl.mbPreference, alternatives: pl.alternatives, actual: pl.actual,
      predictedReward: r3(pl.predicted.reduce((s, p) => s + p.reward, 0)), actualReward: r3(pl.actual.reduce((s, p) => s + p.reward, 0)), completed: pl.actual.length === pl.steps.length && pl.actual.every((x) => x.success) };
    c.mind.plans.push(rec); if (c.mind.plans.length > LIMITS.plans) c.mind.plans.shift();
    c.mind.lastPlan = rec; c.plan = null;
  }

  // ---------------- world tick ----------------
  step() {
    this.tick++;
    if (this.tick % 300 === 0) { if (this.weather.rain && this.tick >= this.weather.until) this.weather.rain = false; else if (!this.weather.rain && this.rng.next() < 0.25) { this.weather = { rain: true, until: this.tick + 300 }; } }
    this.rebuildIndex();
    this.stepFires();
    const queue = [];
    for (const c of this.creatures) {
      this.needs(c);
      if (c.health <= 0) continue;
      if (c.act) this.stepAct(c);
      else if (c.following && c.hunger < 70 && c.thirst < 70 && c.warmth > 40) { this.followStep(c); continue; }
      if (!c.act && c.health > 0) queue.push(c);
    }
    // Fair scheduling: bounded decisions per tick, served oldest-waiting first; others wait (never removed).
    queue.sort((a, b) => (a.waitSince ?? this.tick) - (b.waitSince ?? this.tick) || a.id - b.id);
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i];
      if (i < this.cfg.maxDecisionsPerTick) { c.waitSince = null; this.decide(c); } else { c.waitSince ??= this.tick; this.totals.deferred++; }
    }
    this.lifecycle();
    if (this.tick % this.cfg.historyEvery === 0) { this.history.push(this.summary()); if (this.history.length > this.cfg.historyMax) this.history.shift(); }
  }
  followStep(c) {
    const l = this.getCreature(c.following.id);
    if (!l) { c.following = null; return; }
    if (Math.max(Math.abs(l.x - c.x), Math.abs(l.y - c.y)) > 2) {
      const p = this.findPath(c.x, c.y, l.x, l.y, true, 400);
      if (p?.length) { const [nx, ny] = p[0]; c.x = nx; c.y = ny; c.energy -= 0.08; c.stats.moved++; }
    }
  }
  needs(c) {
    const cf = this.cfg, juvenile = c.age < cf.adultAge;
    c.age++; if (c.cooldown > 0) c.cooldown--;
    const temp = this.effectiveTemp(c);
    const resting = c.act?.prim === 'rest';
    c.hunger = Math.min(100, c.hunger + cf.hungerRate * (juvenile ? 0.6 : 1) * (resting ? 0.6 : 1) * (temp < 5 ? 1.3 : 1));
    c.thirst = Math.min(100, c.thirst + cf.thirstRate * (1 + Math.max(0, temp - 26) / 8));
    // Warmth: cold exposure below 10C drains it; comfortable temperatures restore it.
    if (temp < 10) c.warmth = Math.max(0, c.warmth - (10 - temp) * 0.012); else c.warmth = Math.min(100, c.warmth + 0.25);
    if (!resting) c.energy = Math.max(0, c.energy - 0.02); if (c.energy <= 0) c.health -= 0.03;
    let cause = null;
    if (c.hunger >= 100) { c.health -= 0.08; cause = 'starvation'; } else if (c.hunger >= 90) { c.health -= 0.02; cause = 'starvation'; }
    if (c.thirst >= 100) { c.health -= 0.12; cause = 'dehydration'; }
    if (c.warmth < 25) { c.health -= 0.05 * (1 - c.warmth / 25) + 0.01; cause = 'exposure'; }
    if (c.injury > 0) { c.injury--; c.health -= 0.02; cause ??= 'injury'; if (c.lastDamage?.cause === 'injury') cause = 'injury'; }
    const onFire = this.fires.some((f) => f.x === c.x && f.y === c.y);
    if (onFire) { c.health -= 4; cause = 'burns'; }
    if (!cause && c.hunger < 60 && c.thirst < 60 && c.warmth > 50) c.health = Math.min(100, c.health + 0.03);
    if (c.age > c.lifespan) { c.health = 0; cause = 'old_age'; }
    if (c.health <= 0) c.deathCause = cause ?? 'unknown';
    if (c.following && this.tick >= c.following.until) c.following = null;
  }
  stepFires() {
    for (const f of this.fires.slice()) {
      f.fuel -= this.weather.rain ? 0.2 : 0.025;
      if (f.fuel <= 0) { this.extinguish(f, this.weather.rain ? 'rain' : 'fuel'); continue; }
      if ((this.tick + f.id) % 10) continue;
      const dry = { arid: 2, temperate: 1, cold: 0.3, coast: 0.5 }[this.biome(f.x, f.y)] * (this.weather.rain ? 0 : 1);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = this.nodeAt(f.x + dx, f.y + dy);
        if (!n || n.units <= 0 || !['tree', 'scrub', 'deadfall', 'bush', 'driftwood'].includes(n.kind)) continue;
        if (this.fires.some((o) => o.x === n.x && o.y === n.y)) continue;
        if (this.rng.next() < 0.03 * dry) {
          const item = NODE_KINDS[n.kind].item, u = n.units;
          this.totals.burnedNodes[item] = (this.totals.burnedNodes[item] ?? 0) + u; n.units = 0; n.t = this.tick; this.dirty(n.x, n.y);
          this.fires.push({ id: this.nextId.fire++, x: n.x, y: n.y, fuel: u * 3, lit: this.tick, by: null, spreadFrom: f.id });
          this.emit('fire_spread', { from: f.id, x: n.x, y: n.y, node: n.id });
        }
      }
    }
  }
  lifecycle() {
    const dead = this.creatures.filter((c) => c.health <= 0);
    for (const c of dead) {
      this.creatures.splice(this.creatures.indexOf(c), 1);
      for (const [k, n] of Object.entries(c.inventory)) this.dropToPile(c.x, c.y, k, n); // items stay in the world
      c.inventory = {};
      const cause = c.deathCause ?? c.lastDamage?.cause ?? 'unknown';
      this.totals.deaths++; this.totals.deathsByCause[cause] = (this.totals.deathsByCause[cause] ?? 0) + 1;
      this.graveyard.push({ id: c.id, name: c.name, tick: this.tick, age: c.age, cause, x: c.x, y: c.y, generation: c.generation, parents: c.parents });
      if (this.graveyard.length > this.cfg.graveyardMax) this.graveyard.shift();
      this.emit('death', { id: c.id, cause, age: c.age });
    }
    // Natural births: bonded adults, both nearby, fed/watered/warm, at a shelter or fire, no cooldown.
    for (const m of this.creatures) {
      if (m.sex !== 'F' || !this.isAdult(m) || m.cooldown > 0 || m.age > this.cfg.elderAge) continue;
      if (m.pregnant) { if (this.tick >= m.pregnant.due) this.birth(m); continue; }
      if (m.hunger > 50 || m.thirst > 50 || m.health < 60 || m.warmth < 50) continue;
      if (!this.shelterAt(m.x, m.y) && !this.fireWarmth(m.x, m.y)) continue;
      const f = this.creaturesNear(m.x, m.y, 1).find((o) => o.sex === 'M' && this.isAdult(o) && o.cooldown === 0 && (m.relationships[o.id] ?? 0) > 0.4 && (o.relationships[m.id] ?? 0) > 0.4 && o.hunger < 50 && o.thirst < 50);
      if (!f) continue;
      m.pregnant = { father: f.id, due: this.tick + 80 }; m.cooldown = 600; f.cooldown = 600; m.hunger += 15; f.hunger += 6;
    }
  }
  birth(m) {
    const f = this.getCreature(m.pregnant.father);
    const kid = this.newCreature({ x: m.x, y: m.y, sex: this.rng.next() < 0.5 ? 'F' : 'M', age: 0, parents: [m.id, m.pregnant.father], parentsObj: [m, f ?? m] });
    kid.relationships[m.id] = 0.6; m.relationships[kid.id] = 0.6; kid.home = { ...m.home };
    m.pregnant = null; m.stats.offspring++; if (f) f.stats.offspring++;
    this.creatures.push(kid); this.totals.births++;
    this.emit('birth', { id: kid.id, mother: m.id, father: f?.id ?? null });
  }
  run(n) { for (let i = 0; i < n; i++) this.step(); }

  // ---------------- leadership (observed pattern, not assigned) ----------------
  leadership(window = 2000) {
    const out = [];
    for (const c of this.creatures) { const f = Object.entries(c.followers).filter(([, t]) => this.tick - t <= window); for (const [id] of Object.entries(c.followers)) if (this.tick - c.followers[id] > window) delete c.followers[id]; if (f.length) out.push({ id: c.id, voluntaryFollowers: f.length }); }
    return out.sort((a, b) => b.voluntaryFollowers - a.voluntaryFollowers);
  }
  summary() {
    const by = {}; for (const c of this.creatures) { const b = this.biome(c.x, c.y); by[b] = (by[b] ?? 0) + 1; }
    return { tick: this.tick, population: this.creatures.length, byBiome: by, fires: this.fires.length, shelters: this.shelters.length, chunks: this.chunks.size, births: this.totals.births, deaths: this.totals.deaths };
  }
  // Holdings per item across inventories and ground piles (for conservation checks).
  holdings() {
    const h = {};
    for (const c of this.creatures) for (const [k, n] of Object.entries(c.inventory)) h[k] = (h[k] ?? 0) + n;
    for (const ch of this.chunks.values()) for (const p of ch.piles) for (const [k, n] of Object.entries(p.items)) h[k] = (h[k] ?? 0) + n;
    return h;
  }

  // ---------------- persistence ----------------
  toState() {
    const chunks = [];
    for (const ch of this.chunks.values()) if (ch.dirty) chunks.push({ cx: ch.cx, cy: ch.cy, tiles: Buffer.from(ch.tiles).toString('base64'), nodes: ch.nodes, piles: ch.piles });
    const creatures = this.creatures.map((c) => { const { lastObs, ...rest } = c; return { ...rest, plan: c.plan ? { ...c.plan } : null, act: c.act ? { ...c.act } : null }; });
    return { kind: 'stratoks-expanse', schema: EXPANSE_SCHEMA, seed: this.seed, cfg: this.cfg, tick: this.tick, seq: this.seq, rng: this.rng.s, mode: this.mode, learning: this.learning,
      base: { tiles: Buffer.from(this.base.tiles).toString('base64'), trees: this.base.trees, stones: this.base.stones, bushes: this.base.bushes },
      chunks, fires: this.fires, shelters: this.shelters, creatures, graveyard: this.graveyard, events: this.events, social: this.social, discoveries: this.discoveries,
      history: this.history, totals: this.totals, weather: this.weather, nextId: this.nextId, generated: [...this.chunks.values()].filter((c) => !c.dirty).map((c) => [c.cx, c.cy]) };
  }
  static fromState(s, cfgOverride = {}) {
    if (s.kind !== 'stratoks-expanse') throw new Error('not an expanse snapshot');
    if (s.schema !== EXPANSE_SCHEMA) throw new Error(`expanse schema ${s.schema} requires migration to ${EXPANSE_SCHEMA}`);
    const e = new Expanse({ ...s.cfg, ...cfgOverride });
    const st = structuredClone(s);
    Object.assign(e, { seed: st.seed, schema: st.schema, tick: st.tick, seq: st.seq, mode: cfgOverride.mode ?? st.mode, learning: cfgOverride.learning ?? st.learning, fires: st.fires, shelters: st.shelters,
      creatures: st.creatures, graveyard: st.graveyard, events: st.events, social: st.social, discoveries: st.discoveries, history: st.history, totals: st.totals, weather: st.weather, nextId: st.nextId });
    e.rng = new Rng(1); e.rng.s = st.rng >>> 0;
    e.base = { tiles: Uint8Array.from(Buffer.from(st.base.tiles, 'base64')), trees: st.base.trees, stones: st.base.stones, bushes: st.base.bushes };
    e.chunks = new Map();
    for (const c of st.chunks) {
      const fresh = generateChunk(e.seed, c.cx, c.cy, e.base);
      const ch = { cx: c.cx, cy: c.cy, tiles: Uint8Array.from(Buffer.from(c.tiles, 'base64')), biome: fresh.biome, nodes: c.nodes, piles: c.piles, dirty: true };
      e.indexChunk(ch); e.chunks.set(chunkKey(c.cx, c.cy), ch);
    }
    for (const [cx, cy] of st.generated ?? []) e.chunk(cx, cy); // pristine chunks regenerate deterministically
    for (const c of e.creatures) { ensureMushroom(c.brain, e.seed, c.id); }
    return e;
  }
}

function describe(s) { const { key, label, consumes, firstOnly, ...rest } = s; return { ...rest, key, label }; }
function r3(v) { return Math.round((v ?? 0) * 1000) / 1000; }
function hpush(h, v) { h.push(v); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } }
function hpop(h) { const top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } } return top; }
