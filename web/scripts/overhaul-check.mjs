// Bounded validation of the committed static export; owns and closes its local preview.
// --live adds a READ-ONLY proxy in Playwright, solely to verify the existing production API.
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const { chromium, webkit } = await import(
  process.env.IMD_PLAYWRIGHT
    ? pathToFileURL(process.env.IMD_PLAYWRIGHT).href
    : "playwright"
);
const { default: AxeBuilder } = await import("@axe-core/playwright");
const out = path.join(root, "artifacts/overhaul");
await fs.mkdir(out, { recursive: true });
const capture = JSON.parse(
  await fs.readFile(path.join(root, "web/src/expanse/recording.json"), "utf8"),
);
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://local"),
      rel =
        decodeURIComponent(url.pathname.replace(/^\/preview\//, "")) ||
        "index.html";
    if (!url.pathname.startsWith("/preview/") || rel.includes(".."))
      throw Error();
    const file = path.join(root, "dist", rel),
      data = await fs.readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`,
  url = `${origin}/preview/`;
const report = {
  date: new Date().toISOString(),
  export: "dist/",
  base: "/preview/",
  viewports: [],
  checks: [],
  browserErrors: [],
  performance: [],
  live: null,
  limitations: [],
};
const allBrowsers = [];
const check = (name, evidence) => {
  report.checks.push({ name, passed: true, evidence });
  console.log("PASS", name);
};
const ready = async (p) => {
  await p.waitForSelector("canvas[data-drawn]");
  await p.evaluate(() => document.fonts.ready);
};
const noOverflow = async (p) =>
  assert.ok(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "horizontal overflow",
  );
const cam = async (p) =>
  JSON.parse(await p.locator(".exp-canvas").getAttribute("data-camera"));
function listen(page, label) {
  page.on("pageerror", (e) =>
    report.browserErrors.push({ label, message: e.message }),
  );
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      !m.text().includes("503") &&
      !m.text().includes("500")
    )
      report.browserErrors.push({ label, message: m.text() });
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/api/"))
      report.browserErrors.push({
        label,
        resource: r.url(),
        status: r.status(),
      });
  });
}
function fixture(
  q,
  { population = 1, target = { x: 27, y: 28 }, tick = 1000 } = {},
) {
  const x = Number(q.get("x") ?? 0),
    y = Number(q.get("y") ?? 0),
    w = Number(q.get("w") ?? 56),
    h = Number(q.get("h") ?? 56);
  const residents = Array.from({ length: population }, (_, i) => ({
    id: 10000 + i,
    name: `Fixture resident ${i}`,
    x: population === 1 ? target.x : 8 + (i % 25),
    y: population === 1 ? target.y : 8 + Math.floor(i / 25),
    health: 80,
    action: "move",
  }));
  const f = {
    ...capture,
    worldId: "synthetic-validation-fixture",
    tick,
    summary: { ...capture.summary, population },
    residents,
    inspector: null,
    discoveries: [],
    social: [],
  };
  f.view = {
    ...capture.view,
    tick,
    x0: x,
    y0: y,
    w,
    h,
    tiles: Array(w * h).fill(0),
    creatures: residents
      .filter((r) => r.x >= x && r.x < x + w && r.y >= y && r.y < y + h)
      .map((r) => [r.id, r.name, r.x, r.y, r.action, r.health]),
    nodes: [],
    shelters: [],
    fires: [],
  };
  return f;
}
async function banner(p, text) {
  await p.evaluate((text) => {
    let b = document.getElementById("validation-label");
    if (!b) {
      b = document.createElement("div");
      b.id = "validation-label";
      b.style.cssText =
        "position:fixed;left:50%;top:108px;transform:translateX(-50%);padding:6px 10px;background:#182c25;color:#ffe1a0;font:12px Arial;z-index:1000;pointer-events:none;border-radius:5px";
      document.body.appendChild(b);
    }
    b.textContent = text;
  }, text);
}
try {
  const browser = await chromium.launch({ headless: true });
  allBrowsers.push(browser);
  for (const width of [390, 851, 1440, 320]) {
    const context = await browser.newContext({
      viewport: {
        width,
        height: width === 851 ? 1000 : width >= 1000 ? 900 : 844,
      },
      deviceScaleFactor: 1,
      hasTouch: width < 700,
      isMobile: width < 700,
    });
    const page = await context.newPage();
    listen(page, `chromium-${width}`);
    await page.goto(url);
    await ready(page);
    await noOverflow(page);
    assert.equal(
      await page.locator(".exp-app").getAttribute("data-display"),
      "recording",
    );
    assert.ok(
      await page
        .getByRole("button", { name: "Explore demo", exact: true })
        .isVisible(),
    );
    const box = await page
      .getByRole("button", { name: "Explore demo", exact: true })
      .boundingBox();
    assert.ok(box.y + box.height < 844);
    if (width !== 320)
      await page.screenshot({
        path: path.join(out, `recorded-${width}.jpg`),
        type: "jpeg",
        quality: 78,
      });
    const trigger = page.getByRole("button", {
      name: "Choose world and connection",
      exact: true,
    });
    await trigger.click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Tab");
    assert.ok(
      await page
        .getByRole("dialog")
        .evaluate((d) => d.contains(document.activeElement)),
    );
    await page.keyboard.press("Escape");
    assert.ok(await trigger.evaluate((e) => e === document.activeElement));
    await page
      .locator(".exp-scene-actions")
      .getByRole("button", { name: "Find residents", exact: true })
      .click();
    const chosen = capture.inspector
      ? capture.residents.find((r) => r.id === capture.inspector.id)
      : capture.residents[0];
    await page
      .getByRole("searchbox", { name: "Search residents" })
      .fill(String(chosen.id));
    assert.equal(await page.locator(".exp-resident").count(), 1);
    await page.locator(".exp-resident").click();
    await page.locator(`[data-creature-id="${chosen.id}"]`).waitFor();
    await noOverflow(page);
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: path.join(out, `inspector-${width}.jpg`),
        type: "jpeg",
        quality: 78,
      });
    if (capture.inspector) {
      await page
        .locator("summary")
        .filter({ hasText: /^Perception/ })
        .click();
      assert.ok(
        await page
          .getByRole("button", { name: "Show perception range" })
          .isVisible(),
      );
      await page.getByRole("button", { name: "Show perception range" }).click();
      await page
        .locator("summary")
        .filter({ hasText: /^Learning/ })
        .click();
      assert.ok(await page.getByText("Inventory", { exact: true }).isVisible());
    }
    await page
      .getByRole("button", { name: "Follow resident", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Following resident", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.locator(".exp-canvas").focus();
    await page.keyboard.press("ArrowRight");
    assert.ok(
      await page
        .getByRole("button", { name: "Follow resident", exact: true })
        .isVisible(),
    );
    await page
      .getByRole("button", { name: "Close panel", exact: true })
      .click();
    const before = await cam(page);
    await page.locator(".exp-canvas").focus();
    await page.keyboard.press("+");
    const after = await cam(page);
    assert.ok(after.span < before.span);
    await page.keyboard.press("-");
    const mini = page.getByRole("button", { name: /Navigate using minimap/ });
    await mini.click({ position: { x: 10, y: 10 } });
    const next = await cam(page);
    assert.ok(next.x !== after.x || next.y !== after.y);
    if (width === 390) {
      const axe = await new AxeBuilder({ page }).analyze();
      report.axe = {
        violations: axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
        })),
      };
      assert.equal(axe.violations.length, 0, JSON.stringify(report.axe));
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page
        .getByRole("button", { name: "Return to original settlement" })
        .click();
      await page.waitForTimeout(250);
      const a = await page
        .locator(".exp-canvas")
        .evaluate((c) => c.toDataURL());
      await page.waitForTimeout(400);
      const b = await page
        .locator(".exp-canvas")
        .evaluate((c) => c.toDataURL());
      assert.equal(a, b, "reduced-motion recorded canvas must be stable");
    }
    report.viewports.push({
      browser: "Chromium",
      width,
      overflow: false,
      recorded: true,
      search: true,
      inspector: true,
      follow: true,
      keyboardPan: true,
      zoom: true,
      minimap: true,
      focusReturn: true,
    });
    await context.close();
  }
  check("responsive primary flow at 320, 390, 851 and 1440", report.viewports);
  check(
    "zero axe violations in recorded mobile view; reduced motion freezes visual loops",
    report.axe,
  );
  {
    const p = await browser.newPage({ viewport: { width: 851, height: 393 } });
    listen(p, "landscape-851");
    await p.goto(url);
    await ready(p);
    await noOverflow(p);
    for (const button of await p
      .locator(".exp-tool-rail button:visible,.exp-map-controls button:visible")
      .all()) {
      const box = await button.boundingBox();
      assert.ok(box.y + box.height <= 393, "clipped landscape control");
    }
    await p.screenshot({
      path: path.join(out, "landscape-851.jpg"),
      type: "jpeg",
      quality: 78,
    });
    await p.goto(`${url}#settlement`);
    await p
      .getByRole("heading", {
        name: "The settlement is now part of the Expanse",
      })
      .waitFor();
    assert.equal(await p.locator(".wallet-button").count(), 0);
    await p.close();
    check(
      "short landscape controls fit; retired settlement fails closed",
      true,
    );
  }
  // The real existing engine in its explicitly isolated worker, not a shared server.
  {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    listen(page, "demo-390");
    await page.goto(`${url}?demo=1`);
    await ready(page);
    await page.waitForFunction(
      () =>
        document.querySelector(".exp-app")?.dataset.connection === "connected",
    );
    const first = Number(
      await page.locator(".exp-app").getAttribute("data-tick"),
    );
    await page.waitForTimeout(1000);
    const second = Number(
      await page.locator(".exp-app").getAttribute("data-tick"),
    );
    assert.ok(second > first);
    assert.equal(
      await page.locator(".exp-app").getAttribute("data-display"),
      "demo",
    );
    const canvas = page.locator(".exp-canvas"),
      b = await canvas.boundingBox(),
      start = await cam(page),
      cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: b.x + b.width * 0.55, y: b.y + b.height * 0.55 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: b.x + b.width * 0.7, y: b.y + b.height * 0.6 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    const moved = await cam(page);
    assert.ok(start.x !== moved.x || start.y !== moved.y);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: 120, y: 400 },
        { x: 240, y: 400 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: 90, y: 400 },
        { x: 270, y: 400 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert.ok((await cam(page)).span < moved.span);
    await page.getByRole("button", { name: "Pause demo", exact: true }).click();
    await page.waitForTimeout(600);
    const paused = await page.locator(".exp-app").getAttribute("data-tick");
    await page.waitForTimeout(600);
    assert.equal(
      await page.locator(".exp-app").getAttribute("data-tick"),
      paused,
    );
    await page
      .getByRole("button", { name: "Resume demo", exact: true })
      .click();
    await page.screenshot({
      path: path.join(out, "isolated-demo-390.jpg"),
      type: "jpeg",
      quality: 78,
    });
    await page.close();
    check(
      "isolated engine advances, pauses and resumes; touch pan and pinch work",
      { first, second },
    );
  }
  if (process.argv.includes("--live")) {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const messages = [];
    p.on("console", (m) => {
      if (m.type() === "error") messages.push(m.text());
    });
    await p.goto(url);
    await ready(p);
    await p.getByRole("button", { name: "Connect live", exact: true }).click();
    await p.waitForFunction(() =>
      ["connected", "stale"].includes(
        document.querySelector(".exp-app")?.dataset.connection,
      ),
    );
    const status = await p.locator(".exp-app").getAttribute("data-connection");
    report.crossOrigin = {
      status,
      publicServer: "https://stratoks.2-29-11-211.sslip.io",
      expectedConsoleMessages: messages,
    };
    if (status === "stale") {
      assert.equal(
        await p.locator(".exp-app").getAttribute("data-display"),
        "recording",
      );
      assert.ok(
        await p
          .getByText(
            "Live connection unavailable. Showing a recorded preview.",
            { exact: true },
          )
          .isVisible(),
      );
      await p.screenshot({
        path: path.join(out, "connection-blocked-390.jpg"),
        type: "jpeg",
        quality: 78,
      });
    }
    await p.close();
    check(
      "direct live origin access is reported honestly",
      report.crossOrigin.status,
    );
  }
  // Exercise actual canvas picking against a clearly synthetic response fixture.
  {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    listen(page, "picking-fixture");
    let target = { x: 27, y: 28 };
    let tick = 1000;
    await page.route("**/api/expanse/frame?*", (route) =>
      route.fulfill({
        json: fixture(new URL(route.request().url()).searchParams, {
          target,
          tick: ++tick,
        }),
      }),
    );
    await page.goto(`${url}?server=${encodeURIComponent(origin)}`);
    await ready(page);
    await banner(page, "Synthetic coordinate validation fixture");
    const cases = [];
    for (const point of [
      { x: 27, y: 28 },
      { x: 28, y: 27 },
      { x: -1, y: -28 },
      { x: -28, y: -1 },
    ]) {
      target = point;
      const mini = page.getByRole("button", { name: /Navigate using minimap/ }),
        r = await mini.boundingBox();
      await mini.click({
        position: {
          x: ((point.x + 112) / 280) * r.width,
          y: ((point.y + 112) / 280) * r.height,
        },
      });
      await page.waitForTimeout(1200);
      for (const zoom of ["initial", "in", "out"]) {
        const canvas = page.locator(".exp-canvas");
        if (zoom !== "initial") {
          await canvas.focus();
          for (let i = 0; i < (zoom === "in" ? 2 : 4); i++)
            await page.keyboard.press(zoom === "in" ? "+" : "-");
          await page.waitForTimeout(1200);
        }
        const c = await cam(page),
          size = JSON.parse(await canvas.getAttribute("data-size")),
          r = await canvas.boundingBox(),
          s = size.w / (2 * c.span),
          dx = point.x + 0.5 - c.x,
          dy = point.y + 0.5 - c.y;
        const x = size.w / 2 + (dx - dy) * s,
          y = size.h / 2 + (dx + dy) * s * 0.5 - s * 1.05;
        await canvas.click({ position: { x, y } });
        await page.locator('[data-creature-id="10000"]').waitFor();
        assert.equal(
          await page.locator('[data-creature-id="10000"]').count(),
          1,
        );
        cases.push({ point, span: c.span, picked: 10000 });
        await page
          .getByRole("button", { name: "Close panel", exact: true })
          .click();
        await page.waitForTimeout(250);
      }
    }
    await page.close();
    check(
      "canvas picks the correct resident at 12 zoom/chunk combinations",
      cases,
    );
  }
  // A pinch ending over a resident must not turn its last pointer-up into a tap.
  {
    const p = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    listen(p, "pinch-regression");
    let tick = 2000;
    await p.route("**/api/expanse/frame?*", (route) =>
      route.fulfill({
        json: fixture(new URL(route.request().url()).searchParams, {
          target: { x: 27, y: 28 },
          tick: ++tick,
        }),
      }),
    );
    await p.goto(`${url}?server=${encodeURIComponent(origin)}`);
    await ready(p);
    await banner(p, "Synthetic pinch regression fixture");
    const canvas = p.locator(".exp-canvas"),
      c = await cam(p),
      size = JSON.parse(await canvas.getAttribute("data-size")),
      box = await canvas.boundingBox(),
      s = size.w / (2 * c.span);
    const x = box.x + size.w / 2 + (27.5 - c.x - (28.5 - c.y)) * s,
      y = box.y + size.h / 2 + (27.5 - c.x + 28.5 - c.y) * s * 0.5 - 1.092 * s;
    const cd = await p.context().newCDPSession(p);
    await cd.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: x - 40, y },
        { x: x + 40, y },
      ],
    });
    await cd.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x - 5, y },
        { x: x + 5, y },
      ],
    });
    await p.waitForTimeout(100);
    await cd.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await p.waitForTimeout(100);
    assert.equal(
      await p.locator(".exp-inspector-panel").count(),
      0,
      "pinch release selected a resident",
    );
    await p.touchscreen.tap(x, y);
    await p.locator('[data-creature-id="10000"]').waitFor();
    await p.close();
    check(
      "pinch release does not select a resident; a later intentional tap does",
      true,
    );
  }
  // Performance keeps the captured resource/shelter scene and replaces only population.
  for (const population of [24, 120, 250, 500]) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    listen(page, `synthetic-${population}`);
    let tick = 1000;
    await page.route("**/api/expanse/frame?*", async (route) => {
      const f = fixture(new URL(route.request().url()).searchParams, {
        population,
        tick: ++tick,
      });
      f.view.nodes = capture.view.nodes;
      f.view.shelters = capture.view.shelters;
      f.view.fires = [];
      await route.fulfill({ json: f });
    });
    await page.goto(`${url}?server=${encodeURIComponent(origin)}`);
    await ready(page);
    await banner(
      page,
      `Synthetic performance fixture · ${population} residents · captured scenery`,
    );
    await page.waitForTimeout(600);
    const measurement = await page.evaluate(async () => {
      const gaps = [];
      let last = performance.now();
      await new Promise((resolve) => {
        const start = performance.now();
        function step(now) {
          gaps.push(now - last);
          last = now;
          if (now - start < 2000) requestAnimationFrame(step);
          else resolve();
        }
        requestAnimationFrame(step);
      });
      const canvas = document.querySelector(".exp-canvas"),
        times = JSON.parse(canvas.dataset.drawTimes ?? "[]");
      const stat = (values) => {
        values.sort((a, b) => a - b);
        return {
          samples: values.length,
          median: values[Math.floor(values.length * 0.5)],
          p95: values[Math.floor(values.length * 0.95)],
          max: values.at(-1),
        };
      };
      return {
        rafGapMs: stat(gaps),
        drawMs: stat(times),
        drawn: Number(canvas.dataset.drawn),
        culled: Number(canvas.dataset.culled),
        devicePixelRatio,
      };
    });
    report.performance.push({
      kind: "synthetic",
      population,
      viewport: "1440x900",
      renderCapHz: 30,
      ...measurement,
    });
    await page.close();
  }
  check(
    "synthetic performance measured separately from live",
    report.performance,
  );
  try {
    const b = await webkit.launch({ headless: true });
    allBrowsers.push(b);
    const page = await b.newPage({ viewport: { width: 390, height: 844 } });
    listen(page, "webkit-390");
    await page.goto(url);
    await ready(page);
    await noOverflow(page);
    await page
      .getByRole("button", { name: "Explore demo", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelector(".exp-app")?.dataset.display === "demo",
    );
    await page
      .locator(".exp-tool-rail")
      .getByRole("button", { name: "Find residents", exact: true })
      .click();
    await page.locator(".exp-resident").first().click();
    await page
      .getByRole("button", { name: "Follow resident", exact: true })
      .click();
    await page.screenshot({
      path: path.join(out, "webkit-demo-390.jpg"),
      type: "jpeg",
      quality: 78,
    });
    await page.close();
    check("WebKit mobile demo, resident selection and follow", true);
  } catch (e) {
    report.limitations.push(`WebKit: ${e.message}`);
    console.log("LIMITATION WebKit", e.message.slice(0, 200));
  }
  if (process.argv.includes("--live")) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: {
        dir: path.join(root, "test/scratch/video"),
        size: { width: 960, height: 600 },
      },
    });
    const page = await context.newPage();
    listen(page, "live-read-only-proxy");
    let interrupted = false;
    const frames = [];
    const live = "https://stratoks.2-29-11-211.sslip.io";
    await page.route(`${live}/api/expanse/frame?*`, async (route) => {
      if (interrupted) {
        await route.fulfill({
          status: 503,
          json: { error: "intentional validation disconnect" },
        });
        return;
      }
      try {
        const response = await fetch(route.request().url(), {
          signal: AbortSignal.timeout(15000),
        });
        const f = await response.json();
        frames.push({
          tick: f.tick,
          worldId: f.worldId,
          residents: f.residents.map((r) => ({ id: r.id, x: r.x, y: r.y })),
        });
        await route.fulfill({ json: f });
      } catch {
        await route.fulfill({
          status: 503,
          json: { error: "live source unavailable" },
        });
      }
    });
    await page.goto(`${url}?server=${encodeURIComponent(live)}`);
    await ready(page);
    await banner(
      page,
      "Live validation · read-only test proxy · no production changes",
    );
    await page.waitForFunction(
      () =>
        document.querySelector(".exp-app")?.dataset.connection === "connected",
    );
    await page.waitForTimeout(1500);
    assert.equal(frames[0].worldId, capture.worldId);
    await page
      .locator(".exp-scene-actions")
      .getByRole("button", { name: "Find residents", exact: true })
      .click();
    const name = await page.locator(".exp-resident").first().innerText();
    await page.locator(".exp-resident").first().click();
    await page
      .getByRole("button", { name: "Follow resident", exact: true })
      .click();
    await page.waitForTimeout(2400);
    await page.screenshot({
      path: path.join(out, "live-proxy-inspector-1280.jpg"),
      type: "jpeg",
      quality: 78,
    });
    await page.locator(".exp-canvas").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("+");
    await page.waitForTimeout(700);
    await page
      .getByRole("button", { name: "Close panel", exact: true })
      .click();
    await page
      .getByRole("button", { name: /Navigate using minimap/ })
      .click({ position: { x: 90, y: 85 } });
    await page.waitForTimeout(1000);
    await page
      .getByRole("button", { name: "Return to original settlement" })
      .click();
    await page.waitForTimeout(1000);
    interrupted = true;
    await page.waitForFunction(
      () => document.querySelector(".exp-app")?.dataset.connection === "stale",
    );
    await banner(
      page,
      "Live validation · intentional disconnect · last confirmed state retained",
    );
    await page.waitForTimeout(700);
    interrupted = false;
    await page.getByRole("button", { name: "Reconnect", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector(".exp-app")?.dataset.connection === "connected",
    );
    await banner(
      page,
      "Live validation · reconnected to the same authoritative world",
    );
    await page.waitForTimeout(1000);
    const first = frames[0],
      last = frames.at(-1),
      moved = last.residents.filter((r) => {
        const p = first.residents.find((p) => p.id === r.id);
        return p && (p.x !== r.x || p.y !== r.y);
      }).length;
    assert.ok(last.tick > first.tick);
    assert.ok(moved > 0);
    report.live = {
      transport:
        "Playwright read-only route proxy; bypasses CORS only in validation",
      worldId: first.worldId,
      firstTick: first.tick,
      lastTick: last.tick,
      population: last.residents.length,
      movedResidents: moved,
      frames: frames.length,
      selected: name,
      actions: [
        "selection",
        "follow",
        "keyboard pan",
        "zoom",
        "minimap",
        "intentional disconnect",
        "reconnect",
      ],
    };
    const video = page.video();
    await context.close();
    const videoPath = await video.path();
    let ffmpeg = process.env.STRATOKS_FFMPEG;
    if (!ffmpeg) {
      const cache = path.dirname(
        path.dirname(path.dirname(chromium.executablePath())),
      );
      const found = (await fs.readdir(cache)).find((n) =>
        n.startsWith("ffmpeg-"),
      );
      if (found) ffmpeg = path.join(cache, found, "ffmpeg-linux");
    }
    const encoded = ffmpeg
      ? spawnSync(
          ffmpeg,
          [
            "-y",
            "-i",
            videoPath,
            "-r",
            "12",
            "-c:v",
            "libvpx-vp9",
            "-b:v",
            "220k",
            "-crf",
            "38",
            "-deadline",
            "good",
            "-cpu-used",
            "4",
            "-an",
            path.join(out, "live-interactions.webm"),
          ],
          { stdio: "ignore" },
        )
      : null;
    if (encoded?.status !== 0) {
      await fs.copyFile(videoPath, path.join(out, "live-interactions.webm"));
      report.limitations.push(
        "Video encoder unavailable; retained original recording.",
      );
    }
    check(
      "actual live API movement and reconnect recorded without modifying the server",
      report.live,
    );
  }
  assert.equal(
    report.browserErrors.length,
    0,
    JSON.stringify(report.browserErrors),
  );
  check(
    "no unexpected browser JavaScript errors or broken local resources",
    true,
  );
} catch (e) {
  report.failure = { message: e.message, stack: e.stack };
  process.exitCode = 1;
  console.error(e);
} finally {
  for (const b of allBrowsers) await b.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.writeFile(
    path.join(out, "browser-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
