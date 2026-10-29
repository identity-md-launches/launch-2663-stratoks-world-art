// Bounded browser regressions for the reopened world-art review. No shared engine.
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../../", import.meta.url));
const staged = spawnSync(process.execPath, [path.join(root, "web/scripts/task.mjs"), "path"], { encoding: "utf8" }).stdout.trim();
const playwright = process.env.IMD_PLAYWRIGHT
  ? await import(pathToFileURL(process.env.IMD_PLAYWRIGHT).href)
  : await import("playwright").catch(() => import(pathToFileURL(path.join(staged, "node_modules/playwright/index.mjs")).href));
const { chromium, webkit } = playwright;
const out = path.join(root, "artifacts/overhaul");
await fs.mkdir(out, { recursive: true });
const capture = JSON.parse(await fs.readFile(path.join(root, "web/src/expanse/recording.json"), "utf8"));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://local"), rel = decodeURIComponent(url.pathname.replace(/^\/preview\//, "")) || "index.html";
    if (!url.pathname.startsWith("/preview/") || rel.includes("..")) throw Error();
    res.writeHead(200, { "Content-Type": mime[path.extname(rel)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(await fs.readFile(path.join(root, "dist", rel)));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`, url = `${origin}/preview/`;
const report = { date: new Date().toISOString(), export: "dist/ at /preview/", layouts: [], keyboardMinimap: [], performance: [], errors: [], limitations: [] };
const allBrowsers = [];
const camera = async p => JSON.parse(await p.locator(".exp-canvas").getAttribute("data-camera"));
const ready = async p => { await p.waitForSelector("canvas[data-drawn]"); await p.evaluate(() => document.fonts.ready); };
function listen(p, label) {
  p.on("pageerror", e => report.errors.push({ label, message: e.message }));
  p.on("response", r => { if (r.status() >= 400 && !r.url().includes("/api/")) report.errors.push({ label, resource: r.url(), status: r.status() }); });
}
async function unobscured(p) {
  const issues = await p.evaluate(() => {
    const stage = document.querySelector(".exp-world-stage").getBoundingClientRect(), issues = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push("horizontal overflow");
    for (const e of document.querySelectorAll(".exp-scene-actions button,.exp-tool-rail button,.exp-map-controls button,.exp-scene-notice button,.exp-follow-banner,.exp-atlas-label")) {
      const b = e.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      const name = e.getAttribute("aria-label") || e.textContent;
      if (b.left < stage.left || b.right > stage.right + 1 || b.top < stage.top || b.bottom > stage.bottom + 1) issues.push(`clipped: ${name}`);
      for (const [x, y] of [[.5,.5],[.15,.2],[.85,.8]]) {
        if (!e.contains(document.elementFromPoint(b.left + b.width * x, b.top + b.height * y))) { issues.push(`covered: ${name}`); break; }
      }
    }
    const heading = document.querySelector(".exp-scene-heading").getBoundingClientRect();
    if (heading.width) for (const e of document.querySelectorAll(".exp-scene-notice,.exp-follow-banner,.exp-tool-rail,.exp-map-controls")) {
      const b = e.getBoundingClientRect();
      if (b.width && b.left < heading.right && b.right > heading.left && b.top < heading.bottom && b.bottom > heading.top) issues.push(`HUD overlaps title/actions: ${e.className}`);
    }
    return issues;
  });
  assert.deepEqual(issues, []);
}
async function chooseYela(p) {
  await p.locator(".exp-scene-actions").getByRole("button", { name: "Find residents", exact: true }).click();
  await p.getByRole("searchbox", { name: "Search residents" }).fill("602");
  await p.locator(".exp-resident").click();
  await p.getByRole("button", { name: "Follow resident", exact: true }).click();
  await p.waitForTimeout(200); // Capture the settled pressed colors, after the 150ms transition.
}
function fixture(q, count, tick) {
  const residents = Array.from({ length: count }, (_, i) => ({ id: 10000 + i, name: `Fixture resident ${i}`, x: i === 0 ? 27 + tick % 2 : 8 + i % 25, y: i === 0 ? 28 : 8 + Math.floor(i / 25), health: 80, action: "gather" }));
  const x0 = Number(q.get("x")), y0 = Number(q.get("y")), w = Number(q.get("w")), h = Number(q.get("h"));
  const inside = (x, y) => x >= x0 && y >= y0 && x < x0 + w && y < y0 + h;
  const selected = residents.find(r => r.id === Number(q.get("creature")));
  return { ...capture, tick, worldId: "synthetic-revision-performance-fixture", residents, summary: { ...capture.summary, population: count },
    view: { ...capture.view, tick, x0, y0, w, h, tiles: Array.from({ length: w * h }, (_, i) => {
      const x = x0 + i % w, y = y0 + Math.floor(i / w), v = capture.view;
      return x >= v.x0 && y >= v.y0 && x < v.x0 + v.w && y < v.y0 + v.h ? v.tiles[(y-v.y0)*v.w+x-v.x0] : 0;
    }), nodes: capture.view.nodes.filter(([, , x, y]) => inside(x,y)), shelters: capture.view.shelters.filter(([, x, y]) => inside(x,y)), fires: [], creatures: residents.filter(r => inside(r.x,r.y)).map(r => [r.id,r.name,r.x,r.y,r.action,r.health]) },
    inspector: selected ? { ...capture.inspector, ...selected, needs: { ...capture.inspector.needs, health: 80 }, inventory: {}, observation: null, currentPlan: null, recentPlans: [], episodes: [] } : null };
}
async function measurement(p) {
  return p.locator(".exp-canvas").evaluate(e => {
    const a = JSON.parse(e.dataset.drawTimes).sort((a,b) => a-b);
    return { samples: a.length, medianMs: a[Math.floor(a.length*.5)], p95Ms: a[Math.floor(a.length*.95)], maxMs: a.at(-1), terrainBuilds: Number(e.dataset.terrainBuilds), cachedChunks: Number(e.dataset.terrainChunks), drawn: Number(e.dataset.drawn), culled: Number(e.dataset.culled), dpr: devicePixelRatio };
  });
}
try {
  for (const [name, type] of [["Chromium", chromium], ["WebKit", webkit]]) {
    const browser = await type.launch({ headless: true }); allBrowsers.push(browser);
    for (const [width, height] of [[667,390],[390,600],[320,568],[320,844],[390,844],[851,393],[851,1000],[1440,900]]) {
      const p = await browser.newPage({ viewport: { width, height } }); listen(p, `${name}-${width}x${height}`);
      await p.goto(url); await ready(p); await unobscured(p);
      if (name === "Chromium" && [[667,390],[390,600],[320,568]].some(([w,h]) => w===width && h===height)) await p.screenshot({ path: path.join(out, `revision-${width}x${height}.jpg`), type: "jpeg", quality: 65 });
      await chooseYela(p); await unobscured(p);
      if (name === "Chromium" && width === 320 && height === 844) await p.screenshot({ path: path.join(out, "revision-follow-320.jpg"), type: "jpeg", quality: 65 });
      const notice = await p.locator(".exp-scene-notice").boundingBox(), follow = await p.locator(".exp-follow-banner").boundingBox();
      assert.ok(follow.y >= notice.y + notice.height + 6 || width > 700, "follow must flow below a wrapped phone notice");
      await p.getByRole("button", { name: "Close panel", exact: true }).click();
      await unobscured(p);
      const mini = p.getByRole("button", { name: /Navigate using minimap/ });
      if (!await mini.isVisible()) await p.getByRole("button", { name: "Toggle world atlas" }).click();
      const before = await camera(p); await mini.focus();
      await p.keyboard.press("Enter"); assert.deepEqual(await camera(p), before);
      await p.keyboard.press("Space"); assert.deepEqual(await camera(p), before);
      await p.keyboard.press("ArrowRight"); const arrow = await camera(p); assert.ok(arrow.x > before.x);
      const b = await mini.boundingBox();
      await mini.click({ position: { x: b.width * .5, y: b.height * .5 } });
      const pointer = await camera(p); assert.ok(Math.abs(pointer.x - 28) < 1 && Math.abs(pointer.y - 28) < 1);
      report.keyboardMinimap.push({ browser: name, width, height, before, enterAndSpace: "unchanged", arrow: "one chunk right", pointer });
      report.layouts.push({ browser: name, version: browser.version(), width, height, entry: "all controls exposed", search: true, selection: 602, follow: true, noticeAndFollowGap: follow.y - notice.y - notice.height });
      await p.close();
    }
    console.log("PASS", name, "short/tall phone, tablet and desktop layout; minimap keyboard and pointer");
  }
  const browser = allBrowsers[0];
  // Each phase runs >4s to replace the 120-frame rolling trace. No concurrent probes.
  for (const [width, height, dpr] of [[1440,900,1],[390,844,2]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
    const p = await context.newPage(); listen(p, `synthetic-${width}-dpr${dpr}`);
    let tick = 1000, interrupted = false;
    await p.route("**/api/expanse/frame?*", route => interrupted ? route.fulfill({ status: 503, json: { error: "intentional test interruption" } }) : route.fulfill({ json: fixture(new URL(route.request().url()).searchParams, 120, ++tick) }));
    await p.goto(`${url}?server=${encodeURIComponent(origin)}`); await ready(p);
    await p.evaluate(() => { const label=document.createElement("div"); label.textContent="Synthetic performance fixture · 120 residents · captured scenery"; label.style.cssText="position:fixed;bottom:0;left:0;background:#25362e;color:#ffe1a0;z-index:1000;font:12px Arial"; document.body.append(label); });
    await p.waitForTimeout(4700); const idle = await measurement(p);
    const box = await p.locator(".exp-canvas").boundingBox(), x = box.x + box.width*.62, y = box.y + box.height*.48;
    await p.mouse.move(x,y); await p.mouse.down();
    for (let i=0;i<80;i++) { await p.mouse.move(x + Math.sin(i/12)*80, y + Math.cos(i/12)*30); await p.waitForTimeout(60); }
    await p.mouse.up(); const pan = await measurement(p);
    for (let i=0;i<80;i++) { await p.mouse.wheel(0, Math.floor(i/10)%2 ? 30 : -30); await p.waitForTimeout(60); }
    const zoom = await measurement(p);
    await p.locator(".exp-tool-rail").getByRole("button", { name: "Find residents", exact: true }).click();
    await p.getByRole("searchbox", { name: "Search residents" }).fill("10000"); await p.locator(".exp-resident").click();
    await p.getByRole("button", { name: "Follow resident", exact: true }).click();
    await p.getByRole("button", { name: "Close panel", exact: true }).click();
    const followPositions = [await camera(p)];
    for (let i = 0; i < 12; i++) { await p.waitForTimeout(500); followPositions.push(await camera(p)); }
    const follow = await measurement(p);
    const followPositionChanged = followPositions.some(c => c.x !== followPositions[0].x || c.y !== followPositions[0].y);
    assert.ok(followPositionChanged, "follow must track confirmed fixture movement");
    interrupted = true; await p.waitForFunction(() => document.querySelector('.exp-app').dataset.connection === 'stale');
    await unobscured(p);
    interrupted = false; await p.getByRole("button", { name: "Reconnect", exact: true }).click();
    await p.waitForFunction(() => document.querySelector('.exp-app').dataset.connection === 'connected');
    report.performance.push({ kind: "synthetic; not live", population: 120, scenery: "captured nodes and shelters; query-clipped terrain, grass outside capture", width, height, dpr, renderCapHz: 30, idle, pan, zoom, follow, followPositions, followPositionChanged, reconnect: "passed" });
    await context.close(); console.log("PASS synthetic pan/zoom/follow/reconnect", width, dpr);
  }
  assert.deepEqual(report.errors, []);
  report.limitations.push("Browser automation is not physical-phone or screen-reader testing. Draw times are renderer CPU durations, not measured display fps. Startup/newly visible/changed chunks can still cost a raster build. Synthetic performance is separate from prior read-only live evidence.");
} finally {
  for (const b of allBrowsers) await b.close();
  await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(out, "revision-results.json"), JSON.stringify(report, null, 2) + "\n");
}
