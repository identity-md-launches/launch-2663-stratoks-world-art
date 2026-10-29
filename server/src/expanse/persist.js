// Expanse persistence: atomic gzip snapshots with sha256 manifest, generations for rollback, backup/restore,
// and versioned migrations. Everything operates on a data directory; tests use disposable copies only.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Expanse, EXPANSE_SCHEMA } from './engine.js';
import { migrate as migrateLegacy } from '../migrations.js';
import { MEMORY_VERSION } from './agent.js';

export const SNAPSHOT = 'expanse.json.gz';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Expanse migrations: MIGRATIONS[n] upgrades a state from schema n to n+1 in place.
// v1 (first 2B prototype layout) had no warmth/reputation/followers and kept `knownNodes` instead of `mind.known`.
// v2 used the old 10-weight inventory ceiling and had no individual shelter memory.
export const MIGRATIONS = {
  1(s) {
    for (const c of s.creatures ?? []) {
      c.warmth ??= 90; c.reputation ??= {}; c.followers ??= {};
      if (c.knownNodes && c.mind) { c.mind.known = { ...c.knownNodes, ...(c.mind.known ?? {}) }; delete c.knownNodes; }
    }
    s.social ??= []; s.totals.burnedItems ??= {}; s.schema = 2;
  },
  2(s) {
    s.cfg ??= {};
    s.cfg.invCapacity = Math.max(12, s.cfg.invCapacity ?? 12);
    for (const c of s.creatures ?? []) {
      c.energy = Math.max(0, Math.min(100, c.energy ?? 80));
      c.mind ??= {};
      c.mind.shelters ??= [];
      c.mind.memoryVersion = MEMORY_VERSION;
    }
    s.schema = 3;
  },
};
export function migrateExpanse(s) {
  if (s.kind === 'stratoks-expanse') {
    const from = s.schema ?? 1;
    if (from > EXPANSE_SCHEMA) throw new Error(`expanse schema ${from} is newer than this server (${EXPANSE_SCHEMA}); refusing to load`);
    for (let v = from; v < EXPANSE_SCHEMA; v++) MIGRATIONS[v](s);
    s.schema = EXPANSE_SCHEMA;
    return { state: s, from, to: EXPANSE_SCHEMA };
  }
  throw new Error('unknown snapshot kind');
}
// Phase 2A world snapshot ({schemaVersion, state}) -> expanse. Creatures (ids, coordinates, brains incl. mb-v1
// weights, memories, relationships) and the 56x56 terrain/IDs are kept; nothing is reset.
export function fromLegacySnapshot(snap, cfg = {}) {
  const copy = structuredClone(snap);
  const { snap: up } = migrateLegacy(copy);
  const st = up.state;
  // Refuse lossy conversions; the original snapshot is never modified.
  if ((st.fires ?? []).length || (st.storms ?? []).length)
    throw new Error('Wait for active legacy fires/storms to finish before migrating');
  if ((st.shelters ?? []).some(h => h.stage !== 3))
    throw new Error('Unfinished legacy shelters need an explicit migration; refusing data loss');
  const archive = structuredClone(st);
  const homes = new Map((st.shelters ?? []).map(h => [h.id, h]));
  for (const c of st.creatures) {
    const home = homes.get(c.home);
    c.legacyHomeId = c.home;
    c.home = home ? { x: home.x, y: home.y } : { x: Math.round(c.x), y: Math.round(c.y) };
    c.legacyRelationships = structuredClone(c.relationships ?? {});
    c.relationships = Object.fromEntries(Object.entries(c.relationships ?? {}).map(([id, r]) =>
      [id, typeof r === 'number' ? r : r.affinity ?? 0]));
    if (c.pregnant) c.pregnant.father = c.pregnant.father ?? c.pregnant.partner;
    c.inventory ??= {};
    if (c.carrying) {
      const item = c.carrying.type, units = c.carrying.n ?? c.carrying.amount ?? 1;
      if (!['wood', 'stone'].includes(item) || !Number.isFinite(units) || units < 0)
        throw new Error('Unsupported legacy carried resource');
      c.inventory[item] = (c.inventory[item] ?? 0) + units;
    }
  }
  const e = new Expanse(cfg);
  e.initFrom(st.seed, { ...st, legacyTotals: st.totals });
  e.id = st.id;
  // Operator-only historical archive. Never included in public frames/inspectors.
  e.legacyArchive = archive;
  e.totals.imported = {};
  // Imported resource timestamps begin at migration, not at tick zero.
  for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) {
    const ch = e.chunk(cx, cy); ch.dirty = true;
    for (const n of ch.nodes) {
      n.t = st.tick;
      if (n.kind === 'bush') n.units = Math.max(0, Math.floor(st.bushes.find(b => `b${b.id}` === n.id).amount));
    }
  }
  for (const h of st.shelters ?? []) for (const [item, amount] of Object.entries(h.stock ?? {})) {
    if (!['wood', 'stone'].includes(item) || !Number.isFinite(amount) || amount < 0)
      throw new Error('Unsupported legacy shelter stock');
    if (amount) e.dropToPile(h.x, h.y, item, amount);
  }
  e.totals.imported = e.holdings();
  e.history.push({ tick: e.tick, migratedFrom: { schemaVersion: snap.schemaVersion ?? 0, worldId: st.id, creatures: st.creatures.length } });
  return e;
}

