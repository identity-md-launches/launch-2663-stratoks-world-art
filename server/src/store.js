// Durable storage: atomic checksummed snapshots, bounded rotating + indexed event log, seq-tagged lifecycle and
// intervention logs, crash recovery, backups.
//
// Durability protocol (see server/docs/DURABILITY.md):
//   * The snapshot (world.json) is the commit point. Every log line carries the world `seq` it belongs to.
//   * Log lines are appended before the snapshot that covers them, and all log files are fsync'd before a snapshot
//     is written, so a committed snapshot with seq S always has every log line with seq <= S on disk.
//   * Log lines with seq > S were written by a world that was never committed (SIGKILL / power loss before the next
//     snapshot). On startup they are moved (not deleted) to recovery/ and the logs are truncated to S, so a creature
//     whose uncommitted death was logged and who is alive again in the recovered world gets exactly one death record.
//   * Developer interventions are acknowledged only after the snapshot containing them is committed.
import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';
import crypto from 'node:crypto';
import { migrate, CURRENT_SCHEMA } from './migrations.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const FILES = ['world.json', 'world.prev.json', 'lifecycle.jsonl', 'interventions.jsonl', 'world.id'];
const INDEX_EVERY = 64;          // one index entry per 64 event lines: a read skips at most 63 lines before `after`
const CHUNK = 64 * 1024;
const seqOf = (line) => { const m = /"seq":(\d+)/.exec(line); return m ? Number(m[1]) : null; };
const pidNamespace = () => { try { return fs.readlinkSync('/proc/self/ns/pid'); } catch { return null; } };

// A PID by itself is not an identity in a container: every one-shot Docker command can be PID 1.
// New locks record the PID namespace as well.  Old numeric locks are considered stale when they name this
// process (the important stopped-container case); otherwise retain the conservative old PID check.
export function writerIsLive(dir) {
  const lock = path.join(path.resolve(dir), 'server.lock');
  if (!fs.existsSync(lock)) return false;
  let raw; try { raw = fs.readFileSync(lock, 'utf8').trim(); } catch { return false; }
  let info; try { info = JSON.parse(raw); } catch { info = Number(raw); }
  if (typeof info === 'number') info = { pid: info, legacy: true };
  if (!info || typeof info !== 'object') return false;
  if (!Number.isInteger(info.pid) || info.pid <= 0 || info.pid === process.pid) return false;
  if (info.pidNamespace && pidNamespace() && info.pidNamespace !== pidNamespace()) return false;
  try { process.kill(info.pid, 0); return true; } catch { return false; }
}
export function assertNoLiveWriter(dir, action = 'perform this operation') {
  if (writerIsLive(dir)) throw new Error(`server appears to be running; stop it before ${action}`);
}

// Test-only fault injection: STRATOKS_CRASH_AT=<point>[:<nth>] SIGKILLs the process at that write boundary.
const CRASH = (process.env.STRATOKS_CRASH_AT ?? '').split(':');
const crashHits = {};
export function crashPoint(name) {
  if (CRASH[0] !== name) return;
  crashHits[name] = (crashHits[name] ?? 0) + 1;
  if (crashHits[name] >= Number(CRASH[1] ?? 1)) process.kill(process.pid, 'SIGKILL');
}

function fsyncDir(dir) { try { const fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); fs.closeSync(fd); } catch { /* not supported on every fs */ } }

export class Store {
  constructor(dir, pcfg) {
    this.dir = path.resolve(dir); this.p = pcfg; this.f = (n) => path.join(this.dir, n);
    this.fds = {}; this.segs = []; this.reading = 0;
    this.stats = { readsServed: 0, bytesRead: 0, linesParsed: 0, rejectedBusy: 0 };
  }

