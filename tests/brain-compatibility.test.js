import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Service as LegacyService } from './fixtures/legacy09af84d/src/service.js';
import { World } from '../server/src/world.js';
import { Service } from '../server/src/service.js';
import { DEFAULTS, deepMerge } from '../server/src/config.js';
import { exportLegacyBackup } from '../server/src/rollback.js';
import { restoreBackup } from '../server/src/store.js';
import { runTicks, testConfig, tmpDir } from './helpers.js';
import { starvationCorrectedLegacy } from './fixtures/legacy-starvation-reference.mjs';
const canonical = state => {
  const s = structuredClone(state); delete s.brainMode;
  for (const c of s.creatures) {
    delete c.brain.version; delete c.brain.inspection;
    if (c.act) for (const key of ['brainMode', 'trace', 'decisionSource']) delete c.act[key];
  }
  return s;
};

test('legacy matches recovered engine over 4000 ticks with only the specified starvation correction in the reference', async () => {
  // Unmodified legacy no longer matches: the requested all-mode reflex must see
  // food discarded by its old cap. This independent reference changes only that
  // rule; no resources, RNG, learning, action selection or ecology are adjusted.
  const ReferenceWorld = await starvationCorrectedLegacy();
  const cfg = deepMerge(DEFAULTS, { world: { brainMode: 'legacy' } });
  const old = ReferenceWorld.create(cfg), current = World.create(cfg);
  runTicks(old, 4000); runTicks(current, 4000);
  const actual = canonical(current.toState()), expected = old.toState();
  // Hash first: a real mismatch should report concise evidence, not a huge diff
  // that exhausts the test worker's memory before it can report the assertion.
  const hash = s => crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex');
  assert.equal(hash(actual), hash(expected), 'legacy engine differs beyond the authorized starvation rule');
  assert.deepEqual(actual, expected);
});

test('compatibility backup loads in actual recovered binary modules; original backup is byte-identical', () => {
  const cfg = testConfig({ world: { brainMode: 'mb-v1', tickMs: 1000, catchup: { maxTicks: 0 } } });
  const now = () => 1_800_000_000_000;
  const current = new Service(cfg, { now }); current.start(); clearTimeout(current.timer);
  runTicks(current.world, 300); current.snapshot(true);
  const saved = JSON.parse(JSON.stringify(current.world.toState())), backup = current.store.backup('compatibility'); current.stop();
  const hashDir = dir => Object.fromEntries(fs.readdirSync(dir).sort().map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,n))).digest('hex')]));
  const before = hashDir(backup), output = path.join(tmpDir(), 'export');
  const result = exportLegacyBackup(backup, output); assert.equal(result.schemaVersion, 2);
  assert.deepEqual(hashDir(backup), before);
  assert.throws(() => exportLegacyBackup(backup, output), /must not exist/);
  const copyCfg = testConfig({ world: { brainMode: 'legacy', tickMs: 1000, catchup: { maxTicks: 0 } } });
  restoreBackup(copyCfg.server.dataDir, output);
  const old = new LegacyService(copyCfg, { now }); old.start(); clearTimeout(old.timer);
  assert.equal(old.world.id, saved.id); assert.equal(old.world.tick, saved.tick);
  assert.deepEqual(old.world.creatures, saved.creatures);
  runTicks(old.world, 60); old.stop();
  // Older server retains unknown MB keys when it serializes its ordinary creature objects.
  const again = new Service(deepMerge(copyCfg, { world: { brainMode: 'mb-v1', brainModeSource: 'file' } }), { now });
  again.start(); clearTimeout(again.timer);
  assert.equal(again.world.tick, saved.tick + 60);
  assert.deepEqual(again.world.creatures.map(c=>c.brain.mb), saved.creatures.map(c=>c.brain.mb));
  again.stop();
  assert.deepEqual(hashDir(backup), before);
});

test('compatibility export rejects tampering and traversal before writing output', () => {
  const dir = tmpDir(), output = path.join(tmpDir(), 'export');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 3, files: { '../escape': 'invalid' } }));
  assert.throws(() => exportLegacyBackup(dir, output), /unsupported backup filename/); assert.equal(fs.existsSync(output), false);
  fs.writeFileSync(path.join(dir, 'world.json'), '{}');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 3, files: { 'world.json': 'invalid' } }));
  assert.throws(() => exportLegacyBackup(dir, output), /checksum/); assert.equal(fs.existsSync(output), false);
});
