// Render actual private-worker biome frames through the production export.
// Start web/scripts/preview.mjs first; no authoritative server is created or changed.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const { chromium } = await import(
  process.env.IMD_PLAYWRIGHT
    ? pathToFileURL(process.env.IMD_PLAYWRIGHT).href
    : "playwright"
);
const base = process.argv[2] ?? "http://127.0.0.1:4173/preview/";
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 851, height: 650 } });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.addEventListener("message", ({ data }) => {
          if (data.frame) window.__validationFrame = data.frame;
        });
      }
    };
  });
  await page.goto(`${base}?demo=1`);
  await page.waitForFunction(() => window.__validationFrame?.v === 1);
  await page.waitForSelector("canvas[data-drawn]");
  for (const [biome, p] of [
    ["cold", { x: 0, y: -80 }],
    ["arid", { x: 125, y: 0 }],
    ["coast", { x: -75, y: 110 }],
  ]) {
    const bounds = await page.evaluate(() => window.__validationFrame.bounds);
    const mini = page.getByRole("button", { name: /Navigate using minimap/ }),
      box = await mini.boundingBox();
    await mini.click({
      position: {
        x: ((p.x - bounds.x0) / (bounds.x1 - bounds.x0)) * box.width,
        y: ((p.y - bounds.y0) / (bounds.y1 - bounds.y0)) * box.height,
      },
    });
    await page.waitForFunction(
      (expected) => window.__validationFrame?.view.biome === expected,
      biome,
    );
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => ({
      source: document.querySelector(".exp-app").dataset.display,
      tick: window.__validationFrame.tick,
      biome: window.__validationFrame.view.biome,
      viewport: {
        x: window.__validationFrame.view.x0,
        y: window.__validationFrame.view.y0,
        w: window.__validationFrame.view.w,
        h: window.__validationFrame.view.h,
      },
      kinds: [...new Set(window.__validationFrame.view.nodes.map((n) => n[1]))],
    }));
    assert.equal(state.source, "demo");
    results.push(state);
    await page.screenshot({
      path: path.join(root, `artifacts/overhaul/demo-${biome}-851.jpg`),
      type: "jpeg",
      quality: 68,
    });
  }
  await page.goto(base);
  await page.waitForSelector("canvas[data-drawn]");
  await page.locator(".exp-canvas").focus();
  await page.keyboard.press("ArrowRight");
  await page.screenshot({
    path: path.join(root, "artifacts/overhaul/focus-851.jpg"),
    type: "jpeg",
    quality: 68,
  });
  const colors = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector(".exp-app"));
    return Object.fromEntries(
      [
        "--hud-deep",
        "--hud",
        "--hud-raised",
        "--hud-hover",
        "--hud-text",
        "--hud-muted",
        "--gold",
        "--focus",
      ].map((k) => [k, s.getPropertyValue(k).trim()]),
    );
  });
  const lum = (h) => {
    const c = h
      .slice(1)
      .match(/../g)
      .map((x) => parseInt(x, 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  const pairs = [
    ["--hud-text", "--hud"],
    ["--hud-muted", "--hud"],
    ["--hud-muted", "--hud-hover"],
    ["--hud-deep", "--gold"],
    ["--gold", "--hud-deep"],
    ["--focus", "--hud"],
  ].map(([fg, bg]) => {
    const l = [lum(colors[fg]), lum(colors[bg])].sort((a, b) => a - b);
    return {
      foreground: fg,
      background: bg,
      foregroundHex: colors[fg],
      backgroundHex: colors[bg],
      ratio: Number(((l[1] + 0.05) / (l[0] + 0.05)).toFixed(2)),
    };
  });
  assert.ok(pairs.every((p) => p.ratio >= 4.5));
  const font = await page.evaluate(() =>
    [...document.fonts]
      .filter((f) => f.family.includes("Manrope"))
      .map((f) => ({ family: f.family, status: f.status, weight: f.weight })),
  );
  await fs.writeFile(
    path.join(root, "artifacts/overhaul/biomes-results.json"),
    JSON.stringify(
      {
        mode: "actual isolated browser engine; no shared world",
        results,
        computedHudContrast: pairs,
        font,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      { biomes: results.map((r) => r.biome), contrast: pairs, font },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
