import type { Bounds, Camera, FrameQuery } from "./types";
export type Size = { w: number; h: number };
export type Point = { x: number; y: number };
export const DEFAULT_BOUNDS: Bounds = { x0: -112, y0: -112, x1: 168, y1: 168 };
export const MIN_SPAN = 9;
export const GUTTER = 3;
// Camera is the world-coordinate centre. span controls the width along an isometric diagonal.
export function scale(camera: Camera, size: Size) {
  return size.w / (2 * camera.span);
}
export function project(p: Point, c: Camera, size: Size): Point {
  const s = scale(c, size),
    dx = p.x - c.x,
    dy = p.y - c.y;
  return { x: size.w / 2 + (dx - dy) * s, y: size.h / 2 + (dx + dy) * s * 0.5 };
}
export function unproject(p: Point, c: Camera, size: Size): Point {
  const s = scale(c, size),
    u = (p.x - size.w / 2) / s,
    v = (p.y - size.h / 2) / (s * 0.5);
  return { x: c.x + (u + v) / 2, y: c.y + (v - u) / 2 };
}
export function visiblePolygon(c: Camera, size: Size): Point[] {
  return [
    { x: 0, y: 0 },
    { x: size.w, y: 0 },
    { x: size.w, y: size.h },
    { x: 0, y: size.h },
  ].map((p) => unproject(p, c, size));
}
export function maxSpan(aspect: number) {
  return Math.max(
    MIN_SPAN,
    (94 - 2 * GUTTER) / (1 + 2 / Math.max(0.1, aspect)),
  );
}
export function clampCamera(
  c: Camera,
  b: Bounds = DEFAULT_BOUNDS,
  aspect = 1.5,
): Camera {
  const span = Math.max(MIN_SPAN, Math.min(maxSpan(aspect), c.span));
  const r = span * (0.5 + 1 / aspect);
  const clamp = (v: number, lo: number, hi: number) =>
    lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
  return {
    span,
    x: clamp(c.x, b.x0 + r, b.x1 - r),
    y: clamp(c.y, b.y0 + r, b.y1 - r),
  };
}
export function viewportQuery(
  c: Camera,
  aspect: number,
  b: Bounds = DEFAULT_BOUNDS,
): FrameQuery {
  const radius = c.span * (0.5 + 1 / aspect) + GUTTER;
  const x = Math.max(b.x0, Math.floor(c.x - radius)),
    y = Math.max(b.y0, Math.floor(c.y - radius));
  return {
    x,
    y,
    w: Math.min(96, b.x1 - x, Math.ceil(c.x + radius) - x),
    h: Math.min(96, b.y1 - y, Math.ceil(c.y + radius) - y),
  };
}
export function zoomAt(
  c: Camera,
  span: number,
  p: Point,
  size: Size,
  b: Bounds = DEFAULT_BOUNDS,
): Camera {
  const before = unproject(p, c, size),
    next = {
      ...c,
      span: Math.max(MIN_SPAN, Math.min(maxSpan(size.w / size.h), span)),
    };
  const after = unproject(p, next, size);
  return clampCamera(
    { ...next, x: next.x + before.x - after.x, y: next.y + before.y - after.y },
    b,
    size.w / size.h,
  );
}
export function miniPoint(p: Point, b: Bounds): Point {
  return {
    x: ((p.x - b.x0) / (b.x1 - b.x0)) * 280,
    y: ((p.y - b.y0) / (b.y1 - b.y0)) * 280,
  };
}
export function miniWorld(p: Point, b: Bounds): Point {
  return {
    x: b.x0 + (p.x / 280) * (b.x1 - b.x0),
    y: b.y0 + (p.y / 280) * (b.y1 - b.y0),
  };
}
