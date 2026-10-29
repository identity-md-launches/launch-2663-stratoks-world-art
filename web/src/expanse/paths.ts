import { tileAt, WATER } from "./ground";
import { project, scale, type Point, type Size } from "./projection";
import { wornGround, type Art } from "./art";
import type { Camera, WorldFrame } from "./types";
export type WornSegment = { from: Point; to: Point };
const key = (p: Point) => `${p.x},${p.y}`;

// Presentation only. No route, cost, resource or simulation state is created.
export function settlementWear(f: WorldFrame, travelled: Iterable<WornSegment> = []) {
  const blocked = new Set(f.view.nodes.filter(([, kind, , , units]) => units > 0 && (kind === "tree" || kind === "stone")).map(([, , x, y]) => `${x},${y}`));
  const clear = (p: Point) => {
    const t = tileAt(f, p.x, p.y);
    return t >= 0 && t !== 7 && !WATER.has(t) && !blocked.has(key(p));
  };
  const segments: WornSegment[] = [], seen = new Set<string>();
  const add = (from: Point, to: Point) => {
    if (!clear(from) || !clear(to)) return;
    // A diagonal may not cut a blocked corner, just as in the engine.
    if (from.x !== to.x && from.y !== to.y && (!clear({ x: from.x, y: to.y }) || !clear({ x: to.x, y: from.y }))) return;
    const id = [key(from), key(to)].sort().join(":");
    if (!seen.has(id)) { seen.add(id); segments.push({ from, to }); }
  };
  const shelters = f.view.shelters.map(([, x, y]) => ({ x, y }));
  for (const home of shelters) {
    // Short worn approaches to actual shelters, never decorative buildings.
    add(home, { x: home.x + 1, y: home.y });
    add(home, { x: home.x, y: home.y + 1 });
    const neighbors = shelters.filter(p => p !== home && Math.hypot(p.x - home.x, p.y - home.y) <= 4)
      .sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y)).slice(0, 2);
    for (const other of neighbors) {
      // Only a short, entirely clear approach; do not find or invent a route around obstacles.
      const steps = Math.max(Math.abs(other.x - home.x), Math.abs(other.y - home.y));
      const points = Array.from({ length: steps + 1 }, (_, i) => ({ x: Math.round(home.x + (other.x - home.x) * i / steps), y: Math.round(home.y + (other.y - home.y) * i / steps) }));
      if (points.every(clear)) for (let i = 1; i < points.length; i++) add(points[i - 1], points[i]);
    }
  }
  for (const segment of travelled) add(segment.from, segment.to);
  return segments;
}

export class WornPaths {
  private texture: CanvasPattern | null = null;
  constructor(private art: Art) {}
  draw(ctx: CanvasRenderingContext2D, segments: WornSegment[], c: Camera, size: Size) {
    if (!segments.length) return;
    if (!this.texture && this.art.world) {
      const swatch = document.createElement("canvas");
      const [x, y, w, h] = wornGround.rect;
      swatch.width = w; swatch.height = h;
      // Bare earth at the center of arid.ground: no resource rocks or plants.
      swatch.getContext("2d")!.drawImage(this.art[wornGround.sheet], x, y, w, h, 0, 0, w, h);
      this.texture = ctx.createPattern(swatch, "repeat");
    }
    const s = scale(c, size);
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    for (const { from, to } of segments) {
      const a = project({ x: from.x + 0.5, y: from.y + 0.5 }, c, size), b = project({ x: to.x + 0.5, y: to.y + 0.5 }, c, size);
      if (Math.max(a.x, b.x) < -s || Math.min(a.x, b.x) > size.w + s || Math.max(a.y, b.y) < -s || Math.min(a.y, b.y) > size.h + s) continue;
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.strokeStyle = "#b9a16b"; ctx.lineWidth = s * 0.62; ctx.globalAlpha = 0.06; ctx.stroke();
    ctx.lineWidth = s * 0.48; ctx.globalAlpha = 0.12; ctx.stroke();
    ctx.lineWidth = s * 0.34; ctx.globalAlpha = 0.38; ctx.stroke();
    if (this.texture) {
      const origin = project({ x: 0, y: 0 }, c, size);
      this.texture.setTransform(new DOMMatrix().translate(origin.x, origin.y).scale(s / 32));
      ctx.strokeStyle = this.texture; ctx.globalAlpha = 0.28; ctx.stroke();
    }
    ctx.restore();
  }
}
