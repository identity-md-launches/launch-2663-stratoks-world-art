// Authoritative world state, ecology, lifecycle, disasters and visitor effects. Pure simulation: no I/O, no wall clock.
// All randomness comes from the world's own seeded Rng, so identical config+seed gives identical runs.
import { Rng } from './rng.js';
import { createBrain, inheritBrain, updateWallet, walletValue, clamp } from './brain.js';
import { makeBubble } from './speech.js';
import { decide, stepAct, endAct } from './actions.js';

export const SCHEMA_VERSION = 2;
export const interventionKey = (actor, id) => `${String(actor).toLowerCase()}:${id}`;
const SYL = ['ka', 'to', 'mi', 'ru', 'ne', 'so', 'la', 'bo', 'zi', 'pe', 'du', 'fa', 'ye', 'gu', 'ha', 'vi'];

export class World {
  constructor(cfg) { this.cfg = cfg; this.W = cfg.world.width; this.H = cfg.world.height; }

  // ---------- creation ----------
  static create(cfg, opts = {}) {
    const w = new World(cfg);
    const c = cfg.world;
    w.id = opts.id ?? `world-${c.seed}-${opts.resetCount ?? 0}`;
    w.resetCount = opts.resetCount ?? 0;
    w.seed = opts.seed ?? c.seed;
    w.learning = opts.learning ?? c.learning;
    w.rng = new Rng(w.seed);
    w.tick = 0; w.seq = 0; w.status = 'alive'; w.extinctAt = null;
    w.nextId = { creature: 1, bush: 1, tree: 1, stone: 1, shelter: 1, fire: 1, storm: 1 };
    w.creatures = []; w.bushes = []; w.trees = []; w.stones = []; w.shelters = []; w.fires = []; w.storms = [];
    w.graveyard = []; w.visitors = {}; w.trample = {}; w.paths = {}; w.history = []; w.events = [];
    w.interventions = {}; w.interventionOrder = []; w.interventionTimes = {}; w.learningLog = [];
    w.totals = { births: 0, deaths: 0, deathsByCause: {}, eaten: 0, sheltersBuilt: 0, sheltersLost: 0, interventions: 0, downtimeEvents: 0 };
    w.createdTick = 0;
    w.genTerrain();
    w.populate(opts.initialCount ?? c.initialSeedCount);
    w.rebuildBlocked();
    w.emit('world_created', { worldId: w.id, seed: w.seed, initialSeedCount: opts.initialCount ?? c.initialSeedCount, note: 'initial seed, not a population cap' });
    return w;
  }

  genTerrain() {
    const { W, H } = this, r = this.rng, c = this.cfg.world;
    this.tiles = new Uint8Array(W * H); // 0 grass, 1 water
    const cx = W / 2, cy = H / 2;
    const lakes = 2 + r.int(2);
    for (let l = 0; l < lakes; l++) {
      let lx, ly;
      do { lx = r.range(6, W - 6); ly = r.range(6, H - 6); } while (Math.hypot(lx - cx, ly - cy) < 16);
      const rad = r.range(3.5, 6.5), ph = r.range(0, 6.28), amp = r.range(0.2, 0.4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const a = Math.atan2(y - ly, x - lx), d = Math.hypot(x - lx, y - ly);
        if (d < rad * (1 + amp * Math.sin(3 * a + ph))) this.tiles[y * W + x] = 1;
      }
    }
    // keep a one-tile shoreline of grass border so nobody spawns on the edge
    const free = (x, y) => x > 1 && y > 1 && x < W - 2 && y < H - 2 && this.tiles[y * W + x] === 0;
    const taken = new Set();
    const spot = (minD, maxD) => {
      for (let n = 0; n < 400; n++) {
        const x = r.int(W), y = r.int(H), d = Math.hypot(x - cx, y - cy);
        if (d >= minD && d <= maxD && free(x, y) && !taken.has(y * W + x)) { taken.add(y * W + x); return [x, y]; }
      }
      return null;
    };
    const forests = []; for (let i = 0; i < 6; i++) forests.push(spot(9, 26) ?? [3, 3]);
    for (let i = 0; i < c.tree.count; i++) {
      const f = forests[i % forests.length];
      for (let n = 0; n < 40; n++) {
        const x = Math.round(f[0] + r.gauss() * 3), y = Math.round(f[1] + r.gauss() * 3);
        if (free(x, y) && !taken.has(y * W + x) && Math.hypot(x - cx, y - cy) > 6) { taken.add(y * W + x); this.trees.push({ id: this.nextId.tree++, x, y, wood: c.tree.wood, t: 0 }); break; }
      }
    }
    for (let i = 0; i < c.stone.count; i++) { const s = spot(8, 28); if (s) this.stones.push({ id: this.nextId.stone++, x: s[0], y: s[1], units: c.stone.units, t: 0 }); }
    for (let i = 0; i < c.bush.initial; i++) { const s = spot(3, 22); if (s) this.bushes.push({ id: this.nextId.bush++, x: s[0], y: s[1], amount: c.bush.capacity * r.range(0.4, 1), emptySince: null, gift: null }); }
    this.reserved = taken;
  }

