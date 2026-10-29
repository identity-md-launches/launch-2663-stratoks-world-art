// Preserve installed package notices without shipping dependency code or caches.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const project = spawnSync('node', ['web/scripts/task.mjs', 'path'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const lock = JSON.parse(await fs.readFile(path.join(root, 'web/package-lock.json'), 'utf8'));
const out = path.join(root, 'web/public/licenses'); await fs.mkdir(out, { recursive: true });
const rows = [], text = ['Stratoks client: locked runtime dependency notices', 'This conservative list includes runtime peer/type dependencies. Build-only tools are pinned in web/package-lock.json.', 'No new model/data dependency is installed. Biological datasets are not bundled.'];
for (const [relative, pkg] of Object.entries(lock.packages)) {
  if (!relative || pkg.dev || pkg.optional) continue;
  const dir = path.join(project, relative);
  const names = (await fs.readdir(dir)).filter(n => /^(licen[cs]e|copying|notice)(\.|$)/i.test(n));
  const notices = [];
  for (const name of names) {
    if (!(await fs.stat(path.join(dir, name))).isFile()) continue;
    const body = await fs.readFile(path.join(dir, name), 'utf8'); notices.push(name);
    text.push(`\n===== ${relative.replace(/^node_modules\//, '')} ${pkg.version}: ${name} =====\n${body}`);
  }
  if (!notices.length) throw new Error(`Missing package notice: ${relative}`);
  rows.push({ package: relative.replace(/^node_modules\//, ''), version: pkg.version, license: pkg.license, registryArtifact: pkg.resolved, integrity: pkg.integrity, notices });
}
await fs.writeFile(path.join(out, 'dependencies.json'), JSON.stringify(rows, null, 2) + '\n');
await fs.writeFile(path.join(out, 'THIRD_PARTY_NOTICES.txt'), text.join('\n') + '\n');
for (const name of ['client-and-art', 'manrope', 'rainbowkit']) await fs.copyFile(path.join(root, 'docs/licenses', name + '.txt'), path.join(out, name + '.txt'));
console.log(`Preserved notices for ${rows.length} locked packages; no dependency archives copied.`);