function writeAtomic(file, buf) {
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w'); fs.writeSync(fd, buf); fs.fsyncSync(fd); fs.closeSync(fd);
  fs.renameSync(tmp, file);
}
// Saves the snapshot and keeps `keep` previous generations (gen-N) for rollback.
export function save(dir, world, keep = 3) {
  fs.mkdirSync(path.join(dir, 'generations'), { recursive: true });
  const body = zlib.gzipSync(JSON.stringify(world.toState()));
  const file = path.join(dir, SNAPSHOT);
  if (fs.existsSync(file)) {
    const gens = fs.readdirSync(path.join(dir, 'generations')).filter((f) => f.endsWith('.gz')).sort();
    fs.copyFileSync(file, path.join(dir, 'generations', `${String(world.tick).padStart(10, '0')}-${Date.now()}.json.gz`));
    for (const g of gens.slice(0, Math.max(0, gens.length + 1 - keep))) fs.rmSync(path.join(dir, 'generations', g));
  }
  writeAtomic(file, body);
  writeAtomic(path.join(dir, 'manifest.json'), Buffer.from(JSON.stringify({ file: SNAPSHOT, sha256: sha(body), tick: world.tick, schema: EXPANSE_SCHEMA, bytes: body.length }, null, 1)));
  return { bytes: body.length, sha256: sha(body) };
}
export function readState(file) { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); }
export function load(dir, cfgOverride = {}) {
  const file = path.join(dir, SNAPSHOT), man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const body = fs.readFileSync(file);
  if (sha(body) !== man.sha256) throw new Error('snapshot checksum mismatch; restore a backup or roll back');
  const { state } = migrateExpanse(JSON.parse(zlib.gunzipSync(body).toString('utf8')));
  return Expanse.fromState(state, cfgOverride);
}
export function backup(dir, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of [SNAPSHOT, 'manifest.json']) fs.copyFileSync(path.join(dir, f), path.join(dest, f));
  return JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
}
export function restore(backupDir, dir) {
  const man = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
  const body = fs.readFileSync(path.join(backupDir, SNAPSHOT));
  if (sha(body) !== man.sha256) throw new Error('backup checksum mismatch; refusing to restore');
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(path.join(dir, SNAPSHOT))) fs.renameSync(path.join(dir, SNAPSHOT), path.join(dir, `pre-restore-${Date.now()}.json.gz`)); // never deleted
  writeAtomic(path.join(dir, SNAPSHOT), body); writeAtomic(path.join(dir, 'manifest.json'), Buffer.from(JSON.stringify(man, null, 1)));
  return man;
}
// Rollback = make the newest previous generation current again (the replaced snapshot is kept as rolled-back-*).
export function rollback(dir) {
  const gdir = path.join(dir, 'generations'), gens = fs.readdirSync(gdir).filter((f) => f.endsWith('.gz')).sort();
  if (!gens.length) throw new Error('no previous generation to roll back to');
  const prev = gens.at(-1), body = fs.readFileSync(path.join(gdir, prev)), st = JSON.parse(zlib.gunzipSync(body).toString('utf8'));
  fs.renameSync(path.join(dir, SNAPSHOT), path.join(dir, `rolled-back-${Date.now()}.json.gz`));
  writeAtomic(path.join(dir, SNAPSHOT), body);
  writeAtomic(path.join(dir, 'manifest.json'), Buffer.from(JSON.stringify({ file: SNAPSHOT, sha256: sha(body), tick: st.tick, schema: st.schema, bytes: body.length, rolledBackFrom: prev }, null, 1)));
  fs.rmSync(path.join(gdir, prev));
  return { tick: st.tick };
}
