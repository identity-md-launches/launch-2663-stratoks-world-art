import test from "node:test";
import assert from "node:assert/strict";
import { GroundCache } from "./ground";
import { settlementWear } from "./paths";
import type { WorldFrame } from "./types";

const frame = (): WorldFrame => ({
  worldId: "unit-test", seed: 42, tick: 1,
  view: { x0: 0, y0: 0, w: 16, h: 16, tiles: Array(256).fill(0), nodes: [], shelters: [], fires: [] },
}) as unknown as WorldFrame;

test("paint caches survive pan/zoom and invalidate changed terrain and world identity", () => {
  const gradient = { addColorStop() {} };
  const context = new Proxy({}, { get: (_, name) => name === "createLinearGradient" || name === "createRadialGradient" ? () => gradient : () => {} });
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } });
  try {
    const cache = new GroundCache({}), f = frame(), size = { w: 100, h: 100 };
    const ctx = context as CanvasRenderingContext2D;
    cache.draw(ctx, f, { x: 8, y: 8, span: 8 }, size);
    const initial = cache.builds;
    assert.ok(initial > 0);
    for (let i = 0; i < 20; i++) cache.draw(ctx, f, { x: 8 + i / 100, y: 8, span: 8 - i / 20 }, size);
    assert.equal(cache.builds, initial, "camera changes must blit existing world rasters");
    const changed = { ...f, tick: 2, view: { ...f.view, tiles: [...f.view.tiles] } };
    changed.view.tiles[8 * 16 + 8] = 1;
    cache.draw(ctx, changed, { x: 8, y: 8, span: 8 }, size);
    assert.ok(cache.builds > initial, "received terrain changes must repaint");
    const beforeWorldChange = cache.builds;
    cache.draw(ctx, { ...changed, worldId: "another-world" }, { x: 8, y: 8, span: 8 }, size);
    assert.ok(cache.builds > beforeWorldChange);
    assert.ok(cache.size <= 96);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("worn paint uses reported shelters and adjacent travel without crossing blocked land or water", () => {
  const f = frame();
  assert.deepEqual(settlementWear(f), []);
  f.view.shelters = [[1, 4, 4], [2, 7, 4]];
  const original = JSON.stringify(f);
  const wear = settlementWear(f, [{ from: { x: 10, y: 10 }, to: { x: 11, y: 10 } }]);
  assert.ok(wear.some(s => s.from.x === 10 && s.to.x === 11));
  assert.ok(wear.length > 4, "nearby shelter approaches should read as connected worn ground");
  assert.equal(JSON.stringify(f), original, "presentation must not mutate API state");
  f.view.tiles[4 * 16 + 5] = 1;
  f.view.nodes = [["tree", "tree", 4, 5, 3]];
  for (const s of settlementWear(f)) for (const p of [s.from, s.to]) {
    assert.notDeepEqual(p, { x: 5, y: 4 });
    assert.notDeepEqual(p, { x: 4, y: 5 });
  }
  const empty = frame();
  empty.view.tiles[10 * 16 + 11] = 7;
  assert.deepEqual(settlementWear(empty, [{ from: { x: 10, y: 10 }, to: { x: 11, y: 11 } }]), []);
});
