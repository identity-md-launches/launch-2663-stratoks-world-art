// Real service, durable store, HTTP and WebSocket clients in one process.
// This intentionally includes client CPU/RSS inside the benchmark's cap.
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { Service } from '../../server/src/service.js';
import { createServer } from '../../server/src/http.js';
import { DEFAULTS, deepMerge } from '../../server/src/config.js';
const sourceHashes = Object.fromEntries(['actions', 'brain', 'controller', 'mushroom', 'world', 'service', 'view', 'config', 'store', 'migrations', 'rng', 'http', 'ws', 'auth', 'wallet', 'speech'].map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(new URL(`../../server/src/${name}.js`, import.meta.url))).digest('hex')]));
// Read only this process's cgroup counters, never host/container identities.
const cgroup = () => Object.fromEntries(['memory.max', 'memory.peak', 'memory.current', 'memory.events', 'cpu.max', 'cpu.stat'].map(name => {
  try { return [name, fs.readFileSync(`/sys/fs/cgroup/${name}`, 'utf8').trim()]; } catch { return [name, null]; }
}));
const cgroupBefore = cgroup();
const [population, mode, clients, ticks, realtime] = [Number(process.argv[2] ?? 24), process.argv[3] ?? 'mb-v1', Number(process.argv[4] ?? 8), Number(process.argv[5] ?? 1200), process.argv[6] === 'realtime'];
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratoks-capacity-'));
const cfg = deepMerge(DEFAULTS, { server: { dataDir, host: '127.0.0.1', port: 0, rateLimit: { publicGet: 1000000 } }, world: { brainMode: mode, initialSeedCount: population, tickMs: 1000 } });
const svc = new Service(cfg); svc.start(); clearTimeout(svc.timer); clearInterval(svc.snapTimer);
const server = createServer(svc); await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const socks = [], clientState = [];
const immediate = () => new Promise(r => setImmediate(r));
const delay = n => new Promise(r => setTimeout(r, n));
const q = (a, p) => a.length ? [...a].sort((a,b) => a-b)[Math.floor((a.length-1)*p)] : null;
const times = [], intervals = [], snapshots = [], payloads = [], polls = [];
let lastStart = null, rssPeak = process.memoryUsage().rss;
try {
  for (let i = 0; i < clients; i++) {
    const state = { n: null, tick: 0, messages: 0, bytes: 0, gaps: 0, closed: false, entities: new Map() };
    const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`); socks.push(sock); clientState.push(state);
    sock.onmessage = e => {
      const msg = JSON.parse(e.data); state.messages++; state.bytes += Buffer.byteLength(e.data);
      if (msg.type === 'snapshot') { state.entities = new Map(msg.entities.map(e => [e.k, e])); snapshots.push(Buffer.byteLength(e.data)); }
      if (msg.type === 'delta') {
        if (state.n !== null && msg.n !== state.n + 1) state.gaps++;
        for (const e of msg.upsert) state.entities.set(e.k, e);
        for (const k of msg.remove) state.entities.delete(k);
        if (i === 0) payloads.push(Buffer.byteLength(e.data));
      }
      state.n = msg.n; state.tick = msg.tick;
    };
    sock.onclose = () => { state.closed = true; };
    await new Promise((r,j) => { sock.onopen = r; sock.onerror = j; });
  }
  const initialIds = svc.world.creatures.map(c => c.id);
  const warmup = realtime ? 0 : 300;
  for (let i = 0; i < warmup; i++) { svc.tickOnce(); if (i % 50 === 0) svc.snapshot(true); await immediate(); }
  payloads.length = 0;
  const metricsStart = svc.world.populationMetrics(), cpuStart = process.cpuUsage(), start = performance.now();
  for (let i = 0; i < ticks; i++) {
    if (realtime) await delay(Math.max(0, start + i * 1000 - performance.now()));
    const t = performance.now();
    if (lastStart !== null) intervals.push(t - lastStart); lastStart = t;
    svc.tickOnce();
    // Include a real fsynced snapshot every 30 simulated seconds, as deployed.
    if (i % 30 === 29) svc.snapshot(true);
    times.push(performance.now() - t);
    if (i % 10 === 0) {
      const id = svc.world.creatures[0]?.id;
      if (id !== undefined) { const text = await (await fetch(`http://127.0.0.1:${port}/api/creatures/${id}`)).text(); polls.push(Buffer.byteLength(text)); }
    }
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
    await immediate();
  }
  // Drain queued network frames without adding artificial tick work.
  for (let i = 0; i < 20; i++) await delay(5);
  const elapsed = performance.now() - start, cpu = process.cpuUsage(cpuStart);
  const world = svc.world;
  const equal = clientState.every(s => JSON.stringify([...s.entities]) === JSON.stringify([...clientState[0].entities]));
  const output = {
    formatVersion: 2, sourceHashes, platform: `${process.platform}/${process.arch}`, node: process.version,
    mode, initialPopulation: population, clients, warmupTicks: warmup, measuredTicks: ticks, realtime,
    finalPopulation: world.creatures.length, populationAtMeasurementStart: metricsStart.population,
    initialIdsRetained: initialIds.filter(id => world.creatures.some(c => c.id === id)).length,
    deaths: world.totals.deaths, births: world.totals.births, deathsByCause: world.totals.deathsByCause,
    elapsedMs: elapsed, cpuMs: (cpu.user + cpu.system)/1000, cpuMsPerTick: (cpu.user + cpu.system)/1000/ticks,
    tickWallMs: { p50: q(times,.5), p95:q(times,.95), p99:q(times,.99), max:q(times,1) },
    intervalMs: { p50:q(intervals,.5), p95:q(intervals,.95), p99:q(intervals,.99), max:q(intervals,1) },
    sustainableOneSecondTickByCpuBudget: (cpu.user + cpu.system)/1000/ticks < 750 && q(times,.99) < 1000,
    rssPeakBytes: rssPeak, processMaxRssBytes: process.resourceUsage().maxRSS*1024,
    snapshotStateBytes: Buffer.byteLength(JSON.stringify(world.toState())),
    protocol: { initialSnapshotBytes: snapshots, deltaBytes: { p50:q(payloads,.5),p95:q(payloads,.95),p99:q(payloads,.99), max:q(payloads,1) }, inspectorBytes: { p50:q(polls,.5),p95:q(polls,.95),max:q(polls,1) },
      totalReceivedBytes:clientState.reduce((s,c)=>s+c.bytes,0), sequenceGaps:clientState.reduce((s,c)=>s+c.gaps,0), clientsSameEntities:equal,
      clientsFinalTick:clientState.map(s=>s.tick), clientsClosedDuringRun:clientState.filter(c=>c.closed).length },
    raw: { tickWallMs: times, intervalMs: intervals, firstClientDeltaBytes:payloads, inspectorBytes:polls },
    cgroup: { before: cgroupBefore, after: cgroup() },
    limitation: 'Accelerated runs estimate throughput; realtime runs measure cadence. Service and real clients share process CPU/RSS. Cgroup counters are observational until the runner verifies the requested container settings. No population reset, reseed, culling, refills or disabled ecology. Short-run evidence only.'
  };
  const name = `capacity-${mode}-${population}-${clients}-${realtime?'realtime':'accelerated'}.json`;
  fs.writeFileSync(process.argv[7] ?? new URL(`../results/phase2a/${name}`, import.meta.url), JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({ ...output, raw: undefined }));
  if (!equal || output.protocol.sequenceGaps || output.protocol.clientsClosedDuringRun || output.protocol.clientsFinalTick.some(t => t !== world.tick)) process.exitCode = 1;
} finally {
  for (const s of socks) s.close();
  server.closeAllConnections?.();
  await new Promise(r=>server.close(r)); svc.stop(); fs.rmSync(dataDir,{recursive:true,force:true});
}