  init() {
    fs.mkdirSync(this.dir, { recursive: true }); for (const d of ['backups', 'archive', 'recovery']) fs.mkdirSync(this.f(d), { recursive: true });
    const lock = this.f('server.lock');
    if (writerIsLive(this.dir)) throw new Error(`data dir ${this.dir} is locked by a running world service`);
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, pidNamespace: pidNamespace(), createdAt: new Date().toISOString() }));
    this.#openLogs();
  }
  release() { this.#closeLogs(); try { fs.unlinkSync(this.f('server.lock')); } catch { /* ignore */ } }
  #openLogs() {
    this.#closeLogs();
    for (const n of ['events.jsonl', 'lifecycle.jsonl', 'interventions.jsonl']) this.fds[n] = fs.openSync(this.f(n), 'a');
    this.#buildIndex();
  }
  #closeLogs() { for (const fd of Object.values(this.fds)) { try { fs.closeSync(fd); } catch { /* ignore */ } } this.fds = {}; }
  // fsync every log so that a snapshot written afterwards never refers to log lines that could be lost.
  syncLogs() { for (const fd of Object.values(this.fds)) fs.fsyncSync(fd); }
  #writeFully(fd, text) {
    const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text);
    let at = 0;
    while (at < bytes.length) {
      const n = fs.writeSync(fd, bytes, at, bytes.length - at);
      if (!Number.isInteger(n) || n <= 0) throw new Error('short log write');
      at += n;
    }
  }
  // If an append reports an error, undo any partial bytes before allowing a retry.  This keeps a retry from
  // making a valid-looking duplicate record after ENOSPC/short writes.
  #appendText(name, text) {
    const fd = this.fds[name], start = fs.fstatSync(fd).size;
    try { this.#writeFully(fd, text); }
    catch (e) {
      try { fs.ftruncateSync(fd, start); fs.fsyncSync(fd); }
      catch (rollback) { throw new Error(`log append failed and rollback failed for ${name}: ${e.message}; ${rollback.message}`); }
      throw e;
    }
  }

  // ---------- event segment index ----------
  segName(i) { return i ? `events.jsonl.${i}` : 'events.jsonl'; }
  // One linear scan per segment at startup (no JSON.parse; only the leading seq). Afterwards the index is maintained
  // incrementally on append and rotation, so request work never scales with total history.
  #buildIndex() {
    this.segs = [];
    for (let i = this.p.eventLogFiles; i >= 0; i--) {
      const name = this.segName(i);
      if (!fs.existsSync(this.f(name))) continue;
      this.segs.push(this.#scanSeg(name));
    }
  }
  #scanSeg(name) {
    const seg = { name, size: 0, lines: 0, firstSeq: null, lastSeq: null, index: [], stale: 0 };
    const fd = fs.openSync(this.f(name), 'r'), buf = Buffer.alloc(1 << 20); let pos = 0, carry = Buffer.alloc(0);
    try {
      for (;;) {
        const n = fs.readSync(fd, buf, 0, buf.length, pos); if (!n) break;
        let data = Buffer.concat([carry, buf.subarray(0, n)]), start = 0; const base = pos - carry.length;
        for (let nl = data.indexOf(10, start); nl !== -1; nl = data.indexOf(10, start)) {
          this.#indexLine(seg, data.toString('utf8', start, Math.min(nl, start + 40)), base + start);
          start = nl + 1;
        }
        carry = Buffer.from(data.subarray(start)); pos += n;
      }
      seg.size = pos - carry.length; // a torn trailing line (no newline) is excluded and overwritten by recovery
    } finally { fs.closeSync(fd); }
    return seg;
  }
  #indexLine(seg, head, offset) {
    const s = seqOf(head); if (s === null) return;
    // Legacy data written before crash recovery existed can contain a rewound seq (a lost branch). Keep the index
    // monotonic; such lines are counted and reported by bin/check-history.js.
    if (seg.lastSeq !== null && s <= seg.lastSeq) { seg.stale++; seg.lines++; return; }
    if (seg.lines % INDEX_EVERY === 0) seg.index.push([s, offset]);
    seg.firstSeq ??= s; seg.lastSeq = s; seg.lines++;
  }
  oldestEventSeq() { return this.segs.find((s) => s.firstSeq !== null)?.firstSeq ?? null; }

  appendEvents(evs) {
    if (!evs.length) return;
    const fd = this.fds['events.jsonl'];
    let cur = this.segs[this.segs.length - 1];
    if (!cur || cur.name !== 'events.jsonl') { cur = { name: 'events.jsonl', size: 0, lines: 0, firstSeq: null, lastSeq: null, index: [], stale: 0 }; this.segs.push(cur); }
    let text = '';
    for (const e of evs) text += JSON.stringify(e) + '\n';
    this.#appendText('events.jsonl', text);
    let offset = cur.size;
    for (const line of text.split('\n')) { if (line) { this.#indexLine(cur, line, offset); offset += Buffer.byteLength(line) + 1; } }
    cur.size = offset;
    crashPoint('events-appended');
    if (cur.size > this.p.eventLogMaxBytes) this.#rotate();
  }
  #rotate() { // bounded: keep eventLogFiles rotated generations + the live file
    const f = this.f('events.jsonl');
    // Once closed this generation is absent from syncLogs(); make it durable now.
    fs.fsyncSync(this.fds['events.jsonl']);
    fs.closeSync(this.fds['events.jsonl']);
    for (let i = this.p.eventLogFiles - 1; i >= 1; i--) if (fs.existsSync(`${f}.${i}`)) fs.renameSync(`${f}.${i}`, `${f}.${i + 1}`);
    fs.renameSync(f, `${f}.1`);
    const old = `${f}.${this.p.eventLogFiles}`; if (fs.existsSync(old)) fs.unlinkSync(old);
    this.fds['events.jsonl'] = fs.openSync(f, 'a');
    // Retention (unchanged from Phase 1): the live file plus eventLogFiles-1 rotated generations.
    const keep = this.p.eventLogFiles > 1 ? this.segs.slice(-(this.p.eventLogFiles - 1)) : [];
    keep.forEach((s, i) => { s.name = this.segName(keep.length - i); });
    this.segs = keep;
  }

  // Bounded paginated read of the durable event log: seq > after, ascending, at most `limit` events.
  // Work per call: binary search over the in-memory index + at most INDEX_EVERY-1 skipped lines + `limit` lines.
  // Reads are asynchronous (positioned fs reads on the libuv pool) and concurrency is capped.
  async readEvents(after, limit, through = Number.MAX_SAFE_INTEGER) {
    if (this.reading >= (this.p.maxConcurrentEventReads ?? 4)) { this.stats.rejectedBusy++; const e = new Error('event_reads_busy'); e.busy = true; throw e; }
    this.reading++;
    const pinned = [];
    try {
      const out = []; let last = after;
      const segs = this.segs.filter((s) => s.lastSeq !== null && s.lastSeq > after && s.firstSeq <= through);
      for (const seg of segs) {
        let lo = 0, hi = seg.index.length - 1, off = 0;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (seg.index[mid][0] <= after + 1) { off = seg.index[mid][1]; lo = mid + 1; } else hi = mid - 1; }
        // Pin descriptors before yielding: rotation renames segment paths and mutates
        // their index objects. A queued open by pathname could otherwise read a
        // different generation. At most the configured retained segment count is
        // opened; actual data reads stay asynchronous and bounded by the page size.
        pinned.push({ fd: fs.openSync(this.f(seg.name), 'r'), off, end: seg.size });
      }
      for (const {fd, off, end} of pinned) {
          let carry = '', pos = off;
          const decoder = new StringDecoder('utf8');
          while (pos < end && out.length < limit) {
            const want = Math.min(CHUNK, end - pos), buf = Buffer.alloc(want);
            const bytesRead = await new Promise((resolve, reject) => fs.read(fd, buf, 0, want, pos, (err, n) => err ? reject(err) : resolve(n)));
            if (!bytesRead) break;
            pos += bytesRead; this.stats.bytesRead += bytesRead;
            const lines = (carry + decoder.write(buf.subarray(0, bytesRead))).split('\n'); carry = lines.pop();
            for (const line of lines) {
              if (!line) continue; const s = seqOf(line.slice(0, 40));
              if (s === null || s <= last) continue; // before cursor, or a stale legacy line
              if (s > through) { pos = end; break; }
              let e; try { e = JSON.parse(line); this.stats.linesParsed++; } catch { continue; }
              out.push(e); last = s; if (out.length >= limit) break;
            }
          }
        if (out.length >= limit) break;
      }
      this.stats.readsServed++;
      return out;
    } finally { for (const {fd} of pinned) fs.closeSync(fd); this.reading--; }
  }

  appendLifecycle(rec) { this.#appendText('lifecycle.jsonl', JSON.stringify(rec) + '\n'); crashPoint('lifecycle-appended'); }
  appendIntervention(rec) { this.#appendText('interventions.jsonl', JSON.stringify(rec) + '\n'); crashPoint('intervention-appended'); }

  // ---------- recovery ----------
  // Move every log line with seq > committedSeq into recovery/ and truncate the log. Idempotent: the orphan file name
  // is derived from (file, committedSeq) and written whole before truncating, so a crash during recovery and a repeat
  // recovery produce the same result.
  recover(committedSeq) {
    this.#closeLogs();
    const report = { committedSeq, moved: {} };
    const names = ['lifecycle.jsonl', 'interventions.jsonl'];
    for (let i = this.p.eventLogFiles; i >= 0; i--) names.push(this.segName(i));
    // Phase-1 data can contain a rewind: a lost future followed by the surviving branch at a lower seq.
    // Cutting at the first seq>S would retain the lost prefix and discard the survivor.  Never guess which
    // records describe the world: leave everything intact and require the non-destructive branch migration.
    for (const group of [['lifecycle.jsonl'], ['interventions.jsonl'], Array.from({ length: this.p.eventLogFiles + 1 }, (_, i) => this.segName(this.p.eventLogFiles - i))]) {
      let previous = null;
      for (const n of group) {
        const file = this.f(n); if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
          const s = seqOf(line); if (s === null) continue;
          if (previous !== null && s <= previous) {
            this.#openLogs();
            throw new Error(`legacy lost branch detected in ${n} at seq ${s}; stop the service and run node bin/check-history.js ${this.dir} --apply before starting`);
          }
          previous = s;
        }
      }
    }
    for (const n of names) {
      const file = this.f(n); if (!fs.existsSync(file)) continue;
      const buf = fs.readFileSync(file); let cut = -1, start = 0, torn = false;
      for (let nl = buf.indexOf(10); ; nl = buf.indexOf(10, start)) {
        if (nl === -1) { if (start < buf.length) { torn = true; if (cut === -1) cut = start; } break; }
        const s = seqOf(buf.toString('utf8', start, Math.min(nl, start + 200)));
        if (s !== null && s > committedSeq) { cut = start; break; }
        start = nl + 1;
      }
      if (cut === -1) continue;
      const tail = buf.subarray(cut);
      const orphan = this.f(path.join('recovery', `${n}.after-${committedSeq}.orphaned`));
      // Preserve evidence from every recovery attempt.  Append rather than overwrite: a later failed startup can
      // have a different uncommitted tail at the same committed sequence.
      const fd = fs.openSync(orphan, 'a'); this.#writeFully(fd, tail); fs.fsyncSync(fd); fs.closeSync(fd);
      fsyncDir(this.f('recovery')); // persist recovery evidence before truncating the source
      crashPoint('recovery-orphan-written');
      fs.truncateSync(file, cut); const tfd = fs.openSync(file, 'r+'); fs.fsyncSync(tfd); fs.closeSync(tfd);
      report.moved[n] = { bytes: tail.length, lines: tail.toString('utf8').split('\n').filter(Boolean).length, tornTail: torn, orphanFile: path.relative(this.dir, orphan) };
    }
    fsyncDir(this.f('recovery'));
    this.#openLogs();
    return report;
  }

  worldExists() { return fs.existsSync(this.f('world.id')) || fs.existsSync(this.f('world.json')) || fs.existsSync(this.f('world.prev.json')); }

  readSnapshot(file) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (sha(JSON.stringify(raw.state)) !== raw.sha256) throw new Error(`checksum mismatch in ${file}`);
    return raw;
  }
  // Returns {state, savedAtWall, migratedFrom, usedFallback} or null if no world was ever created.
  // Throws if a world exists but cannot be read: NEVER silently starts a new world.
  load() {
    if (!this.worldExists()) return null;
    const errs = [];
    for (const [name, fb] of [['world.json', false], ['world.prev.json', true]]) {
      if (!fs.existsSync(this.f(name))) continue;
      try {
        const raw = this.readSnapshot(this.f(name));
        const m = migrate(raw);
        if (fb && fs.existsSync(this.f('world.json'))) fs.copyFileSync(this.f('world.json'), this.f(path.join('recovery', `world.json.unreadable-${raw.state.seq}`))); // keep evidence; next save overwrites it
        return { state: m.snap.state, savedAtWall: raw.savedAtWall, migratedFrom: m.from, usedFallback: fb };
      } catch (e) { errs.push(`${name}: ${e.message}`); }
    }
    throw new Error(`World data exists in ${this.dir} but no valid snapshot could be read (${errs.join('; ') || 'missing'}). Refusing to create a new world. Restore a backup with bin/restore.js.`);
  }
  save(state, savedAtWall = Date.now()) {
    if (this.failNextSaves > 0) { this.failNextSaves--; throw new Error('injected save failure'); } // test hook
    this.syncLogs(); // logs first: the snapshot must never be ahead of its records
    const body = JSON.stringify({ schemaVersion: CURRENT_SCHEMA, savedAtWall, sha256: sha(JSON.stringify(state)), state });
    const tmp = this.f('world.json.tmp'), cur = this.f('world.json');
    const fd = fs.openSync(tmp, 'w'); fs.writeSync(fd, body); fs.fsyncSync(fd); fs.closeSync(fd);
    crashPoint('snapshot-tmp-written');
    if (fs.existsSync(cur)) fs.copyFileSync(cur, this.f('world.prev.json'));
    fs.renameSync(tmp, cur);
    fsyncDir(this.dir);
    crashPoint('snapshot-committed');
    fs.writeFileSync(this.f('world.id'), state.id);
    return body.length;
  }
  archiveWorld(label) {
    this.#closeLogs();
    const dest = this.f(path.join('archive', label)); fs.mkdirSync(dest, { recursive: true });
    for (const n of fs.readdirSync(this.dir)) if (n.startsWith('world') || n.endsWith('.jsonl') || /\.jsonl\.\d+$/.test(n)) fs.renameSync(this.f(n), path.join(dest, n));
    this.#openLogs();
    return dest;
  }

  // Backup = copy of the durable files + manifest with sha256. Safe while running (snapshot is written atomically).
  backup(label = new Date().toISOString().replace(/[:.]/g, '-')) {
    this.syncLogs();
    const dest = this.f(path.join('backups', label)); fs.mkdirSync(dest, { recursive: true });
    const manifest = { createdAt: new Date().toISOString(), schemaVersion: CURRENT_SCHEMA, files: {} };
    for (const n of fs.readdirSync(this.dir)) {
      if (!(FILES.includes(n) || n === 'events.jsonl' || /^events\.jsonl\.\d+$/.test(n))) continue;
      fs.copyFileSync(this.f(n), path.join(dest, n)); manifest.files[n] = sha(fs.readFileSync(path.join(dest, n)));
    }
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const all = fs.readdirSync(this.f('backups')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - this.p.backupKeep))) fs.rmSync(this.f(path.join('backups', old)), { recursive: true, force: true });
    return dest;
  }
}

// Restore (server must be stopped). Verifies checksums, moves the current data aside, never deletes it.
// Logs in a backup may be ahead of its snapshot; the next server start trims them to the snapshot via recover().
export function restoreBackup(dataDir, backupDir) {
  const dir = path.resolve(dataDir), src = path.resolve(backupDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
  for (const [n, h] of Object.entries(manifest.files)) if (sha(fs.readFileSync(path.join(src, n))) !== h) throw new Error(`backup file ${n} failed checksum`);
  assertNoLiveWriter(dir, 'restoring');
  fs.mkdirSync(dir, { recursive: true });
  const aside = path.join(dir, 'archive', `pre-restore-${Date.now()}`); fs.mkdirSync(aside, { recursive: true });
  for (const n of fs.readdirSync(dir)) if (FILES.includes(n) || n.startsWith('events.jsonl')) fs.renameSync(path.join(dir, n), path.join(aside, n));
  for (const n of Object.keys(manifest.files)) fs.copyFileSync(path.join(src, n), path.join(dir, n));
  const st = new Store(dir, { eventLogFiles: 3 }); st.readSnapshot(path.join(dir, 'world.json')); // verify
  return { restoredFrom: src, previousMovedTo: aside };
}
