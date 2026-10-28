#!/usr/bin/env node
// Phase 1.1 history check + non-destructive migration for data written by Phase 1 (before crash recovery existed).
//   node bin/check-history.js <dataDir>            report only (safe while the server runs)
//   node bin/check-history.js <dataDir> --apply    server STOPPED: rewrite logs to the surviving branch;
//                                                  originals are moved to archive/pre-history-migration-<ts>/
// Phase 1 could crash after logging records whose world snapshot was never committed; the restarted world then
// re-used those seqs ("rewind"). A later line with seq <= an earlier line's seq proves the earlier lines from that
// seq on belong to a lost branch. --apply keeps the surviving (later) branch and moves lost-branch lines aside.
// What cannot be repaired automatically is listed under `irrecoverable` and must be reviewed by the operator.
import fs from 'node:fs';
import path from 'node:path';
import { assertNoLiveWriter } from '../src/store.js';

const [dirArg, flag] = process.argv.slice(2);
if (!dirArg) { console.error('usage: check-history.js <dataDir> [--apply]'); process.exit(2); }
const dir = path.resolve(dirArg), apply = flag === '--apply';
const f = (n) => path.join(dir, n);
const read = (n) => (fs.existsSync(f(n)) ? fs.readFileSync(f(n), 'utf8').split('\n').filter(Boolean) : []);
const parse = (l) => { try { return JSON.parse(l); } catch { return null; } };

function resolveBranches(lines) { // returns { kept, lost, torn }
  const kept = [], lost = []; let torn = 0;
  for (const line of lines) {
    const r = parse(line); if (!r) { torn++; continue; }
    if (typeof r.seq !== 'number') { kept.push({ r, line }); continue; }
    while (kept.length && typeof kept.at(-1).r.seq === 'number' && kept.at(-1).r.seq >= r.seq) lost.unshift(kept.pop());
    kept.push({ r, line });
  }
  return { kept, lost, torn };
}

let snap = null;
try { snap = JSON.parse(fs.readFileSync(f('world.json'), 'utf8')).state; } catch { /* reported below */ }
const report = { dataDir: dir, snapshot: snap ? { worldId: snap.id, tick: snap.tick, seq: snap.seq } : 'unreadable world.json', logs: {}, irrecoverable: [], actions: [] };

const evNames = fs.readdirSync(dir).filter((n) => /^events\.jsonl(\.\d+)?$/.test(n)).sort((a, b) => (Number(b.split('.')[2] ?? 0) - Number(a.split('.')[2] ?? 0)));
const groups = { events: evNames, lifecycle: ['lifecycle.jsonl'], interventions: ['interventions.jsonl'] };
const resolved = {};
for (const [g, names] of Object.entries(groups)) {
  const res = resolveBranches(names.flatMap(read)); resolved[g] = res;
  const ahead = snap ? res.kept.filter((x) => typeof x.r.seq === 'number' && x.r.seq > snap.seq).length : 0;
  report.logs[g] = { files: names, lines: res.kept.length + res.lost.length, lostBranchLines: res.lost.length, tornLines: res.torn, aheadOfSnapshot: ahead };
}
const life = resolved.lifecycle.kept.map((x) => x.r);
const dupIds = (kind) => { const seen = new Map(); for (const r of life) if (r.kind === kind) seen.set(r.id, (seen.get(r.id) ?? 0) + 1); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); };
const alive = new Set((snap?.creatures ?? []).map((c) => c.id));
const deadAlive = life.filter((r) => r.kind === 'death' && alive.has(r.id) && (!snap || r.seq <= snap.seq)).map((r) => r.id);
if (dupIds('death').length) report.irrecoverable.push({ issue: 'creature with more than one death record on the surviving branch', ids: dupIds('death') });
if (dupIds('birth').length) report.irrecoverable.push({ issue: 'creature with more than one birth record on the surviving branch', ids: dupIds('birth') });
if (deadAlive.length) report.irrecoverable.push({ issue: 'death record (covered by the snapshot) for a creature alive in the snapshot', ids: deadAlive });
const ivKeys = new Map(); for (const x of resolved.interventions.kept) { const k = `${x.r.record?.actor}:${x.r.record?.id}`; ivKeys.set(k, (ivKeys.get(k) ?? 0) + 1); }
const dupIv = [...ivKeys].filter(([, n]) => n > 1).map(([k]) => k);
if (dupIv.length) report.irrecoverable.push({ issue: 'intervention logged more than once on the surviving branch', keys: dupIv });
if (snap) for (const x of resolved.interventions.kept) { const r = x.r.record; if (r && x.r.seq <= snap.seq && !Object.values(snap.interventions ?? {}).some((s) => s.id === r.id && s.actor === r.actor)) report.irrecoverable.push({ issue: 'logged intervention missing from the committed snapshot', id: r.id, actor: r.actor }); }
report.note = 'Lines ahead of the snapshot are moved to recovery/ automatically by the server on its next start. Lost-branch lines need --apply.';

if (apply) {
  try { assertNoLiveWriter(dir, '--apply'); } catch (e) { console.error(e.message); process.exit(1); }
  const dest = f(path.join('archive', `pre-history-migration-${Date.now()}`)); fs.mkdirSync(dest, { recursive: true });
  for (const [g, names] of Object.entries(groups)) {
    const res = resolved[g]; if (!res.lost.length && !res.torn) continue;
    for (const n of names) if (fs.existsSync(f(n))) fs.copyFileSync(f(n), path.join(dest, n));
    fs.writeFileSync(path.join(dest, `${g}.lost-branch.jsonl`), res.lost.map((x) => x.line).join('\n') + (res.lost.length ? '\n' : ''));
    const body = res.kept.map((x) => x.line).join('\n') + (res.kept.length ? '\n' : '');
    if (g === 'events') { for (const n of names) fs.unlinkSync(f(n)); fs.writeFileSync(f('events.jsonl'), body); }
    else fs.writeFileSync(f(names[0]), body);
    report.actions.push(`${g}: kept ${res.kept.length}, moved ${res.lost.length} lost-branch + ${res.torn} torn line(s); originals in ${path.relative(dir, dest)}`);
  }
  report.rollback = `stop the server, copy the files from ${path.relative(dir, dest)} back into the data dir`;
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.irrecoverable.length ? 3 : 0);
