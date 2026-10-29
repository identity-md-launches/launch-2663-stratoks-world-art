// Real production export + authoritative service. No fixed/private keys are written to disk.
// Dependencies remain in the isolated frontend build directory.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { DEFAULTS, deepMerge } from "../../server/src/config.js";
import { Service } from "../../server/src/service.js";
import { createServer } from "../../server/src/http.js";
const root = fileURLToPath(new URL("../../", import.meta.url));
const p = spawnSync("node", ["web/scripts/task.mjs", "path"], {
  cwd: root,
  encoding: "utf8",
});
if (p.status !== 0) throw new Error(p.stderr);
const project = p.stdout.trim().split("\n").at(-1);
const { chromium, webkit } = await import(
  pathToFileURL(path.join(project, "node_modules/playwright/index.mjs"))
);
const { default: AxeBuilder } = await import(
  pathToFileURL(
    path.join(project, "node_modules/@axe-core/playwright/dist/index.mjs"),
  )
);
const { privateKeyToAccount } = await import(
  pathToFileURL(path.join(project, "node_modules/viem/_esm/accounts/index.js"))
);
const account = privateKeyToAccount("0x" + randomBytes(32).toString("hex"));
const artifacts = path.join(root, "artifacts");
await fs.mkdir(artifacts, { recursive: true });
const previewPort = 4178,
  origin = `http://127.0.0.1:${previewPort}`,
  url = origin + "/preview/";
