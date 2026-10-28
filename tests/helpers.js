import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULTS, deepMerge } from '../server/src/config.js';
import { Service } from '../server/src/service.js';
import { createServer } from '../server/src/http.js';
import { signForTests, addressFromPrivateKey } from '../server/src/wallet.js';

export const DEV_KEY = '0000000000000000000000000000000000000000000000000000000000000a11';
export const VIS_KEY = '0000000000000000000000000000000000000000000000000000000000000b22';
export const VIS2_KEY = '0000000000000000000000000000000000000000000000000000000000000c33';
export const ORIGIN = 'https://client.test';
export const tmpDir = (n = 'st') => fs.mkdtempSync(path.join(os.tmpdir(), `${n}-`));

export function testConfig(over = {}) {
  return deepMerge(DEFAULTS, deepMerge({
    server: { port: 0, host: '127.0.0.1', allowedOrigins: [ORIGIN], dataDir: tmpDir() },
    auth: { developerWallets: [addressFromPrivateKey(DEV_KEY)] },
    world: { tickMs: 20 },
  }, over));
}
export async function startApp(over = {}, opts = {}) {
  const cfg = testConfig(over);
  const svc = new Service(cfg, { log: () => {}, ...(opts.now ? { now: opts.now } : {}) });
  svc.start();
  if (opts.manualTicks) { clearTimeout(svc.timer); }
  const server = createServer(svc);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); svc.stop(); };
  return { cfg, svc, server, base, stop, dataDir: cfg.server.dataDir };
}
export async function api(base, method, p, { body, token, origin = ORIGIN } = {}) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, json };
}
export async function login(base, key, origin = ORIGIN) {
  const address = addressFromPrivateKey(key);
  const n = await api(base, 'POST', '/api/auth/nonce', { body: { address }, origin });
  if (n.status !== 200) return n;
  const sig = signForTests(n.json.message, key);
  return api(base, 'POST', '/api/auth/verify', { body: { address, message: n.json.message, signature: sig }, origin });
}
export const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
export function runTicks(w, n) { for (let i = 0; i < n; i++) w.step(); }
export async function wsClient(base, after = 0) {
  const url = base.replace('http', 'ws') + '/ws' + (after ? `?after=${after}` : '');
  const ws = new WebSocket(url);
  const st = { entities: new Map(), events: new Map(), tick: 0, msgs: 0, n: 0, gaps: 0, meta: null, ws };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data); st.msgs++;
    if (d.type === 'snapshot') { st.entities = new Map(d.entities.map((e) => [e.k, e])); st.tick = d.tick; st.n = d.n; st.meta = d.world; st.tiles = d.world.tiles; for (const e of d.events) st.events.set(e.seq, e); }
    else if (d.type === 'delta') { if (d.n !== st.n + 1) st.gaps++; st.n = d.n; for (const e of d.upsert) st.entities.set(e.k, e); for (const k of d.remove) st.entities.delete(k); for (const e of d.events) st.events.set(e.seq, e); st.tick = d.tick; st.meta = d.meta; st.health = d.health; st.dupEvents = (st.dupEvents ?? 0); }
  };
  return st;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, ms = 5000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(10); } return false; }
