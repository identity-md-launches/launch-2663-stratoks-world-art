// Finding 3: crash-consistent world history. Real child processes are SIGKILLed at write boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Service } from '../server/src/service.js';
import { crashConfig, FIXED_NOW } from './fixtures/crash-config.mjs';
import { tmpDir } from './helpers.js';

const CHILD = fileURLToPath(new URL('./fixtures/crash-child.mjs', import.meta.url));
function child(dir, mode, arg, crashAt) {
  const env = { ...process.env }; delete env.STRATOKS_CRASH_AT; if (crashAt) env.STRATOKS_CRASH_AT = crashAt;
  const r = spawnSync(process.execPath, [CHILD, dir, mode, String(arg ?? '')], { env, encoding: 'utf8', timeout: 60_000 });
  return { signal: r.signal, status: r.status, out: r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)), err: r.stderr };
}
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const open = (dir) => { const s = new Service(crashConfig(dir), { now: () => FIXED_NOW }); s.start(); clearTimeout(s.timer); clearInterval(s.snapTimer); s.running = false; return s; };
const digest = (dir) => Object.fromEntries(fs.readdirSync(dir).filter((n) => /\.jsonl(\.\d+)?$|^world\.json$/.test(n)).map((n) => [n, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, n))).digest('hex')]));

// Invariants that must hold for a recovered data dir: logs never ahead of the snapshot, no creature dies twice,
// no birth twice, no recorded-dead creature alive, event seqs strictly increasing.
function checkConsistent(dir, svc) {
  const life = lines(path.join(dir, 'lifecycle.jsonl')), evs = lines(path.join(dir, 'events.jsonl'));
  const deaths = life.filter((r) => r.kind === 'death'), births = life.filter((r) => r.kind === 'birth');
  assert.equal(new Set(deaths.map((r) => r.id)).size, deaths.length, 'a creature has two death records');
  assert.equal(new Set(births.map((r) => r.id)).size, births.length, 'a creature has two birth records');
  const alive = new Set(svc.world.creatures.map((c) => c.id));
  for (const d of deaths) assert.ok(!alive.has(d.id), `creature ${d.id} recorded dead but alive`);
  for (const r of life) assert.ok(r.seq <= svc.world.seq, 'lifecycle record ahead of the snapshot');
  for (let i = 1; i < evs.length; i++) assert.ok(evs[i].seq > evs[i - 1].seq, `event seq not increasing at ${i}`);
  assert.equal(deaths.length, svc.world.totals.deaths, 'death records == committed death total');
  return { deaths: deaths.length, births: births.length, events: evs.length };
}

test('SIGKILL after lifecycle records but before the snapshot: recovered world never resurrects-and-re-kills', () => {
  const dir = tmpDir('crash-life');
  const r = child(dir, 'lifecycle', 1000);
  assert.equal(r.signal, 'SIGKILL', r.err);
  const [{ snapshotSeq }, { births, deaths, killedAtTick }] = r.out;
  assert.ok(births >= 1 && deaths >= 1);
  const before = lines(path.join(dir, 'lifecycle.jsonl')).filter((x) => x.seq > snapshotSeq);
  assert.ok(before.length >= 2, 'uncommitted records were on disk at the crash (the original bug condition)');
  const s = open(dir);
  assert.equal(s.world.seq, snapshotSeq);
  assert.ok(s.recovery.moved['lifecycle.jsonl'].lines >= 2, 'uncommitted lifecycle tail moved to recovery/');
  assert.ok(fs.existsSync(path.join(dir, s.recovery.moved['lifecycle.jsonl'].orphanFile)), 'orphaned records preserved, not deleted');
  checkConsistent(dir, s);
  // The deterministic world re-lives the same future: the same creatures die again, and must be recorded ONCE.
  // Replay the exact future the child actually reached. Corrected foraging can
  // move its first death beyond the former arbitrary 1500-tick replay window.
  assert.ok(killedAtTick > s.world.tick && killedAtTick < 20000);
  while (s.world.tick < killedAtTick) s.tickOnce();
  s.snapshot(true);
  const c = checkConsistent(dir, s);
  assert.equal(c.deaths, deaths); assert.equal(c.births, births);
  s.stop();
  // Repeated recovery is a no-op.
  const d1 = digest(dir); const s2 = open(dir); assert.deepEqual(s2.recovery.moved, {}); s2.stop();
  assert.deepEqual(Object.keys(digest(dir)).sort(), Object.keys(d1).sort());
  checkConsistent(dir, open(dir));
});