  populate(n) {
    const r = this.rng, c = this.cfg.world, cx = Math.floor(this.W / 2), cy = Math.floor(this.H / 2);
    for (let i = 0; i < n; i++) {
      let x = cx, y = cy;
      for (let k = 0; k < 60; k++) {
        const tx = Math.round(cx + r.gauss() * 3), ty = Math.round(cy + r.gauss() * 3);
        if (this.tiles[ty * this.W + tx] === 0 && !this.reserved.has(ty * this.W + tx)) { x = tx; y = ty; break; }
      }
      this.creatures.push(this.newCreature({ x, y, sex: i % 2 ? 'F' : 'M', age: c.adultAge + r.int(8000), parents: [] }));
    }
  }

  newName() { const r = this.rng; return SYL[r.int(16)] + SYL[r.int(16)] + (r.next() < 0.5 ? SYL[r.int(16)] : ''); }

  newCreature({ x, y, sex, age, parents, brainFrom }) {
    const r = this.rng, c = this.cfg.world;
    const personality = { boldness: r.next(), sociability: r.next(), diligence: r.next(), curiosity: r.next(), caution: r.next() };
    const brain = brainFrom ? inheritBrain(r, brainFrom[0]?.brain, brainFrom[1]?.brain, c.inheritBlend, c.mutation, personality) : createBrain(r, personality);
    const name = this.newName();
    return {
      id: this.nextId.creature++, name: name[0].toUpperCase() + name.slice(1), sex, bornTick: this.tick - age, age,
      x, y, face: 1, hunger: 10 + r.next() * 30, energy: 60 + r.next() * 40, health: 100,
      personality, brain, lifespan: Math.round(c.lifespanBase * r.range(0.8, 1.2)),
      parents, generation: parents.length ? 1 + Math.max(...parents.map((p) => this.generationOf(p))) : 0,
      relationships: {}, memories: [], decisions: [], places: { food: [] }, speech: [],
      partner: null, home: null, pregnant: null, cooldown: 0, carrying: null,
      act: null, path: [], inside: false, bubble: null, lastBubble: -999, lastDamage: null, lastHunger: 0,
      stats: { eaten: 0, gathered: 0, built: 0, social: 0, hurt: 0, offspring: 0, decisions: 0 },
    };
  }
  // Sex ratio self-balances mildly (documented simplification of monogamous pairing): minority sex is slightly favoured.
  maleBirthProb() { let m = 0, f = 0; for (const c of this.creatures) if (this.isAdult(c)) c.sex === 'M' ? m++ : f++; return m + f ? clamp(0.5 + 0.5 * (f - m) / (m + f), 0.3, 0.7) : 0.5; }
  generationOf(id) { const c = this.getCreature(id) ?? this.graveyard.find((g) => g.id === id); return c?.generation ?? 0; }

  // ---------- accessors ----------
  getCreature(id) { return this.creatures.find((c) => c.id === id); }
  getBush(id) { return this.bushes.find((b) => b.id === id); }
  getShelter(id) { return this.shelters.find((s) => s.id === id); }
  ageStage(c) { const a = this.cfg.world; return c.age < a.adultAge * 0.4 ? 'infant' : c.age < a.adultAge ? 'juvenile' : c.age > a.elderAge ? 'elder' : 'adult'; }
  isAdult(c) { return c.age >= this.cfg.world.adultAge; }
  idx(x, y) { return y * this.W + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  walkable(x, y) { return this.inBounds(x, y) && !this.blocked[y * this.W + x]; }

  rebuildBlocked() {
    this.blocked = new Uint8Array(this.W * this.H);
    for (let i = 0; i < this.tiles.length; i++) this.blocked[i] = this.tiles[i];
    for (const t of this.trees) if (t.wood > 0) this.blocked[this.idx(t.x, t.y)] = 1;
    for (const s of this.stones) if (s.units > 0) this.blocked[this.idx(s.x, s.y)] = 1;
    for (const s of this.shelters) this.blocked[this.idx(s.x, s.y)] = 1;
  }

  // BFS path to the goal tile (adj=true: any tile within 1 of it). Returns [] if already there, null if unreachable.
  findPath(fx, fy, gx, gy, adj) {
    const { W, H } = this; fx = Math.round(fx); fy = Math.round(fy);
    const done = (x, y) => adj ? Math.max(Math.abs(x - gx), Math.abs(y - gy)) <= 1 : (x === gx && y === gy);
    if (done(fx, fy)) return [];
    const prev = new Int32Array(W * H).fill(-2);
    const q = [fy * W + fx]; prev[q[0]] = -1;
    for (let h = 0; h < q.length; h++) {
      const cur = q[h], cx = cur % W, cy = (cur / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!this.inBounds(nx, ny) || prev[ny * W + nx] !== -2) continue;
        const gOk = adj ? false : (nx === gx && ny === gy);
        if (this.blocked[ny * W + nx] && !gOk) continue;
        if (dx && dy && (this.blocked[cy * W + nx] || this.blocked[ny * W + cx])) continue;
        prev[ny * W + nx] = cur;
        if (done(nx, ny)) {
          const path = []; let p = ny * W + nx;
          while (p !== -1 && p !== fy * W + fx) { path.push([p % W, (p / W) | 0]); p = prev[p]; }
          return path.reverse();
        }
        q.push(ny * W + nx);
      }
    }
    return null;
  }

