import type { Entity, WorldMeta, WorldState } from "./types";
const TX = 24,
  TY = 12;
const iso = (x: number, y: number) => ({ x: (x - y) * TX, y: (x + y) * TY });
const rand = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
function polygon(
  ctx: CanvasRenderingContext2D,
  points: number[][],
  color: string,
) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}
function line(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color: string,
  width = 2,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function rounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
export function drawCreature(
  ctx: CanvasRenderingContext2D,
  e: Entity,
  time: number,
  selected = false,
  motion = true,
) {
  const small = ["infant", "juvenile"].includes(String(e.stage));
  const phase = e.id ?? 1;
  const t = motion ? time / 130 + phase : 0;
  const moving =
    e.phase === "go" ||
    ["WANDER", "FLEE", "APPROACH", "AVOID", "FORAGE"].includes(e.act ?? "");
  const rest = e.act === "REST" && e.phase !== "go";
  const work =
    ["BUILD", "REPAIR", "GATHER", "GATHER_WOOD", "GATHER_STONE"].includes(
      e.act ?? "",
    ) && e.phase !== "go";
  const eating =
    (e.act === "FORAGE" && e.phase === "eat") ||
    (e.act === "EAT" && e.phase === "do");
  const distress =
    (e.health ?? 100) < 45 || (e.hunger ?? 0) > 85 || e.act === "FLEE";
  const bounce =
    moving && motion
      ? Math.sin(t) * 1.3
      : work && motion
        ? Math.sin(t * 0.8) * 1.5
        : 0;
  ellipse(ctx, 3, 1, 13, 5, "#314e3430");
  if (selected) {
    ctx.strokeStyle = "#fffde8";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 1, 18, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#29583b";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.save();
  ctx.scale(small ? 0.72 : 1, small ? 0.72 : 1);
  ctx.translate(0, bounce);
  if (rest) {
    ctx.rotate(-0.2);
    rounded(ctx, -14, -15, 27, 16, 8, "#e6bb42");
    ellipse(ctx, -2, -12, 11, 8, "#f3d265");
    line(ctx, -6, -14, -3, -14, "#425034", 1.5);
    line(ctx, 3, -14, 6, -14, "#425034", 1.5);
  } else {
    const step = moving && motion ? Math.sin(t) * 3 : 0;
    line(ctx, -6, -4, -7 + step, 2, "#bb9137", 4);
    line(ctx, 6, -4, 7 - step, 2, "#bb9137", 4);
    const arm =
      work && motion
        ? Math.sin(t) * 5
        : eating && motion
          ? -8 + Math.sin(t) * 2
          : 0;
    line(ctx, -11, -18, -15, -10 + arm, "#ddb548", 4);
    line(ctx, 11, -18, 15, -10 - arm, "#ddb548", 4);
    rounded(ctx, -12, -30, 24, 28, 10, distress ? "#e3b544" : "#eac451");
    rounded(ctx, -10, -29, 17, 24, 9, "#f8dc76");
    line(ctx, -6, -29, -10, -35, "#edcc5d", 3.5);
    ellipse(ctx, -11, -35, 3, 2, "#edcc5d");
    line(ctx, 6, -29, 10, -35, "#edcc5d", 3.5);
    ellipse(ctx, 11, -35, 3, 2, "#edcc5d");
    const facing = (e.face ?? 1) * 1.3;
    ellipse(ctx, -4 + facing, -21, 1.7, distress ? 2.8 : 2.3, "#364b32");
    ellipse(ctx, 5 + facing, -21, 1.7, distress ? 2.8 : 2.3, "#364b32");
    ellipse(ctx, -7 + facing, -16, 2.4, 1, "#e7ac65");
    ellipse(ctx, 8 + facing, -16, 2.4, 1, "#e7ac65");
    ctx.strokeStyle = "#65703f";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(
      facing,
      -15,
      2.5,
      distress ? Math.PI : 0,
      distress ? Math.PI * 2 : Math.PI,
    );
    ctx.stroke();
    if (e.carry === "wood") {
      rounded(ctx, -12, -13, 24, 7, 3, "#8c6542");
      ellipse(ctx, 11, -9.5, 3, 3.5, "#c5a06a");
    }
    if (e.carry === "stone") {
      polygon(
        ctx,
        [
          [-8, -9],
          [-5, -18],
          [5, -20],
          [11, -12],
          [6, -6],
        ],
        "#8a9687",
      );
    }
    if (eating) {
      ellipse(ctx, 6, -15, 3, 3, "#b35158");
      ellipse(ctx, 8, -17, 2, 2, "#c66469");
    }
    if (work) {
      line(ctx, 15, -12 - arm, 17, -22 - arm, "#805e3d", 2);
      rounded(ctx, 12, -24 - arm, 10, 5, 1, "#7c8679");
    }
    if (distress) {
      line(ctx, -16, -27, -18, -31, "#a26239", 1.5);
      line(ctx, 16, -27, 18, -31, "#a26239", 1.5);
    }
  }
  ctx.restore();
}
function tree(ctx: CanvasRenderingContext2D, e: Entity) {
  const r = rand(e.x + 0.3, e.y + 0.7),
    scale = 0.8 + r * 0.5;
  ctx.save();
  ctx.scale(scale, scale);
  ellipse(ctx, 10, 3, 23, 9, "#315d3b24");
  line(ctx, 0, -2, 0, -26, "#78633e", 7);
  line(ctx, 0, -13, 9, -25, "#78633e", 3);
  if ((e.wood ?? 0) < 1) {
    rounded(ctx, -5, -9, 10, 9, 2, "#8a7450");
    ellipse(ctx, 0, -9, 5, 2, "#cbb081");
  } else if (r > 0.55) {
    polygon(
      ctx,
      [
        [-23, -16],
        [0, -59],
        [23, -16],
      ],
      "#3b754c",
    );
    polygon(
      ctx,
      [
        [-19, -29],
        [0, -67],
        [19, -29],
      ],
      "#4c8a59",
    );
    polygon(
      ctx,
      [
        [-14, -42],
        [0, -75],
        [14, -42],
      ],
      "#68a36a",
    );
    polygon(
      ctx,
      [
        [0, -75],
        [14, -42],
        [0, -46],
      ],
      "#60915f",
    );
  } else {
    ellipse(ctx, 1, -38, 25, 25, "#528753");
    ellipse(ctx, -13, -37, 16, 17, "#60975c");
    ellipse(ctx, 9, -45, 20, 21, "#75a969");
    ellipse(ctx, -6, -52, 18, 20, "#87b677");
    ellipse(ctx, -12, -54, 11, 13, "#94bf7f");
    ellipse(ctx, 15, -34, 11, 13, "#619357");
  }
  ctx.restore();
}
function shelter(ctx: CanvasRenderingContext2D, e: Entity) {
  const stage = Number(e.stage);
  const damage = (e.integrity ?? 100) < 45;
  ellipse(ctx, 8, 5, 39, 14, "#35573824");
  polygon(
    ctx,
    [
      [0, -15],
      [34, 2],
      [0, 19],
      [-34, 2],
    ],
    "#a1946e",
  );
  if (stage === 0) {
    [
      [-25, 0],
      [-10, 8],
      [10, 8],
      [25, 0],
    ].forEach(([x, y]) => rounded(ctx, x - 5, y - 5, 11, 8, 2, "#9a9e87"));
    line(ctx, -24, 0, -24, -23, "#b5915e", 3);
    line(ctx, 24, 0, 24, -23, "#b5915e", 3);
    line(ctx, -24, -23, 24, -23, "#b5915e", 3);
    return;
  }
  polygon(
    ctx,
    [
      [-28, -28],
      [0, -14],
      [0, 12],
      [-28, -2],
    ],
    "#b78b58",
  );
  polygon(
    ctx,
    [
      [0, -14],
      [28, -28],
      [28, -2],
      [0, 12],
    ],
    "#ccaa73",
  );
  if (stage === 1) {
    line(ctx, -28, -2, -28, -39, "#896b45", 4);
    line(ctx, 28, -2, 28, -39, "#896b45", 4);
    line(ctx, 0, 12, 0, -25, "#896b45", 4);
    line(ctx, -28, -39, 0, -25, "#a88a5d", 3);
    line(ctx, 28, -39, 0, -25, "#a88a5d", 3);
    line(ctx, -28, -39, 0, -54, "#a88a5d", 3);
    line(ctx, 28, -39, 0, -54, "#a88a5d", 3);
    return;
  }
  for (let i = 0; i < 4; i++) {
    line(ctx, -27, -22 + i * 7, -1, -9 + i * 7, "#a27b50", 1);
    line(ctx, 1, -9 + i * 7, 27, -22 + i * 7, "#b69864", 1);
  }
  polygon(
    ctx,
    [
      [8, -12],
      [20, -18],
      [20, 2],
      [8, 8],
    ],
    "#4d6851",
  );
  line(ctx, 14, -13, 14, 4, "#617f5d", 1);
  ellipse(ctx, 11, -1, 1, 1, "#ecd690");
  polygon(
    ctx,
    [
      [-22, -22],
      [-12, -17],
      [-12, -8],
      [-22, -13],
    ],
    "#e8d79c",
  );
  line(ctx, -17, -19, -17, -10, "#92794c", 1);
  line(ctx, -21, -17, -13, -13, "#92794c", 1);
  const roof = damage ? "#8a7860" : "#b88950";
  polygon(
    ctx,
    [
      [-35, -28],
      [-4, -57],
      [32, -39],
      [1, -9],
    ],
    roof,
  );
  polygon(
    ctx,
    [
      [-4, -57],
      [32, -39],
      [35, -27],
      [1, -9],
    ],
    damage ? "#a49778" : "#d3ad67",
  );
  for (let i = 0; i < 6; i++) {
    const v = i * 5;
    line(
      ctx,
      -30 + v,
      -28 + v * 0.5,
      -4 + v,
      -53 + v * 0.5,
      damage ? "#796a51" : "#c39a5d",
      2,
    );
  }
  line(ctx, -4, -58, 32, -40, "#e2bc7b", 3);
  if (stage === 2) {
    line(ctx, -32, -29, -32, 8, "#8a714b", 2);
    line(ctx, -39, -11, -9, 4, "#8a714b", 3);
  }
  if (damage) line(ctx, 5, -22, 10, -15, "#635b44", 3);
}
function bush(ctx: CanvasRenderingContext2D, e: Entity) {
  ellipse(ctx, 2, 2, 14, 5, "#36593621");
  ellipse(ctx, -6, -5, 8, 8, "#628b50");
  ellipse(ctx, 6, -6, 9, 9, "#719e59");
  ellipse(ctx, 0, -11, 8, 8, "#83ac66");
  const n = Math.min(8, Math.ceil((e.amount ?? 0) * 1.7));
  for (let i = 0; i < n; i++) {
    const x = rand(i + e.x, e.y) * 20 - 10,
      y = rand(e.x, i + e.y) * 12 - 15;
    ellipse(ctx, x, y, 2.3, 2.4, "#a9585d");
    ellipse(ctx, x - 0.5, y - 0.8, 0.8, 0.7, "#dd9b8f");
  }
}
export class WorldRenderer {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private zoom = 1;
  private pan = { x: 0, y: 0 };
  private terrain: HTMLCanvasElement | null = null;
  private terrainKey = "";
  private state: WorldState | null = null;
  private lastEntities = new Map<string, Entity>();
  private updated = 0;
  private frame = 0;
  private selected: number | null = null;
  private motion = true;
  private bubbles = true;
  private hit: { x: number; y: number; id: number }[] = [];
  private raf = 0;
  private preview = makePreview();
  constructor(
    private canvas: HTMLCanvasElement,
    private onSelect: (id: number) => void,
    private onZoom: (zoom: number) => void,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.draw = this.draw.bind(this);
    this.raf = requestAnimationFrame(this.draw);
  }
  destroy() {
    cancelAnimationFrame(this.raf);
  }
  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
  }
  update(
    state: WorldState,
    selected: number | null,
    motion: boolean,
    bubbles: boolean,
  ) {
    if (state.entities !== this.state?.entities) {
      this.lastEntities = this.state?.entities ?? state.entities;
      this.updated = performance.now();
    }
    this.state = state;
    this.selected = selected;
    this.motion = motion;
    this.bubbles = bubbles;
  }
  setZoom(value: number) {
    this.zoom = Math.min(2.4, Math.max(0.35, value));
    this.onZoom(this.zoom);
  }
  zoomBy(amount: number) {
    this.setZoom(this.zoom * amount);
  }
  getZoom() {
    return this.zoom;
  }
  move(dx: number, dy: number) {
    this.pan.x += dx;
    this.pan.y += dy;
  }
  center(entity?: Entity) {
    this.pan = { x: 0, y: 0 };
    if (entity) {
      const p = iso(entity.x - 28, entity.y - 28);
      this.pan = { x: -p.x * this.zoom, y: -p.y * this.zoom };
    }
  }
  select(x: number, y: number) {
    const near = this.hit
      .filter(
        (h) => Math.hypot(h.x - x, h.y - y) < Math.max(23, 20 * this.zoom),
      )
      .sort(
        (a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y),
      )[0];
    if (near) this.onSelect(near.id);
  }
  private buildTerrain(
    world: Pick<WorldMeta, "width" | "height" | "tiles" | "worldId">,
  ) {
    const key = world.worldId;
    if (key === this.terrainKey) return;
    this.terrainKey = key;
    const c = document.createElement("canvas");
    c.width = (world.width + world.height) * TX + 4;
    c.height = (world.width + world.height) * TY + 40;
    const ctx = c.getContext("2d")!;
    ctx.translate(world.height * TX + 2, 2);
    // The ground is cached; only entity sprites are redrawn each animation frame.
    const greens = [
      "#a4bc82",
      "#a6be84",
      "#a9bf86",
      "#a7bd83",
      "#abc18a",
      "#a5bc81",
    ];
    for (let y = 0; y < world.height; y++)
      for (let x = 0; x < world.width; x++) {
        const p = iso(x, y),
          r = rand(x, y),
          water = world.tiles[y]?.[x] === "w";
        const shore =
          !water &&
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].some(([dx, dy]) => world.tiles[y + dy]?.[x + dx] === "w");
        const color = water
          ? ["#87b8b1", "#8cbcb4", "#8ab9b2"][Math.floor(r * 3)]
          : shore
            ? "#c2c394"
            : greens[Math.floor(r * greens.length)];
        polygon(
          ctx,
          [
            [p.x, p.y],
            [p.x + TX, p.y + TY],
            [p.x, p.y + TY * 2],
            [p.x - TX, p.y + TY],
          ],
          color,
        );
        if (water && r > 0.72) {
          line(ctx, p.x - 7, p.y + TY, p.x + 3, p.y + TY, "#b4d4c3", 1.2);
        }
        if (!water && !shore && r > 0.75) {
          line(ctx, p.x + 4, p.y + TY, p.x + 2, p.y + TY - 3, "#8da66b", 0.8);
          line(ctx, p.x + 4, p.y + TY, p.x + 7, p.y + TY - 3, "#8da66b", 0.8);
        }
        if (!water && r > 0.98) {
          ellipse(ctx, p.x, p.y + TY, 1.7, 1.2, "#ede4a8");
          ellipse(ctx, p.x + 5, p.y + TY + 2, 1.4, 1.1, "#ede4a8");
        }
      }
    this.terrain = c;
  }
  private draw(now: number) {
    this.raf = requestAnimationFrame(this.draw);
    // 30fps is ample for this slow world, and reduces renderer load.
    if (now - this.frame < 32 || !this.width) return;
    this.frame = now;
    const state = this.state;
    const world = state?.world ?? this.preview.world;
    const entities = state?.world
      ? [...state.entities.values()]
      : this.preview.entities;
    const active = state?.mode === "demo" || state?.mode === "connected";
    const animated = this.motion && active;
    const time = animated ? now : 0;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = "#b9cba1";
    ctx.fillRect(0, 0, this.width, this.height);
    const center = iso(world.width / 2, world.height / 2);
    const ox = this.width / 2 + this.pan.x,
      oy = this.height / 2 + this.pan.y + 35;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-center.x, -center.y);
    this.buildTerrain(world);
    if (this.terrain) ctx.drawImage(this.terrain, -world.height * TX - 2, -2);
    for (const e of entities)
      if (e.kind === "path") {
        const p = iso(e.x, e.y);
        ellipse(ctx, p.x, p.y + TY, 19, 9, "#c3b68a");
        ellipse(ctx, p.x + 2, p.y + TY, 12, 6, "#cebf93");
      }
    this.hit = [];
    const sorted = entities
      .filter((e) => e.kind !== "path")
      .sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const e of sorted) {
      let x = e.x,
        y = e.y;
      const old = this.lastEntities.get(e.k);
      if (e.k.startsWith("c:") && old && animated) {
        const mix = Math.min(
          1,
          (now - this.updated) /
            Math.min(800, state?.mode === "demo" ? 220 : world.tickMs),
        );
        x = old.x + (e.x - old.x) * mix;
        y = old.y + (e.y - old.y) * mix;
      }
      const p = iso(x, y);
      p.y += TY;
      const sx = ox + (p.x - center.x) * this.zoom,
        sy = oy + (p.y - center.y) * this.zoom;
      if (
        sx < -90 ||
        sx > this.width + 90 ||
        sy < -70 ||
        sy > this.height + 130
      )
        continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (e.k.startsWith("c:")) {
        drawCreature(ctx, e, time, e.id === this.selected, animated);
        this.hit.push({ x: sx, y: sy - 14 * this.zoom, id: e.id! });
      } else if (e.kind === "tree") tree(ctx, e);
      else if (e.kind === "bush") bush(ctx, e);
      else if (e.kind === "shelter") shelter(ctx, e);
      else if (e.kind === "stone" && (e.units ?? 0) > 0) {
        ellipse(ctx, 3, 2, 14, 5, "#4b624321");
        polygon(
          ctx,
          [
            [-12, 0],
            [-9, -11],
            [1, -18],
            [12, -10],
            [13, 0],
            [1, 6],
          ],
          "#8f9b88",
        );
        polygon(
          ctx,
          [
            [-9, -11],
            [1, -18],
            [12, -10],
            [0, -6],
          ],
          "#b0b8a0",
        );
      } else if (e.kind === "visitor") {
        ellipse(ctx, 0, 0, 10, 5, "#36594144");
        rounded(ctx, -6, -23, 12, 22, 5, "#e5e7d2");
        ellipse(ctx, 0, -26, 6, 6, "#698a81");
      } else if (e.kind === "fire") {
        ctx.globalAlpha = 0.22;
        ellipse(ctx, 0, 0, (e.r ?? 4) * TX, (e.r ?? 4) * TY, "#b96534");
        ctx.globalAlpha = 1;
        for (let i = 0; i < 7; i++) {
          const fx = (rand(i, e.x) - 0.5) * (e.r ?? 4) * TX,
            fy = (rand(e.y, i) - 0.5) * (e.r ?? 4) * TY;
          const h =
            14 +
            rand(i, 2) * 20 +
            (animated ? Math.sin(time / 180 + i) * 5 : 0);
          polygon(
            ctx,
            [
              [fx - 8, fy],
              [fx - 3, fy - h * 0.5],
              [fx, fy - h],
              [fx + 10, fy - 6],
              [fx + 6, fy + 3],
            ],
            "#d97936",
          );
          polygon(
            ctx,
            [
              [fx - 4, fy],
              [fx + 1, fy - h * 0.65],
              [fx + 5, fy],
            ],
            "#f5c652",
          );
        }
      } else if (e.kind === "storm") {
        ctx.globalAlpha = 0.18;
        ellipse(ctx, 0, 0, (e.r ?? 4) * TX, (e.r ?? 4) * TY, "#456d79");
        ctx.globalAlpha = 0.7;
        for (let i = 0; i < 22; i++) {
          const rx = (rand(i, e.x) - 0.5) * (e.r ?? 4) * TX * 2,
            ry = (rand(e.y, i) - 0.5) * (e.r ?? 4) * TY * 2;
          const shift = animated ? (time / 25 + i * 3) % 30 : 0;
          line(
            ctx,
            rx,
            ry - 45 + shift,
            rx - 4,
            ry - 33 + shift,
            "#527783",
            1.2,
          );
        }
      }
      ctx.restore();
    }
    // A few contextual bubbles at normal zoom; all speech comes from actual engine events.
    if (this.bubbles && this.zoom > 0.7 && state?.world) {
      let count = 0;
      for (const e of sorted) {
        if (
          !e.bubble ||
          !e.k.startsWith("c:") ||
          count >= 3 ||
          e.id === this.selected
        )
          continue;
        const p = iso(e.x, e.y);
        if (
          Math.abs(p.x - center.x + this.pan.x / this.zoom) >
          this.width / (2 * this.zoom) - 90
        )
          continue;
        if ((e.id ?? 0) % 7 !== 0) continue;
        const text = e.bubble.text;
        ctx.font = '600 12px "Manrope Variable", sans-serif';
        const w = ctx.measureText(text).width + 18;
        rounded(ctx, p.x - w / 2, p.y - 56, w, 24, 7, "#ffffef");
        polygon(
          ctx,
          [
            [p.x - 4, p.y - 32],
            [p.x + 4, p.y - 32],
            [p.x, p.y - 27],
          ],
          "#ffffef",
        );
        ctx.fillStyle = "#38503d";
        ctx.textAlign = "center";
        ctx.fillText(text, p.x, p.y - 40);
        count++;
      }
    }
    ctx.restore();
  }
}
function makePreview() {
  const width = 56,
    height = 56;
  const tiles = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      (x - 38) ** 2 / 60 + (y - 26) ** 2 / 25 < 1 ||
      (x - 15) ** 2 / 35 + (y - 36) ** 2 / 20 < 1
        ? "w"
        : "g",
    ).join(""),
  );
  const entities: Entity[] = [];
  for (let y = 3; y < 53; y++)
    for (let x = 3; x < 53; x++) {
      const r = rand(x, y);
      if (tiles[y][x] === "w") continue;
      if (r > 0.95 && Math.hypot(x - 28, y - 28) > 5)
        entities.push({ k: `t:${x}:${y}`, kind: "tree", x, y, wood: 8 });
      else if (r < 0.015)
        entities.push({ k: `b:${x}:${y}`, kind: "bush", x, y, amount: 3 });
      else if (r > 0.91 && r < 0.915)
        entities.push({ k: `s:${x}:${y}`, kind: "stone", x, y, units: 5 });
    }
  return {
    world: { worldId: "illustration", width, height, tiles, tickMs: 1000 },
    entities,
  };
}
