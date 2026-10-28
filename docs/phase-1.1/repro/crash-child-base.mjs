// Child process for crash-consistency tests. Runs a real Service on DATA_DIR and gets SIGKILLed, either by the
// store's STRATOKS_CRASH_AT fault point or by itself after uncommitted lifecycle records reached disk.
// Usage: node crash-child.mjs <dataDir> <mode> [arg]
import { Service } from './base/server/src/service.js';
import { crashConfig, FIXED_NOW } from './crash-config-base.mjs';

const [dir, mode, arg] = process.argv.slice(2);
const svc = new Service(crashConfig(dir), { now: () => FIXED_NOW });
svc.start(); clearTimeout(svc.timer); clearInterval(svc.snapTimer); svc.running = false;
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let births = 0, deaths = 0;
const rec = svc.world.onRecord;
svc.world.onRecord = (r) => { rec(r); if (r.kind === 'birth') births++; if (r.kind === 'death') deaths++; };

if (mode === 'lifecycle') {
  // Snapshot at tick `arg`, then keep simulating (logs reach disk every tick) until births AND deaths were logged
  // after that snapshot, then die without another snapshot: the logs are ahead of the committed world.
  while (svc.world.tick < Number(arg)) svc.tickOnce();
  svc.snapshot(true); births = deaths = 0;
  out({ snapshotTick: svc.world.tick, snapshotSeq: svc.world.seq });
  while (!(births >= 1 && deaths >= 1)) svc.tickOnce();
  out({ killedAtTick: svc.world.tick, births, deaths });
  process.kill(process.pid, 'SIGKILL');
} else if (mode === 'run') {
  // Plain run; the STRATOKS_CRASH_AT env var decides where (and if) the process dies.
  for (let i = 0; i < Number(arg); i++) { svc.tickOnce(); if (i % 200 === 199) svc.snapshot(true); }
  svc.stop(); out({ finished: true, tick: svc.world.tick });
} else if (mode === 'intervene') {
  // Mirror of POST /api/dev/interventions: apply, then commit; the ack would only be sent after snapshot(true).
  const r = svc.world.intervene(JSON.parse(arg), '0xdeveloper');
  svc.snapshot(true);
  out({ acked: true, duplicate: r.duplicate });
  svc.stop();
}