  freeTileNear(x, y, minR, maxR) {
    const r = this.rng, cand = [];
    for (let dy = -maxR; dy <= maxR; dy++) for (let dx = -maxR; dx <= maxR; dx++) {
      const d = Math.hypot(dx, dy); if (d < minR || d > maxR) continue;
      const tx = Math.round(x + dx), ty = Math.round(y + dy);
      if (!this.inBounds(tx, ty) || this.blocked[this.idx(tx, ty)] || tx < 2 || ty < 2 || tx > this.W - 3 || ty > this.H - 3) continue;
      if (this.bushes.some((b) => b.x === tx && b.y === ty)) continue;
      if (this.shelters.some((s) => Math.abs(s.x - tx) < 2 && Math.abs(s.y - ty) < 2)) continue;
      cand.push([tx, ty]);
    }
    return cand.length ? cand[r.int(cand.length)] : null;
  }

  // ---------- events & memory ----------
  emit(type, data = {}) {
    const ev = { seq: ++this.seq, tick: this.tick, type, ...data };
    this.events.push(ev);
    if (this.events.length > this.cfg.world.eventRing) this.events.splice(0, this.events.length - this.cfg.world.eventRing);
    this.pending ??= []; this.pending.push(ev);
    return ev;
  }
  // The service acknowledges this queue only after the corresponding append completed.  Draining before an
  // append is durable loses an event when the filesystem reports ENOSPC or a short write.
  pendingEvents() { return this.pending ?? []; }
  acknowledgeEvents(count) { if (count > 0) this.pending.splice(0, count); }
  drainEvents() { const p = this.pendingEvents(); this.pending = []; return p; } // compatibility for offline callers

  remember(c, kind, text, valence = 0, extra = {}) {
    c.memories.push({ tick: this.tick, kind, text, valence, x: Math.round(c.x), y: Math.round(c.y), ...extra });
    if (c.memories.length > this.cfg.world.memorySize) {
      // forget the least emotionally salient old memory first
      let wi = 0, wv = Infinity;
      for (let i = 0; i < c.memories.length - 5; i++) { const v = Math.abs(c.memories[i].valence) + i * 0.001; if (v < wv) { wv = v; wi = i; } }
      c.memories.splice(wi, 1);
    }
  }
  say(c, trigger, cause) {
    if (this.tick - c.lastBubble < 40) return;
    const b = makeBubble(this.rng, trigger, this.tick, cause);
    if (!b) return;
    c.bubble = b; c.lastBubble = this.tick;
    c.speech.push({ tick: b.tick, text: b.text, tpl: b.tpl, cause: b.cause }); if (c.speech.length > 8) c.speech.shift();
  }
  relate(a, b, delta, kind) {
    const rel = (x, y) => {
      let r = x.relationships[y.id];
      if (!r) {
        const keys = Object.keys(x.relationships);
        if (keys.length >= 24) { keys.sort((p, q) => Math.abs(x.relationships[p].affinity) - Math.abs(x.relationships[q].affinity)); delete x.relationships[keys[0]]; }
        r = x.relationships[y.id] = { affinity: 0, n: 0, last: this.tick, kind: kind ?? 'acquaintance' };
      }
      return r;
    };
    for (const [x, y] of [[a, b], [b, a]]) { const r = rel(x, y); r.affinity = clamp(r.affinity + delta, -1, 1); r.n++; r.last = this.tick; if (kind) r.kind = kind; }
  }
  damage(c, amount, cause) {
    if (amount <= 0) return;
    c.health -= amount; c.lastDamage = { cause, tick: this.tick };
    this.damagedNow ??= new Set(); this.damagedNow.add(c.id);
  }

