#!/usr/bin/env node
// Copy-migrate a Phase 2A world snapshot into a NEW Phase 2B expanse data directory. Never writes the source.
// usage: node server/bin/expanse-migrate.js <phase2a-data-dir>/world.json <new-expanse-data-dir>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fromLegacySnapshot, save, SNAPSHOT } from '../src/expanse/persist.js';
const [src, dest] = process.argv.slice(2);
if (!src || !dest) { console.error('usage: expanse-migrate.js <world.json> <new-dir>'); process.exit(2); }
if (fs.existsSync(path.join(dest, SNAPSHOT))) { console.error(`${dest} already holds an expanse snapshot; refusing to overwrite`); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
if (raw.sha256 && crypto.createHash('sha256').update(JSON.stringify(raw.state)).digest('hex') !== raw.sha256) { console.error('source checksum mismatch; refusing'); process.exit(1); }
const snap = raw;
const e = fromLegacySnapshot(snap);
const r = save(dest, e);
console.log(JSON.stringify({ migratedCreatures: e.creatures.length, tick: e.tick, ...r }));
