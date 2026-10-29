import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import type { Bounds, Camera, WorldFrame } from './types';
import preview from './preview.json';

export const BIOME_COLORS: Record<string, string> = { t: '#819b69', a: '#cfb47b', c: '#becbd0', coast: '#78a5ae' };
export const BIOME_NAMES: Record<string, string> = { temperate: 'Temperate forest', arid: 'Arid terrain', cold: 'Cold highlands', coast: 'Coast & islands' };
const tiles = ['#afc087', '#6f9fa4', '#5d8d9e', '#99b7b1', '#d6c38e', '#a7b0a7', '#dce3df', '#7c8883', '#92aa78', '#c6ac72', '#88b0ad'];
const tileLabel = ['Grass', 'Freshwater lake', 'Open sea', 'Shallows', 'Sand', 'Rock', 'Snow', 'Cliff', 'Forest floor', 'Dune', 'Freshwater stream'];
export const DEFAULT_BOUNDS: Bounds = { x0: -112, y0: -112, x1: 168, y1: 168 };
export function clampCamera(c: Camera, b: Bounds = DEFAULT_BOUNDS, aspect = 1): Camera { const span = Math.max(20, Math.min(96, c.span)); return { span, x: Math.max(b.x0, Math.min(b.x1 - span, c.x)), y: Math.max(b.y0, Math.min(b.y1 - span / aspect, c.y)) }; }
function hash(x: number, y: number) { return ((x * 374761393 + y * 668265263) ^ (x * y * 1274126177)) >>> 0; }

