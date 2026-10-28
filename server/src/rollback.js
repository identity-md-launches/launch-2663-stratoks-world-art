// Compatibility export only. Input and any live world are never overwritten.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const allowed = name => ['world.json', 'world.prev.json', 'world.id', 'lifecycle.jsonl', 'interventions.jsonl', 'events.jsonl'].includes(name) || /^events\.jsonl\.\d+$/.test(name);
export function exportLegacyBackup(source, output) {
  const src = path.resolve(source), dest = path.resolve(output);
  if (src === dest || dest.startsWith(src + path.sep) || src.startsWith(dest + path.sep)) throw new Error('source and output must be separate directories');
  if (fs.existsSync(dest)) throw new Error('output must not exist; refusing overwrite');
  const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 3) throw new Error('expected schema 3 backup');
  const files = new Map();
  for (const [name, checksum] of Object.entries(manifest.files)) {
    if (!allowed(name)) throw new Error(`unsupported backup filename ${name}`);
    const p = path.join(src, name);
    if (!fs.lstatSync(p).isFile()) throw new Error('backup entries must be regular files');
    const data = fs.readFileSync(p);
    if (sha(data) !== checksum) throw new Error(`backup checksum failed for ${name}`);
    files.set(name, data);
  }
  if (!files.has('world.json')) throw new Error('backup has no current snapshot');
  for (const name of ['world.json', 'world.prev.json']) {
    if (!files.has(name)) continue;
    const snap = JSON.parse(files.get(name));
    if (![2, 3].includes(snap.schemaVersion) || snap.sha256 !== sha(JSON.stringify(snap.state))) throw new Error(`invalid compatible snapshot ${name}`);
    // Original server ignores and retains extra per-brain keys. MB state is archived
    // in each brain; only active policy changes. No identities/age/needs/weights reset.
    snap.schemaVersion = 2; snap.state.brainMode = 'legacy';
    snap.sha256 = sha(JSON.stringify(snap.state)); files.set(name, Buffer.from(JSON.stringify(snap)));
  }
  const next = { ...manifest, schemaVersion: 2, compatibilityExport: { from: 3, policy: 'legacy', preservedCircuitState: true }, files: {} };
  // All validation completed before creating the output directory.
  fs.mkdirSync(dest, { recursive: false });
  for (const [name, data] of files) { fs.writeFileSync(path.join(dest, name), data, { flag: 'wx' }); next.files[name] = sha(data); }
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(next, null, 2) + '\n', { flag: 'wx' });
  return { schemaVersion: 2, circuitStatePreserved: true, files: files.size };
}
