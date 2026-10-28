// Production export + real accepted-parent snapshot, explicit startup mode switch,
// read-only HTTP/WS clients. No decide/tick calls before inspecting retained history.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Service } from '../../server/src/service.js';
import { Store } from '../../server/src/store.js';
import { DEFAULTS, deepMerge } from '../../server/src/config.js';
import { createServer } from '../../server/src/http.js';
import { creatureDetail } from '../../server/src/view.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const project = spawnSync(process.execPath, ['web/scripts/task.mjs', 'path'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const engines = await import(pathToFileURL(path.join(project, 'node_modules/playwright/index.mjs')));
const engine = process.argv[2] ?? 'chromium', before = process.argv.includes('--before');
assert(['chromium', 'webkit'].includes(engine));
const out = path.join(root, `artifacts/phase2a-client/review/${engine}${before ? '-before' : ''}`);
const shots = path.join(root, `docs/correction/screens/review/${engine}${before ? '-before' : ''}`);
await fs.mkdir(out, { recursive: true });
await fs.mkdir(shots, { recursive: true });
const fixture = gunzipSync(await fs.readFile(path.join(root, 'tests/fixtures/accepted99e50b1-mb-decision.json.gz')));
const state = JSON.parse(fixture), captured = state.creatures[0].brain.inspection;
const results = { engine, before, date: new Date().toISOString(), fixtureSha256: createHash('sha256').update(fixture).digest('hex'), exportIndexSha256: createHash('sha256').update(await fs.readFile(path.join(root, 'dist/index.html'))).digest('hex'), checks: [], errors: [], failedAssets: [] };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const staticRoot = path.join(root, 'dist');
const preview = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve(staticRoot, p.replace(/^\/preview\//, '') || 'index.html');
  if (!p.startsWith('/preview/') || !file.startsWith(staticRoot + path.sep)) { res.writeHead(404); return res.end(); }
  try { const body = await fs.readFile(file); res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => preview.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${preview.address().port}`;
let browser;
try {
  browser = await engines[engine].launch({ headless: true }); results.version = browser.version();
  for (const mode of (before ? ['legacy'] : ['legacy', 'mb-v1', 'mb-v1-frozen', 'mb-v1-ablated'])) {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stratoks-review-browser-'));
    const cfg = deepMerge(DEFAULTS, { server: { dataDir, host: '127.0.0.1', port: 0, allowedOrigins: [origin] }, world: { brainMode: mode, brainModeSource: 'file', catchup: { maxTicks: 0 } } });
    const store = new Store(dataDir, cfg.persistence); store.init(); store.save(structuredClone(state)); store.release();
    const svc = new Service(cfg); svc.start(); clearTimeout(svc.timer); clearInterval(svc.snapTimer);
    const server = createServer(svc), methods = [], contexts = [];
    server.on('request', req => methods.push(req.method));
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const width of (before ? [390] : [320, 390, 1440])) {
        const context = await browser.newContext({ viewport: { width, height: 844 } }); contexts.push(context);
        const page = await context.newPage();
        page.on('pageerror', e => results.errors.push(e.message));
        page.on('response', r => { if (r.url().startsWith(origin) && r.status() >= 400) results.failedAssets.push({ path: new URL(r.url()).pathname, status: r.status() }); });
        await page.goto(origin + '/preview/');
        await page.getByRole('button', { name: 'Open settings', exact: true }).click();
        await page.getByLabel('World service URL').fill(base);
        await page.getByLabel('WebSocket URL (optional)').fill('');
        await page.getByRole('button', { name: 'Connect to world', exact: true }).click();
        await page.locator('[data-mode="connected"]').waitFor();
        await page.getByRole('button', { name: 'Residents', exact: true }).click();
        await page.locator('.resident-row').first().click();
        await page.getByRole('button', { name: 'Learning', exact: true }).click();
        const panel = page.locator('.brain-behavior'); await panel.locator(`p strong:text-is("${mode}")`).waitFor();
        const actual = creatureDetail(svc.world, svc.world.creatures[0]).brainBehavior;
        assert.equal(actual.mode, mode); assert.deepEqual(actual.decision, captured);
        assert.equal(svc.world.creatures[0].stats.decisions, state.creatures[0].stats.decisions);
        const trace = page.getByText('Sparse circuit activity', { exact: true });
        const candidateText = await panel.locator('details').filter({ has: page.getByText('Action candidates & preferences', { exact: true }) }).innerText();
        if (before) {
          assert(candidateText.includes('Totals use the linear policy and game rules.'));
          assert.equal(await trace.count(), 0);
        } else {
          assert(await panel.getByText('Decision mode unrecorded', { exact: true }).isVisible());
          assert(candidateText.includes('Scoring policy and target selection method were not recorded for this decision.'));
          assert(!candidateText.includes('Totals use the linear policy'));
          assert(!candidateText.includes('Action probability uses its best target'));
          await trace.click();
          assert((await panel.innerText()).includes('8 / 128 KC-like units active'));
          assert((await panel.innerText()).includes(captured.activeKCs.join(', ')));
        }
        const rows = await panel.locator('.brain-table tbody tr').allTextContents();
        captured.candidates.forEach((c, i) => { assert(rows[i].includes(c.score.toFixed(3))); if (c.preference !== null) assert(rows[i].includes(c.preference.toFixed(3))); });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert(await page.locator('.panel-body').evaluate(el => el.scrollWidth <= el.clientWidth));
        await page.locator('.panel-body').evaluate(el => { el.scrollTop = 0; });
        if (mode === 'legacy' && width !== 320) await page.screenshot({ path: path.join(shots, `retained-decision-${width}.jpg`), type: 'jpeg', quality: 75 });
        results.checks.push({ mode, width, decisionMode: actual.decision.mode ?? null, activeKCs: actual.decision.activeKCs, candidateText, passed: true });
      }
      assert(methods.every(m => m === 'GET')); assert.equal(svc.world.tick, state.tick);
    } finally {
      await Promise.all(contexts.map(c => c.close())); server.closeAllConnections();
      await new Promise(r => server.close(r)); svc.stop(); await fs.rm(dataDir, { recursive: true, force: true });
    }
  }
  assert.deepEqual(results.errors, []); assert.deepEqual(results.failedAssets, []);
  console.log(`${engine}: ${results.checks.length} retained-history checks passed${before ? ' (confirmed old misattribution)' : ''}`);
} finally {
  await browser?.close(); await new Promise(r => preview.close(r));
  await fs.writeFile(path.join(out, 'checks.json'), JSON.stringify(results, null, 2) + '\n');
}
