// Rendering-facing projection of the world. The simulation never depends on this module.
import { shortAddr } from './wallet.js';
const r2 = (n) => Math.round(n * 100) / 100, r1 = (n) => Math.round(n * 10) / 10;

export function compactCreature(w, c) {
  return {
    k: `c:${c.id}`, id: c.id, name: c.name, sex: c.sex, x: r2(c.x), y: r2(c.y), face: c.face, act: c.act ? (c.act.type === 'MATE_WAIT' ? 'MATE' : c.act.type) : 'IDLE',
    phase: c.act?.phase ?? null, stage: w.ageStage(c), age: c.age, hunger: Math.round(c.hunger), energy: Math.round(c.energy), health: Math.round(c.health),
    carry: c.carrying ? c.carrying.type : null, inside: c.inside, home: c.home, partner: c.partner, pregnant: !!c.pregnant,
    bubble: c.bubble ? { text: c.bubble.text, emote: c.bubble.emote, kind: 'template', tpl: c.bubble.tpl, cause: c.bubble.cause } : null,
  };
}
export function buildView(w) {
  const m = new Map();
  for (const c of w.creatures) m.set(`c:${c.id}`, compactCreature(w, c));
  for (const b of w.bushes) m.set(`b:${b.id}`, { k: `b:${b.id}`, kind: 'bush', x: b.x, y: b.y, amount: r1(b.amount), gift: !!b.gift });
  for (const t of w.trees) m.set(`t:${t.id}`, { k: `t:${t.id}`, kind: 'tree', x: t.x, y: t.y, wood: Math.floor(t.wood) });
  for (const s of w.stones) m.set(`s:${s.id}`, { k: `s:${s.id}`, kind: 'stone', x: s.x, y: s.y, units: Math.floor(s.units) });
  for (const s of w.shelters) m.set(`h:${s.id}`, { k: `h:${s.id}`, kind: 'shelter', x: s.x, y: s.y, stage: s.stage, progress: s.progress, integrity: Math.round(s.integrity), stock: s.stock, residents: s.residents.length });
  for (const f of w.fires) m.set(`f:${f.id}`, { k: `f:${f.id}`, kind: 'fire', x: f.x, y: f.y, r: f.r, intensity: f.intensity, left: f.left });
  for (const s of w.storms) m.set(`z:${s.id}`, { k: `z:${s.id}`, kind: 'storm', x: s.x, y: s.y, r: s.r, intensity: s.intensity, left: s.left });
  for (const [a, v] of Object.entries(w.visitors)) m.set(`v:${a}`, { k: `v:${a}`, kind: 'visitor', wallet: shortAddr(a), x: r1(v.x), y: r1(v.y) });
  for (const k of Object.keys(w.paths)) { const [x, y] = k.split(',').map(Number); m.set(`p:${k}`, { k: `p:${k}`, kind: 'path', x, y }); }
  return m;
}
export function tileRows(w) {
  const rows = [];
  for (let y = 0; y < w.H; y++) { let s = ''; for (let x = 0; x < w.W; x++) s += w.tiles[y * w.W + x] ? 'w' : 'g'; rows.push(s); }
  return rows;
}
export function worldMeta(w, cfg) {
  return { worldId: w.id, status: w.status, extinctAt: w.extinctAt, width: w.W, height: w.H, tick: w.tick, seq: w.seq, tickMs: cfg.world.tickMs, learning: w.learning, ...w.populationMetrics() };
}
export function creatureDetail(w, c) {
  const name = (id) => w.getCreature(id)?.name ?? w.graveyard.find((g) => g.id === id)?.name ?? `#${id}`;
  return {
    ...compactCreature(w, c), bornTick: c.bornTick, lifespan: c.lifespan, personality: c.personality, generation: c.generation, parents: c.parents.map((p) => ({ id: p, name: name(p) })),
    cooldown: c.cooldown, stats: c.stats,
    relationships: Object.entries(c.relationships).map(([id, r]) => ({ id: Number(id), name: name(Number(id)), ...r, affinity: r2(r.affinity) })).sort((a, b) => Math.abs(b.affinity) - Math.abs(a.affinity)),
    memories: c.memories.slice(-20).reverse(), decisions: c.decisions.slice().reverse(), speech: c.speech.slice().reverse(),
    walletOpinions: Object.entries(c.brain.wallets).map(([a, e]) => ({ wallet: shortAddr(a), value: r2(e.v), interactions: e.n, lastTick: e.last })),
    knownFood: c.places.food.length,
    learning: { enabled: w.learning, updates: c.brain.updates, meanReward: c.brain.rewardN ? r2(c.brain.rewardSum / c.brain.rewardN) : 0, topWeights: topWeights(c) },
    note: 'Speech bubbles are template-generated from simulation events; they are not model output.',
  };
}
function topWeights(c) {
  return Object.fromEntries(Object.entries(c.brain.w).map(([a, p]) => [a, p.map(r2)]));
}
