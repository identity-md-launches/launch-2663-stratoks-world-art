// Final release check: byte inventories, protected paths, preserved evidence and budget.
// Git queries are read-only. No package install/build/deployment or Git mutation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULTS } from '../../server/src/config.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const base = '99e50b1c275b9422c14f279498b3e192b151992b';
const git = args => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const release = read('docs/correction/RELEASE.json'), pack = read('docs/correction/PACKAGE.json');
for (const row of [...release.sourceFiles, ...release.staticFiles.map(r => ({ ...r, file: 'dist/' + r.file })), ...pack.files]) {
  const bytes = fs.readFileSync(path.join(root, row.file)); assert.equal(bytes.length, row.bytes, row.file); assert.equal(hash(bytes), row.sha256, 'Stale inventory: ' + row.file);
}
assert.equal(hash(fs.readFileSync(path.join(root, release.carFile))), release.carGzipSha256);
assert.equal(hash(fs.readFileSync(path.join(root, pack.archive))), pack.sha256);
assert.equal(DEFAULTS.world.brainMode, 'legacy');
assert.deepEqual(read('dist/world-config.json'), { httpUrl: '', wsUrl: '' });
for (const name of ['brain', 'mushroom', 'rng']) assert.equal(hash(fs.readFileSync(path.join(root, 'server/src', name + '.js'))), hash(fs.readFileSync(path.join(root, 'deploy/phase2a-demo/circuit', name + '.js'))));
assert.equal(git(['diff', '--name-only', base, '--', 'tests/results/phase2a', 'docs/phase2a', 'deploy/recovered']).trim(), '', 'Original evidence changed');
const changed = new Set([...git(['diff', '--name-only', base, '-z']).split('\0'), ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')].filter(Boolean));
const protectedPath = rel => /(^|\/)(\.git|\.github|node_modules|lib)(\/|$)/.test(rel) || /(^|\/)(\.env(?:\..*)?|foundry\.toml|foundry\.lock|remappings\.txt|\.gitmodules|package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|\.gitignore)$/.test(rel);
const rows = [];
for (const rel of [...changed].sort()) {
  if (rel.startsWith('test/scratch/') || rel.startsWith('.imd/')) continue;
  assert(!protectedPath(rel), 'Protected path changed: ' + rel);
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  assert(!fs.lstatSync(file).isSymbolicLink(), 'Symlink/submodule: ' + rel);
  assert(!/(^|\/)(\.cache|\.npm|__pycache__|node_modules)(\/|$)|\.(tgz|deb)$/.test(rel), 'Generated packaging/dependency artifact: ' + rel);
  if (fs.statSync(file).isFile()) rows.push({ file: rel, bytes: fs.statSync(file).size });
}
const bytes = rows.reduce((s, r) => s + r.bytes, 0), limit = 8388608;
assert(bytes < limit, `Contribution ${bytes} exceeds ${limit}`);
function size(dir) { return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0); }
const evidenceBytes = size(path.join(root, 'artifacts/phase2a-client'));
assert(evidenceBytes < 3145728, 'Existing evidence path budget exceeded');
const learning = read('tests/results/correction/learning.json'), ecology = read('tests/results/correction/ecology.json');
assert.equal(learning.rows.length, 120); assert.equal(ecology.rows.length, 40);
for (const data of [learning, ecology]) for (const [name, expected] of Object.entries(data.sourceHashes)) assert.equal(hash(fs.readFileSync(path.join(root, 'server/src', name + '.js'))), expected);
const cap = read('tests/results/correction/capacity/status.json'); assert.equal(cap.rows.length, 16);
for (const entry of cap.rows) {
  const row = read('tests/results/correction/capacity/' + entry.file);
  for (const [name, expected] of Object.entries(row.sourceHashes)) assert.equal(hash(fs.readFileSync(path.join(root, 'server/src', name + '.js'))), expected, 'Stale benchmark');
  assert.equal(row.protocol.sequenceGaps, 0); assert.equal(row.protocol.clientsSameEntities, true); assert.equal(row.protocol.clientsClosedDuringRun, 0);
}
const result = { passed: true, baseline: base, checkoutCommit: git(['rev-parse', 'HEAD']).trim(), sourceTreeSha256: release.sourceTreeSha256, exportTreeSha256: release.exportTreeSha256, computedCid: release.cid, publicHttpsVerified: read('docs/correction/HTTPS.json').publicHttpsVerified, dockerVerified: read('tests/results/correction/docker/status.json').verified, contributionBytes: bytes, reserveBytes: limit - bytes, limitBytes: limit, evidencePathBytes: evidenceBytes, evidencePathLimitBytes: 3145728, staticFiles: release.staticFiles.length, capacityRows: cap.rows.length, files: rows };
fs.writeFileSync(path.join(root, 'docs/correction/INTEGRITY.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, files: undefined }, null, 2));