export function WorldMap({ frame, camera, onCamera, onSelect, selected, knowledge, borders, onAspect }: { frame: WorldFrame | null; camera: Camera; onCamera: (c: Camera) => void; onSelect: (id: number) => void; selected: number | null; knowledge: boolean; borders: boolean; onAspect: (aspect: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 540 });
  const [hover, setHover] = useState<{ x: number; y: number; label: string } | null>(null);
  const drag = useRef<{ x: number; y: number; cam: Camera; moved: boolean } | null>(null);
  const bounds = frame?.bounds ?? DEFAULT_BOUNDS;
  const view = frame?.view ?? (preview as unknown as WorldFrame['view']);
  const cam = frame ? camera : { x: -3, y: -3, span: 64 };
  const unit = size.w / cam.span;
  const offset = { x: 0, y: 0 };
  useEffect(() => {
    const el = canvas.current!;
    const observer = new ResizeObserver(([e]) => { setSize({ w: e.contentRect.width, h: e.contentRect.height }); onAspect(e.contentRect.width / e.contentRect.height); });
    observer.observe(el); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = canvas.current!; const ctx = el.getContext('2d')!; const dpr = Math.min(devicePixelRatio || 1, 2);
    el.width = Math.round(size.w * dpr); el.height = Math.round(size.h * dpr); ctx.scale(dpr, dpr);
    ctx.fillStyle = '#d8dfc3'; ctx.fillRect(0, 0, size.w, size.h);
    const px = (x: number) => offset.x + (x - cam.x) * unit, py = (y: number) => offset.y + (y - cam.y) * unit;
    const tileAt = (x: number, y: number) => view.tiles[(y - view.y0) * view.w + x - view.x0];
    for (let j = 0; j < view.h; j++) for (let i = 0; i < view.w; i++) {
      const x = view.x0 + i, y = view.y0 + j, t = view.tiles[j * view.w + i], h = hash(x, y);
      const left = px(x), top = py(y);
      ctx.fillStyle = tiles[t] ?? tiles[0]; ctx.fillRect(left, top, unit + .7, unit + .7);
      if (h % 4 === 0) { ctx.fillStyle = '#ffffff0d'; ctx.fillRect(left, top, unit, unit); }
      if (unit > 4 && t !== 1 && t !== 2 && h % 3 === 0) { ctx.fillStyle = '#455a3b20'; ctx.fillRect(left + unit * .3, top + unit * .6, unit * .18, unit * .09); }
      if ([1,2,3,10].includes(t)) {
        if (h % 3 === 0) { ctx.strokeStyle = '#e6f4ed55'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left + unit*.18,top + unit*.6); ctx.lineTo(left + unit*.7,top + unit*.6); ctx.stroke(); }
        if (tileAt(x+1,y) === 0 || tileAt(x,y+1) === 0) { ctx.fillStyle = '#dce2b840'; ctx.fillRect(left + unit*.85,top,unit*.15,unit); }
      }
    }
    // A thin original-settlement outline is geography, never a movement boundary.
    ctx.strokeStyle = '#fafaf1b0'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.strokeRect(px(0), py(0),56*unit,56*unit); ctx.setLineDash([]);
    if (borders) { ctx.strokeStyle = '#314e4960'; ctx.lineWidth = 1; for(let x=bounds.x0;x<=bounds.x1;x+=28){ctx.beginPath();ctx.moveTo(px(x),0);ctx.lineTo(px(x),size.h);ctx.stroke();} for(let y=bounds.y0;y<=bounds.y1;y+=28){ctx.beginPath();ctx.moveTo(0,py(y));ctx.lineTo(size.w,py(y));ctx.stroke();} }
    for (const [, kind, x, y, units] of view.nodes) {
      if (units <= 0) continue;
      const sx=px(x)+unit*.5, sy=py(y)+unit*.5;
      if (kind==='tree') {
        ctx.fillStyle='#384d3430';ctx.beginPath();ctx.ellipse(sx+unit*.15,sy+unit*.4,unit*.7,unit*.38,0,0,7);ctx.fill();
        ctx.fillStyle='#756e45';ctx.fillRect(sx-unit*.09,sy-unit*.2,unit*.18,unit*.8);
        ctx.fillStyle='#5e7f4d';ctx.beginPath();ctx.moveTo(sx,sy-unit*1.15);ctx.lineTo(sx+unit*.66,sy+unit*.15);ctx.lineTo(sx-unit*.66,sy+unit*.15);ctx.fill();
        ctx.fillStyle='#6b8a53';ctx.beginPath();ctx.moveTo(sx,sy-unit*.9);ctx.lineTo(sx+unit*.48,sy-unit*.05);ctx.lineTo(sx-unit*.48,sy-unit*.05);ctx.fill();
      } else if(kind==='stone'||kind==='flint') {
        ctx.fillStyle=kind==='flint'?'#6c7769':'#8b9785';ctx.beginPath();ctx.moveTo(sx-unit*.4,sy+unit*.3);ctx.lineTo(sx-unit*.3,sy-unit*.25);ctx.lineTo(sx+unit*.15,sy-unit*.45);ctx.lineTo(sx+unit*.48,sy+unit*.15);ctx.closePath();ctx.fill();ctx.fillStyle='#e1e5ce80';ctx.fillRect(sx-unit*.18,sy-unit*.23,unit*.22,unit*.1);
      } else if(kind==='bush'||kind==='scrub'||kind==='cactus') {
        ctx.fillStyle=kind==='cactus'?'#6c8b61':'#78904d';ctx.beginPath();ctx.ellipse(sx,sy,unit*.48,unit*.37,0,0,7);ctx.fill();
        if(kind==='bush'&&unit>5){ctx.fillStyle='#a5685a';ctx.fillRect(sx-unit*.24,sy-unit*.14,unit*.14,unit*.14);ctx.fillRect(sx+unit*.13,sy+unit*.05,unit*.14,unit*.14);}
      } else { ctx.fillStyle=kind==='shellfish'?'#f1e4bf':'#7a7751';ctx.fillRect(sx-unit*.24,sy-unit*.1,unit*.5,unit*.2); }
    }
    for(const [,x,y] of view.shelters){const sx=px(x),sy=py(y);ctx.fillStyle='#8b694a';ctx.fillRect(sx,sy,unit,unit);ctx.fillStyle='#d2b98b';ctx.beginPath();ctx.moveTo(sx-unit*.2,sy);ctx.lineTo(sx+unit*.5,sy-unit*.8);ctx.lineTo(sx+unit*1.2,sy);ctx.fill();}
    for(const [,x,y] of view.fires){ctx.fillStyle='#f2b54c';ctx.beginPath();ctx.arc(px(x)+unit*.5,py(y)+unit*.5,unit*.5,0,7);ctx.fill();ctx.fillStyle='#b65c3f';ctx.fillRect(px(x)+unit*.3,py(y)+unit*.4,unit*.4,unit*.4);}
    if(knowledge && frame?.inspector?.observation){const o=frame.inspector.observation;ctx.fillStyle='#21392b65';ctx.beginPath();ctx.rect(0,0,size.w,size.h);ctx.rect(px(o.self.x-o.radius),py(o.self.y-o.radius),(o.radius*2+1)*unit,(o.radius*2+1)*unit);ctx.fill('evenodd');ctx.strokeStyle='#fafaf1';ctx.lineWidth=2;ctx.strokeRect(px(o.self.x-o.radius),py(o.self.y-o.radius),(o.radius*2+1)*unit,(o.radius*2+1)*unit);}
    for(const [id,,x,y] of view.creatures){const sx=px(x)+unit*.5,sy=py(y)+unit*.5;const r=Math.max(3,unit*.4);ctx.fillStyle='#304c3440';ctx.beginPath();ctx.ellipse(sx+1,sy+r,r*1.1,r*.45,0,0,7);ctx.fill();if(id===selected){ctx.strokeStyle='#fffaf0';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(sx,sy,r+5,0,7);ctx.stroke();}ctx.fillStyle='#f5d168';ctx.beginPath();ctx.ellipse(sx,sy,r*.85,r*1.1,0,0,7);ctx.fill();ctx.fillStyle='#37432b';ctx.fillRect(sx-r*.4,sy-r*.3,Math.max(1,r*.22),Math.max(1,r*.3));ctx.fillRect(sx+r*.2,sy-r*.3,Math.max(1,r*.22),Math.max(1,r*.3));}
  }, [view, cam.x, cam.y, cam.span, size, selected, knowledge, borders, frame?.inspector]);
  useEffect(() => {
    const el = canvas.current!;
    const wheel = (event: WheelEvent) => {
      if (!frame || event.ctrlKey || event.metaKey || !event.deltaY) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const span = Math.max(20, Math.min(96, camera.span * (event.deltaY > 0 ? 1.15 : 1 / 1.15)));
      onCamera(clampCamera({ span, x: camera.x + (camera.span - span) * (event.clientX - rect.left) / size.w,
        y: camera.y + (camera.span - span) * (event.clientY - rect.top) / size.w }, bounds, size.w / size.h));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [frame, camera, size, onCamera]);
  function zoom(delta: number) {
    const span = Math.max(20, Math.min(96, camera.span + delta));
    if (frame) onCamera(clampCamera({span, x:camera.x+(camera.span-span)/2, y:camera.y+(camera.span-span)/2/(size.w/size.h)},bounds,size.w/size.h));
  }
  const position = (e: { clientX: number; clientY: number }) => {const r=canvas.current!.getBoundingClientRect();return {x:Math.floor(cam.x+(e.clientX-r.left-offset.x)/unit),y:Math.floor(cam.y+(e.clientY-r.top-offset.y)/unit)};};
  function pan(dx:number,dy:number){if(frame)onCamera(clampCamera({...camera,x:camera.x+dx,y:camera.y+dy},bounds,size.w/size.h));}
  return <div className="exp-map-scene">
    <canvas ref={canvas} className="exp-canvas" tabIndex={0} aria-label="World map. Drag to pan, use arrow keys to move, plus and minus to zoom. Select creatures from the Residents list."
      onKeyDown={e=>{const d=Math.max(2,camera.span/8);const dirs:Record<string,number[]>={ArrowUp:[0,-d],ArrowDown:[0,d],ArrowLeft:[-d,0],ArrowRight:[d,0]};if(dirs[e.key]){e.preventDefault();pan(dirs[e.key][0],dirs[e.key][1]);}else if(['+','=','-'].includes(e.key)){e.preventDefault();zoom(e.key==='-'?8:-8);}}}
      onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,cam:camera,moved:false};}}
      onPointerMove={e=>{if(drag.current&&frame){const d=drag.current;const dx=(d.x-e.clientX)/unit,dy=(d.y-e.clientY)/unit;if(Math.abs(dx)+Math.abs(dy)>.5)d.moved=true;if(d.moved)onCamera(clampCamera({...d.cam,x:d.cam.x+dx,y:d.cam.y+dy},bounds,size.w/size.h));}else{const p=position(e);const t=view.tiles[(p.y-view.y0)*view.w+p.x-view.x0];setHover({...p,label:tileLabel[t]??'Outside viewport'});}}}
      onPointerUp={e=>{if(!drag.current?.moved&&frame){const p=position(e);const c=frame.residents.find(c=>Math.abs(c.x-p.x)<=1&&Math.abs(c.y-p.y)<=1);if(c)onSelect(c.id);}drag.current=null;}}
      onPointerCancel={()=>{drag.current=null;}} onPointerLeave={()=>setHover(null)} />
    <div className="exp-compass" aria-hidden="true"><span>N</span><svg width="22" height="34" viewBox="0 0 22 34"><path d="M11 0 21 28 11 22 1 28Z" fill="#fafaf1"/><path d="M11 0v22L1 28Z" fill="#3c5947"/></svg></div>
    <div className="exp-map-caption">{frame ? 'Observer view' : 'Terrain preview'}<span>{hover ? `${hover.label} · ${hover.x}, ${hover.y}` : 'Original settlement outlined'}</span></div>
    <div className="exp-map-controls" aria-label="Map controls"><button aria-label="Zoom in" disabled={!frame||camera.span<=20} onClick={()=>zoom(-12)}><Icon name="plus"/></button><button aria-label="Zoom out" disabled={!frame||camera.span>=96} onClick={()=>zoom(12)}><Icon name="minus"/></button><button aria-label="Return to settlement" disabled={!frame} onClick={()=>onCamera({x:0,y:0,span:56})}><Icon name="home"/></button></div>
  </div>;
}

