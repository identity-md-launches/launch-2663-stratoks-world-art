import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const project = spawnSync('node', ['web/scripts/task.mjs', 'path'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const { chromium } = await import(pathToFileURL(path.join(project, 'node_modules/playwright/index.mjs')));
const child = spawn('node', ['web/scripts/demo-server.mjs', '0'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
const exit = new Promise(resolve => child.once('exit', resolve));
let browser;
const result = { checks: [], errors: [] };
try {
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Demo launcher startup timed out')), 15000);
    child.once('error', reject);
    child.stdout.on('data', data => { output += data; const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/preview\//); if (match) { clearTimeout(timer); resolve(match[0]); } });
  });
  const cfg = await (await fetch(url + 'world-config.json')).json();
  assert.equal(cfg.isolated, true); assert.equal(new URL(cfg.httpUrl).hostname, '127.0.0.1');
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  // A deliberately invalid test fixture, never a shipped server configuration.
  await context.addInitScript(() => localStorage.setItem('stratoks-service-v1', JSON.stringify({ httpUrl: 'https://saved-world.invalid', wsUrl: 'wss://saved-world.invalid/ws' })));
  const a = await context.newPage(), b = await context.newPage(), remote = [];
  for (const p of [a, b]) p.on('request', r => { if (r.url().includes('saved-world.invalid')) remote.push(r.url()); });
  await Promise.all([a.goto(url), b.goto(url)]);
  for (const p of [a, b]) { await p.locator('[data-mode="connected"]').waitFor(); await p.getByText('Local test server', { exact: true }).first().waitFor(); }
  const id = await a.locator('.app').getAttribute('data-world-id');
  assert.equal(await b.locator('.app').getAttribute('data-world-id'), id);
  const start = Number(await a.locator('.app').getAttribute('data-world-tick'));
  await a.waitForFunction(tick => Number(document.querySelector('.app').dataset.worldTick) >= tick + 2, start);
  assert.deepEqual(remote, []);
  await a.getByRole('button', { name: 'Open settings', exact: true }).click();
  assert.equal(await a.getByLabel('World service URL').inputValue(), cfg.httpUrl);
  result.checks.push('fresh loopback server and relative static client start', 'static server rejects writes', 'isolated config overrides an old saved remote URL', 'two actual tabs share one mb-v1 world and observe one-second ticks', 'settings displays the actual isolated service URL, not stale remote settings');
  result.worldId = id; result.tickAfter = Number(await a.locator('.app').getAttribute('data-world-tick'));
  await context.close();
} catch (e) { result.errors.push(String(e.stack)); process.exitCode = 1; }
finally {
  await browser?.close(); child.kill('SIGTERM'); await exit;
  await fs.mkdir(path.join(root, 'artifacts/phase2a-client'), { recursive: true });
  await fs.writeFile(path.join(root, 'artifacts/phase2a-client/demo-launcher.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
