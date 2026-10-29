import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { WorldRenderer } from "./renderer";
import type { Entity, WorldState } from "./types";
export type Camera = {
  zoomIn: () => void;
  zoomOut: () => void;
  center: (entity?: Entity) => void;
};
export const WorldCanvas = forwardRef<
  Camera,
  {
    state: WorldState;
    selected: number | null;
    motion: boolean;
    bubbles: boolean;
    onSelect: (id: number) => void;
    onZoom: (zoom: number) => void;
  }
>(function WorldCanvas(
  { state, selected, motion, bubbles, onSelect, onZoom },
  ref,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<WorldRenderer | null>(null);
  const props = useRef({ onSelect, onZoom });
  props.current = { onSelect, onZoom };
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef({ x: 0, y: 0, moved: false });
  const pinch = useRef(0);
  const [dragging, setDragging] = useState(false);
  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => renderer.current?.zoomBy(1.2),
      zoomOut: () => renderer.current?.zoomBy(1 / 1.2),
      center: (e) => renderer.current?.center(e),
    }),
    [],
  );
  useEffect(() => {
    const element = canvas.current!;
    const r = new WorldRenderer(
      element,
      (id) => props.current.onSelect(id),
      (z) => props.current.onZoom(z),
    );
    renderer.current = r;
    const observer = new ResizeObserver(([entry]) =>
      r.resize(entry.contentRect.width, entry.contentRect.height),
    );
    observer.observe(element);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      r.zoomBy(Math.exp(-e.deltaY * 0.001));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      r.destroy();
      observer.disconnect();
      element.removeEventListener("wheel", wheel);
    };
  }, []);
  useEffect(() => {
    renderer.current?.update(state, selected, motion, bubbles);
  }, [state, selected, motion, bubbles]);
  return (
    <canvas
      ref={canvas}
      id="world-canvas"
      className={dragging ? "dragging" : ""}
      aria-label="Isometric world. Arrow keys pan; plus and minus zoom; Home recenters. Use Residents to select a creature with a keyboard."
      tabIndex={0}
      onKeyDown={(e) => {
        const keys: Record<string, [number, number]> = {
          ArrowLeft: [50, 0],
          ArrowRight: [-50, 0],
          ArrowUp: [0, 50],
          ArrowDown: [0, -50],
        };
        if (keys[e.key]) {
          e.preventDefault();
          renderer.current?.move(...keys[e.key]);
        } else if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          renderer.current?.zoomBy(1.2);
        } else if (e.key === "-") {
          e.preventDefault();
          renderer.current?.zoomBy(1 / 1.2);
        } else if (e.key === "Home") {
          e.preventDefault();
          renderer.current?.center();
        }
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        start.current = { x: e.clientX, y: e.clientY, moved: false };
        setDragging(true);
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
        }
      }}
      onPointerMove={(e) => {
        const prev = pointers.current.get(e.pointerId);
        if (!prev) return;
        const dx = e.clientX - prev.x,
          dy = e.clientY - prev.y;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (
          Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) >
          5
        )
          start.current.moved = true;
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch.current > 0)
            renderer.current?.zoomBy(distance / pinch.current);
          pinch.current = distance;
          start.current.moved = true;
        } else renderer.current?.move(dx, dy);
      }}
      onPointerUp={(e) => {
        if (!start.current.moved && pointers.current.size === 1) {
          const r = e.currentTarget.getBoundingClientRect();
          renderer.current?.select(e.clientX - r.left, e.clientY - r.top);
        }
        pointers.current.delete(e.pointerId);
        if (!pointers.current.size) setDragging(false);
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        setDragging(false);
      }}
    />
  );
});
