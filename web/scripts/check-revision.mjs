// Regression checks for the four reopened client findings, against the production
// export and real service. Test wallets and world data exist only in memory / /tmp.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULTS, deepMerge } from "../../server/src/config.js";
import { Service } from "../../server/src/service.js";
import { createServer } from "../../server/src/http.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const prepared = spawnSync("node", ["web/scripts/task.mjs", "path"], {
  cwd: root, encoding: "utf8",
});
assert.equal(prepared.status, 0, prepared.stderr);
const project = prepared.stdout.trim().split("\n").at(-1);
const { chromium, webkit } = await import(
  pathToFileURL(path.join(project, "node_modules/playwright/index.mjs"))
);
const { privateKeyToAccount } = await import(
  pathToFileURL(path.join(project, "node_modules/viem/_esm/accounts/index.js"))
);
const account = privateKeyToAccount("0x" + randomBytes(32).toString("hex"));
const wallet = account.address.toLowerCase();
const out = path.resolve(process.argv[2] ?? path.join(root, "artifacts/revision"));
await fs.mkdir(out, { recursive: true });
const results = { date: new Date().toISOString(), checks: [], layouts: [], screenshots: [], errors: [] };
const pass = (name, evidence = {}) => {
  results.checks.push({ name, passed: true, ...evidence });
  console.log("PASS", name);
};
const previewPort = 4194;
const origin = `http://127.0.0.1:${previewPort}`, url = origin + "/preview/";
const preview = spawn("node", ["web/scripts/preview.mjs", String(previewPort)], {
  cwd: root, stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((resolve, reject) => {
  preview.stdout.once("data", resolve);
  preview.once("error", reject);
  preview.once("exit", (code) => reject(new Error(`Preview exited ${code}`)));
});
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "stratoks-revision-world-"));
const svc = new Service(deepMerge(DEFAULTS, {
  server: { host: "127.0.0.1", port: 0, dataDir, allowedOrigins: [origin] },
}), { log: () => {} });
svc.start();
clearTimeout(svc.timer);
const server = createServer(svc);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const full = "The world’s visitor spaces are full. Try again later.";

