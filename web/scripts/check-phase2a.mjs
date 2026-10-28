// Real production export + two independent browser contexts + disposable HTTP/WS service.
// The main agreement/isolation checks use real server JSON. Fault fixtures are named explicitly.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Service } from '../../server/src/service.js';
import { DEFAULTS, deepMerge } from '../../server/src/config.js';
import { createServer } from '../../server/src/http.js';
import { creatureDetail } from '../../server/src/view.js';
import { setBrainMode } from '../../server/src/controller.js';
import { decide } from '../../server/src/actions.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const project = spawnSync('node', ['web/scripts/task.mjs', 'path'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const engines = await import(pathToFileURL(path.join(project, 'node_modules/playwright/index.mjs')));
const { default: AxeBuilder } = await import(pathToFileURL(path.join(project, 'node_modules/@axe-core/playwright/dist/index.mjs')));
const engine = process.argv[2] ?? 'chromium';
assert(['chromium', 'webkit'].includes(engine));
const out = path.resolve(process.argv[3] ?? `artifacts/phase2a-client/${engine}`);
await fs.mkdir(out, { recursive: true });
const results = { date: new Date().toISOString(), engine, checks: [], errors: [], observations: {}, accessibility: [] };
const exportIndexHash = async () => createHash('sha256').update(await fs.readFile(path.join(root, 'dist/index.html'))).digest('hex');
results.indexSha256 = await exportIndexHash();
const pass = (name, data = {}) => { results.checks.push({ name, passed: true, ...data }); console.log('PASS', name); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const staticRoot = path.join(root, 'dist');
const preview = http.createServer(async (req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  const file = path.resolve(staticRoot, p.replace(/^\/preview\//, '') || 'index.html');
  if (!p.startsWith('/preview/') || !file.startsWith(staticRoot + path.sep)) { res.writeHead(404); return res.end(); }
  try { const body = await fs.readFile(file); res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => preview.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${preview.address().port}`, url = origin + '/preview/';
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stratoks-browser-phase2a-'));
const cfg = deepMerge(DEFAULTS, { server: { host: '127.0.0.1', port: 0, dataDir, allowedOrigins: [origin] }, world: { brainMode: 'mb-v1', tickMs: 1000, catchup: { maxTicks: 0 } } });
const svc = new Service(cfg, { log: () => {} }); svc.start(); clearTimeout(svc.timer); clearInterval(svc.snapTimer);
for (let i = 0; i < 900; i++) svc.tickOnce();
svc.snapshot(true);
const server = createServer(svc), methods = [];
server.on('request', req => methods.push({ method: req.method, path: req.url }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [], failedAssets = [];
async function connect(page) {
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await page.getByLabel('World service URL').fill(base);
  await page.getByLabel('WebSocket URL (optional)').fill('');
  await page.getByRole('button', { name: 'Connect to world', exact: true }).click();
  await page.locator('[data-mode="connected"]').waitFor();
}
async function inspect(page) {
  await page.getByRole('button', { name: 'Residents', exact: true }).click();
  await page.locator('.resident-row').first().click();
  await page.getByRole('button', { name: 'Learning', exact: true }).click();
  await page.locator('[data-brain-mode="mb-v1"]').waitFor();
}
async function audit(page, state) {
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  results.accessibility.push({ state, violations: scan.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })) });
  assert.equal(scan.violations.length, 0, `axe violations: ${state}`);
}
async function noOverflow(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert(await page.locator('.panel-body').evaluate(el => el.scrollWidth <= el.clientWidth));
}
try {
  const executablePath = engine === 'webkit' ? process.env.WEBKIT_EXECUTABLE_PATH : process.env.CHROMIUM_EXECUTABLE_PATH;
  browser = await engines[engine].launch({ headless: true, ...(executablePath ? { executablePath } : {}) }); results.version = browser.version();
  const contexts = await Promise.all([browser.newContext({ viewport: { width: 390, height: 844 } }), browser.newContext({ viewport: { width: 1440, height: 960 } })]);
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  for (const page of pages) {
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.url().startsWith(origin) && r.status() >= 400) failedAssets.push({ url: new URL(r.url()).pathname, status: r.status() }); });
  }
  const [a, b] = pages;
  await Promise.all(pages.map(p => p.goto(url)));
  const entry = await a.getByRole('button', { name: 'Explore local demo', exact: true }).boundingBox();
  assert(entry && entry.y >= 0 && entry.y + entry.height < 844);
  assert(await a.locator('canvas').isVisible());
  await a.screenshot({ path: path.join(out, 'first-screen-390.jpg'), type: 'jpeg', quality: 78 });
  await audit(a, 'first screen at 390');
  pass('first screen at 390 shows the original world, product and working main action');
  // Keyboard opens and closes the real native dialog; focus returns to its trigger.
  await a.getByRole('button', { name: 'Open settings', exact: true }).focus();
  await a.keyboard.press('Enter'); await a.getByRole('dialog').waitFor();
  await a.keyboard.press('Escape');
  assert.equal(await a.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Open settings');
  pass('keyboard settings dialog closes with Escape and restores focus');
  let reachedDemo = false;
  for (let i = 0; i < 30; i++) {
    await a.keyboard.press('Tab');
    if (await a.evaluate(() => document.activeElement?.matches('button') && document.activeElement.textContent.includes('Explore local demo'))) { reachedDemo = true; break; }
  }
  assert(reachedDemo, 'main action reachable by keyboard');
  await a.screenshot({ path: path.join(out, 'keyboard-primary-390.jpg'), type: 'jpeg', quality: 78 });
  await a.keyboard.press('Enter'); await a.locator('[data-mode="demo"]').waitFor();
  pass('Tab navigation reaches the main action and Enter starts the real private simulation');
  await Promise.all(pages.map(connect));
  assert.equal(svc.clients.size, 2);
  for (const page of pages) assert.equal(await page.locator('.app').getAttribute('data-world-id'), svc.world.id);
  await Promise.all(pages.map(inspect));
  const creature = svc.world.creatures[0];
  const expected = JSON.parse(JSON.stringify(creatureDetail(svc.world, creature).brainBehavior));
  for (const page of pages) {
    assert.equal(await page.locator('.brain-behavior').getAttribute('data-decision-tick'), String(expected.decision.tick));
    assert.equal(await page.locator('.brain-behavior').getAttribute('data-selected-action'), expected.decision.selectedAction);
    assert.equal(await page.locator('.brain-table tbody tr').count(), expected.decision.candidates.length);
    const body = await page.evaluate(async url => (await fetch(url)).json(), `${base}/api/creatures/${creature.id}`);
    assert.deepEqual(body.brainBehavior, expected);
    const rows = await page.locator('.brain-table tbody tr').allTextContents();
    expected.decision.candidates.forEach((candidate, i) => assert(rows[i].includes(candidate.score.toFixed(3))));
  }
  results.observations.shared = { worldId: svc.world.id, tick: svc.world.tick, creatureId: creature.id, brain: expected, sha256: hash(expected), clients: svc.clients.size };
  await fs.writeFile(path.join(out, 'shared-decision.json'), JSON.stringify(results.observations.shared, null, 2) + '\n');
  pass('two independent real browser clients display the same authoritative decision and candidate scores');
  for (const mode of ['legacy', 'mb-v1-frozen', 'mb-v1-ablated', 'mb-v1']) {
    setBrainMode(svc.world, mode, 'isolated-browser-test');
    creature.act = null; decide(svc.world, creature);
    const actual = creatureDetail(svc.world, creature).brainBehavior;
    for (const page of pages) {
      const panel = page.locator(`[data-brain-mode="${mode}"]`); await panel.waitFor();
      assert.equal(await panel.getAttribute('data-selected-action'), actual.decision.selectedAction);
      assert.equal(await panel.locator('.brain-table tbody tr').count(), actual.decision.candidates.length);
      assert((await panel.innerText()).includes(`Policy learning ${actual.learningEnabled ? 'enabled' : 'disabled'}`));
      assert.equal(actual.learningEnabled, !['mb-v1-frozen', 'mb-v1-ablated'].includes(mode));
      if (mode === 'mb-v1-ablated') assert(actual.decision.candidates.every(c => c.preference === 0));
      await page.getByText('Learning history', { exact: true }).click();
      assert(await page.getByText('Linear-policy updates', { exact: true }).isVisible());
      assert(await page.getByText(/Recent decisions span active policies/).isVisible());
      await page.getByText('Learning history', { exact: true }).click();
    }
  }
  pass('all four policy modes show accurate plasticity, candidate output and Learning history in both clients');
  for (let i = 0; i < 24; i++) svc.tickOnce();
  for (const page of pages) await page.waitForFunction(tick => Number(document.querySelector('.app').dataset.worldTick) === tick, svc.world.tick);
  pass('both real WebSocket clients observe subsequent server ticks');
  await audit(a, 'real brain inspector at 390');
  await a.locator('.panel-body').evaluate(el => { el.scrollTop = 0; });
  await a.screenshot({ path: path.join(out, 'brain-390.jpg'), type: 'jpeg', quality: 78 });
  await b.screenshot({ path: path.join(out, 'brain-1440.jpg'), type: 'jpeg', quality: 78 });
  for (const width of [320, 390, 800, 1440]) { await a.setViewportSize({ width, height: 844 }); await noOverflow(a); }
  pass('brain inspector reflows at 320, 390, 800 and 1440 without horizontal overflow');
  await a.setViewportSize({ width: 390, height: 844 });
  const rememberedDecision = await a.locator('.brain-behavior').getAttribute('data-selected-action');
  await contexts[0].setOffline(true);
  for (const c of svc.clients) c.close(1001);
  await a.locator('[data-mode="reconnecting"]').waitFor();
  await a.getByText(/Last received details/).waitFor();
  assert.equal(await a.locator('.brain-behavior').getAttribute('data-selected-action'), rememberedDecision);
  await contexts[0].setOffline(false);
  for (const page of pages) await page.locator('[data-mode="connected"]').waitFor();
  pass('connection loss retains the selected Brain view, labels it stale and reconnects');
  const serverBefore = hash(svc.world.toState());
  const requestsBefore = methods.length;
  await a.getByRole('button', { name: 'Try isolated learning scenarios', exact: true }).click();
  await a.getByRole('button', { name: 'Evaluate without learning', exact: true }).click();
  await a.getByRole('heading', { name: 'Held-out evaluation', exact: true }).waitFor();
  await a.getByRole('button', { name: 'Train 300 trials', exact: true }).click();
  await a.getByRole('heading', { name: 'Acquisition', exact: true }).waitFor();
  await a.getByRole('button', { name: 'Evaluate without learning', exact: true }).click();
  await a.getByRole('heading', { name: 'Held-out evaluation', exact: true }).waitFor();
  results.observations.acquisition = await a.locator('.lab-results').innerText();
  await a.getByRole('button', { name: 'Reverse rewards & train', exact: true }).click();
  await a.getByRole('heading', { name: 'Reward reversal', exact: true }).waitFor();
  await a.getByRole('button', { name: 'Evaluate without learning', exact: true }).click();
  await a.getByRole('heading', { name: 'Held-out evaluation', exact: true }).waitFor();
  results.observations.reversal = await a.locator('.lab-results').innerText();
  await a.locator('.lab-results').scrollIntoViewIfNeeded();
  await a.screenshot({ path: path.join(out, 'reversal-390.jpg'), type: 'jpeg', quality: 78 });
  await a.getByRole('button', { name: 'Remove learned output & evaluate', exact: true }).click();
  await a.getByRole('heading', { name: 'Learned output removed', exact: true }).waitFor();
  results.observations.ablation = await a.locator('.lab-results').innerText();
  await a.getByText('Check serialized retention', { exact: true }).click();
  await a.getByRole('button', { name: 'Check restore', exact: true }).click();
  await a.locator('.lab-retention li').first().waitFor();
  assert.equal(await a.locator('.lab-retention li').count(), 3);
  assert(!(await a.locator('.lab-retention').innerText()).includes('failed'));
  const downloadPromise = a.waitForEvent('download');
  await a.getByRole('button', { name: 'Download measured results', exact: true }).click();
  const download = await downloadPromise;
  const raw = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  assert.equal(raw.seed, 1); assert.equal(raw.history.length, 6);
  assert(raw.history.filter(p => ['Held-out evaluation', 'Learned output removed'].includes(p.phase)).every(p => p.results.every(r => !r.weightsChanged)));
  assert(raw.retention.every(r => r.stateIdentical && r.choicesIdentical));
  await download.saveAs(path.join(out, 'downloaded-experiment.json'));
  assert.equal(hash(svc.world.toState()), serverBefore);
  assert(methods.slice(requestsBefore).every(r => r.method === 'GET'));
  pass('acquisition, held-out, reversal, ablation, restore and JSON download run locally with zero world changes or write requests');
  await audit(a, 'learning lab results');
  for (const task of ['cue', 'threat']) {
    await a.getByLabel('Scenario', { exact: true }).selectOption(task);
    await a.getByLabel('Seed', { exact: true }).fill('7');
    await a.getByRole('button', { name: 'Reset this experiment', exact: true }).click();
    await a.getByText('No measured trials yet. Evaluate an untrained baseline or start training.', { exact: true }).waitFor();
    await a.getByRole('button', { name: 'Train 300 trials', exact: true }).click();
    await a.getByRole('heading', { name: 'Acquisition', exact: true }).waitFor();
    await a.getByRole('button', { name: 'Evaluate without learning', exact: true }).click();
    await a.getByRole('heading', { name: 'Held-out evaluation', exact: true }).waitFor();
    results.observations[task] = await a.locator('.lab-results').innerText();
  }
  pass('food cue and learned-danger scenario controls run new measured experiments');
  for (const width of [320, 390, 800, 1440]) { await a.setViewportSize({ width, height: 844 }); await noOverflow(a); }
  await a.setViewportSize({ width: 667, height: 375 }); await noOverflow(a);
  await a.screenshot({ path: path.join(out, 'lab-landscape-667.jpg'), type: 'jpeg', quality: 78 });
  await a.setViewportSize({ width: 390, height: 844 });
  await a.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await a.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  await a.locator('.panel-body').evaluate(el => el.scrollTop = 0);
  await a.screenshot({ path: path.join(out, 'lab-390.jpg'), type: 'jpeg', quality: 78 });
  pass('lab reflows through portrait, landscape and reduced-motion states');
  // Honest fallback for an old server: remove ONLY the additive brain field in a named response fixture.
  await b.route('**/api/creatures/*', async route => {
    const response = await route.fetch(); const data = await response.json(); delete data.brainBehavior;
    await route.fulfill({ response, json: data });
  });
  await b.getByText('Brain details unavailable', { exact: true }).waitFor();
  await b.unroute('**/api/creatures/*');
  await b.locator('[data-brain-mode="mb-v1"]').waitFor();
  pass('old-server response fixture shows an explicit unavailable state and recovers');
  let rate = true;
  await b.route('**/api/creatures/*', route => rate ? route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'rate_limited', retryAfterSec: 1 }) }) : route.continue());
  await b.locator('.error').filter({ hasText: 'Too many requests. Try again in 1 seconds.' }).waitFor();
  await b.getByText(/Last received details/).waitFor(); rate = false;
  await b.getByRole('button', { name: 'Retry details', exact: true }).click();
  await b.getByRole('button', { name: 'Learning', exact: true }).click();
  await b.locator('[data-brain-mode="mb-v1"]').waitFor();
  await b.unroute('**/api/creatures/*');
  pass('429 fixture marks retained data stale and retry recovers');
  // Default local-world flow exercises the compiled worker, real tools, needs and history.
  await a.getByRole('button', { name: 'Open settings', exact: true }).click();
  await a.getByRole('button', { name: 'Disconnect and clear saved settings', exact: true }).click();
  await a.getByRole('button', { name: 'Explore local demo', exact: true }).click();
  await a.locator('[data-mode="demo"]').waitFor();
  await inspect(a);
  assert.equal(await a.locator('.brain-behavior').getAttribute('data-brain-mode'), 'mb-v1');
  await a.getByRole('button', { name: 'Needs', exact: true }).click(); assert.equal(await a.locator('.needs meter').count(), 3);
  await a.getByRole('button', { name: 'Memories', exact: true }).click(); assert(await a.locator('.story-list li').count() > 0);
  await a.getByRole('button', { name: 'History', exact: true }).click();
  assert(await a.getByRole('heading', { name: 'World history', exact: true }).isVisible());
  await a.getByRole('button', { name: 'Close panel', exact: true }).click();
  await a.getByRole('button', { name: 'Pause local demo', exact: true }).click();
  await a.waitForTimeout(500); // let the worker consume the pause message
  const tick = await a.locator('.app').getAttribute('data-world-tick');
  await a.waitForTimeout(600); assert.equal(await a.locator('.app').getAttribute('data-world-tick'), tick);
  await a.getByRole('button', { name: 'Resume local demo', exact: true }).click();
  await a.waitForFunction(tick => document.querySelector('.app').dataset.worldTick !== tick, tick);
  pass('private mb-v1 world worker, needs, memories, history and pause/resume remain functional');
  assert.equal(DEFAULTS.world.brainMode, 'legacy');
  assert.equal(hash(svc.world.toState()), serverBefore);
  pass('browser experiments and local world leave shared world unchanged; production default remains legacy');
  assert.deepEqual(errors, []); assert.deepEqual(failedAssets, []);
  pass('no uncaught application errors or missing static resources under /preview/');
  await Promise.all(contexts.map(c => c.close()));
} catch (error) { results.errors.push(String(error.stack)); console.error(error); process.exitCode = 1; }
finally {
  if (await exportIndexHash() !== results.indexSha256) { results.errors.push('Export changed during browser validation'); process.exitCode = 1; }
  results.observations.uncaught = errors; results.observations.failedStatic = failedAssets;
  await browser?.close(); svc.stop();
  for (const s of [server, preview]) { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); }
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.writeFile(path.join(out, 'checks.json'), JSON.stringify(results, null, 2) + '\n');
}