  // ---------- main step ----------
  step(opts = {}) {
    this.tick++; this.catchup = !!opts.catchup;
    this.damagedNow = new Set();
    this.ecology();
    for (const c of this.creatures) this.updateCreature(c);
    this.reapAndBirth();
    for (const a of Object.keys(this.visitors)) if (this.tick - this.visitors[a].tick > this.cfg.world.visitor.ttl) delete this.visitors[a];
    if (this.tick % this.cfg.world.historyEvery === 0) this.recordHistory();
    if (this.creatures.length === 0 && this.status === 'alive') {
      this.status = 'extinct'; this.extinctAt = this.tick;
      this.emit('extinction', { worldId: this.id, totals: this.totals, note: 'history preserved; births stopped; only an authenticated developer reset can start a new world' });
    }
  }

  totalFood() { let t = 0; for (const b of this.bushes) t += b.amount; return t; }

  ecology() {
    const c = this.cfg.world, B = c.bush, r = this.rng;
    // Bush regrowth: logistic with a small floor so empty bushes can recover; +lakeBonus near water; bushes empty for
    // deadAfter ticks die (overgrazing); full bushes seed neighbours with prob spread while below maxCount.
    const dead = [];
    for (const b of this.bushes) {
      const lake = this.nearWater(b.x, b.y, 4) ? B.lakeBonus : 1;
      b.amount = Math.min(B.capacity, b.amount + B.regrow * lake * (b.amount + B.floor) * (1 - b.amount / B.capacity));
      if (b.amount < 0.05) { b.emptySince ??= this.tick; if (this.tick - b.emptySince > B.deadAfter) dead.push(b); } else if (b.amount >= 0.5) b.emptySince = null;
      if (b.amount >= 0.8 * B.capacity && this.bushes.length + 0 < B.maxCount && r.next() < B.spread) {
        const t = this.freeTileNear(b.x, b.y, 1, 3);
        if (t) { this.bushes.push({ id: this.nextId.bush++, x: t[0], y: t[1], amount: 0.3, emptySince: null, gift: null }); }
      }
      if (b.gift && b.amount < 0.05) b.gift = null;
    }
    if (dead.length) { this.bushes = this.bushes.filter((b) => !dead.includes(b)); this.emit('bush_died', { count: dead.length, cause: 'overgrazed' }); }
    for (const t of this.trees) if (t.wood < c.tree.wood && ++t.t >= c.tree.regrowEvery) { t.t = 0; t.wood++; if (t.wood === 1) this.blocked[this.idx(t.x, t.y)] = 1; }
    for (const s of this.stones) if (s.units < c.stone.units && ++s.t >= c.stone.regrowEvery) { s.t = 0; s.units++; if (s.units === 1) this.blocked[this.idx(s.x, s.y)] = 1; }
    this.disasters();
  }
  nearWater(x, y, rad) {
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (this.inBounds(x + dx, y + dy) && this.tiles[this.idx(x + dx, y + dy)] === 1) return true;
    return false;
  }

  disasters() {
    for (const f of this.fires) {
      f.left--;
      const I = f.intensity, rr = f.r;
      for (const t of this.trees) if (t.wood > 0 && Math.hypot(t.x - f.x, t.y - f.y) <= rr) { t.wood = Math.max(0, t.wood - 0.05 * I); if (t.wood === 0) { t.wood = 0; this.blocked[this.idx(t.x, t.y)] = 0; } }
      for (const b of this.bushes) if (Math.hypot(b.x - f.x, b.y - f.y) <= rr) b.amount = Math.max(0, b.amount - 0.06 * I);
      for (const s of this.shelters) if (Math.hypot(s.x - f.x, s.y - f.y) <= rr) s.integrity -= 0.3 * I;
      for (const c of this.creatures) if (Math.hypot(c.x - f.x, c.y - f.y) <= rr) this.damage(c, (c.inside ? 0.1 : 0.4) * I, 'fire');
    }
    for (const s of this.storms) {
      s.left--;
      const I = s.intensity;
      for (const sh of this.shelters) if (Math.hypot(sh.x - s.x, sh.y - s.y) <= s.r) sh.integrity -= (sh.stage >= 3 ? 0.08 : 0.2) * I;
      for (const b of this.bushes) if (Math.hypot(b.x - s.x, b.y - s.y) <= s.r) b.amount = Math.max(0, b.amount - 0.01 * I);
      for (const c of this.creatures) if (!c.inside && Math.hypot(c.x - s.x, c.y - s.y) <= s.r) { this.damage(c, 0.04 * I, 'storm'); c.energy = Math.max(0, c.energy - 0.05); }
    }
    const endedF = this.fires.filter((f) => f.left <= 0), endedS = this.storms.filter((s) => s.left <= 0);
    for (const f of endedF) this.emit('fire_end', { id: f.id });
    for (const s of endedS) this.emit('storm_end', { id: s.id });
    if (endedF.length) this.fires = this.fires.filter((f) => f.left > 0);
    if (endedS.length) this.storms = this.storms.filter((s) => s.left > 0);
    for (const s of [...this.shelters]) {
      if (s.integrity <= 0) this.collapseShelter(s);
    }
  }
  collapseShelter(s) {
    this.shelters = this.shelters.filter((x) => x !== s);
    for (const c of this.creatures) if (c.home === s.id) { c.home = null; c.inside = false; this.remember(c, 'home_lost', 'My shelter was destroyed.', -0.8); this.say(c, 'hurt', 'home_lost'); }
    this.totals.sheltersLost++;
    this.blocked[this.idx(s.x, s.y)] = 0;
    this.emit('shelter_destroyed', { id: s.id, x: s.x, y: s.y, stage: s.stage });
  }

