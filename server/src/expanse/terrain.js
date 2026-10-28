// Phase 2B persistent biome chunks. Pure and deterministic: a chunk's initial content depends only on
// (worldSeed, cx, cy). The original 56x56 settlement (tiles, trees, stones, bushes, IDs, coordinates)
// occupies world tiles [0,56)x[0,56) unchanged; everything else is generated lazily in 28x28 chunks.
import { hashSeed, Rng } from '../rng.js';

export const CHUNK = 28;
export const BASE = 56; // original settlement edge
export const T = Object.freeze({ GRASS: 0, LAKE: 1, SEA: 2, SHALLOW: 3, SAND: 4, ROCK: 5, SNOW: 6, CLIFF: 7, FOREST: 8, DUNE: 9, STREAM: 10 });
export const TILE_NAMES = ['grass', 'lake', 'sea', 'shallow', 'sand', 'rock', 'snow', 'cliff', 'forest', 'dune', 'stream'];
// Ticks needed to enter a tile (Infinity = blocked). Designer-defined physics, not learned.
export const MOVE_COST = [1, Infinity, Infinity, 3, 1.5, 2, 2.5, Infinity, 1.2, 1.6, 2];
export const FRESH = new Set([T.LAKE, T.STREAM]); // drinkable when adjacent / on it
export const SALT = new Set([T.SEA, T.SHALLOW]);
export const BIOMES = ['temperate', 'arid', 'cold', 'coast'];
// Base temperature (deg C) and day/night swing per biome.
export const CLIMATE = { temperate: { t: 15, swing: 5 }, arid: { t: 27, swing: 13 }, cold: { t: 1, swing: 4 }, coast: { t: 13, swing: 3 } };
// Resource node kinds: yielded item, initial/max units and exact integer regrowth period (ticks per unit).
export const NODE_KINDS = {
  tree: { item: 'wood', max: 8, regrow: 800, blocks: true },
  bush: { item: 'berry', max: 5, regrow: 300, blocks: false },
  stone: { item: 'stone', max: 12, regrow: 1500, blocks: true },
  flint: { item: 'flint', max: 4, regrow: 3000, blocks: false },
  deadfall: { item: 'stick', max: 4, regrow: 500, blocks: false },
  scrub: { item: 'fiber', max: 4, regrow: 600, blocks: false },
  cactus: { item: 'cactus_fruit', max: 3, regrow: 900, blocks: false },
  shellfish: { item: 'shellfish', max: 4, regrow: 700, blocks: false },
  lichen: { item: 'lichen', max: 3, regrow: 1200, blocks: false },
  driftwood: { item: 'wood', max: 2, regrow: 2000, blocks: false },
};

