import test from "node:test";
import assert from "node:assert/strict";
import {
  clampCamera,
  DEFAULT_BOUNDS,
  maxSpan,
  miniPoint,
  miniWorld,
  project,
  unproject,
  viewportQuery,
  visiblePolygon,
  zoomAt,
} from "./projection";
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const widths = [
  { w: 390, h: 722 },
  { w: 851, h: 700 },
  { w: 1440, h: 760 },
];
test("isometric basis points preserve existing coordinates, including negative chunk boundaries", () => {
  const c = { x: 0, y: 0, span: 20 },
    size = { w: 800, h: 600 };
  assert.deepEqual(project({ x: 1, y: 0 }, c, size), { x: 420, y: 310 });
  assert.deepEqual(project({ x: 0, y: 1 }, c, size), { x: 380, y: 310 });
  for (const size of widths)
    for (const span of [9, 12, 20, 32])
      for (const x of [-112, -56, -28, -1, 0, 27, 28, 55, 56, 167])
        for (const y of [-112, -28, -1, 0, 27, 28, 56, 167]) {
          const c = clampCamera(
            { x: 24, y: 24, span },
            DEFAULT_BOUNDS,
            size.w / size.h,
          );
          const p = { x: x + 0.5, y: y + 0.5 },
            back = unproject(project(p, c, size), c, size);
          near(back.x, p.x);
          near(back.y, p.y);
          assert.equal(Math.floor(back.x), x);
          assert.equal(Math.floor(back.y), y);
        }
});
test("all screen corners are covered by the bounded API query at every zoom and aspect", () => {
  for (const size of widths)
    for (const span of [9, 12, maxSpan(size.w / size.h)])
      for (const x of [-1000, -112, -28, 24, 168, 1000])
        for (const y of [-1000, -112, 28, 168, 1000]) {
          const c = clampCamera(
              { x, y, span },
              DEFAULT_BOUNDS,
              size.w / size.h,
            ),
            q = viewportQuery(c, size.w / size.h);
          assert.ok(q.w <= 96 && q.h <= 96);
          assert.ok(q.x >= -112 && q.y >= -112);
          assert.ok(q.x + q.w <= 168 && q.y + q.h <= 168);
          for (const p of visiblePolygon(c, size)) {
            assert.ok(p.x >= q.x - 1e-8 && p.x <= q.x + q.w + 1e-8);
            assert.ok(p.y >= q.y - 1e-8 && p.y <= q.y + q.h + 1e-8);
          }
        }
});
test("zoom keeps the pointer world coordinate stable, while minimap uses the same world bounds", () => {
  for (const size of widths) {
    const c = clampCamera(
        { x: 24, y: 24, span: 12 },
        DEFAULT_BOUNDS,
        size.w / size.h,
      ),
      pointer = { x: size.w * 0.35, y: size.h * 0.4 };
    const next = zoomAt(c, 10, pointer, size),
      before = unproject(pointer, c, size),
      after = unproject(pointer, next, size);
    near(before.x, after.x);
    near(before.y, after.y);
  }
  for (const p of [
    { x: -112, y: -112 },
    { x: 0, y: 0 },
    { x: 28, y: -28 },
    { x: 168, y: 168 },
  ]) {
    const result = miniWorld(miniPoint(p, DEFAULT_BOUNDS), DEFAULT_BOUNDS);
    near(result.x, p.x);
    near(result.y, p.y);
  }
});