  hazardAt(c) { // returns {danger, storm} perception
    let danger = 0, storm = 0;
    for (const f of this.fires) { const d = Math.hypot(c.x - f.x, c.y - f.y); if (d <= f.r + 3) danger = Math.max(danger, 1 - Math.max(0, d - f.r) / 3 * 0.5); }
    for (const s of this.storms) if (Math.hypot(c.x - s.x, c.y - s.y) <= s.r) storm = Math.max(storm, s.intensity);
    return { danger, storm };
  }

  updateCreature(c) {
    const cfg = this.cfg.world;
    c.age++;
    const stage = this.ageStage(c);
    const resting = c.act?.type === 'REST';
    c.hunger = Math.min(100, c.hunger + cfg.hungerRate * (stage === 'infant' || stage === 'juvenile' ? cfg.juvenileHungerFactor : 1) * (resting ? 0.6 : 1));
    if (c.cooldown > 0) c.cooldown--;
    // starvation harm: only at severe hunger; reproduction is already suppressed earlier (mateHungerMax)
    if (c.hunger >= 99.9) this.damage(c, cfg.starveDamage, 'starvation');
    else if (c.hunger >= 90) this.damage(c, cfg.severeHungerDamage, 'starvation');
    else if (c.hunger < 60 && c.energy > 15 && c.health < 100) c.health = Math.min(100, c.health + (c.inside ? 0.06 : 0.03));
    if (c.energy <= 0) this.damage(c, 0.03, 'exhaustion');
    if (c.age > cfg.elderAge) {
      const p = 0.0004 * (c.age - cfg.elderAge) / Math.max(1, c.lifespan - cfg.elderAge);
      if (this.rng.next() < p * 4 && !this.catchup) this.damage(c, 100, 'old_age');
    }
    if (this.catchup && !this.cfg.world.catchup.lethal && c.health < 1) c.health = 1;
    if (c.bubble && c.bubble.until < this.tick) c.bubble = null;
    if (c.hunger >= 70 && c.lastHunger < 70) { this.say(c, 'hungry', 'hunger'); this.remember(c, 'hunger', 'I got very hungry.', -0.3); }
    if (c.hunger >= 95 && c.lastHunger < 95) this.say(c, 'starving', 'starvation');
    c.lastHunger = c.hunger;
    if (this.damagedNow.has(c.id) && this.tick % 15 === 0 && c.lastDamage && c.lastDamage.cause !== 'starvation') this.say(c, c.lastDamage.cause === 'fire' ? 'fire' : c.lastDamage.cause === 'storm' ? 'storm' : 'hurt', c.lastDamage.cause);
    if (c.health <= 0) { c.dead = c.lastDamage?.cause ?? 'unknown'; return; }
    if (c.pregnant && this.tick >= c.pregnant.due) c.pregnant.ready = true;
    // act
    if (c.act) stepAct(this, c);
    if (!c.act && !c.dead) decide(this, c);
  }

