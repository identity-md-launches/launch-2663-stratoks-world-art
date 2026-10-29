import { drawSprite, type Art } from "./art";
import { project, scale, type Size } from "./projection";
import type { Camera, Resident, WorldFrame } from "./types";
export const TILE_NAMES = [
  "Grass",
  "Freshwater lake",
  "Open sea",
  "Shallows",
  "Sand",
  "Rock",
  "Snow",
  "Cliff",
  "Forest floor",
  "Dune",
  "Freshwater stream",
];
const COLORS = [
  "#89ad59",
  "#3bafb2",
  "#2b9eac",
  "#74cbbd",
  "#dfc78d",
  "#9ba7a1",
  "#e3ece9",
  "#778f90",
  "#6e964c",
  "#d4b779",
  "#69beb7",
];
export const hash = (x: number, y = 0) =>
  ((x * 374761393 + y * 668265263) ^ ((x + 19) * (y + 37) * 1274126177)) >>> 0;
const WATER = new Set([1, 2, 3, 10]);
export function biomeAt(f: WorldFrame, x: number, y: number) {
  const cx = Math.floor(x / 28),
    cy = Math.floor(y / 28);
  return (
    f.minimap.biomes.find(([bx, by]) => bx === cx && by === cy)?.[2] ??
    f.view.biome
  );
}
export type Pose = "idle" | "walk" | "rest" | "gather" | "carry" | "build";
export function residentPose(
  r: Resident,
  frame: WorldFrame,
  moving: boolean,
): Pose {
  if (r.action === "rest") return "rest";
  if (r.action === "build") return "build";
  if (r.action === "gather") return "gather";
  if (
    (r.action === "carry" || r.action === "move") &&
    frame.inspector?.id === r.id &&
    (frame.inspector.inventory.wood ?? 0) > 0
  )
    return "carry";
  return moving && (r.action === "move" || r.action === "flee")
    ? "walk"
    : "idle";
}
type Track = {
  from: { x: number; y: number };
  to: Resident;
  since: number;
  duration: number;
  direction: string;
  moving: boolean;
};
export class WorldRenderer {
  private ground = document.createElement("canvas");
  private groundKey = "";
  private tracks = new Map<number, Track>();
  private frame: WorldFrame | null = null;
  private received = 0;
  private tick: number | undefined;
  hits: { id: number; x: number; y: number; r: number }[] = [];
  stats = {
    drawn: 0,
    culled: 0,
    terrainBuilds: 0,
    frames: 0,
    drawTimes: [] as number[],
  };
  constructor(private art: Art) {}
  update(f: WorldFrame, now: number, recorded: boolean) {
    if (this.frame === f) return;
    if (
      this.frame?.worldId !== f.worldId ||
      this.frame?.seed !== f.seed ||
      f.tick < (this.tick ?? 0)
    )
      this.tracks.clear();
    const duration = Math.max(100, Math.min(1100, now - this.received || 500));
    if (f.tick !== this.tick) {
      for (const r of f.residents) {
        const old = this.tracks.get(r.id),
          dx = r.x - (old?.to.x ?? r.x),
          dy = r.y - (old?.to.y ?? r.y);
        const adjacent = Math.max(Math.abs(dx), Math.abs(dy)) <= 1;
        const moving = !!old && (dx !== 0 || dy !== 0) && adjacent && !recorded;
        let direction =
          old?.direction ?? ["se", "sw", "ne", "nw"][hash(r.id) % 4];
        if (dx || dy) {
          const sx = dx - dy,
            sy = dx + dy;
          direction = sx >= 0 ? (sy >= 0 ? "se" : "ne") : sy >= 0 ? "sw" : "nw";
        }
        this.tracks.set(r.id, {
          from: moving ? { x: old!.to.x, y: old!.to.y } : { x: r.x, y: r.y },
          to: r,
          since: now,
          duration,
          direction,
          moving,
        });
      }
      const alive = new Set(f.residents.map((r) => r.id));
      for (const id of this.tracks.keys())
        if (!alive.has(id)) this.tracks.delete(id);
      this.received = now;
      this.tick = f.tick;
    }
    this.frame = f;
  }
  private diamond(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
  ) {
    ctx.beginPath();
    ctx.moveTo(x, y - s / 2);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x, y + s / 2);
    ctx.lineTo(x - s, y);
    ctx.closePath();
  }
  private terrain(f: WorldFrame, c: Camera, size: Size, dpr: number) {
    const v = f.view,
      key =
        `${v.x0},${v.y0},${v.w},${v.h},${c.x},${c.y},${c.span},${size.w},${size.h},${dpr}:` +
        v.tiles.join("");
    if (key === this.groundKey) return;
    this.groundKey = key;
    this.stats.terrainBuilds++;
    this.ground.width = Math.round(size.w * dpr);
    this.ground.height = Math.round(size.h * dpr);
    const ctx = this.ground.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const g = ctx.createLinearGradient(0, 0, size.w, size.h);
    g.addColorStop(0, "#bdcecf");
    g.addColorStop(1, "#8da9ac");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size.w, size.h);
    const s = scale(c, size);
    const tile = (x: number, y: number) =>
      x >= v.x0 && y >= v.y0 && x < v.x0 + v.w && y < v.y0 + v.h
        ? v.tiles[(y - v.y0) * v.w + x - v.x0]
        : -1;
    for (let j = 0; j < v.h; j++)
      for (let i = 0; i < v.w; i++) {
        const x = v.x0 + i,
          y = v.y0 + j,
          t = v.tiles[j * v.w + i],
          p = project({ x: x + 0.5, y: y + 0.5 }, c, size);
        if (
          p.x < -s * 2 ||
          p.x > size.w + s * 2 ||
          p.y < -s ||
          p.y > size.h + s
        )
          continue;
        this.diamond(ctx, p.x, p.y, s + 0.65);
        ctx.fillStyle = COLORS[t] ?? COLORS[0];
        ctx.fill();
        if (!WATER.has(t)) {
          ctx.save();
          this.diamond(ctx, p.x, p.y, s + 0.7);
          ctx.clip();
          // Texture is the provided ground artwork, clipped to the exact authoritative tile.
          const biome =
            t === 6
              ? "cold"
              : t === 4 || t === 9
                ? "arid"
                : t === 5 || t === 7
                  ? "coast"
                  : "temperate";
          drawSprite(
            ctx,
            this.art,
            `${biome}.ground`,
            p.x,
            p.y + s * 0.45,
            s * 2.8,
            0.27,
          );
          const n = hash(x, y);
          ctx.fillStyle = n % 2 ? "#fff3b30c" : "#355b2a0a";
          ctx.fillRect(p.x - s, p.y - s / 2, s * 2, s);
          ctx.restore();
        } else {
          // Every shoreline segment lies on a real water/land boundary; no terrain is relocated.
          const verts = [
            { x: p.x, y: p.y - s / 2 },
            { x: p.x + s, y: p.y },
            { x: p.x, y: p.y + s / 2 },
            { x: p.x - s, y: p.y },
          ];
          const neighbors = [
            [x, y - 1],
            [x + 1, y],
            [x, y + 1],
            [x - 1, y],
          ];
          for (let edge = 0; edge < 4; edge++) {
            const nt = tile(neighbors[edge][0], neighbors[edge][1]);
            if (nt < 0 || WATER.has(nt)) continue;
            const a = verts[edge],
              b = verts[(edge + 1) % 4];
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = "#eee4b491";
            ctx.lineWidth = Math.max(2, s * 0.12);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo((a.x + p.x * 0.08) / 1.08, (a.y + p.y * 0.08) / 1.08);
            ctx.lineTo((b.x + p.x * 0.08) / 1.08, (b.y + p.y * 0.08) / 1.08);
            ctx.strokeStyle = "#d5fff081";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
    // Soft upper-left sunlight belongs to the observer presentation, never simulation weather.
    const light = ctx.createRadialGradient(
      size.w * 0.12,
      0,
      0,
      size.w * 0.12,
      0,
      size.w * 0.9,
    );
    light.addColorStop(0, "#fff7ca20");
    light.addColorStop(1, "#ffffff00");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, size.w, size.h);
  }
  draw(
    ctx: CanvasRenderingContext2D,
    f: WorldFrame,
    c: Camera,
    size: Size,
    now: number,
    opts: {
      selected: number | null;
      knowledge: boolean;
      borders: boolean;
      motion: boolean;
      recorded: boolean;
    },
    dpr: number,
  ) {
    const start = performance.now();
    this.update(f, now, opts.recorded);
    this.terrain(f, c, size, dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.drawImage(
      this.ground,
      0,
      0,
      this.ground.width,
      this.ground.height,
      0,
      0,
      size.w,
      size.h,
    );
    const s = scale(c, size),
      v = f.view;
    if (opts.borders) {
      ctx.strokeStyle = "#304f5470";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      for (let x = f.bounds.x0; x <= f.bounds.x1; x += 28) {
        const a = project({ x, y: f.bounds.y0 }, c, size),
          b = project({ x, y: f.bounds.y1 }, c, size);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (let y = f.bounds.y0; y <= f.bounds.y1; y += 28) {
        const a = project({ x: f.bounds.x0, y }, c, size),
          b = project({ x: f.bounds.x1, y }, c, size);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (opts.motion) {
      ctx.strokeStyle = "#d9fff08a";
      ctx.lineWidth = 1;
      for (let j = 0; j < v.h; j++)
        for (let i = 0; i < v.w; i++)
          if (
            WATER.has(v.tiles[j * v.w + i]) &&
            hash(i + v.x0, j + v.y0) % 7 === 0
          ) {
            const p = project(
              { x: v.x0 + i + 0.5, y: v.y0 + j + 0.5 },
              c,
              size,
            );
            if (p.x < 0 || p.y < 0 || p.x > size.w || p.y > size.h) continue;
            const shift = Math.sin(now / 1800 + hash(i, j)) * s * 0.09;
            ctx.globalAlpha = 0.35 + 0.2 * Math.sin(now / 1500 + i);
            ctx.beginPath();
            ctx.ellipse(p.x + shift, p.y, s * 0.3, s * 0.06, 0, 0, Math.PI);
            ctx.stroke();
          }
      ctx.globalAlpha = 1;
    }
    const objects: { depth: number; draw: () => void }[] = [];
    let drawn = 0,
      culled = 0;
    this.hits = [];
    const visible = (p: { x: number; y: number }, r: number) =>
      p.x > -r && p.x < size.w + r && p.y > -r && p.y < size.h + r;
    for (const [node, kind, x, y, units] of v.nodes) {
      if (units < 0) continue;
      const p = project({ x: x + 0.5, y: y + 0.5 }, c, size);
      if (!visible(p, s * 4)) {
        culled++;
        continue;
      }
      const biome = biomeAt(f, x, y),
        variant = hash(x, y) % 3 === 0;
      let key: string | null = null,
        width = 2;
      if (kind === "tree") {
        if (units === 0) continue;
        key = variant ? "tree-small" : "tree";
        width = 3.9;
      } else if (kind === "bush") {
        key = units === 0 ? "bush-empty" : "bush";
        width = 2;
      } else if (kind === "stone") {
        key = units < 6 ? "stone-small" : "stone";
        width = 2.2;
      } else if (kind === "deadfall" || kind === "driftwood") {
        if (units === 0) continue;
        key = "wood";
        width = 2.4;
      } else if (kind === "scrub") {
        if (units === 0) continue;
        key = "scrub";
        width = 1.5;
      } else if (["flint", "cactus", "shellfish", "lichen"].includes(kind)) {
        if (units === 0) continue;
        key = kind;
        width = kind === "cactus" ? 1.9 : 1.5;
      }
      if (!key) continue;
      drawn++;
      const sprite =
        key.includes("flint") || ["cactus", "shellfish", "lichen"].includes(key)
          ? `extra.${key}`
          : `${biome}.${key}`;
      objects.push({
        depth: p.y,
        draw: () => {
          const sway =
            opts.motion && kind === "tree"
              ? Math.sin(now / 2400 + hash(x, y)) * s * 0.012
              : 0;
          drawSprite(ctx, this.art, sprite, p.x + sway, p.y, width * s);
        },
      });
    }
    for (const [, x, y] of v.shelters) {
      const p = project({ x: x + 0.5, y: y + 0.5 }, c, size);
      if (!visible(p, s * 4)) {
        culled++;
        continue;
      }
      drawn++;
      objects.push({
        depth: p.y,
        draw: () =>
          drawSprite(
            ctx,
            this.art,
            `${biomeAt(f, x, y)}.shelter`,
            p.x,
            p.y,
            s * 3.8,
          ),
      });
    }
    for (const [, x, y] of v.fires) {
      const p = project({ x: x + 0.5, y: y + 0.5 }, c, size);
      if (!visible(p, s * 3)) {
        culled++;
        continue;
      }
      drawn++;
      objects.push({
        depth: p.y,
        draw: () => {
          const phase = opts.motion ? Math.floor(now / 180) % 2 : 0;
          drawSprite(ctx, this.art, `extra.fire.${phase}`, p.x, p.y, s * 2);
        },
      });
    }
    for (const r of f.residents) {
      const tr = this.tracks.get(r.id)!;
      if (!tr) continue;
      const t =
        opts.motion && !opts.recorded
          ? Math.max(0, Math.min(1, (now - tr.since) / tr.duration))
          : 1;
      const x = tr.from.x + (tr.to.x - tr.from.x) * t,
        y = tr.from.y + (tr.to.y - tr.from.y) * t,
        p = project({ x: x + 0.5, y: y + 0.5 }, c, size);
      // Global roster is for navigation. Only residents in the confirmed viewport are rendered.
      if (
        r.x < v.x0 ||
        r.y < v.y0 ||
        r.x >= v.x0 + v.w ||
        r.y >= v.y0 + v.h ||
        !visible(p, s * 3)
      ) {
        culled++;
        continue;
      }
      drawn++;
      const pose = residentPose(r, f, tr.moving && t < 1);
      const walking = pose === "walk",
        idle = pose === "idle";
      const sequence = idle
        ? [0, 1, 2, 3, 2, 1]
        : walking
          ? [0, 1, 2, 3]
          : [0, 1];
      const fps = walking ? 6 : idle ? 2 : pose === "rest" ? 1 : 3;
      const phase =
        opts.motion && !opts.recorded
          ? sequence[
              Math.floor((now / 1000) * fps + (hash(r.id) % 7)) %
                sequence.length
            ]
          : 0;
      const h = s * 2.6;
      this.hits.push({
        id: r.id,
        x: p.x,
        y: p.y - h * 0.42,
        r: Math.max(12, h * 0.48),
      });
      objects.push({
        depth: p.y + 0.1,
        draw: () => {
          ctx.fillStyle = "#243d2b2e";
          ctx.beginPath();
          ctx.ellipse(p.x, p.y + 1, s * 0.56, s * 0.24, 0, 0, 7);
          ctx.fill();
          if (r.id === opts.selected || r.health < 30) {
            ctx.strokeStyle = r.id === opts.selected ? "#fff1b0" : "#943e2d";
            ctx.lineWidth = r.id === opts.selected ? 2.5 : 2;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, s * 0.8, s * 0.4, 0, 0, 7);
            ctx.stroke();
          }
          drawSprite(
            ctx,
            this.art,
            `${tr.direction}.${pose}.${phase}`,
            p.x,
            p.y,
            h,
          );
          // A deterministic fur glint distinguishes individuals; it conveys no learned trait.
          ctx.fillStyle = ["#fff0b9", "#c78032", "#e4b44b", "#f4da87"][
            hash(r.id) % 4
          ];
          ctx.beginPath();
          ctx.arc(p.x + s * 0.18, p.y - h * 0.48, Math.max(1, s * 0.055), 0, 7);
          ctx.fill();
          if (r.id === opts.selected) {
            ctx.fillStyle = "#fff3c3";
            ctx.beginPath();
            ctx.moveTo(p.x, p.y - h * 0.9 - 8);
            ctx.lineTo(p.x - 4, p.y - h * 0.9 - 14);
            ctx.lineTo(p.x + 4, p.y - h * 0.9 - 14);
            ctx.fill();
          }
        },
      });
    }
    objects.sort((a, b) => a.depth - b.depth);
    for (const o of objects) o.draw();
    if (opts.knowledge && f.inspector?.observation) {
      const o = f.inspector.observation,
        pts = [
          { x: o.self.x - o.radius, y: o.self.y - o.radius },
          { x: o.self.x + o.radius + 1, y: o.self.y - o.radius },
          { x: o.self.x + o.radius + 1, y: o.self.y + o.radius + 1 },
          { x: o.self.x - o.radius, y: o.self.y + o.radius + 1 },
        ].map((p) => project(p, c, size));
      ctx.fillStyle = "#112c3866";
      ctx.beginPath();
      ctx.rect(0, 0, size.w, size.h);
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fill("evenodd");
      ctx.strokeStyle = "#fff1b0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.stroke();
    }
    this.stats.drawn = drawn;
    this.stats.culled = culled;
    this.stats.frames++;
    this.stats.drawTimes.push(performance.now() - start);
    if (this.stats.drawTimes.length > 300) this.stats.drawTimes.shift();
  }
  pick(x: number, y: number): number | null {
    let best: number | null = null,
      dist = Infinity;
    for (const hit of this.hits) {
      const d = Math.hypot(hit.x - x, hit.y - y);
      if (d < hit.r && d < dist) {
        dist = d;
        best = hit.id;
      }
    }
    return best;
  }
}
