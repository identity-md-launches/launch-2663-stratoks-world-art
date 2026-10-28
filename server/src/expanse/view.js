// Read-only views of the expanse for clients: a bounded viewport, a coarse minimap and a creature inspector.
// These never mutate the world; generating a viewport may materialize pristine chunks deterministically.
import { NODE_KINDS } from './terrain.js';
export const VIEW_VERSION = 1;
const MAX_W = 96, MAX_H = 96;

export function viewport(e, x0, y0, w, h) {
  x0 = Math.round(x0); y0 = Math.round(y0); w = Math.min(MAX_W, Math.max(1, w | 0)); h = Math.min(MAX_H, Math.max(1, h | 0));
  const tiles = new Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) tiles[j * w + i] = e.tile(x0 + i, y0 + j);
  const nodes = e.nodesNear(x0 + (w >> 1), y0 + (h >> 1), Math.max(w, h) >> 1).filter((n) => n.x >= x0 && n.y >= y0 && n.x < x0 + w && n.y < y0 + h).map((n) => [n.id, n.kind, n.x, n.y, n.units]);
  const creatures = e.creaturesNear(x0 + (w >> 1), y0 + (h >> 1), Math.max(w, h) >> 1).map((c) => [c.id, c.name, c.x, c.y, c.act?.prim ?? null, Math.round(c.health)]);
  return { v: VIEW_VERSION, tick: e.tick, x0, y0, w, h, tiles, biome: e.biome(x0 + (w >> 1), y0 + (h >> 1)), nodes, creatures,
    fires: e.fires.filter((f) => f.x >= x0 && f.y >= y0 && f.x < x0 + w && f.y < y0 + h).map((f) => [f.id, f.x, f.y]),
    shelters: e.shelters.filter((s) => s.x >= x0 && s.y >= y0 && s.x < x0 + w && s.y < y0 + h).map((s) => [s.id, s.x, s.y]) };
}
// Minimap: biome letter per generated chunk only (unvisited chunks are not revealed or generated).
export function minimap(e) { return { v: VIEW_VERSION, ...e.extentChunks(), chunks: [...e.chunks.values()].map((c) => [c.cx, c.cy, c.biome[392][0]]) }; }
export function inspect(e, id) {
  const c = e.getCreature(id); if (!c) return null;
  const m = c.mind;
  return { v: VIEW_VERSION, id: c.id, name: c.name, age: c.age, x: c.x, y: c.y, needs: { hunger: r(c.hunger), thirst: r(c.thirst), energy: r(c.energy), health: r(c.health), warmth: r(c.warmth), injury: c.injury },
    inventory: c.inventory, personality: c.personality, observation: c.lastObs ?? null,
    currentPlan: c.plan ? { id: c.plan.id, source: c.plan.source, steps: c.plan.steps, predicted: c.plan.predicted, actual: c.plan.actual, utility: c.plan.utility, mbPreference: c.plan.mbPreference } : null,
    recentPlans: m.plans, episodes: m.episodes.slice(-12), knownNodes: Object.keys(m.known).length, knownWater: m.water, discoveries: m.discoveries,
    modelEntries: Object.keys(m.model).length, mbUpdates: c.brain.mb?.updates ?? 0, mode: e.mode, learning: e.learning && e.mode !== 'frozen',
    relationships: c.relationships, reputation: c.reputation, following: c.following,
    note: 'Learned: outcome model + mb-v1 weights. Designed: physics, primitives, reflexes, drives, planner search. Not a complete fly brain.' };
}
const r = (v) => Math.round(v * 10) / 10;
export { NODE_KINDS };
