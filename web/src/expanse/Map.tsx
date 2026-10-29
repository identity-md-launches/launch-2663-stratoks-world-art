import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { loadArt } from "./art";
import { WorldRenderer, TILE_NAMES } from "./worldRenderer";
import {
  clampCamera,
  DEFAULT_BOUNDS,
  maxSpan,
  miniPoint,
  miniWorld,
  MIN_SPAN,
  project,
  unproject,
  visiblePolygon,
  zoomAt,
  type Size,
} from "./projection";
import type { Camera, WorldFrame } from "./types";
export { clampCamera, DEFAULT_BOUNDS } from "./projection";
export const BIOME_NAMES: Record<string, string> = {
  temperate: "Temperate forest",
  arid: "Sandy desert",
  cold: "Snowy highlands",
  coast: "Rocky coast",
};
export const BIOME_COLORS: Record<string, string> = {
  temperate: "#729451",
  arid: "#d5bb82",
  cold: "#d2e2e3",
  coast: "#65b4b3",
};
export function WorldMap({
  frame,
  camera,
  onCamera,
  onSelect,
  selected,
  knowledge,
  borders,
  onAspect,
  motion,
  recorded,
}: {
  frame: WorldFrame;
  camera: Camera;
  onCamera: (c: Camera) => void;
  onSelect: (id: number) => void;
  selected: number | null;
  knowledge: boolean;
  borders: boolean;
  onAspect: (aspect: number) => void;
  motion: boolean;
  recorded: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<WorldRenderer | null>(null);
  const [ready, setReady] = useState(false),
    [assetError, setAssetError] = useState(false);
  const [size, setSize] = useState<Size>({ w: 800, h: 600 });
  const [hover, setHover] = useState("");
  const current = useRef({
    frame,
    camera,
    onCamera,
    onSelect,
    selected,
    knowledge,
    borders,
    motion,
    recorded,
    size,
  });
  current.current = {
    frame,
    camera,
    onCamera,
    onSelect,
    selected,
    knowledge,
    borders,
    motion,
    recorded,
    size,
  };
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinched = useRef(false);
  const gesture = useRef<{
    start: { x: number; y: number };
    camera: Camera;
    moved: boolean;
    distance?: number;
    mid?: { x: number; y: number };
  } | null>(null);
  useEffect(() => {
    let closed = false;
    loadArt()
      .then((a) => {
        if (!closed) {
          renderer.current = new WorldRenderer(a);
          setReady(true);
        }
      })
      .catch(() => {
        if (!closed) setAssetError(true);
      });
    return () => {
      closed = true;
    };
  }, []);
  useEffect(() => {
    const el = canvas.current!;
    const observer = new ResizeObserver(([e]) => {
      const w = e.contentRect.width,
        h = e.contentRect.height;
      if (!w || !h) return;
      setSize({ w, h });
      onAspect(w / h);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onAspect]);
  useEffect(() => {
    if (!ready) return;
    const el = canvas.current!,
      ctx = el.getContext("2d")!;
    let request = 0,
      previous = 0;
    const draw = (now: number) => {
      const p = current.current,
        dpr = Math.min(devicePixelRatio || 1, 2),
        w = Math.round(p.size.w * dpr),
        h = Math.round(p.size.h * dpr);
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      // Cap visual updates at 30 Hz; network polling and simulation remain independent.
      if (now - previous >= 32) {
        renderer.current!.draw(ctx, p.frame, p.camera, p.size, now, p, dpr);
        previous = now;
        if (renderer.current!.stats.frames % 15 === 0) {
          el.dataset.drawn = String(renderer.current!.stats.drawn);
          el.dataset.culled = String(renderer.current!.stats.culled);
          el.dataset.drawTimes = JSON.stringify(
            renderer.current!.stats.drawTimes.slice(-120),
          );
        }
      }
      request = requestAnimationFrame(draw);
    };
    request = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(request);
  }, [ready]);
  useEffect(() => {
    const el = canvas.current!;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const p = current.current,
        r = el.getBoundingClientRect();
      p.onCamera(
        zoomAt(
          p.camera,
          p.camera.span * (e.deltaY > 0 ? 1.14 : 1 / 1.14),
          { x: e.clientX - r.left, y: e.clientY - r.top },
          p.size,
          p.frame.bounds,
        ),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  function zoom(factor: number) {
    const p = current.current;
    p.onCamera(
      zoomAt(
        p.camera,
        p.camera.span * factor,
        { x: p.size.w / 2, y: p.size.h / 2 },
        p.size,
        p.frame.bounds,
      ),
    );
  }
  const point = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const resetGesture = () => {
    const ps = [...pointers.current.values()];
    if (!ps.length) {
      gesture.current = null;
      return;
    }
    const distance =
      ps.length === 2
        ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y)
        : undefined;
    gesture.current = {
      start: ps[0],
      camera: current.current.camera,
      moved: ps.length === 2,
      distance,
      mid:
        ps.length === 2
          ? { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 }
          : undefined,
    };
  };
  function pan(dx: number, dy: number) {
    const p = current.current;
    const from = unproject({ x: 0, y: 0 }, p.camera, p.size),
      to = unproject({ x: dx, y: dy }, p.camera, p.size);
    p.onCamera(
      clampCamera(
        {
          ...p.camera,
          x: p.camera.x + to.x - from.x,
          y: p.camera.y + to.y - from.y,
        },
        p.frame.bounds,
        p.size.w / p.size.h,
      ),
    );
  }
  return (
    <div className="exp-map-scene">
      <canvas
        ref={canvas}
        className="exp-canvas"
        tabIndex={0}
        data-camera={JSON.stringify(camera)}
        data-size={JSON.stringify(size)}
        aria-label="Isometric world. Drag or use arrow keys to pan. Pinch or use plus and minus to zoom. Select a resident here or open Find residents."
        onKeyDown={(e) => {
          const d = 70;
          const dirs: Record<string, number[]> = {
            ArrowUp: [0, -d],
            ArrowDown: [0, d],
            ArrowLeft: [-d, 0],
            ArrowRight: [d, 0],
          };
          if (dirs[e.key]) {
            e.preventDefault();
            pan(...(dirs[e.key] as [number, number]));
          } else if (["+", "=", "-"].includes(e.key)) {
            e.preventDefault();
            zoom(e.key === "-" ? 1.2 : 1 / 1.2);
          }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          if (pointers.current.size === 0) pinched.current = false;
          pointers.current.set(e.pointerId, point(e));
          if (pointers.current.size > 1) pinched.current = true;
          resetGesture();
        }}
        onPointerMove={(e) => {
          const p = point(e),
            g = gesture.current,
            cur = current.current;
          if (pointers.current.has(e.pointerId) && g) {
            pointers.current.set(e.pointerId, p);
            const ps = [...pointers.current.values()];
            if (ps.length === 2 && g.distance && g.mid) {
              const distance = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
              cur.onCamera(
                zoomAt(
                  g.camera,
                  (g.camera.span * g.distance) / Math.max(1, distance),
                  g.mid,
                  cur.size,
                  cur.frame.bounds,
                ),
              );
              g.moved = true;
            } else {
              if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > 5)
                g.moved = true;
              if (g.moved) {
                const start = unproject(g.start, g.camera, cur.size),
                  end = unproject(p, g.camera, cur.size);
                cur.onCamera(
                  clampCamera(
                    {
                      ...g.camera,
                      x: g.camera.x + start.x - end.x,
                      y: g.camera.y + start.y - end.y,
                    },
                    cur.frame.bounds,
                    cur.size.w / cur.size.h,
                  ),
                );
              }
            }
          } else if (e.pointerType !== "touch") {
            const w = unproject(p, camera, size),
              x = Math.floor(w.x),
              y = Math.floor(w.y),
              v = frame.view,
              t =
                x >= v.x0 && x < v.x0 + v.w && y >= v.y0 && y < v.y0 + v.h
                  ? v.tiles[(y - v.y0) * v.w + x - v.x0]
                  : -1;
            setHover(`${TILE_NAMES[t] ?? "Awaiting terrain"} · ${x}, ${y}`);
          }
        }}
        onPointerUp={(e) => {
          if (gesture.current && !gesture.current.moved && !pinched.current) {
            const p = point(e),
              id = renderer.current?.pick(p.x, p.y);
            if (id !== null && id !== undefined) onSelect(id);
          }
          pointers.current.delete(e.pointerId);
          if (pointers.current.size === 0) pinched.current = false;
          resetGesture();
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size === 0) pinched.current = false;
          resetGesture();
        }}
        onPointerLeave={() => setHover("")}
      />
      {!ready && (
        <div className="exp-art-loading" role="status">
          {assetError
            ? "Artwork could not load. Reload to retry."
            : "Opening the world…"}
        </div>
      )}
      <div className="exp-compass" aria-hidden="true">
        <span>N</span>
        <svg width="32" height="34" viewBox="0 0 32 34">
          <path d="M25 3 26 28 18 20 5 20Z" fill="#f6e8be" />
          <path d="m25 3-7 17L5 20Z" fill="#afbd9e" />
        </svg>
      </div>
      <div className="exp-map-controls" aria-label="Map controls">
        <button
          aria-label="Zoom in"
          disabled={camera.span <= MIN_SPAN + 0.01}
          onClick={() => zoom(1 / 1.2)}
        >
          <Icon name="plus" />
        </button>
        <span>{Math.round((24 / camera.span) * 100)}%</span>
        <button
          aria-label="Zoom out"
          disabled={camera.span >= maxSpan(size.w / size.h) - 0.01}
          onClick={() => zoom(1.2)}
        >
          <Icon name="minus" />
        </button>
        <button
          aria-label="Return to original settlement"
          onClick={() =>
            onCamera(
              clampCamera(
                { x: 26, y: 26, span: innerWidth < 600 ? 12 : 22 },
                frame.bounds,
                size.w / size.h,
              ),
            )
          }
        >
          <Icon name="home" />
        </button>
      </div>
      <div className="exp-map-caption" aria-hidden="true">
        {hover || "Drag to wander · Select a resident"}
      </div>
    </div>
  );
}
export function MiniMap({
  frame,
  camera,
  onCamera,
  aspect = 1.5,
}: {
  frame: WorldFrame;
  camera: Camera;
  onCamera: (c: Camera) => void;
  aspect?: number;
}) {
  const [expanded, setExpanded] = useState(false),
    b = frame.bounds ?? DEFAULT_BOUNDS;
  const polygon = visiblePolygon(camera, { w: 280, h: 280 / aspect })
    .map((p) => miniPoint(p, b))
    .map((p) => `${p.x},${p.y}`)
    .join(" ");
  return (
    <div className={`exp-atlas ${expanded ? "expanded" : ""}`}>
      <button
        className="exp-atlas-label"
        aria-label="Toggle world atlas"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <Icon name="world" size={16} />
        <span>World atlas</span>
        <Icon name="chevron" size={14} />
      </button>
      <div className="exp-minimap">
        <svg
          viewBox="0 0 280 280"
          role="img"
          aria-label="Materialized biome chunks, residents and the isometric viewport. Dark areas have no recorded terrain."
        >
          <rect width="280" height="280" fill="#35483c" />
          {frame.minimap.biomes.map(([x, y, kind]) => {
            const p = miniPoint({ x: x * 28, y: y * 28 }, b);
            return (
              <rect
                key={`${x},${y}`}
                x={p.x}
                y={p.y}
                width={(28 / (b.x1 - b.x0)) * 280 + 0.2}
                height={(28 / (b.y1 - b.y0)) * 280 + 0.2}
                fill={BIOME_COLORS[kind] ?? "#7b9670"}
              />
            );
          })}
          <rect
            x={miniPoint({ x: 0, y: 0 }, b).x}
            y={miniPoint({ x: 0, y: 0 }, b).y}
            width={(56 / (b.x1 - b.x0)) * 280}
            height={(56 / (b.y1 - b.y0)) * 280}
            fill="none"
            stroke="#fff3c3"
            strokeDasharray="4 3"
          />
          {frame.residents.map((r) => {
            const p = miniPoint({ x: r.x + 0.5, y: r.y + 0.5 }, b);
            return (
              <circle key={r.id} cx={p.x} cy={p.y} r="1.6" fill="#293e26" />
            );
          })}
          <polygon
            data-testid="minimap-viewport"
            points={polygon}
            fill="#fff3c32a"
            stroke="#fff5d4"
            strokeWidth="2.5"
          />
        </svg>
        <button
          className="exp-minimap-hit"
          aria-label="Navigate using minimap. Arrow keys move by one chunk."
          onKeyDown={(e) => {
            const dirs: Record<string, number[]> = {
              ArrowUp: [0, -28],
              ArrowDown: [0, 28],
              ArrowLeft: [-28, 0],
              ArrowRight: [28, 0],
            };
            if (dirs[e.key]) {
              e.preventDefault();
              onCamera(
                clampCamera(
                  {
                    ...camera,
                    x: camera.x + dirs[e.key][0],
                    y: camera.y + dirs[e.key][1],
                  },
                  b,
                  aspect,
                ),
              );
            }
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect(),
              p = miniWorld(
                {
                  x: ((e.clientX - rect.left) / rect.width) * 280,
                  y: ((e.clientY - rect.top) / rect.height) * 280,
                },
                b,
              );
            onCamera(clampCamera({ ...camera, ...p }, b, aspect));
          }}
        />
      </div>
      <div className="exp-atlas-key">
        <i /> Original settlement
      </div>
    </div>
  );
}