  // ---------- death & birth ----------
  reapAndBirth() {
    const cfg = this.cfg.world;
    const dead = this.creatures.filter((c) => c.dead);
    for (const c of dead) this.kill(c, c.dead);
    if (dead.length) this.creatures = this.creatures.filter((c) => !c.dead);
    if (this.status !== 'alive') return;
    for (const f of this.creatures) {
      if (!f.pregnant?.ready) continue;
      const preg = f.pregnant; f.pregnant = null;
      if (f.health < 25 || f.hunger > 90) { this.emit('miscarriage', { mother: f.id, cause: f.hunger > 90 ? 'starvation' : 'poor_health' }); this.remember(f, 'loss', 'I lost the child.', -0.8); continue; }
      const dad = this.getCreature(preg.partner);
      const kid = this.newCreature({ x: f.x, y: f.y, sex: this.rng.next() < this.maleBirthProb() ? 'M' : 'F', age: 0, parents: [f.id, preg.partner], brainFrom: [f, dad] });
      kid.hunger = 25; kid.energy = 70; kid.home = f.home;
      const home = this.getShelter(f.home); if (home && !home.residents.includes(kid.id)) home.residents.push(kid.id);
      this.creatures.push(kid);
      this.totals.births++; f.stats.offspring++; if (dad) dad.stats.offspring++;
      for (const p of [f, dad]) if (p) { this.relate(p, kid, 0.8, 'kin'); this.remember(p, 'birth', `${kid.name} was born.`, 0.9, { other: kid.id }); }
      this.say(kid, 'born', 'birth');
      const ev = this.emit('birth', { id: kid.id, name: kid.name, parents: kid.parents, x: Math.round(f.x), y: Math.round(f.y), generation: kid.generation, population: this.creatures.length });
      this.onRecord?.({ kind: 'birth', seq: ev.seq, tick: this.tick, id: kid.id, name: kid.name, parents: kid.parents, generation: kid.generation });
    }
  }
  kill(c, cause) {
    this.totals.deaths++; this.totals.deathsByCause[cause] = (this.totals.deathsByCause[cause] ?? 0) + 1;
    const rec = { id: c.id, name: c.name, bornTick: c.bornTick, diedTick: this.tick, age: c.age, cause, parents: c.parents, generation: c.generation, offspring: c.stats.offspring, hunger: Math.round(c.hunger), x: Math.round(c.x), y: Math.round(c.y) };
    this.graveyard.push(rec); if (this.graveyard.length > this.cfg.world.graveyardMax) this.graveyard.shift();
    const home = this.getShelter(c.home); if (home) home.residents = home.residents.filter((i) => i !== c.id);
    for (const o of this.creatures) {
      if (o.partner === c.id) { o.partner = null; this.remember(o, 'grief', `${c.name} died (${cause}).`, -0.9, { other: c.id }); this.say(o, 'grief', 'partner_death'); this.emit('bond_end', { a: o.id, b: c.id, cause: 'death' }); }
      else if (o.relationships[c.id] && o.relationships[c.id].affinity > 0.3) this.remember(o, 'loss', `${c.name} died (${cause}).`, -0.5, { other: c.id });
    }
    const ev = this.emit('death', { id: c.id, name: c.name, cause, age: c.age, generation: c.generation, population: this.creatures.length - 1 });
    this.onRecord?.({ kind: 'death', seq: ev.seq, tick: this.tick, id: c.id, name: c.name, cause, age: c.age, parents: c.parents });
  }