for (const point of ['lifecycle-appended:3', 'events-appended:20', 'snapshot-tmp-written:2', 'snapshot-committed:3']) {
  test(`SIGKILL at write boundary ${point}, then repeated recovery and continued simulation stay consistent`, () => {
    const dir = tmpDir('crash-pt');
    assert.equal(child(dir, 'run', 1200).status, 0); // establish a world with history first
    const r = child(dir, 'run', 3000, point);
    assert.equal(r.signal, 'SIGKILL', `expected a crash at ${point}: ${r.err}`);
    let s = open(dir); checkConsistent(dir, s);
    for (let i = 0; i < 800; i++) s.tickOnce();
    s.snapshot(true); checkConsistent(dir, s); s.stop();
    s = open(dir); assert.deepEqual(s.recovery.moved, {}); checkConsistent(dir, s); s.stop();
  });
}

test('SIGKILL during recovery itself (after the orphan file, before truncation) recovers identically', () => {
  const dir = tmpDir('crash-rec');
  child(dir, 'lifecycle', 1000);
  const r = child(dir, 'run', 0, 'recovery-orphan-written');
  assert.equal(r.signal, 'SIGKILL');
  const s = open(dir); checkConsistent(dir, s);
  for (let i = 0; i < 1500; i++) s.tickOnce();
  s.snapshot(true); checkConsistent(dir, s); s.stop();
});

test('interventions: crash before commit is not acknowledged and applies once on retry; crash after commit is a duplicate', () => {
  const body = { id: 'crash-iv-0001', type: 'add_food', x: 28, y: 28, radius: 6, intensity: 1 };
  const dir = tmpDir('crash-iv');
  assert.equal(child(dir, 'run', 50).status, 0);
  // 1. killed after the record reached interventions.jsonl but before the snapshot: no ack
  let r = child(dir, 'intervene', JSON.stringify(body), 'intervention-appended');
  assert.equal(r.signal, 'SIGKILL'); assert.equal(r.out.length, 0, 'never acknowledged');
  let s = open(dir);
  assert.equal(Object.keys(s.world.interventions).length, 0);
  assert.equal(lines(path.join(dir, 'interventions.jsonl')).length, 0, 'uncommitted intervention record moved aside');
  s.stop();
  // 2. retry: applied exactly once and acknowledged
  r = child(dir, 'intervene', JSON.stringify(body));
  assert.deepEqual(r.out[0], { acked: true, duplicate: false });
  // 3. retry killed right after commit (ack lost in flight) and retry again: duplicate, still one record
  r = child(dir, 'intervene', JSON.stringify(body), 'snapshot-committed');
  assert.equal(r.signal, 'SIGKILL');
  r = child(dir, 'intervene', JSON.stringify(body));
  assert.deepEqual(r.out[0], { acked: true, duplicate: true });
  s = open(dir);
  assert.equal(s.world.totals.interventions, 1);
  assert.equal(lines(path.join(dir, 'interventions.jsonl')).length, 1);
  assert.equal(s.world.events.filter((e) => e.type === 'intervention').length, 1);
  s.stop();
});

test('intervention save failure: 503-style failure, world keeps one application, a later commit makes it durable once', () => {
  const dir = tmpDir('iv-fail'); const s = open(dir);
  const body = { id: 'save-fail-0001', type: 'heal_area', x: 20, y: 20, radius: 4, intensity: 0.5 };
  s.store.failNextSaves = 2;
  const r1 = s.world.intervene(body, '0xdeveloper'); assert.equal(r1.duplicate, false);
  assert.throws(() => s.snapshot(true), /injected save failure/);
  const r2 = s.world.intervene(body, '0xdeveloper'); assert.equal(r2.duplicate, true);
  assert.throws(() => s.snapshot(true));
  const r3 = s.world.intervene(body, '0xdeveloper'); assert.equal(r3.duplicate, true);
  s.snapshot(true); s.stop();
  const s2 = open(dir);
  assert.equal(s2.world.totals.interventions, 1);
  assert.equal(lines(path.join(dir, 'interventions.jsonl')).length, 1);
  s2.stop();
});