// ---- deterministic value noise ----
function lattice(seed, ix, iy) { return hashSeed(`${seed}:${ix}:${iy}`) / 4294967296; }
export function noise(seed, x, y, scale) {
  const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = lattice(seed, ix, iy), b = lattice(seed, ix + 1, iy), c = lattice(seed, ix, iy + 1), d = lattice(seed, ix + 1, iy + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
export function biomeAt(seed, x, y) {
  if (x >= 0 && y >= 0 && x < BASE && y < BASE) return 'temperate';
  const dx = x - BASE / 2, dy = y - BASE / 2, r = Math.hypot(dx, dy);
  const n = (k) => (noise(seed + k, x, y, 40) - 0.5) * 50;
  const s = { temperate: 75 - r + n(11), cold: -dy - 20 + n(12), arid: dx - 20 + n(13), coast: (dy - dx) * 0.75 - 20 + n(14) };
  let best = 'temperate'; for (const k of BIOMES) if (s[k] > s[best]) best = k;
  return best;
}
export const chunkKey = (cx, cy) => `${cx},${cy}`;
export const chunkOf = (x, y) => [Math.floor(x / CHUNK), Math.floor(y / CHUNK)];

// Generates the pristine content of a chunk. `base` = { tiles: Uint8Array(56*56), trees, stones, bushes } from the
// preserved Phase 2A settlement; base chunks copy it verbatim (IDs t#, s#, b# keep the original numeric ids).
export function generateChunk(seed, cx, cy, base) {
  const tiles = new Uint8Array(CHUNK * CHUNK), biome = new Array(CHUNK * CHUNK), nodes = [];
  const x0 = cx * CHUNK, y0 = cy * CHUNK;
  const inBase = x0 >= 0 && y0 >= 0 && x0 < BASE && y0 < BASE;
  if (inBase) {
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) { tiles[j * CHUNK + i] = base.tiles[(y0 + j) * BASE + x0 + i]; biome[j * CHUNK + i] = 'temperate'; }
    const own = (o) => o.x >= x0 && o.y >= y0 && o.x < x0 + CHUNK && o.y < y0 + CHUNK;
    for (const t of base.trees.filter(own)) nodes.push({ id: `t${t.id}`, kind: 'tree', x: t.x, y: t.y, units: t.wood, t: 0 });
    for (const s of base.stones.filter(own)) nodes.push({ id: `s${s.id}`, kind: 'stone', x: s.x, y: s.y, units: s.units, t: 0 });
    for (const b of base.bushes.filter(own)) nodes.push({ id: `b${b.id}`, kind: 'bush', x: b.x, y: b.y, units: Math.max(1, Math.round(b.amount)), t: 0 });
    return { cx, cy, tiles, biome, nodes, piles: [], dirty: false };
  }
  const rng = new Rng(hashSeed(`stratoks:chunk:${seed}:${cx}:${cy}`));
  let k = 0;
  const add = (kind, x, y) => nodes.push({ id: `c${cx},${cy}:${k++}`, kind, x, y, units: NODE_KINDS[kind].max, t: 0 });
  for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
    const x = x0 + i, y = y0 + j, b = biomeAt(seed, x, y), e = noise(seed + 101, x, y, 9), e2 = noise(seed + 202, x, y, 5);
    let tile = T.GRASS;
    if (b === 'temperate') tile = e > 0.8 ? T.LAKE : e2 > 0.6 ? T.FOREST : T.GRASS;
    else if (b === 'arid') tile = e > 0.88 ? T.LAKE : e2 > 0.55 ? T.DUNE : T.SAND; // rare oases
    else if (b === 'cold') tile = e > 0.8 ? T.CLIFF : (e > 0.36 && e < 0.4) ? T.STREAM : e2 > 0.5 ? T.SNOW : T.ROCK;
    else { // coast: open sea with islands, joined to land and each other by wadeable shallows
      const land = noise(seed + 303, x, y, 14) + (noise(seed + 404, x, y, 4) - 0.5) * 0.25;
      tile = land > 0.55 ? (e2 > 0.6 ? T.GRASS : T.SAND) : land > 0.42 ? T.SHALLOW : T.SEA;
      if (tile === T.GRASS && e > 0.9) tile = T.LAKE;
    }
    tiles[j * CHUNK + i] = tile; biome[j * CHUNK + i] = b;
    if (MOVE_COST[tile] === Infinity || tile === T.STREAM) continue;
    const r = rng.next();
    if (b === 'temperate') { if (r < (tile === T.FOREST ? 0.14 : 0.03)) add('tree', x, y); else if (r < 0.19) add('bush', x, y); else if (r < 0.21) add('deadfall', x, y); else if (r < 0.215) add('stone', x, y); else if (r < 0.222) add('scrub', x, y); }
    else if (b === 'arid') { if (r < 0.012) add('cactus', x, y); else if (r < 0.022) add('flint', x, y); else if (r < 0.04) add('scrub', x, y); else if (r < 0.045) add('stone', x, y); else if (r < 0.048) add('deadfall', x, y); }
    else if (b === 'cold') { if (r < 0.025) add('stone', x, y); else if (r < 0.04) add('flint', x, y); else if (r < 0.05) add('lichen', x, y); else if (r < 0.065) add('tree', x, y); else if (r < 0.07) add('deadfall', x, y); }
    else if (tile !== T.SHALLOW) { if (r < 0.05) add('shellfish', x, y); else if (r < 0.07) add('driftwood', x, y); else if (r < 0.08) add('scrub', x, y); else if (r < 0.085) add('bush', x, y); else if (r < 0.09) add('stone', x, y); }
  }
  return { cx, cy, tiles, biome, nodes, piles: [], dirty: false };
}

// Exact lazy regrowth: integer units every `regrow` ticks, so evaluating late gives the identical value as per-tick
// evaluation (no approximation error). Burned/removed nodes have units<0 sentinel `dead`.
export function settleNode(n, tick) {
  if (n.dead) return n;
  const k = NODE_KINDS[n.kind];
  if (n.units >= k.max) { n.t = tick; return n; }
  const steps = Math.floor((tick - n.t) / k.regrow);
  if (steps > 0) { n.units = Math.min(k.max, n.units + steps); n.t = n.units >= k.max ? tick : n.t + steps * k.regrow; }
  return n;
}
