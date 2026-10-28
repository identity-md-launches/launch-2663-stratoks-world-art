// A public release passes only when HTTPS serves the exact committed export.
// No publishing credentials, platform configuration, pinning or ENS writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'docs/correction/RELEASE.json'), 'utf8'));
const candidates = process.argv.slice(2);
const urls = candidates.length ? candidates : [
  'https://stratoks-a-little-world-unf-0d68.identitymd.eth.limo/',
  `https://${manifest.cid}.ipfs.dweb.link/`,
  `https://ipfs.io/ipfs/${manifest.cid}/`
];
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'stratoks-https-check-'));
const result = { checkedAt: new Date().toISOString(), expectedCid: manifest.cid, exportTreeSha256: manifest.exportTreeSha256, checks: [], workingExactExportUrls: [], publicHttpsVerified: false, boundary: 'The worker can prepare and verify content, but cannot publish through IMD or repair its ENS gateway DNS/TLS. Pinning and the final submission commit are assigned outside this worker.' };
try {
  for (const raw of urls) {
    const base = new URL(raw);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) throw Error('Use a clean HTTPS base URL ending in /');
    const check = { baseUrl: base.href, indexExact: false, files: [], errors: [], passed: false };
    for (const entry of manifest.staticFiles) {
      const dest = path.join(temp, 'response');
      const response = spawnSync('curl', ['--silent', '--show-error', '--location', '--proto', '=https', '--max-time', '25', '--output', dest, '--write-out', '%{http_code}', new URL(entry.file, base).href], { encoding: 'utf8' });
      const bytes = await fs.readFile(dest).catch(() => Buffer.alloc(0));
      const exact = response.status === 0 && response.stdout === '200' && hash(bytes) === entry.sha256;
      check.files.push({ file: entry.file, curlExit: response.status, httpStatus: response.stdout || null, bytes: bytes.length, sha256: hash(bytes), exact });
      if (entry.file === 'index.html') check.indexExact = exact;
      if (!exact) {
        check.errors.push(response.stderr.trim() || `HTTP ${response.stdout}; release bytes do not match.`);
        break; // A bad gateway's first response cannot certify this export.
      }
    }
    check.passed = check.files.length === manifest.staticFiles.length && check.files.every(f => f.exact);
    if (check.passed) result.workingExactExportUrls.push(base.href);
    result.checks.push(check);
  }
  result.publicHttpsVerified = result.workingExactExportUrls.length > 0;
  await fs.writeFile(path.join(root, 'docs/correction/HTTPS.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (!result.publicHttpsVerified) process.exitCode = 1;
} finally { await fs.rm(temp, { recursive: true, force: true }); }