export function MiniMap({ frame, camera, onCamera, aspect = 1 }: { frame: WorldFrame | null; camera: Camera; onCamera: (c: Camera) => void; aspect?: number }) {
  const b=frame?.bounds??DEFAULT_BOUNDS; const extent=b.x1-b.x0;
  return <div className="exp-minimap"><svg role="img" aria-label="Generated chunks and current viewport. Gray chunks have not been materialized." viewBox="0 0 280 280"><rect width="280" height="280" fill="#e0e2d5"/>{frame?.minimap.biomes.map(([x,y,kind])=><rect key={`${x},${y}`} x={(x*28-b.x0)/extent*280} y={(y*28-b.y0)/extent*280} width={28/extent*280} height={28/extent*280} fill={kind==='cold'? '#becbd0':kind==='arid'?'#cfb47b':kind==='temperate'?'#819b69':'#78a5ae'}/>)}<rect x={(0-b.x0)/extent*280} y={(0-b.y0)/extent*280} width={56/extent*280} height={56/extent*280} fill="none" stroke="#53664c" strokeDasharray="4 3" strokeWidth="2"/><rect data-testid="minimap-viewport" x={(camera.x-b.x0)/extent*280} y={(camera.y-b.y0)/extent*280} width={camera.span/extent*280} height={camera.span/aspect/extent*280} fill="#fafaf133" stroke="#294d36" strokeWidth="3"/>{frame?.residents.map(c=><circle key={c.id} cx={(c.x-b.x0)/extent*280} cy={(c.y-b.y0)/extent*280} r="2.5" fill="#394c30"/>)}</svg><button className="exp-minimap-hit" disabled={!frame} aria-label="Navigate using minimap. Arrow keys move the viewport." onKeyDown={e=>{const dirs:Record<string,number[]>={ArrowUp:[0,-28],ArrowDown:[0,28],ArrowLeft:[-28,0],ArrowRight:[28,0]};if(dirs[e.key]){e.preventDefault();onCamera(clampCamera({...camera,x:camera.x+dirs[e.key][0],y:camera.y+dirs[e.key][1]},b,aspect));}}} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();onCamera(clampCamera({...camera,x:b.x0+(e.clientX-r.left)/r.width*extent-camera.span/2,y:b.y0+(e.clientY-r.top)/r.height*extent-camera.span/aspect/2},b,aspect));}}/></div>;
}
