import { drawSprite, type Art } from "./art";
import { project, scale, type Size } from "./projection";
import type { Camera, WorldFrame } from "./types";

const COLORS = ["#89ad59", "#3bafb2", "#2b9eac", "#74cbbd", "#dfc78d", "#9ba7a1", "#e3ece9", "#778f90", "#6e964c", "#d4b779", "#69beb7"];
export const WATER = new Set([1, 2, 3, 10]);
const CHUNK = 8, UNIT = 32, PAD = 2, LIMIT = 96;
const RASTER = { w: 2 * CHUNK * UNIT + 2 * PAD, h: CHUNK * UNIT + 2 * PAD };
type CachedGround = { canvas: HTMLCanvasElement; signature: string };
export function tileAt(f: WorldFrame, x: number, y: number) {
  const v = f.view;
  return x >= v.x0 && y >= v.y0 && x < v.x0 + v.w && y < v.y0 + v.h
    ? v.tiles[(y - v.y0) * v.w + x - v.x0] : -1;
}
export function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - s / 2);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x, y + s / 2);
  ctx.lineTo(x - s, y);
  ctx.closePath();
}

// Fixed world-space rasters: camera translation, zoom and DPR never invalidate paint.
// At most 96 ~0.54 MB chunks (~52 MB RGBA) are retained, independently of DPR.
export class GroundCache {
  private chunks = new Map<string, CachedGround>();
  private world = "";
  private frame: WorldFrame | null = null;
  private signatures = new Map<string, string>();
  private surface = document.createElement("canvas");
  private surfaceKey = "";
  private surfaceCamera = "";
  private cameraKey = "";
  private movedAt = 0;
  builds = 0;
  get size() { return this.chunks.size; }
  private clear() {
    for (const entry of this.chunks.values()) entry.canvas.width = entry.canvas.height = 0;
    this.chunks.clear();
    this.surfaceKey = "";
  }
  draw(ctx: CanvasRenderingContext2D, f: WorldFrame, c: Camera, size: Size, dpr = 1) {
    const world = `${f.worldId ?? ""}:${f.seed}`;
    if (world !== this.world || (this.frame && f.tick < this.frame.tick)) {
      this.clear();
      this.world = world;
    }
    const cameraKey = `${c.x},${c.y},${c.span},${size.w},${size.h},${dpr}`;
    const changedFrame = this.frame !== f;
    const now = performance.now();
    if (cameraKey !== this.cameraKey) this.movedAt = now;
    const blit = () => ctx.drawImage(this.surface, 0, 0, size.w * dpr, size.h * dpr, 0, 0, size.w, size.h);
    // Reuse the viewport composition between confirmed frames/camera changes.
    if (this.frame === f && this.surfaceCamera === cameraKey && this.surfaceKey) { this.cameraKey = cameraKey; blit(); return; }
    if (this.frame !== f) {
      this.frame = f;
      this.signatures.clear();
    }
    const v = f.view, s = scale(c, size), ratio = s / UNIT;
    let surfaceKey = cameraKey;
    const pieces: { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number }[] = [];
    for (let y = Math.floor(v.y0 / CHUNK) * CHUNK; y < v.y0 + v.h; y += CHUNK)
      for (let x = Math.floor(v.x0 / CHUNK) * CHUNK; x < v.x0 + v.w; x += CHUNK) {
        const p = project({ x: x + CHUNK / 2, y: y + CHUNK / 2 }, c, size),
          w = RASTER.w * ratio, h = RASTER.h * ratio;
        if (p.x + w / 2 < 0 || p.x - w / 2 > size.w || p.y + h / 2 < 0 || p.y - h / 2 > size.h) continue;
        const key = `${x},${y}`;
        let signature = this.signatures.get(key);
        if (signature === undefined) {
          signature = "";
          // A one-tile halo captures shore neighbors and partial viewport edges.
          for (let j = y - 1; j <= y + CHUNK; j++)
            for (let i = x - 1; i <= x + CHUNK; i++)
              signature += String.fromCharCode(tileAt(f, i, j) + 2);
          this.signatures.set(key, signature);
        }
        let entry = this.chunks.get(key);
        if (!entry || entry.signature !== signature) {
          if (entry) entry.canvas.width = entry.canvas.height = 0;
          entry = { canvas: this.build(f, x, y), signature };
          this.builds++;
        }
        // Reinsert on use: evict the least recently visible raster.
        this.chunks.delete(key);
        this.chunks.set(key, entry);
        surfaceKey += `:${key}:${signature}`;
        pieces.push({ canvas: entry.canvas, x: p.x - w / 2, y: p.y - h / 2, w, h });
      }
    const paintGround = (paint: CanvasRenderingContext2D) => {
      const sky = paint.createLinearGradient(0, 0, size.w, size.h);
      sky.addColorStop(0, "#bdcecf"); sky.addColorStop(1, "#8da9ac");
      paint.fillStyle = sky; paint.fillRect(0, 0, size.w, size.h);
      for (const p of pieces) paint.drawImage(p.canvas, p.x, p.y, p.w, p.h);
      const light = paint.createRadialGradient(size.w * 0.12, 0, 0, size.w * 0.12, 0, size.w * 0.9);
      light.addColorStop(0, "#fff7ca20"); light.addColorStop(1, "#ffffff00");
      paint.fillStyle = light; paint.fillRect(0, 0, size.w, size.h);
    };
    // Avoid repeatedly painting a mutable intermediate canvas during a gesture.
    // Direct chunk blits stay cheap; compose once the camera settles or a frame arrives.
    if (changedFrame || now - this.movedAt >= 180) {
      if (surfaceKey !== this.surfaceKey) {
        const w = Math.ceil(size.w * dpr), h = Math.ceil(size.h * dpr);
        if (this.surface.width !== w || this.surface.height !== h) {
          this.surface.width = w; this.surface.height = h;
        }
        const paint = this.surface.getContext("2d")!;
        paint.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintGround(paint);
        this.surfaceKey = surfaceKey;
        this.surfaceCamera = cameraKey;
      }
      blit();
    } else {
      paintGround(ctx);
    }
    this.cameraKey = cameraKey;
    while (this.chunks.size > LIMIT) {
      const key = this.chunks.keys().next().value!;
      const old = this.chunks.get(key)!;
      old.canvas.width = old.canvas.height = 0;
      this.chunks.delete(key);
    }
  }
  constructor(private art: Art) {}
  private build(f: WorldFrame, x0: number, y0: number) {
    const canvas = document.createElement("canvas");
    canvas.width = RASTER.w;
    canvas.height = RASTER.h;
    const ctx = canvas.getContext("2d")!;
    const c = { x: x0 + CHUNK / 2, y: y0 + CHUNK / 2, span: RASTER.w / (2 * UNIT) };
    for (let y = y0; y < y0 + CHUNK; y++)
      for (let x = x0; x < x0 + CHUNK; x++) {
        const t = tileAt(f, x, y);
        if (t < 0) continue;
        const p = project({ x: x + 0.5, y: y + 0.5 }, c, RASTER);
        diamond(ctx, p.x, p.y, UNIT + 0.65);
        ctx.fillStyle = COLORS[t] ?? COLORS[0];
        ctx.fill();
        if (!WATER.has(t)) {
          ctx.save();
          diamond(ctx, p.x, p.y, UNIT + 0.7);
          ctx.clip();
          const biome = t === 6 ? "cold" : t === 4 || t === 9 ? "arid" : t === 5 || t === 7 ? "coast" : "temperate";
          drawSprite(ctx, this.art, `${biome}.ground`, p.x, p.y + UNIT * 0.45, UNIT * 2.8, 0.27);
          ctx.fillStyle = ((x * 374761393 + y * 668265263) ^ ((x + 19) * (y + 37) * 1274126177)) % 2 ? "#fff3b30c" : "#355b2a0a";
          ctx.fillRect(p.x - UNIT, p.y - UNIT / 2, UNIT * 2, UNIT);
          ctx.restore();
        } else {
          const verts = [{ x: p.x, y: p.y - UNIT / 2 }, { x: p.x + UNIT, y: p.y }, { x: p.x, y: p.y + UNIT / 2 }, { x: p.x - UNIT, y: p.y }];
          const neighbors = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]];
          for (let edge = 0; edge < 4; edge++) {
            const nt = tileAt(f, neighbors[edge][0], neighbors[edge][1]);
            if (nt < 0 || WATER.has(nt)) continue;
            const a = verts[edge], b = verts[(edge + 1) % 4];
            ctx.beginPath();
            ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = "#eee4b491"; ctx.lineWidth = UNIT * 0.12; ctx.stroke();
            ctx.beginPath();
            ctx.moveTo((a.x + p.x * 0.08) / 1.08, (a.y + p.y * 0.08) / 1.08);
            ctx.lineTo((b.x + p.x * 0.08) / 1.08, (b.y + p.y * 0.08) / 1.08);
            ctx.strokeStyle = "#d5fff081"; ctx.lineWidth = 1; ctx.stroke();
          }
        }
      }
    return canvas;
  }
}
