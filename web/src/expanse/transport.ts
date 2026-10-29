import type { FrameQuery, WorldFrame } from './types';

export function validateServer(value: string, pageProtocol = location.protocol): string {
  let u: URL;
  try { u = new URL(value.trim()); } catch { throw new Error('Enter a complete HTTPS server URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.username || u.password || u.search || u.hash) throw new Error('Use a server URL without credentials, query strings or fragments.');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback && pageProtocol !== 'https:')) throw new Error('Use HTTPS. Local HTTP is available from a local HTTP preview.');
  return u.href.replace(/\/$/, '');
}
export function queryString(query: FrameQuery) {
  return new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
}
export function validateFrame(data: unknown): WorldFrame {
  const f = data as WorldFrame;
  if (!f || f.v !== 1 || !Number.isFinite(f.tick) || !f.bounds || !f.summary || !f.view || f.view.tick !== f.tick || !Array.isArray(f.view.tiles) || !Array.isArray(f.residents) || !Array.isArray(f.discoveries) || !f.minimap || !Array.isArray(f.minimap.biomes) || f.view.w * f.view.h !== f.view.tiles.length) throw new Error('This server does not provide a compatible Expanse v1 frame. Use a Phase 2B backend.');
  return f;
}
export class ExpanseClient {
  private worker: Worker | null = null;
  private calls = new Map<number, { resolve: (v: WorldFrame) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private next = 0;
  constructor(private url?: string, seed = 20260101) {
    if (url) return;
    this.worker = new Worker(new URL('./demo.worker.ts', import.meta.url), { type: 'module' });
    this.worker.postMessage({ type: 'start', seed });
    this.worker.onmessage = ({ data }) => {
      const call = this.calls.get(data.id); if (!call) return;
      clearTimeout(call.timer); this.calls.delete(data.id);
      if (data.error) call.reject(new Error(data.error));
      else { try { call.resolve(validateFrame(data.frame)); } catch (e) { call.reject(e as Error); } }
    };
    this.worker.onerror = () => this.fail(new Error('The isolated demo could not start. Reopen it to retry.'));
  }
  async read(query: FrameQuery, signal?: AbortSignal): Promise<WorldFrame> {
    if (this.url) {
      const response = await fetch(`${this.url}/api/expanse/frame?${queryString(query)}`, { method: 'GET', cache: 'no-store', credentials: 'omit', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`Server returned ${response.status}. Check its URL and Phase 2B API.`);
      return validateFrame(await response.json());
    }
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.calls.delete(id); reject(new Error('The isolated demo timed out. Reopen it to retry.')); }, 15000);
      this.calls.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ type: 'frame', id, query });
    });
  }
  pause(paused: boolean) { this.worker?.postMessage({ type: 'pause', paused }); }
  private fail(e: Error) { for (const c of this.calls.values()) { clearTimeout(c.timer); c.reject(e); } this.calls.clear(); }
  close() { this.worker?.terminate(); this.fail(new Error('Connection closed.')); }
}