async function connect(page, target = base) {
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await page.getByLabel("World service URL").fill(target);
  await page.getByRole("button", { name: "Connect to world", exact: true }).click();
}
async function layout(page, state) {
  const measurement = await page.evaluate(() => {
    const box = (selector) => {
      const node = document.querySelector(selector);
      return node && node.checkVisibility() ? node.getBoundingClientRect().toJSON() : null;
    };
    return {
      width: innerWidth, height: innerHeight, scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      app: box(".app"), header: box(".app-header"), footer: box(".world-footer"),
      action: box(".welcome .primary"), welcome: box(".welcome"),
      notice: box(".connection-notice"), heading: box(".world-heading"),
      metrics: box(".world-metrics"), panel: box(".side-panel"),
    };
  });
  results.layouts.push({ state, ...measurement });
  assert.equal(measurement.scrollY, 0, state);
  assert.equal(measurement.app.height, measurement.height, state);
  assert.equal(measurement.scrollHeight, measurement.height, state);
  assert(measurement.scrollWidth <= measurement.width, state);
  assert(measurement.footer.bottom <= measurement.height, state);
  if (measurement.action) {
    assert(measurement.action.top >= measurement.header.bottom, state);
    assert(measurement.welcome.bottom <= measurement.footer.top, state);
  }
  if (measurement.notice && measurement.heading) {
    assert(measurement.heading.top >= measurement.notice.bottom + 8, state);
  }
  if (measurement.notice && measurement.metrics) {
    assert(measurement.metrics.top >= measurement.heading.bottom, state);
  }
  return measurement;
}
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(out, name) });
  results.screenshots.push(name);
}
async function checkDock(page) {
  for (const name of ["Observe", "Residents", "History", "Visit", "Tools"]) {
    const button = page.getByRole("button", { name, exact: true });
    const box = await button.boundingBox();
    const viewport = page.viewportSize();
    assert(box && box.y >= 0 && box.y + box.height <= viewport.height, name);
    assert(await button.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }), `${name} is covered`);
    await button.click();
    if (name !== "Observe") {
      const panel = await page.locator(".side-panel").boundingBox();
      assert(panel && panel.y >= 0 && panel.y + panel.height <= box.y, name);
      await layout(page, name);
    }
  }
}
function fillVisitors() {
  while (Object.keys(svc.world.visitors).length < 64)
    assert(svc.world.visitorPresence("0x" + randomBytes(20).toString("hex"), 28, 28));
}
function freeSpace() {
  const other = Object.keys(svc.world.visitors).find((key) => key !== wallet);
  assert(other);
  delete svc.world.visitors[other];
}
async function place(page, expected) {
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/api/visitor/presence") && r.request().method() === "POST");
  await page.getByRole("button", { name: /^(Place visitor|Refresh presence)$/ }).click();
  const result = await response;
  assert.equal(result.status(), 200);
  assert.deepEqual(await result.json(), { ok: expected });
  if (expected) await page.getByText("Your visitor is in the world.", { exact: true }).waitFor();
  else await page.getByText(full, { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Leave food", exact: true }).isEnabled(), expected);
}

try {
  browser = await chromium.launch({ headless: true });
  results.chromium = browser.version();
  const unexpected = [];
  for (const [width, height] of [[667, 375], [844, 390], [568, 320], [390, 844], [320, 700], [360, 540], [768, 1024], [1440, 1000]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", (e) => unexpected.push(e.message));
    await page.goto(url);
    await page.getByRole("button", { name: "Explore local demo" }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await layout(page, "fresh preview");
    if (width === 667) await screenshot(page, "landscape-preview-667.png");
    if (width === 390) await screenshot(page, "preview-390.png");
    await page.getByRole("button", { name: "Explore local demo" }).click();
    await page.locator('[data-mode="demo"]').waitFor();
    await layout(page, "local demo");
    await checkDock(page);
    if (width === 667) {
      await page.getByRole("button", { name: "Residents", exact: true }).click();
      const body = page.locator(".panel-body");
      assert(await body.evaluate((el) => el.scrollHeight > el.clientHeight));
      await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      assert(await body.evaluate((el) => el.scrollTop > 0));
      await layout(page, "landscape panel scrolled internally");
      await screenshot(page, "landscape-residents-667.png");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Observe", exact: true }).waitFor();
      await page.getByRole("button", { name: "Residents", exact: true }).click();
      await page.locator(".resident-row").first().click();
      await page.getByRole("button", { name: "Learning", exact: true }).click();
      await page.getByText("Learning from experience", { exact: false }).waitFor();
      await layout(page, "landscape inspector");
    }
    pass(`viewport, primary action, demo and five toolbar actions at ${width}×${height}`);
    await page.close();
  }

  for (const [width, height] of [[390, 844], [320, 700], [667, 375], [568, 320], [360, 540]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(url);
    await connect(page, "http://127.0.0.1:48739");
    await page.getByText("Cannot connect to the world. Retrying automatically.", { exact: true }).waitFor();
    await page.waitForTimeout(80); // ResizeObserver measurement commits before geometry checks.
    assert.equal(await page.locator(".app").getAttribute("data-world-id"), "");
    await layout(page, "initial connection failure");
    if (width === 390) await screenshot(page, "connection-failure-390.png");
    pass(`initial failure copy and unobstructed title/action at ${width}×${height}`);
    await page.close();
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.exposeFunction("testWalletSign", (message) => account.signMessage({ message: { raw: message } }));
  await context.addInitScript(({ address }) => {
    let granted = false;
    const provider = {
      request: async ({ method, params }) => {
        if (method === "eth_accounts") return granted ? [address] : [];
        if (method === "eth_requestAccounts") { granted = true; return [address]; }
        if (method === "eth_chainId") return "0x1";
        if (method === "net_version") return "1";
        if (method === "personal_sign") return window.testWalletSign(params[0]);
        throw new Error(`Unsupported test method: ${method}`);
      },
      on: () => {}, removeListener: () => {},
    };
    window.ethereum = provider;
    const announce = () => dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: {
      info: { uuid: "e4b0cf6f-51ad-4a70-8a39-036c2d1b5216", name: "Revision wallet",
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: "test.stratoks.wallet" },
      provider,
    } }));
    addEventListener("eip6963:requestProvider", announce);
    announce();
  }, { address: account.address });
  const page = await context.newPage();
  let liveSocket;
  page.on("websocket", (socket) => { liveSocket = socket; });
  page.on("pageerror", (e) => unexpected.push(e.message));
  await page.goto(url);
  await connect(page);
  await page.locator('[data-mode="connected"]').waitFor();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/creatures/*", async (route) => { await gate; await route.continue(); });
  await page.getByRole("button", { name: "Residents", exact: true }).click();
  await page.locator(".resident-row").first().click();
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  assert.equal(svc.world.learning, true);
  assert.match(await page.locator(".notice").innerText(), /^Learning from experience/);
  assert.deepEqual(await page.locator(".facts dd").allTextContents(), ["–", "–", "–"]);
  await page.getByText("Loading visitor memories…", { exact: true }).waitFor();
  await screenshot(page, "learning-loading-390.png");
  release();
  await page.waitForFunction(() => document.querySelector(".facts dd")?.textContent !== "–");
  await page.unroute("**/api/creatures/*");
  assert.match(await page.locator(".notice").innerText(), /^Learning from experience/);
  pass("learning uses the actual enabled snapshot before and after delayed creature details");

  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("button", { name: "Revision wallet", exact: true }).click();
  await page.getByRole("button", { name: "Sign in to world", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Visit", exact: true }).click();
  let actions = 0;
  page.on("request", (r) => { if (r.url().endsWith("/api/visitor/action") && r.method() === "POST") actions++; });
  fillVisitors();
  await place(page, false);
  assert.equal(Object.keys(svc.world.visitors).length, 64);
  assert.equal(svc.world.visitors[wallet], undefined);
  assert.equal(await page.locator(".success").innerText(), "");
  assert.equal(actions, 0);
  await screenshot(page, "visitor-capacity-390.png");
  pass("actual 64-visitor HTTP 200 rejection shows capacity error with visitor actions disabled");

  freeSpace();
  await place(page, true);
  assert(svc.world.visitors[wallet]);
  delete svc.world.visitors[wallet];
  fillVisitors();
  await page.getByRole("button", { name: "Leave food", exact: true }).click();
  await page.getByText(full, { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Leave food", exact: true }).isEnabled(), false);
  assert.equal(actions, 0);
  assert.equal(await page.locator(".success").innerText(), "");
  pass("an action's rejected presence check never dispatches /api/visitor/action");

  await page.clock.install();
  freeSpace();
  await place(page, true);
  delete svc.world.visitors[wallet];
  fillVisitors();
  const refreshed = page.waitForResponse((r) => r.url().endsWith("/api/visitor/presence") && r.request().method() === "POST");
  // Let real ping/pong IO complete between virtual heartbeat intervals. Jumping
  // 30 seconds in one step can legitimately trigger the client's stale-socket
  // timeout before the server has any opportunity to answer, signing us out.
  for (let i = 0; i < 6; i++) {
    const pong = liveSocket.waitForEvent("framereceived", {
      predicate: (frame) => {
        try { return JSON.parse(String(frame.payload)).type === "pong"; }
        catch { return false; }
      },
    });
    await page.clock.fastForward(5000);
    await pong;
  }
  await page.clock.fastForward(1);
  assert.deepEqual(await (await refreshed).json(), { ok: false });
  await page.getByText(full, { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Leave food", exact: true }).isEnabled(), false);
  assert.equal(await page.locator(".success").innerText(), "");
  assert.equal(actions, 0);
  pass("30-second presence refresh handles actual capacity rejection (virtual browser clock)");
  freeSpace();
  await place(page, true);
  await page.getByRole("button", { name: "Leave food", exact: true }).click();
  await page.getByText("Food was left nearby. Stratoks can remember this wallet’s help.", { exact: true }).waitFor();
  assert.equal(actions, 1);
  assert(svc.world.bushes.some((b) => b.gift === wallet));
  pass("explicit retry after capacity frees restores placement and a real food gift");
  await page.clock.resume();
  await page.getByRole("button", { name: "Observe", exact: true }).click();
  for (const client of svc.clients) client.close(1012);
  await page.getByText("Connection lost. Retrying automatically; the last world view is frozen.", { exact: true }).waitFor();
  await page.waitForTimeout(80);
  assert.equal(await page.locator(".app").getAttribute("data-world-id"), svc.world.id);
  await layout(page, "existing snapshot connection failure");
  pass("frozen-view wording is retained only after a real snapshot, with heading and metrics below notice");
  await page.locator('[data-mode="connected"]').waitFor({ timeout: 15000 });
  assert.equal(await page.locator(".connection-notice").count(), 0);
  await layout(page, "reconnected, notice space removed");
  pass("automatic reconnect clears the notice and its reserved space");
  await context.close();

  svc.world.learning = false;
  const disabled = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await disabled.goto(url);
  await connect(disabled);
  await disabled.locator('[data-mode="connected"]').waitFor();
  let releaseDisabled;
  const disabledGate = new Promise((resolve) => { releaseDisabled = resolve; });
  await disabled.route("**/api/creatures/*", async (route) => { await disabledGate; await route.continue(); });
  await disabled.getByRole("button", { name: "Residents", exact: true }).click();
  await disabled.locator(".resident-row").first().click();
  await disabled.getByRole("button", { name: "Learning", exact: true }).click();
  assert.match(await disabled.locator(".notice").innerText(), /^Learning disabled for this world/);
  releaseDisabled();
  await disabled.close();
  pass("a genuinely disabled world still reports learning disabled while details load");
  assert.deepEqual(unexpected, []);
  pass("no uncaught application errors across the revision flows");
  try {
    const safari = await webkit.launch({ headless: true });
    try {
      const mobile = await safari.newPage({ viewport: { width: 667, height: 375 } });
      await mobile.goto(url);
      await mobile.getByRole("button", { name: "Explore local demo" }).click();
      await mobile.locator('[data-mode="demo"]').waitFor();
      await layout(mobile, "WebKit landscape");
      await checkDock(mobile);
      pass("WebKit landscape primary interaction and toolbar");
      results.webkit = safari.version();
    } finally { await safari.close(); }
  } catch (e) {
    results.webkit = { notRun: String(e.message).slice(0, 2000) };
    console.log("WEBKIT LIMITATION", String(e.message).slice(0, 250));
  }
} catch (e) {
  results.errors.push(String(e.stack));
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  svc.stop();
  for (const client of svc.clients) client.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  preview.kill("SIGTERM");
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.writeFile(path.join(out, "checks.json"), JSON.stringify(results, null, 2) + "\n");
}