test('failed and short event/intervention appends remain pending and a same-ID retry repairs every durable record', () => {
  const dir = tmpDir('iv-append-fail'); const s = open(dir);
  const eventFd = s.store.fds['events.jsonl'], interventionFd = s.store.fds['interventions.jsonl'];
  const original = fs.writeSync;
  const body = { id: 'append-failure-001', type: 'add_food', x: 28, y: 28, radius: 4, intensity: 0.5 };
  try {
    // The event append fails after the world mutation.  It must stay queued; a duplicate is not an acknowledgement
    // until the retry has written the event and snapshot.
    let failEvent = true;
    fs.writeSync = function (fd, ...args) { if (fd === eventFd && failEvent) { failEvent = false; const e = new Error('ENOSPC'); e.code = 'ENOSPC'; throw e; } return original.call(this, fd, ...args); };
    assert.equal(s.world.intervene(body, '0xdeveloper').duplicate, false);
    assert.throws(() => s.snapshot(true), /ENOSPC/);
    fs.writeSync = original;
    assert.equal(s.world.intervene(body, '0xdeveloper').duplicate, true);
    s.snapshot(true);
    assert.equal(lines(path.join(dir, 'events.jsonl')).filter((x) => x.type === 'intervention').length, 1);
    assert.equal(lines(path.join(dir, 'interventions.jsonl')).filter((x) => x.record.id === body.id).length, 1);

    // The intervention ledger has the same property.  A partial/short event write is completed by #writeFully,
    // not treated as success with a torn JSON line.
    const body2 = { ...body, id: 'ledger-failure-02', x: 29 };
    let failLedger = true;
    fs.writeSync = function (fd, ...args) { if (fd === interventionFd && failLedger) { failLedger = false; const e = new Error('ENOSPC'); e.code = 'ENOSPC'; throw e; } return original.call(this, fd, ...args); };
    assert.equal(s.world.intervene(body2, '0xdeveloper').duplicate, false);
    assert.throws(() => s.snapshot(true), /ENOSPC/);
    fs.writeSync = original;
    assert.equal(s.world.intervene(body2, '0xdeveloper').duplicate, true);
    let shorten = true;
    fs.writeSync = function (fd, data, offset, length, position) {
      if (fd === eventFd && shorten) { shorten = false; return original.call(this, fd, data, offset, Math.min(3, length), position); }
      return original.call(this, fd, data, offset, length, position);
    };
    s.snapshot(true);
    fs.writeSync = original;
    const eventLines = lines(path.join(dir, 'events.jsonl'));
    assert.equal(eventLines.filter((x) => x.type === 'intervention' && x.id === body2.id).length, 1);
    assert.equal(lines(path.join(dir, 'interventions.jsonl')).filter((x) => x.record.id === body2.id).length, 1);
  } finally { fs.writeSync = original; s.stop(); }
  const s2 = open(dir);
  assert.equal(s2.world.totals.interventions, 2, 'both recovered records are exactly once');
  s2.stop();
});

test('recovery refuses an ambiguous Phase-1 lost branch without moving its surviving records', () => {
  const dir = tmpDir('lost-branch'); const s = open(dir); s.stop();
  const life = path.join(dir, 'lifecycle.jsonl');
  const rec = (seq, id, branch) => JSON.stringify({ kind: 'birth', seq, id, branch }) + '\n';
  fs.writeFileSync(life, [11, 12, 13, 14, 15, 16, 17].map((n) => rec(n, 9000 + n, 'lost')).join('') + [11, 12, 13, 14].map((n) => rec(n, 8000 + n, 'surviving')).join(''));
  const before = fs.readFileSync(life, 'utf8');
  const retry = new Service(crashConfig(dir), { now: () => FIXED_NOW });
  assert.throws(() => retry.start(), /legacy lost branch detected.*check-history\.js/);
  assert.equal(fs.readFileSync(life, 'utf8'), before, 'startup did not keep a lost prefix and orphan the survivor');
  retry.store.release();
});

test('a second recovery at the same snapshot sequence appends evidence instead of overwriting the first orphan', () => {
  const dir = tmpDir('orphan-append'); const s = open(dir); const seq = s.world.seq;
  s.store.appendEvents([{ seq: seq + 1, tick: 1, type: 'first-tail' }]);
  s.store.recover(seq);
  const orphan = path.join(dir, 'recovery', `events.jsonl.after-${seq}.orphaned`);
  const first = fs.readFileSync(orphan, 'utf8');
  s.store.appendEvents([{ seq: seq + 1, tick: 2, type: 'second-tail' }]);
  s.store.recover(seq);
  const all = fs.readFileSync(orphan, 'utf8');
  assert.ok(all.startsWith(first)); assert.match(all, /second-tail/);
  s.stop();
});
