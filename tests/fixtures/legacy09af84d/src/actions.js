// Creature perception, decision (learned utilities + softmax) and action execution.
import { ACTIONS, NF, utility, visitorUtility, softmaxPick, learn, updateWallet, walletValue, clamp } from './brain.js';

const CARRY_CAP = 3, SPEED = 0.4;
const GATHER_TICKS = 10, EAT_TICKS = 4, BUILD_CHUNK = 25, SOCIAL_TICKS = 12, MATE_TICKS = 15;

export function stagesCost(cfg) {
  const { stone, wood } = cfg.world.shelterCost, w1 = Math.ceil(wood * 2 / 3);
  return [{ stone }, { wood: w1 }, { wood: wood - w1 }];
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function perceive(w, c) {
  const R = w.cfg.world.perceptionRadius;
  for (const b of w.bushes) {
    if (dist(c, b) > R) continue;
    let m = c.places.food.find((p) => p.id === b.id);
    if (!m) { m = { id: b.id, x: b.x, y: b.y, amount: 0, tick: 0 }; c.places.food.push(m); if (c.places.food.length > 10) { c.places.food.sort((p, q) => q.tick - p.tick); c.places.food.length = 10; } }
    m.amount = b.amount; m.tick = w.tick;
  }
  c.places.food = c.places.food.filter((m) => m.tick === w.tick || w.bushes.some((b) => b.id === m.id));
}
function nearestFood(w, c) {
  let best = null, bd = Infinity;
  for (const m of c.places.food) {
    if (m.amount < 0.5) continue;
    const d = dist(c, m); if (d < bd) { bd = d; best = m; }
  }
  return best ? { m: best, d: bd } : null;
}
function nearest(list, c, ok = () => true) {
  let best = null, bd = Infinity;
  for (const o of list) { if (!ok(o)) continue; const d = dist(c, o); if (d < bd) { bd = d; best = o; } }
  return best ? { o: best, d: bd } : null;
}
function siteDeficit(w, s) { // remaining materials still to be deposited for a site
  const st = stagesCost(w.cfg), need = { wood: 0, stone: 0 };
  for (let i = s.stage; i < 3; i++) { if (s.paid[i]) continue; for (const k of Object.keys(st[i])) need[k] += st[i][k]; }
  need.wood = Math.max(0, need.wood - s.stock.wood); need.stone = Math.max(0, need.stone - s.stock.stone);
  return need;
}
function shelterDemand(w) {
  const adults = w.creatures.filter((c) => w.isAdult(c)).length, cap = w.cfg.world.shelterCapacity;
  return adults > w.shelters.length * (cap - 1); // keep one slot per shelter free for offspring
}
function openSite(w, c) { return nearest(w.shelters, c, (s) => s.stage < 3)?.o ?? null; }
function repairTarget(w, c) { const h = w.getShelter(c.home); return h && h.stage >= 3 && h.integrity < 60 ? h : null; }

// ---------- decision ----------
export function decide(w, c) {
  const cfg = w.cfg.world;
  perceive(w, c);
  const adult = w.isAdult(c);
  const haz = w.hazardAt(c);
  const food = nearestFood(w, c);
  const site = adult ? openSite(w, c) : null;
  const repair = adult ? repairTarget(w, c) : null;
  const others = w.creatures.filter((o) => o !== c);
  const near = nearest(others, c);
  const vis = nearestVisitor(w, c);
  const f = new Array(NF).fill(0);
  f[0] = c.hunger / 100; f[1] = 1 - c.energy / 100; f[2] = 1 - c.health / 100;
  f[3] = food ? 1 / (1 + food.d / 6) : 0; f[4] = food ? 1 : 0;
  f[5] = c.home ? 0 : 1; f[6] = c.carrying ? 1 : 0;
  f[7] = site || repair ? 1 : 0;
  f[8] = near ? 1 / (1 + near.d / 6) : 0; f[9] = haz.danger; f[10] = haz.storm; f[11] = near && near.d < 15 ? 0 : 1;

  const cand = [];
  const add = (a, extra) => cand.push({ a, u: extra?.u ?? utility(c.brain, a, f), ...extra });
  if (haz.danger > 0.3) add('FLEE', { u: utility(c.brain, 'FLEE', f) });
  if (food) add('EAT', { food });
  if (c.hunger > 97 && !food) { /* nothing known: must explore */ }
  add('REST');
  if (adult) {
    const wantMat = (k) => (!c.carrying || c.carrying.type === k) && (c.carrying?.n ?? 0) < CARRY_CAP && (
      (site ? siteDeficit(w, site)[k] > 0 : (shelterDemand(w) && w.shelters.length < 40 && (k === 'wood' ? true : true))) || (repair && k === 'wood' && repair.stock.wood < 1));
    if (wantMat('wood') && w.trees.some((t) => t.wood >= 1)) add('GATHER_WOOD');
    if (wantMat('stone') && w.stones.some((t) => t.units >= 1)) add('GATHER_STONE');
    const carries = c.carrying?.n > 0;
    const usefulCarry = carries && (site ? siteDeficit(w, site)[c.carrying.type] > 0 : (repair ? c.carrying.type === 'wood' : shelterDemand(w)));
    const stockOk = site && canWork(w, site);
    if (usefulCarry || stockOk || (repair && repair.stock.wood >= 1)) add('BUILD', { site, repair });
    const mate = mateTarget(w, c);
    if (mate) add('MATE', { mate });
  }
  if (near) add('SOCIALIZE', { target: preferredCompany(w, c, others) ?? near.o });
  add('WANDER');
  if (vis) {
    const v = walletValue(c.brain, vis.addr);
    add('APPROACH', { vis, u: visitorUtility(c.brain, 'APPROACH', v) });
    add('AVOID', { vis, u: visitorUtility(c.brain, 'AVOID', v) });
  }
  // emergencies override choice (hard-wired survival reflexes, not learned)
  let pick;
  if (haz.danger > 0.8) pick = cand.find((x) => x.a === 'FLEE');
  else if (c.hunger >= 55 && !food && !haz.danger) pick = { a: 'WANDER', u: utility(c.brain, 'WANDER', f), far: true }; // foraging search when no known food
  else if (c.hunger >= 80 && food) pick = cand.find((x) => x.a === 'EAT'); // survival reflex: learning cannot talk a creature out of eating when starving
  else if (c.energy < 8) pick = cand.find((x) => x.a === 'REST');
  else pick = softmaxPick(w.rng, cand, cfg.temperature);
  startAct(w, c, pick, f);
}

function nearestVisitor(w, c) {
  let best = null, bd = Infinity;
  for (const [addr, v] of Object.entries(w.visitors)) { const d = dist(c, v); if (d <= w.cfg.world.visitor.radius * 1.5 && d < bd) { bd = d; best = { addr, x: v.x, y: v.y, d }; } }
  return best;
}
function preferredCompany(w, c, others) {
  if (c.partner) { const p = others.find((o) => o.id === c.partner); if (p) return p; }
  let best = null, bs = -Infinity;
  for (const o of others) { const d = dist(c, o); if (d > 25) continue; const s = (c.relationships[o.id]?.affinity ?? 0) * 3 - d / 10 + (!c.partner && w.isAdult(c) && w.isAdult(o) && !o.partner && o.sex !== c.sex ? 1.5 : 0); if (s > bs) { bs = s; best = o; } }
  return best;
}
function canWork(w, s) {
  if (s.stage >= 3) return false;
  const cost = stagesCost(w.cfg)[s.stage];
  if (s.paid[s.stage]) return true;
  return Object.keys(cost).every((k) => s.stock[k] >= cost[k]);
}
function mateTarget(w, c) {
  const cfg = w.cfg.world;
  if (!c.partner || c.cooldown > 0 || c.pregnant || w.status !== 'alive' || w.catchup) return null;
  const p = w.getCreature(c.partner);
  if (!p || !eligible(w, c) || !eligible(w, p) || p.pregnant) return null;
  if (c.sex === p.sex) return null;
  alignHomes(w, c, p);
  const home = w.getShelter(c.home);
  if (!home || home.stage < 3 || home.integrity < 30 || p.home !== c.home) return null;
  if (home.residents.length >= cfg.shelterCapacity) return null;
  if (w.totalFood() / Math.max(1, w.creatures.length) < cfg.foodPerCapitaMin) return null;
  return p;
}
function alignHomes(w, c, p) { // bonded pair shares a home when a shelter has room
  const cap = w.cfg.world.shelterCapacity;
  if (c.home && c.home === p.home) { // crowded home: the pair moves to a shelter with room for them plus offspring
    const h = w.getShelter(c.home);
    if (h && h.residents.length >= cap) {
      const alt = nearest(w.shelters, c, (x) => x.stage >= 3 && x.integrity > 40 && x.residents.length <= cap - 3)?.o;
      if (alt) for (const m of [c, p]) { h.residents = h.residents.filter((i) => i !== m.id); alt.residents.push(m.id); m.home = alt.id; }
    }
    return;
  }
  const room = (id) => { const h = w.getShelter(id); return h && h.stage >= 3 && h.residents.length < cap ? h : null; };
  const leave = (x) => { const o = w.getShelter(x.home); if (o) o.residents = o.residents.filter((i) => i !== x.id); x.home = null; };
  const target = room(c.home) && (!p.home || true) ? room(c.home) : room(p.home);
  const mover = target && target.id === c.home ? p : c;
  if (!target || (mover.home === target.id)) return;
  leave(mover); target.residents.push(mover.id); mover.home = target.id;
}
function eligible(w, x) {
  const cfg = w.cfg.world;
  return w.isAdult(x) && x.cooldown <= 0 && x.hunger < cfg.mateHungerMax && x.health > 60 && x.energy > 40;
}

function startAct(w, c, pick, f) {
  const a = pick.a;
  c.act = { type: a, phase: 'go', t: 0, f, u: pick.u, start: { h: c.hunger, e: c.energy, hp: c.health, tick: w.tick }, bonus: 0, path: [], tgt: null };
  c.stats.decisions++;
  const act = c.act;
  const goto = (x, y, adj) => { const p = w.findPath(c.x, c.y, x, y, adj); if (p === null) { return false; } act.path = p; act.tgt = [x, y]; return true; };
  let ok = true;
  switch (a) {
    case 'EAT': act.bush = pick.food.m.id; ok = goto(pick.food.m.x, pick.food.m.y, false); break;
    case 'REST': {
      const h = w.getShelter(c.home);
      if (h && h.stage >= 3) { act.shelter = h.id; ok = goto(h.x, h.y, true); } break;
    }
    case 'GATHER_WOOD': case 'GATHER_STONE': {
      const list = a === 'GATHER_WOOD' ? w.trees.filter((t) => t.wood >= 1) : w.stones.filter((t) => t.units >= 1);
      const n = nearest(list, c).o; act.node = n.id; ok = goto(n.x, n.y, true); break;
    }
    case 'BUILD': {
      let s = pick.repair && !(pick.site && (c.carrying && pick.site)) ? pick.repair : pick.site;
      if (pick.site) s = pick.site; else if (pick.repair) { s = pick.repair; act.repair = true; }
      if (!s) { s = createSite(w, c); if (!s) { ok = false; break; } }
      act.shelter = s.id; ok = goto(s.x, s.y, true); break;
    }
    case 'SOCIALIZE': act.other = pick.target.id; ok = goto(pick.target.x, pick.target.y, true); break;
    case 'MATE': act.other = pick.mate.id; ok = goto(pick.mate.x, pick.mate.y, true); break;
    case 'WANDER': {
      const t = pick.far ? w.freeTileNear(c.x, c.y, 10, 22) : w.freeTileNear(c.x, c.y, 4, 12); ok = !!t && goto(t[0], t[1], false); break;
    }
    case 'FLEE': {
      let best = null, bd = -1;
      for (let k = 0; k < 8; k++) {
        const ang = k * Math.PI / 4, tx = Math.round(c.x + Math.cos(ang) * 9), ty = Math.round(c.y + Math.sin(ang) * 9);
        if (!w.walkable(tx, ty)) continue;
        let d = 0; for (const fr of w.fires) d += Math.hypot(tx - fr.x, ty - fr.y); if (d > bd) { bd = d; best = [tx, ty]; }
      }
      ok = !!best && goto(best[0], best[1], false); act.speed = 1.5; break;
    }
    case 'APPROACH': act.addr = pick.vis.addr; ok = goto(Math.round(pick.vis.x), Math.round(pick.vis.y), true); {
      const v = walletValue(c.brain, pick.vis.addr);
      if (v > 0.3) w.say(c, 'friend_visitor', 'friendly_wallet');
    } break;
    case 'AVOID': {
      act.addr = pick.vis.addr; const dx = c.x - pick.vis.x, dy = c.y - pick.vis.y, d = Math.hypot(dx, dy) || 1;
      let tx = Math.round(c.x + dx / d * 8), ty = Math.round(c.y + dy / d * 8);
      const t = w.freeTileNear(tx, ty, 0, 3); ok = !!t && goto(t[0], t[1], false); act.speed = 1.3;
      if (walletValue(c.brain, pick.vis.addr) < -0.3) w.say(c, 'wary_visitor', 'harmful_wallet');
    } break;
  }
  if (!ok) { act.bonus -= 0.2; act.failed = true; act.phase = 'fail'; }
  c.decisions.push({ tick: w.tick, action: a, utility: Math.round(pick.u * 100) / 100, why: top3(c, f, pick.u), hunger: Math.round(c.hunger), energy: Math.round(c.energy) });
  if (c.decisions.length > w.cfg.world.decisionLog) c.decisions.shift();
  c.inside = false;
}
function top3(c, f, u) { return FEATURE_NAMES.map((n, i) => [n, f[i]]).filter(([, v]) => v > 0.4).slice(0, 4).map(([n, v]) => `${n}=${v.toFixed(2)}`); }
import { FEATURES as FEATURE_NAMES } from './brain.js';

function createSite(w, c) {
  const cfg = w.cfg.world;
  const homes = w.shelters.length ? w.shelters : null;
  const ax = homes ? homes.reduce((s, h) => s + h.x, 0) / homes.length : w.W / 2, ay = homes ? homes.reduce((s, h) => s + h.y, 0) / homes.length : w.H / 2;
  const t = w.freeTileNear(ax, ay, 2, 9) ?? w.freeTileNear(c.x, c.y, 2, 8);
  if (!t) return null;
  const s = { id: w.nextId.shelter++, x: t[0], y: t[1], stage: 0, progress: 0, integrity: 100, stock: { wood: 0, stone: 0 }, paid: [false, false, false], residents: [], builders: [c.id], startedTick: w.tick };
  w.shelters.push(s); w.blocked[w.idx(s.x, s.y)] = 1;
  w.remember(c, 'build_start', 'I started a new shelter.', 0.3, { shelter: s.id });
  w.say(c, 'build_start', 'build');
  w.emit('shelter_started', { id: s.id, x: s.x, y: s.y, by: c.id });
  return s;
}

// ---------- execution ----------
function arrive(w, c) { // trample
  const k = Math.round(c.x) + ',' + Math.round(c.y);
  const n = (w.trample[k] = (w.trample[k] ?? 0) + 1);
  if (n === 40 && !w.paths[k]) w.paths[k] = 1;
}
function move(w, c, act) {
  if (!act.path.length) return true;
  const [tx, ty] = act.path[0];
  const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
  const sp = SPEED * (act.speed ?? 1) * (w.paths[tx + ',' + ty] ? 1.3 : 1);
  if (dx) c.face = dx > 0 ? 1 : -1;
  c.energy = Math.max(0, c.energy - 0.03 * (act.speed ?? 1));
  if (d <= sp) { c.x = tx; c.y = ty; act.path.shift(); arrive(w, c); } else { c.x += dx / d * sp; c.y += dy / d * sp; }
  return act.path.length === 0;
}

export function stepAct(w, c) {
  const act = c.act, h = w.hazardAt(c);
  if (act.type !== 'FLEE' && h.danger > 0.5) { act.bonus -= 0.2; return endAct(w, c, 'interrupted'); }
  if (act.phase === 'fail') return endAct(w, c, 'failed');
  if (act.phase === 'go') {
    if (!move(w, c, act)) return;
    act.phase = 'do'; act.t = 0;
    if (!onArrive(w, c, act)) return;
  }
  doPhase(w, c, act);
}

function onArrive(w, c, act) {
  switch (act.type) {
    case 'EAT': {
      const b = w.getBush(act.bush); const m = c.places.food.find((p) => p.id === act.bush);
      if (!b || b.amount < 0.5) { if (m) m.amount = 0; c.places.food = c.places.food.filter((p) => p.id !== act.bush); w.say(c, 'food_gone', 'food_gone'); w.remember(c, 'food_gone', 'A bush I went to was empty.', -0.3, {}); act.bonus -= 0.4; endAct(w, c, 'failed'); return false; }
      return true;
    }
    case 'GATHER_WOOD': case 'GATHER_STONE': {
      const n = act.type === 'GATHER_WOOD' ? w.trees.find((t) => t.id === act.node) : w.stones.find((t) => t.id === act.node);
      if (!n || (n.wood ?? n.units) < 1) { act.bonus -= 0.2; endAct(w, c, 'failed'); return false; }
      return true;
    }
    case 'BUILD': {
      const s = w.getShelter(act.shelter); if (!s) { endAct(w, c, 'failed'); return false; }
      if (c.carrying) { s.stock[c.carrying.type] += c.carrying.n; act.bonus += 0.25 * c.carrying.n; c.carrying = null; }
      if (!s.builders.includes(c.id)) s.builders.push(c.id);
      return true;
    }
    case 'MATE': {
      const p = w.getCreature(act.other);
      if (!p || Math.hypot(p.x - c.x, p.y - c.y) > 3 || !mateTarget(w, c)) { act.bonus -= 0.2; endAct(w, c, 'failed'); return false; }
      if (p.act && p.act.type !== 'MATE_WAIT') { p.act = { type: 'MATE_WAIT', phase: 'do', t: 0, f: p.act.f, u: p.act.u, start: { h: p.hunger, e: p.energy, hp: p.health, tick: w.tick }, bonus: 0, path: [], skipLearn: true }; }
      else if (!p.act) p.act = { type: 'MATE_WAIT', phase: 'do', t: 0, f: new Array(NF).fill(0), u: 0, start: { h: p.hunger, e: p.energy, hp: p.health, tick: w.tick }, bonus: 0, path: [], skipLearn: true };
      return true;
    }
    case 'REST': c.inside = !!act.shelter; return true;
    case 'APPROACH': return true;
    default: return true;
  }
}

function doPhase(w, c, act) {
  const cfg = w.cfg.world;
  act.t++;
  switch (act.type) {
    case 'MATE_WAIT': if (act.t >= MATE_TICKS + 2) { c.act = null; } return;
    case 'EAT': {
      if (act.t % EAT_TICKS !== 0) return;
      const b = w.getBush(act.bush);
      if (!b || b.amount < 0.1) return endAct(w, c, 'done');
      const unit = Math.min(1, b.amount); b.amount -= unit;
      c.hunger = Math.max(0, c.hunger - 25 * unit); c.stats.eaten += unit; w.totals.eaten += unit;
      act.bonus += 0.1;
      if (b.gift) {
        act.bonus += 0.6; w.say(c, 'thanks', 'gift_food');
        if (w.learning) updateWallet(c.brain, b.gift, 1, 0.5, w.tick);
        w.remember(c, 'gift_eaten', `I ate food left by ${b.gift.slice(0, 6)}….`, 0.7, { wallet: b.gift });
      } else if (act.t === EAT_TICKS) w.say(c, 'eat', 'eat');
      if (c.hunger < 15 || b.amount < 0.1) { w.remember(c, 'ate', 'I ate berries.', 0.3); return endAct(w, c, 'done'); }
      return;
    }
    case 'REST': {
      const inH = c.inside; c.energy = Math.min(100, c.energy + (inH ? 0.25 : 0.1));
      if (inH) c.health = Math.min(100, c.health + 0.03);
      if (act.t === 5) w.say(c, c.energy < 30 ? 'tired' : 'rest', 'rest');
      if (c.energy >= 90 || act.t > 250 || c.hunger > 88) { if (c.energy >= 90) act.bonus += 0.1; return endAct(w, c, 'done'); }
      return;
    }
    case 'GATHER_WOOD': case 'GATHER_STONE': {
      c.energy = Math.max(0, c.energy - 0.05);
      if (act.t % GATHER_TICKS !== 0) return;
      const wood = act.type === 'GATHER_WOOD', n = wood ? w.trees.find((t) => t.id === act.node) : w.stones.find((t) => t.id === act.node);
      const key = wood ? 'wood' : 'units';
      if (!n || n[key] < 1) return endAct(w, c, 'done');
      n[key] -= 1; if (n[key] < 1 && n[key] > 0) n[key] = 0; if (n[key] === 0) w.blocked[w.idx(n.x, n.y)] = 0;
      const type = wood ? 'wood' : 'stone';
      c.carrying = { type, n: (c.carrying?.n ?? 0) + 1 }; c.stats.gathered++; act.bonus += 0.3;
      if (act.t === GATHER_TICKS) w.say(c, 'gather', 'gather');
      if (c.carrying.n >= CARRY_CAP || n[key] < 1) { w.remember(c, 'gather', `I collected ${type}.`, 0.2); return endAct(w, c, 'done'); }
      return;
    }
    case 'BUILD': return buildTick(w, c, act);
    case 'SOCIALIZE': {
      const o = w.getCreature(act.other);
      if (!o) return endAct(w, c, 'failed');
      if (dist(c, o) > 4) { act.path = w.findPath(c.x, c.y, o.x, o.y, true) ?? []; act.phase = 'go'; if (act.t > 60) return endAct(w, c, 'failed'); return; }
      if (act.t >= SOCIAL_TICKS) {
        const aff = c.relationships[o.id]?.affinity ?? 0;
        w.relate(c, o, 0.12); c.stats.social++; act.bonus += 0.3;
        if (act.t === SOCIAL_TICKS && !c.partner && !o.partner && w.isAdult(c) && w.isAdult(o) && c.sex !== o.sex && aff + 0.12 >= 0.3) {
          c.partner = o.id; o.partner = c.id; w.relate(c, o, 0.1, 'bond');
          w.emit('bond', { a: c.id, b: o.id }); w.say(c, 'bond', 'bond'); w.say(o, 'bond', 'bond');
          w.remember(c, 'bond', `I bonded with ${o.name}.`, 0.9, { other: o.id }); w.remember(o, 'bond', `I bonded with ${c.name}.`, 0.9, { other: c.id });
          act.bonus += 1;
        } else if (aff > 0.2) w.say(c, 'greet', 'social');
        if (!c.home) assignHome(w, c, o);
        return endAct(w, c, 'done');
      }
      return;
    }
    case 'MATE': {
      const p = w.getCreature(act.other);
      if (!p || !mateOk(w, c, p)) return endAct(w, c, 'failed');
      if (act.t >= MATE_TICKS) {
        const f = c.sex === 'F' ? c : p, m = f === c ? p : c;
        // reproduction cost: parental hunger/energy plus food provisioning removed from nearby bushes
        let need = 2; for (const b of [...w.bushes].sort((a, b2) => dist(f, a) - dist(f, b2))) { const t = Math.min(need, b.amount); b.amount -= t; need -= t; if (need <= 0) break; }
        f.hunger = Math.min(100, f.hunger + 20); m.hunger = Math.min(100, m.hunger + 8); f.energy -= 25; m.energy -= 20;
        f.cooldown = m.cooldown = cfg.reproCooldown; f.pregnant = { partner: m.id, due: w.tick + cfg.gestation };
        w.emit('pregnancy', { mother: f.id, father: m.id }); w.say(c, 'mate', 'mate');
        w.remember(c, 'mate', 'We are expecting a child.', 0.8, { other: p.id }); w.remember(p, 'mate', 'We are expecting a child.', 0.8, { other: c.id });
        act.bonus += 1; return endAct(w, c, 'done');
      }
      return;
    }
    case 'WANDER': act.bonus += 0; return endAct(w, c, 'done');
    case 'FLEE': return endAct(w, c, 'done');
    case 'APPROACH': {
      if (act.t >= 15) { return endAct(w, c, 'done'); }
      return;
    }
    case 'AVOID': return endAct(w, c, 'done');
  }
  endAct(w, c, 'done');
}
function mateOk(w, c, p) { return mateTargetFor(w, c, p); }
function mateTargetFor(w, c, p) { return p.pregnant == null && c.pregnant == null && eligible(w, c) && eligible(w, p) && w.status === 'alive' && !w.catchup; }

function assignHome(w, c, other) {
  const cap = w.cfg.world.shelterCapacity;
  const h = nearest(w.shelters, c, (s) => s.stage >= 3 && s.residents.length < cap)?.o;
  if (!h) return;
  h.residents.push(c.id); c.home = h.id;
}

function buildTick(w, c, act) {
  const s = w.getShelter(act.shelter);
  if (!s) return endAct(w, c, 'failed');
  c.energy = Math.max(0, c.energy - 0.05);
  const st = stagesCost(w.cfg);
  if (s.stage >= 3) { // repair: costs 1 wood per 30 integrity
    if (act.t === 1) { if (s.stock.wood >= 1 && s.integrity < 90) { s.stock.wood -= 1; act.repairing = true; } else return endAct(w, c, 'done'); }
    if (act.t >= 10) { s.integrity = Math.min(100, s.integrity + 30); act.bonus += 0.5; w.remember(c, 'repair', 'I repaired our shelter.', 0.4); return endAct(w, c, 'done'); }
    return;
  }
  if (!s.paid[s.stage]) {
    const cost = st[s.stage];
    if (!Object.keys(cost).every((k) => s.stock[k] >= cost[k])) { act.bonus -= 0.1; return endAct(w, c, 'done'); } // waiting for materials
    for (const k of Object.keys(cost)) s.stock[k] -= cost[k];
    s.paid[s.stage] = true;
  }
  const per = w.cfg.world.shelterWork / 3;
  s.progress++; act.bonus += 0.02; c.stats.built += 0.01;
  if (s.progress >= per * (s.stage + 1)) {
    s.stage++; act.bonus += 0.5;
    w.emit('shelter_stage', { id: s.id, stage: s.stage, x: s.x, y: s.y, by: c.id });
    if (s.stage >= 3) {
      w.totals.sheltersBuilt++; c.stats.built++;
      w.emit('shelter_complete', { id: s.id, x: s.x, y: s.y, by: c.id });
      w.say(c, 'build_done', 'build_done'); w.remember(c, 'build_done', 'A shelter was finished.', 0.8, { shelter: s.id });
      for (const bid of s.builders) { const b = w.getCreature(bid); if (b && !b.home && s.residents.length < w.cfg.world.shelterCapacity) { b.home = s.id; s.residents.push(b.id); } }
      if (c.partner) { const p = w.getCreature(c.partner); if (p && !p.home && s.residents.length < w.cfg.world.shelterCapacity) { p.home = s.id; s.residents.push(p.id); } }
    } else w.say(c, 'build_stage', 'build_stage');
    return endAct(w, c, 'done');
  }
  if (act.t >= BUILD_CHUNK) endAct(w, c, 'done');
}

// reward = need improvement + task bonus; learning update; clears the act
export function endAct(w, c, outcome) {
  const act = c.act; c.act = null;
  if (!act) return;
  const cfg = w.cfg.world;
  if (act.skipLearn || act.type === 'MATE_WAIT') return;
  const dh = act.start.h - c.hunger, de = c.energy - act.start.e, dhp = c.health - act.start.hp;
  const dur = Math.max(1, w.tick - act.start.tick);
  let r = dh / 25 + de / 40 + dhp / 20 + act.bonus - 0.002 * dur;
  if (outcome === 'failed') r -= 0.2;
  if (act.type === 'FLEE' && !w.damagedNow.has(c.id)) r += 0.4;
  r = clamp(r, -2, 2);
  if (w.learning && !w.catchup) learn(c.brain, act.type, act.f, act.u, r, cfg.learningRate);
  else { c.brain.rewardSum += r; c.brain.rewardN++; }
}