const preview = spawn(
  "node",
  ["web/scripts/preview.mjs", String(previewPort)],
  { cwd: root, stdio: ["ignore", "pipe", "inherit"] },
);
await new Promise((r, j) => {
  preview.stdout.once("data", r);
  preview.on("error", j);
});
const dataDir = await fs.mkdtemp(
  path.join(os.tmpdir(), "stratoks-browser-world-"),
);
const cfg = deepMerge(DEFAULTS, {
  server: { host: "127.0.0.1", port: 0, dataDir, allowedOrigins: [origin] },
  world: { tickMs: 80 },
  auth: { developerWallets: [account.address.toLowerCase()] },
});
const svc = new Service(cfg);
svc.start();
clearTimeout(svc.timer);
for (let i = 0; i < 900; i++) svc.tickOnce();
svc.snapshot();
const server = createServer(svc);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
let ticker = setInterval(() => svc.tickOnce(), 80);
const results = {
  date: new Date().toISOString(),
  browsers: {},
  checks: [],
  errors: [],
  screenshots: [],
};
const check = (name, data = {}) => {
  results.checks.push({ name, passed: true, ...data });
  console.log("PASS", name);
};
let browser;
try {
  browser = await chromium.launch({ headless: true });
  results.browsers.chromium = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const unexpected = [];
  page.on("pageerror", (e) => unexpected.push(e.message));
  await page.goto(url);
  await page.getByRole("button", { name: "Explore local demo" }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.match(
    await page.locator(".offline-note").innerText(),
    /World server not connected/,
  );
  assert.equal(await page.locator(".world-metrics").count(), 0);
  const remote = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((u) => !u.startsWith(location.origin)),
  );
  assert.deepEqual(remote, []);
  check(
    "unconfigured export shows no fabricated live metrics and makes no remote requests",
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const cta = await page
      .getByRole("button", { name: "Explore local demo" })
      .boundingBox();
    assert(cta && cta.y + cta.height < 844);
    if ([390, 1440].includes(width)) {
      const file = `unconfigured-${width}.png`;
      await page.screenshot({ path: path.join(artifacts, file) });
      results.screenshots.push(file);
    }
  }
  check(
    "product and primary action visible without overflow at 320, 390, 768, 1440",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  await page.getByLabel("World service URL").fill("http://untrusted.example");
  await page
    .getByRole("button", { name: "Connect to world", exact: true })
    .click();
  await page
    .getByText("Use HTTPS, or HTTP on localhost for testing.")
    .waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Open settings", exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  check(
    "settings validate insecure remote URL; keyboard dialog traps focus and Escape restores trigger",
  );
  await page.getByRole("button", { name: "Explore local demo" }).click();
  await page.locator('[data-mode="demo"]').waitFor();
  await page.waitForTimeout(150);
  assert.equal(
    await page
      .locator(".metric")
      .first()
      .innerText()
      .then((s) => s.includes("24")),
    true,
  );
  const tick = Number(
    await page.locator(".app").getAttribute("data-world-tick"),
  );
  await page.waitForTimeout(350);
  assert(
    Number(await page.locator(".app").getAttribute("data-world-tick")) > tick,
  );
  await page
    .getByRole("button", { name: "Pause local demo", exact: true })
    .click();
  await page.waitForTimeout(100);
  const paused = await page.locator(".app").getAttribute("data-world-tick");
  await page.waitForTimeout(350);
  assert.equal(
    await page.locator(".app").getAttribute("data-world-tick"),
    paused,
  );
  check("same-engine worker demo runs and pause stops simulation ticks");
  await page.screenshot({ path: path.join(artifacts, "demo-mobile.png") });
  results.screenshots.push("demo-mobile.png");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(artifacts, "demo-desktop.png") });
  results.screenshots.push("demo-desktop.png");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  assert.equal(await page.locator(".zoom-value").innerText(), "120%");
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.getByRole("button", { name: "Center world", exact: true }).click();
  await page.locator("canvas").focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Home");
  check("pan, zoom and center controls respond to keyboard and pointer");
  await page.getByRole("button", { name: "Residents", exact: true }).click();
  await page
    .getByRole("searchbox", { name: "Find a Stratok" })
    .fill("no-such-resident");
  await page.getByText("No residents match this view.").waitFor();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.locator(".resident-row").first().click();
  await page.getByText("Personality", { exact: true }).waitFor();
  assert.equal(await page.locator("meter").count(), 3);
  await page.getByRole("button", { name: "Memories", exact: true }).click();
  assert((await page.locator(".story-list li").count()) > 0);
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await page.getByRole("heading", { name: "Recent decisions" }).waitFor();
  assert((await page.locator(".decision").count()) > 0);
  await page.getByRole("button", { name: "Needs", exact: true }).click();
  check(
    "resident search, needs, relationships, memories, decisions and learned state inspect real creatures",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(artifacts, "inspector-mobile.png") });
  results.screenshots.push("inspector-mobile.png");
  assert.equal(await page.locator(".world-update").isVisible(), false);
  check("mobile inspector no longer collides with status footer");
  const scans = [];
  for (const name of ["inspector"]) {
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    scans.push({
      state: name,
      violations: audit.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    });
  }
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .getByRole("button", { name: "Apply intervention", exact: true })
    .click();
  await page.getByText(/Applied at tick/).waitFor();
  await page.getByLabel("Intervention", { exact: true }).selectOption("fire");
  await page
    .getByRole("button", { name: "Apply destructive intervention" })
    .click();
  await page
    .getByText("Confirm the damage below before applying this intervention.")
    .waitFor();
  await page
    .getByRole("checkbox", { name: /I understand this damages/ })
    .check();
  await page
    .getByRole("button", { name: "Apply destructive intervention" })
    .click();
  await page.getByText(/Applied at tick/).waitFor();
  check(
    "demo interventions change simulation and destructive actions require explicit confirmation",
  );
  await page.getByRole("button", { name: "History", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download history" }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "stratoks-history.csv");
  assert((await page.locator("[data-event-seq]").count()) > 0);
  check("population/resource history, event filtering and CSV download");
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Open settings" }).click();
  assert.equal(
    await page.getByRole("checkbox", { name: /Animate creatures/ }).isChecked(),
    false,
  );
  assert.equal(
    await page
      .getByRole("checkbox", { name: /Animate creatures/ })
      .isDisabled(),
    true,
  );
  await page.keyboard.press("Escape");
  check("reduced-motion preference disables cosmetic animation");
  // Share image is an actual prototype view, clearly labeled Local demo.
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.waitForTimeout(100);
  if (process.argv.includes("--capture-share"))
    await page.screenshot({ path: path.join(root, "web/public/share.png") });
  // Test the real WebSocket protocol and EIP-6963 + EIP-191 path with a generated ephemeral wallet.
  const liveContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await liveContext.exposeFunction("testWalletSign", (message) =>
    account.signMessage({ message: { raw: message } }),
  );
  await liveContext.addInitScript(
    ({ address }) => {
      let granted = false;
      const listeners = new Map();
      const provider = {
        request: async ({ method, params }) => {
          if (method === "eth_accounts") return granted ? [address] : [];
          if (method === "eth_requestAccounts") {
            granted = true;
            return [address];
          }
          if (method === "eth_chainId") return "0x1";
          if (method === "net_version") return "1";
          if (method === "personal_sign")
            return window.testWalletSign(params[0]);
          if (method === "wallet_switchEthereumChain") return null;
          throw new Error("Unsupported test request " + method);
        },
        on: (event, fn) => {
          listeners.set(event, fn);
        },
        removeListener: (event) => listeners.delete(event),
      };
      window.ethereum = provider;
      const announce = () =>
        dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: {
                uuid: "e4b0cf6f-51ad-4a70-8a39-036c2d1b5216",
                name: "Integration wallet",
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="%23315d40"/></svg>',
                rdns: "test.stratoks.wallet",
              },
              provider,
            },
          }),
        );
      addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { address: account.address },
  );
  const a = await liveContext.newPage(),
    b = await liveContext.newPage();
  for (const client of [a, b]) {
    client.on("pageerror", (e) => unexpected.push(e.message));
    await client.goto(url);
    await client.getByRole("button", { name: "Open settings" }).click();
    await client.getByLabel("World service URL").fill(base);
    await client
      .getByRole("button", { name: "Connect to world", exact: true })
      .click();
    await client.locator('[data-mode="connected"]').waitFor();
  }
  clearInterval(ticker);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(
    await a.locator(".app").getAttribute("data-world-id"),
    await b.locator(".app").getAttribute("data-world-id"),
  );
  assert.equal(
    await a.locator(".app").getAttribute("data-world-tick"),
    await b.locator(".app").getAttribute("data-world-tick"),
  );
  assert.deepEqual(
    await a.locator(".world-metrics").innerText(),
    await b.locator(".world-metrics").innerText(),
  );
  check(
    "two real browser clients share the authoritative world, tick and metrics",
  );
  await a.getByRole("button", { name: "Connect", exact: true }).click();
  await a
    .getByRole("button", { name: "Integration wallet", exact: true })
    .click();
  await a.getByRole("button", { name: "Sign in to world" }).click();
  await a.getByRole("dialog").waitFor({ state: "detached" });
  check(
    "EIP-6963 wallet discovered; viem personal signature verified by delivered server",
  );
  await a.getByRole("button", { name: "Visit", exact: true }).click();
  await a.getByRole("button", { name: "Place visitor", exact: true }).click();
  await a.getByText("Your visitor is in the world.").waitFor();
  await a.getByRole("button", { name: "Leave food", exact: true }).click();
  await a
    .getByText(
      "Food was left nearby. Stratoks can remember this wallet’s help.",
    )
    .waitFor();
  check("authenticated visitor presence and food gift reach the shared server");
  let loseResponse = true;
  await a.route("**/api/dev/interventions", async (route) => {
    if (loseResponse && route.request().method() === "POST") {
      loseResponse = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await a.getByRole("button", { name: "Tools", exact: true }).click();
  await a
    .getByRole("button", { name: "Apply intervention", exact: true })
    .click();
  await a.getByRole("button", { name: "Retry same intervention" }).waitFor();
  assert.equal(svc.world.totals.interventions, 1);
  await a.getByRole("button", { name: "Observe", exact: true }).click();
  await a.getByRole("button", { name: "Tools", exact: true }).click();
  await a.getByText(/Request ID:/).waitFor();
  await a.getByRole("button", { name: "Retry same intervention" }).click();
  await a.getByText(/Already applied; no duplicate effect/).waitFor();
  assert.equal(svc.world.totals.interventions, 1);
  svc.tickOnce();
  await b.waitForTimeout(100);
  check(
    "authenticated developer intervention survives a lost response; retry applies effect exactly once",
  );
  await a.unroute("**/api/dev/interventions");
  let loseWith500 = true;
  await a.route("**/api/dev/interventions", async (route) => {
    if (loseWith500 && route.request().method() === "POST") {
      loseWith500 = false;
      await route.fetch();
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "internal_error" }),
      });
    } else await route.continue();
  });
  await a
    .getByRole("combobox", { name: "Intervention", exact: true })
    .selectOption("heal_area");
  await a
    .getByRole("button", { name: "Apply intervention", exact: true })
    .click();
  await a.getByRole("button", { name: "Retry same intervention" }).waitFor();
  assert.equal(svc.world.totals.interventions, 2);
  await a.getByRole("button", { name: "Retry same intervention" }).click();
  await a.getByText(/Already applied; no duplicate effect/).waitFor();
  assert.equal(svc.world.totals.interventions, 2);
  check(
    "HTTP 5xx preserves uncertain request ID and retry cannot repeat an accepted effect",
  );
  // Anonymous POST is rejected, even from an allowed origin.
  const denied = await fetch(base + "/api/dev/interventions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      id: "not-authorized",
      type: "fire",
      x: 28,
      y: 28,
      radius: 4,
      intensity: 0.5,
    }),
  });
  assert.equal(denied.status, 401);
  check("anonymous destructive API request rejected");
  await a.getByRole("button", { name: "History", exact: true }).click();
  for (const c of svc.clients) c.close(1012);
  await a.locator('[data-mode="reconnecting"]').waitFor();
  await a.locator('[data-mode="connected"]').waitFor({ timeout: 15000 });
  await b.locator('[data-mode="connected"]').waitFor({ timeout: 15000 });
  const sequences = await a
    .locator("[data-event-seq]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-event-seq")));
  assert.equal(new Set(sequences).size, sequences.length);
  check(
    "socket interruption reconnects and resynchronizes without duplicate visible events",
  );
  // A new world ID forces a full snapshot instead of applying delta geometry over the old world.
  const oldWorld = svc.world.id;
  svc.resetWorld({ seed: 12345 });
  svc.tickOnce();
  await a.waitForFunction(
    (id) => document.querySelector(".app").dataset.worldId !== id,
    oldWorld,
  );
  await a.waitForTimeout(150);
  assert.equal(
    await a.locator(".app").getAttribute("data-world-id"),
    svc.world.id,
  );
  check("explicit server reset resynchronizes geometry and new event sequence");
  for (const client of [a, b]) await client.close();
  await liveContext.close();
  results.axe = scans;
  const violations = scans.flatMap((s) => s.violations);
  if (violations.length) {
    console.log("AXE FINDINGS", JSON.stringify(violations, null, 2));
    results.errors.push("Accessibility scan findings require review.");
  } else check("automated axe WCAG A/AA scan: inspector has no violations");
  assert.deepEqual(unexpected, []);
  check("no uncaught application errors across tested Chromium flows");
  await context.close();
  try {
    const safari = await webkit.launch({ headless: true });
    results.browsers.webkit = safari.version();
    const sp = await safari.newPage({ viewport: { width: 390, height: 844 } });
    await sp.goto(url);
    await sp.getByRole("button", { name: "Explore local demo" }).click();
    await sp.locator('[data-mode="demo"]').waitFor();
    await sp.getByRole("button", { name: "Residents", exact: true }).click();
    await sp.locator(".resident-row").first().click();
    await sp.getByText("Personality", { exact: true }).waitFor();
    await safari.close();
    check("WebKit mobile primary interaction");
  } catch (e) {
    results.browsers.webkit = { notRun: String(e.message).slice(0, 1200) };
    console.log("WEBKIT LIMITATION", String(e.message).slice(0, 350));
  }
} catch (e) {
  results.errors.push(String(e.stack));
  console.error(e);
  process.exitCode = 1;
} finally {
  clearInterval(ticker);
  await browser?.close();
  svc.stop();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  preview.kill("SIGTERM");
  await fs.writeFile(
    path.join(artifacts, "browser-checks.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
}
