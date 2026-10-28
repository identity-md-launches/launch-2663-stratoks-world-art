// Deterministic static release CAR + byte manifest. This does not publish or pin.
// Release-only utilities install under /tmp; the application's lockfile is unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const utilityRoot = path.resolve(process.argv[2] ?? '/tmp/stratoks-release-tools');
const get = rel => import(pathToFileURL(path.join(utilityRoot, 'node_modules', rel)).href);
const { importer } = await get('ipfs-unixfs-importer/dist/src/index.js');
const { fixedSize } = await get('ipfs-unixfs-importer/dist/src/chunker/fixed-size.js');
const { exporter } = await get('ipfs-unixfs-exporter/dist/src/index.js');
const { CarWriter } = await get('@ipld/car/src/writer.js');
const { CarReader } = await get('@ipld/car/src/reader.js');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
async function files(rel) {
  const out = [];
  for (const e of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
    assert(!e.isSymbolicLink(), 'Symlink in release: ' + rel);
    const name = path.posix.join(rel, e.name);
    if (e.isDirectory()) { assert(!['node_modules', '.cache', '.npm'].includes(e.name)); out.push(...await files(name)); }
    else if (e.isFile()) out.push(name);
  }
  return out.sort();
}
const exported = [];
const entries = [];
for (const rel of await files('dist')) {
  const bytes = await fs.readFile(path.join(root, rel)), name = rel.slice(5);
  exported.push({ file: name, bytes: bytes.length, sha256: hash(bytes) }); entries.push({ path: name, content: bytes });
}
const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
for (const p of [/<title>Stratoks/, /name="description"/, /rel="icon"/, /property="og:title"/, /property="og:image"/]) assert.match(html, p);
assert(!/(?:src|href)="\/(?!\/)/.test(html));
const blocks = new Map();
const store = {
  async put(cid, bytes) { blocks.set(cid.toString(), { cid, bytes }); return cid; },
  async *get(cid) { const b = blocks.get(cid.toString()); assert(b, 'Missing block ' + cid); yield b.bytes; }
};
let release;
for await (const entry of importer(entries, store, { cidVersion: 1, rawLeaves: true, wrapWithDirectory: true, reduceSingleLeafToSelf: true, chunker: fixedSize({ chunkSize: 262144 }), fileImportConcurrency: 1, blockWriteConcurrency: 1 })) release = entry;
assert.equal(release.path, '');
const { writer, out } = CarWriter.create([release.cid]);
const chunks = [];
const drain = (async () => { for await (const chunk of out) chunks.push(Buffer.from(chunk)); })();
for (const entry of blocks.values()) await writer.put(entry);
await writer.close(); await drain;
const car = Buffer.concat(chunks), compressed = gzipSync(car, { level: 9, mtime: 0 });
const carFile = 'deploy/correction-client.car.gz';
await fs.writeFile(path.join(root, carFile), compressed);
// Independent CAR parse, block-hash check and UnixFS traversal for every export file.
const reader = await CarReader.fromBytes(car);
assert.equal((await reader.getRoots())[0].toString(), release.cid.toString());
const restored = new Map();
for await (const { cid, bytes } of reader.blocks()) {
  assert.equal(hash(bytes), Buffer.from(cid.multihash.digest).toString('hex'));
  restored.set(cid.toString(), bytes);
}
const readStore = { async *get(cid) { const b = restored.get(cid.toString()); assert(b); yield b; } };
for (const entry of exported) {
  const file = await exporter(`${release.cid}/${entry.file}`, readStore);
  assert(['file', 'raw'].includes(file.type));
  const content = []; for await (const chunk of file.content()) content.push(Buffer.from(chunk));
  assert.equal(hash(Buffer.concat(content)), entry.sha256, entry.file);
}
const sourceFiles = [];
for (const rel of [...await files('server'), ...await files('shared'), ...await files('web')].sort()) {
  const b = await fs.readFile(path.join(root, rel)); sourceFiles.push({ file: rel, bytes: b.length, sha256: hash(b) });
}
const digest = rows => hash(rows.map(r => `${r.file}\0${r.sha256}\n`).join(''));
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }); assert.equal(git.status, 0);
const manifest = {
  release: 'STRATOKS Phase 2A correction', acceptedParentCommit: git.stdout.trim(), submissionCommit: null,
  commitBoundary: 'The submission service assigns the final commit after this work. This manifest identifies final source/export bytes; no uncommitted tree is represented as a Git commit.',
  cid: release.cid.toString(), cidStatus: 'Computed locally and verified by CAR traversal; not a claim of public pinning.',
  import: { cidVersion: 1, rawLeaves: true, wrapWithDirectory: true, chunkBytes: 262144, fileImportConcurrency: 1, blockWriteConcurrency: 1, importer: '17.1.1', exporter: '16.2.3', car: '5.4.7' },
  carFile, carGzipBytes: compressed.length, carGzipSha256: hash(compressed), carBytes: car.length, carSha256: hash(car), carFilesVerified: exported.length,
  exportTreeSha256: digest(exported), sourceTreeSha256: digest(sourceFiles), exportBytes: exported.reduce((s, f) => s + f.bytes, 0), staticFiles: exported, sourceFiles,
  publicHttpsVerified: false, publicUrl: null, productionDefault: 'legacy', backendDeployment: 'not performed'
};
await fs.mkdir(path.join(root, 'docs/correction'), { recursive: true });
await fs.writeFile(path.join(root, 'docs/correction/RELEASE.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ cid: manifest.cid, filesVerified: exported.length, exportBytes: manifest.exportBytes, carGzipBytes: compressed.length, exportTreeSha256: manifest.exportTreeSha256 }));
