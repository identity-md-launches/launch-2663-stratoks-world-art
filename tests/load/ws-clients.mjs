// Real server process + N WebSocket clients (clients run on the SAME machine, so CPU numbers include client overhead).
// usage: node tests/load/ws-clients.mjs [clients=100] [seconds=30] [tickMs=250] [population=24]
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const [N, SECS, TICK, POP] = [100, 30, 250, 24].map((d, i) => Number(process.argv[2 + i] ?? d));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsload-')), port = 8800 + Math.floor(Math.random() * 500);
const child = spawn('node', [new URL('../../server/src/main.js', import.meta.url).pathname], { env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', TICK_MS: String(TICK), INITIAL_SEED_COUNT: String(POP), DEMO_MODE: '1', LOG_LEVEL: 'error' }, stdio: 'inherit' });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i++) { try { await fetch(base + '/health'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
let msgs = 0, bytes = 0, gaps = 0, closed = 0; const last = [];
const socks = [];
for (let i = 0; i < N; i++) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); let n = null;
  ws.onmessage = (m) => { msgs++; bytes += m.data.length; const d = JSON.parse(m.data); if (d.type === 'snapshot') n = d.n; else if (d.type === 'delta') { if (n !== null && d.n !== n + 1) gaps++; n = d.n; last[i] = d.tick; } };
  ws.onclose = () => closed++; socks.push(ws);
}
const samples = [];
for (let s = 0; s < SECS; s += 5) { await new Promise((r) => setTimeout(r, 5000)); const st = await (await fetch(base + '/api/status')).json(); samples.push({ t: s + 5, cpu: st.cpuPercent, rssMB: st.rssMB, p95: st.tickLatencyMs.p95, p99: st.tickLatencyMs.p99, max: st.tickLatencyMs.max, lagMs: st.lagMs, overloaded: st.overloaded, clients: st.clients, pop: st.population }); }
const maxTick = Math.max(...last.filter(Boolean)), minTick = Math.min(...last.filter(Boolean));
const out = { clients: N, seconds: SECS, tickMs: TICK, population: POP, messages: msgs, mbReceivedTotal: +(bytes / 1e6).toFixed(1), deltaGaps: gaps, closedByServer: closed, tickSpreadAcrossClients: maxTick - minTick, samples, last: samples.at(-1) };
console.log(JSON.stringify(out));
const f = new URL(`../results/ws-${N}clients-pop${POP}.json`, import.meta.url); fs.writeFileSync(f, JSON.stringify(out, null, 1));
socks.forEach((s) => s.close()); child.kill('SIGTERM'); setTimeout(() => process.exit(0), 500);
