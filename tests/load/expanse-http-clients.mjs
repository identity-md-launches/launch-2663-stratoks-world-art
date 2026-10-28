// Local transport check: eight real HTTP clients request view + inspector payloads concurrently.
// usage: node tests/load/expanse-http-clients.mjs [rounds]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { startExpanse } from '../../server/src/expanse/server.js';

const rounds = Number(process.argv[2] ?? 100), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expanse-http-clients-'));
const service = startExpanse({ dataDir, seed: 4242, tickMs: 60_000, port: 0, host: '127.0.0.1', initialCount: 24 });
await new Promise((resolve) => service.server.once('listening', resolve));
const base = `http://127.0.0.1:${service.server.address().port}`;
const clients = Array.from({ length: 8 }, (_, id) => ({ id, creature: service.world.creatures[id * 2] }));
const batchMs = [], requestMs = [], payloadBytes = [], tickSets = [];
const before = JSON.stringify(service.world.toState());
try {
  for (let round = 0; round < rounds; round++) {
    const started = performance.now();
    const responses = await Promise.all(clients.map(async ({ id, creature }) => {
      const viewportUrl = `/api/expanse/view?x=${creature.x - 20}&y=${creature.y - 12}&w=40&h=24`;
      const paths = [viewportUrl, `/api/expanse/creature/${creature.id}`];
      const own = [];
      for (const endpoint of paths) {
        const t = performance.now(), response = await fetch(base + endpoint), bytes = new Uint8Array(await response.arrayBuffer());
        if (!response.ok) throw new Error(`client ${id}: ${endpoint} returned ${response.status}`);
        requestMs.push(performance.now() - t); payloadBytes.push(bytes.byteLength);
        own.push(JSON.parse(new TextDecoder().decode(bytes)));
      }
      return own;
    }));
    batchMs.push(performance.now() - started);
    tickSets.push(new Set(responses.map((pair) => pair[0].tick)).size);
  }
  const after = JSON.stringify(service.world.toState());
  const quantile = (xs, q) => { const s = xs.slice().sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(3); };
  const report = { clients: clients.length, rounds, requests: requestMs.length, endpointMix: '1 viewport + 1 inspector per client per round', transport: 'loopback HTTP to the actual expanse service; no browser rendering',
    roundLatencyMs: { p50: quantile(batchMs, 0.50), p95: quantile(batchMs, 0.95), p99: quantile(batchMs, 0.99), max: +Math.max(...batchMs).toFixed(3) },
    requestLatencyMs: { p50: quantile(requestMs, 0.50), p95: quantile(requestMs, 0.95), p99: quantile(requestMs, 0.99) },
    payloadBytes: { mean: Math.round(payloadBytes.reduce((a, b) => a + b, 0) / payloadBytes.length), max: Math.max(...payloadBytes), total: payloadBytes.reduce((a, b) => a + b, 0) },
    sameWorldTickEveryRound: tickSets.every((n) => n === 1), serializedWorldStateUnchanged: before === after,
    node: process.version, arch: process.arch, cpus: os.cpus().length };
  console.log(JSON.stringify(report));
} finally {
  await service.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
