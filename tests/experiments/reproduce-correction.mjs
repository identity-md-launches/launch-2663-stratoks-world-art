// Read the accepted commit into a disposable directory. Never changes Git metadata.
// Run from any directory; final tests exercise original source with no patch-back step.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = '99e50b1c275b9422c14f279498b3e192b151992b';
const out = path.join(root, 'test/scratch/correction-original');
fs.mkdirSync(out, { recursive: true });
const git = args => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr); return r.stdout;
};
for (const rel of git(['ls-tree', '-r', '--name-only', baseline, 'server']).trim().split('\n')) {
  if (!rel.startsWith('server/src/') && rel !== 'server/package.json') continue;
  const target = path.join(out, rel); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, git(['show', `${baseline}:${rel}`]));
}
fs.mkdirSync(path.join(out, 'tests'), { recursive: true });
for (const name of ['helpers.js', 'brain-correction.test.js']) fs.copyFileSync(path.join(root, 'tests', name), path.join(out, 'tests', name));
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/brain-correction.test.js'], { cwd: out, encoding: 'utf8', timeout: 60000 });
const report = process.argv[2] ?? path.join(root, 'artifacts/phase2a-client/correction/original-regressions.tap');
fs.writeFileSync(report, `# Original source ${baseline}; final regression tests, expected failures\n` + result.stdout + result.stderr);
console.log(`Baseline exit ${result.status}; ${report}`);
if (result.status !== 1 || !result.stdout.includes('not ok')) throw new Error('Original failures were not reproduced');
