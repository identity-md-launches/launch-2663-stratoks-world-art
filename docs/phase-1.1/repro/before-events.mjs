// Baseline (b57000a) readEvents on three ~5MB logs: synchronous full read+parse per request.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { Store } from './base/server/src/store.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'before-'));
const pad = 'x'.repeat(180); let seq = 0;
for (const name of ['events.jsonl.2', 'events.jsonl.1', 'events.jsonl']) { const parts = []; let size = 0; while (size < 5e6) { const l = JSON.stringify({ seq: ++seq, tick: seq, type: 'filler', pad }) + '\n'; parts.push(l); size += l.length; } fs.writeFileSync(path.join(dir, name), parts.join('')); }
const st = new Store(dir, { eventLogFiles: 3 });
const times = []; const h0 = process.memoryUsage().heapUsed; let peak = 0;
for (let i = 0; i < 10; i++) { const t = performance.now(); const r = st.readEvents(0, 1); times.push(performance.now() - t); peak = Math.max(peak, process.memoryUsage().heapUsed - h0); if (r.length !== 1) throw 0; }
times.sort((a, b) => a - b);
console.log(JSON.stringify({ baseline: 'b57000a Store.readEvents(after=0, limit=1)', events: seq, historyBytes: 15e6, perRequestBlockingMsP50: +times[5].toFixed(1), perRequestBlockingMsMax: +times[9].toFixed(1), bytesReadPerRequest: 15e6, linesParsedPerRequest: seq, peakHeapDeltaMB: +(peak / 1048576).toFixed(1), note: 'synchronous on the simulation thread: every tick waits for the whole read' }, null, 1));