  // ---------- visitors (wallet identities) ----------
  visitorPresence(addr, x, y) {
    if (!this.visitors[addr] && Object.keys(this.visitors).length >= 64) return false;
    this.visitors[addr] = { x: clamp(x, 1, this.W - 2), y: clamp(y, 1, this.H - 2), tick: this.tick };
    return true;
  }
  visitorAction(addr, type) {
    const v = this.visitors[addr], vc = this.cfg.world.visitor;
    if (!v) return { ok: false, error: 'not_present' };
    this.vstate ??= {}; const st = this.vstate[addr] ??= { gift: -1e9, harm: -1e9, harmCount: 0 };
    const near = this.creatures.filter((c) => Math.hypot(c.x - v.x, c.y - v.y) <= vc.radius);
    const rate = this.learning ? 1 : 0;
    if (type === 'gift_food') {
      if (this.tick - st.gift < vc.giftCooldown) return { ok: false, error: 'cooldown', retryAfterTicks: vc.giftCooldown - (this.tick - st.gift) };
      const t = this.freeTileNear(v.x, v.y, 0, 3); if (!t) return { ok: false, error: 'no_space' };
      st.gift = this.tick;
      this.bushes.push({ id: this.nextId.bush++, x: t[0], y: t[1], amount: 3, emptySince: null, gift: addr });
      for (const c of near) {
        this.remember(c, 'visitor_gift', `A visitor ${addr.slice(0, 6)}… left food nearby.`, 0.6, { wallet: addr });
        if (rate) updateWallet(c.brain, addr, 1, 0.3, this.tick);
      }
      this.emit('visitor_gift', { wallet: addr, x: t[0], y: t[1], witnesses: near.length });
      return { ok: true };
    }
    if (type === 'startle') {
      if (this.tick - st.harm < vc.harmCooldown) return { ok: false, error: 'cooldown', retryAfterTicks: vc.harmCooldown - (this.tick - st.harm) };
      if (st.harmCount >= vc.harmMaxPerWallet) return { ok: false, error: 'wallet_harm_cap' };
      if (!near.length) return { ok: false, error: 'no_target' };
      near.sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y));
      const target = near[0];
      st.harm = this.tick; st.harmCount++;
      this.damage(target, vc.harmDamage, 'visitor');
      target.stats.hurt++;
      this.remember(target, 'visitor_harm', `A visitor ${addr.slice(0, 6)}… hurt me.`, -0.9, { wallet: addr });
      this.say(target, 'hurt', 'visitor_harm');
      if (rate) updateWallet(target.brain, addr, -1, 0.7, this.tick);
      for (const c of near.slice(1)) { this.remember(c, 'visitor_harm_seen', `I saw ${addr.slice(0, 6)}… hurt ${target.name}.`, -0.4, { wallet: addr }); if (rate) updateWallet(c.brain, addr, -1, 0.3, this.tick); }
      this.emit('visitor_harm', { wallet: addr, target: target.id, witnesses: near.length - 1 });
      return { ok: true };
    }
    return { ok: false, error: 'unknown_action' };
  }

  // ---------- interventions (developer) ----------
  // Returns {ok, record, duplicate}. Idempotent per (world, authenticated actor, id): the state belongs to one world,
  // and the key is interventionKey(actor, id), so a second developer reusing an ID gets their own intervention,
  // attributed to them, never a silent duplicate of someone else's. Limits come from cfg.interventions.
  intervene(req, actor) {
    const L = this.cfg.interventions;
    if (!L.enabled) return { ok: false, status: 403, error: 'interventions_disabled' };
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(req.id ?? ''))) return { ok: false, status: 400, error: 'bad_id' };
    if (typeof actor !== 'string' || !actor) return { ok: false, status: 401, error: 'actor_required' };
    actor = actor.toLowerCase();
    const key = interventionKey(actor, req.id);
    const body = { type: req.type, x: Number(req.x), y: Number(req.y), radius: Number(req.radius ?? 4), intensity: Number(req.intensity ?? 0.5) };
    const prior = this.interventions[key];
    if (prior) {
      const same = ['type', 'x', 'y', 'radius', 'intensity'].every((k) => prior.request[k] === body[k]);
      return same ? { ok: true, duplicate: true, record: prior } : { ok: false, status: 409, error: 'id_reused_with_different_request' };
    }
    if (!['add_food', 'heal_area', 'fire', 'storm'].includes(body.type)) return { ok: false, status: 400, error: 'unknown_type' };
    if (![body.x, body.y, body.radius, body.intensity].every(Number.isFinite)) return { ok: false, status: 400, error: 'bad_numbers' };
    if (!this.inBounds(Math.round(body.x), Math.round(body.y))) return { ok: false, status: 400, error: 'out_of_bounds' };
    if (body.radius <= 0 || body.radius > L.maxRadius) return { ok: false, status: 422, error: 'radius_out_of_bounds', max: L.maxRadius };
    if (body.intensity <= 0 || body.intensity > L.maxIntensity) return { ok: false, status: 422, error: 'intensity_out_of_bounds', max: L.maxIntensity };
    const times = (this.interventionTimes[body.type] ??= []);
    while (times.length && this.tick - times[0] > L.windowTicks) times.shift();
    if (times.length && this.tick - times[times.length - 1] < (L.cooldownTicks[body.type] ?? 0)) return { ok: false, status: 429, error: 'cooldown', retryAfterTicks: L.cooldownTicks[body.type] - (this.tick - times[times.length - 1]) };
    if (times.length >= L.maxPerTypePerWindow) return { ok: false, status: 429, error: 'window_limit' };
    times.push(this.tick);
    const result = this.applyEffect(body);
    const record = { id: req.id, key, request: body, actor, worldId: this.id, appliedTick: this.tick, result, payment: null };
    this.interventions[key] = record; this.interventionOrder.push(key);
    // Retain every accepted ID for this world: pruning would let an old retry apply twice.
    // The durable intervention log and snapshot grow with accepted developer actions.
    this.totals.interventions++;
    const ev = this.emit('intervention', { id: req.id, actor, kind: body.type, x: body.x, y: body.y, radius: body.radius, intensity: body.intensity, result });
    this.onRecord?.({ kind: 'intervention', seq: ev.seq, tick: this.tick, record });
    return { ok: true, duplicate: false, record };
  }
  applyEffect(b) {
    const L = this.cfg.interventions, r = this.rng, cap = this.cfg.world.bush.capacity;
    const inR = (o) => Math.hypot(o.x - b.x, o.y - b.y) <= b.radius;
    if (b.type === 'add_food') {
      let budget = Math.round(L.foodUnitsMax * b.intensity), added = 0, created = 0;
      for (const bush of this.bushes) if (inR(bush) && budget > 0) { const a = Math.min(cap - bush.amount, budget, cap); bush.amount += a; budget -= a; added += a; }
      for (let i = 0; i < 6 && budget >= 2; i++) { const t = this.freeTileNear(b.x, b.y, 0, b.radius); if (!t) break; this.bushes.push({ id: this.nextId.bush++, x: t[0], y: t[1], amount: 2, emptySince: null, gift: null }); budget -= 2; added += 2; created++; }
      return { foodAdded: Math.round(added * 10) / 10, bushesCreated: created };
    }
    if (b.type === 'heal_area') {
      let n = 0;
      for (const c of this.creatures) if (inR(c)) { c.health = Math.min(100, c.health + 50 * b.intensity); n++; this.remember(c, 'healed', 'Something healed me.', 0.5); }
      for (const s of this.shelters) if (inR(s)) s.integrity = Math.min(100, s.integrity + 40 * b.intensity);
      let out = 0; for (const f of this.fires) if (Math.hypot(f.x - b.x, f.y - b.y) <= b.radius) { f.left = Math.min(f.left, 5); out++; }
      return { healed: n, firesDoused: out };
    }
    if (b.type === 'fire') {
      const f = { id: this.nextId.fire++, x: b.x, y: b.y, r: b.radius, intensity: b.intensity, left: Math.round(L.fireDuration * b.intensity) + 10 };
      this.fires.push(f); return { fireId: f.id, duration: f.left };
    }
    const s = { id: this.nextId.storm++, x: b.x, y: b.y, r: b.radius, intensity: b.intensity, left: Math.round(L.stormDuration * b.intensity) + 10 };
    this.storms.push(s); return { stormId: s.id, duration: s.left };
  }

  // ---------- metrics / history ----------
  recordHistory() {
    const cs = this.creatures, n = cs.length || 1;
    const sum = (f) => cs.reduce((a, c) => a + f(c), 0);
    const rec = {
      tick: this.tick, pop: cs.length, food: Math.round(this.totalFood() * 10) / 10, bushes: this.bushes.length,
      wood: Math.round(this.trees.reduce((a, t) => a + t.wood, 0)), stone: this.stones.reduce((a, s) => a + s.units, 0),
      shelters: this.shelters.filter((s) => s.stage >= 3).length, births: this.totals.births, deaths: this.totals.deaths,
      avgHunger: Math.round(sum((c) => c.hunger) / n), avgHealth: Math.round(sum((c) => c.health) / n),
    };
    this.history.push(rec); if (this.history.length > this.cfg.world.historyMax) this.history.shift();
  }
  populationMetrics() {
    const cs = this.creatures, st = { infant: 0, juvenile: 0, adult: 0, elder: 0 };
    for (const c of cs) st[this.ageStage(c)]++;
    return { tick: this.tick, status: this.status, population: cs.length, stages: st, food: Math.round(this.totalFood() * 10) / 10, bushes: this.bushes.length, shelters: this.shelters.length, sheltersComplete: this.shelters.filter((s) => s.stage >= 3).length, births: this.totals.births, deaths: this.totals.deaths, deathsByCause: this.totals.deathsByCause, pairs: cs.filter((c) => c.partner).length / 2 };
  }

  // ---------- serialisation ----------
  toState() {
    return {
      id: this.id, resetCount: this.resetCount, seed: this.seed, learning: this.learning, rng: this.rng.s, tick: this.tick, seq: this.seq,
      status: this.status, extinctAt: this.extinctAt, nextId: this.nextId, tiles: Buffer.from(this.tiles).toString('base64'),
      creatures: this.creatures, bushes: this.bushes, trees: this.trees, stones: this.stones, shelters: this.shelters,
      fires: this.fires, storms: this.storms, graveyard: this.graveyard, visitors: this.visitors, vstate: this.vstate ?? {},
      trample: this.trample, paths: this.paths, history: this.history, events: this.events.slice(-500),
      interventions: this.interventions, interventionOrder: this.interventionOrder, interventionTimes: this.interventionTimes, learningLog: this.learningLog ?? [],
      totals: this.totals, createdTick: this.createdTick,
    };
  }
  static fromState(cfg, s) {
    const w = new World(cfg);
    Object.assign(w, structuredClone(s));
    w.rng = new Rng(1); w.rng.s = s.rng >>> 0;
    w.tiles = Uint8Array.from(Buffer.from(s.tiles, 'base64'));
    w.pending = [];
    w.rebuildBlocked();
    return w;
  }
}
