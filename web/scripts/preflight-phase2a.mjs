// Exact client/source inventory and conservative contribution budget. Read-only Git queries.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'artifacts/phase2a-client'); await fs.mkdir(out, { recursive: true });
const hash = data => createHash('sha256').update(data).digest('hex');
async function walk(relative) {
  const files = [];
  for (const e of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const rel = path.posix.join(relative, e.name);
    assert(!['node_modules', '.cache', '__pycache__', '.git'].includes(e.name), 'Generated directory: ' + rel);
    assert(!e.isSymbolicLink(), 'No symlinks/submodules: ' + rel);
    if (e.isDirectory()) files.push(...await walk(rel)); else if (e.isFile()) files.push(rel);
  }
  return files.sort();
}
const rows = async files => Promise.all(files.map(async file => { const data = await fs.readFile(path.join(root, file)); return { file, bytes: data.length, sha256: hash(data) }; }));
const source = await rows([...(await walk('web')), ...(await walk('server')), ...(await walk('shared')), 'README.md', 'DESIGN.md', '.gitignore']);
const exported = await rows(await walk('dist'));
const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
for (const pattern of [/<title>Stratoks/, /name="description"/, /rel="icon"/, /property="og:title"/, /property="og:image"/]) assert.match(html, pattern);
assert(!/(?:src|href)="\/(?!\/)/.test(html), 'Root-relative asset URL');
for (const [, url] of html.matchAll(/(?:src|href|content)="(\.\/[^"<>]+)"/g)) await fs.access(path.join(root, 'dist', url));
assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'dist/world-config.json'))), { httpUrl: '', wsUrl: '' });
assert.equal(hash(await fs.readFile(path.join(root, 'deploy/recovered/stratoks-09af84d.zip'))), '8816bfda36545436f85d4ca0b13bd439be14fb3a6be285f25bd39f3edf8abd9e');
const previous = JSON.parse(await fs.readFile(path.join(root, 'docs/phase2a/inventory.json')));
for (const row of previous.files) {
  // Existing accepted server/component, science evidence and archived assets all remain exact.
  assert.equal(hash(await fs.readFile(path.join(root, row.path))), row.sha256, 'Accepted artifact changed: ' + row.path);
}
const git = (...args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
assert.equal(git('diff', '--name-only'), '', 'Existing accepted tracked files must stay unchanged in this integration');
const evidenceBudgetBytes = 3145728;
const evidenceBytes = (await rows(await walk('artifacts/phase2a-client'))).reduce((n, f) => n + f.bytes, 0);
assert(evidenceBytes < evidenceBudgetBytes, 'Evidence path budget exceeded');
assert(git('ls-files', '--cached', '--others', '--exclude-standard', 'artifacts/phase2a-client').includes('artifacts/phase2a-client/VALIDATION.md'), 'Required evidence hidden from submission');
const contributionFiles = [...new Set([...(await walk('web')), ...(await walk('dist')), ...(await walk('artifacts')), 'README.md', 'DESIGN.md', '.gitignore'])];
const contributionBytes = (await rows(contributionFiles)).reduce((n, f) => n + f.bytes, 0);
const reserveBytes = 196608, limitBytes = 8388608;
assert(contributionBytes + reserveBytes < limitBytes, 'Contribution budget exceeded');
const digest = records => hash(records.map(r => r.file + '\0' + r.sha256 + '\n').join(''));
const release = { release: 'Stratoks Phase 2A integrated client', acceptedParentCommit: git('rev-parse', 'HEAD'), submissionCommit: null, submissionCommitNote: 'Assigned by the contributor network after submission; Git metadata was not modified.', recoveredCommit: '09af84d67722e30c0cb0c096ab8a8189a3b03166', recoveredArchiveSha256: '8816bfda36545436f85d4ca0b13bd439be14fb3a6be285f25bd39f3edf8abd9e', publicUrl: null, publication: 'IMD export pinning after review', sourceTreeSha256: digest(source), exportTreeSha256: digest(exported), exportBytes: exported.reduce((n, r) => n + r.bytes, 0), sourceFiles: source, staticFiles: exported };
await fs.writeFile(path.join(out, 'release.json'), JSON.stringify(release, null, 2) + '\n');
const result = { passed: true, baselineChecksumVerified: true, acceptedInventoryUnchanged: true, existingTrackedFilesUnchanged: true, relativeEntryAssets: true, shareMetadata: true, serverUnconfigured: true, evidencePathBudget: { path: 'artifacts/phase2a-client/', bytes: evidenceBytes, limitBytes: evidenceBudgetBytes }, addedPathBudget: { contributionBytes, reserveBytes, upperBoundBytes: contributionBytes + reserveBytes, limitBytes, scope: 'Complete web + dist + artifacts + root README/DESIGN/.gitignore; includes restored source/lockfile and all current evidence. Uncompressed bytes, not just a compressed delta. Existing accepted ZIP/artifacts are retained and excluded from added-path accounting.' }, sourceTreeSha256: release.sourceTreeSha256, exportTreeSha256: release.exportTreeSha256 };
await fs.writeFile(path.join(out, 'preflight.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
