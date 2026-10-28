// Summarize actual raw artifacts; fail on stale source hashes or missing cohort rows.
import fs from 'node:fs';
import crypto from 'node:crypto';
const root = new URL('../results/phase2a/', import.meta.url), docs = new URL('../../docs/phase2a/', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, root)));
const learning = read('learning.json'), ecology = read('ecology.json');
const fmt = n => typeof n === 'number' ? n.toFixed(3) : String(n);
let text = '# Measured Phase 2A results\n\nGenerated from committed raw JSON by `node tests/experiments/report-phase2a.mjs`. Standard deviations below are population SD across ten fixed seeds, not standard errors. No thresholds select or discard seeds.\n\n## Controlled conditioning\n\nAll modes use seeds 1–10 and the same counterbalanced outcome schedule. Trials are synthetic component tasks using the real server adapter and circuit. Equal innate EAT scores cannot distinguish sites. Training includes 20% forced exposure and 10% outcome-sign noise; evaluation has no plasticity or forced choices. Heldout trials revisit the same sites with hunger 0.45 instead of 0.4, testing limited need-context generalization, not unseen-world transfer. The cue condition keeps both targets in the same spatial bin and distinguishes a visible fire cue; it deliberately counterbalances its reward meaning, bypasses reflexes, and is not a natural fire-safety demonstration. The threat condition pairs one location only with punishment and the other with no punishment.\n\nRaw choices, realized rewards, forced-trial indices, state/weight digests, RNG endpoints, per-seed fractions, variability and below-60% failure counts are in [learning.json](../../tests/results/phase2a/learning.json). There is no expected site encoded in the policy.\n\n| Task | Mode | Acquisition heldout correct | Reversal heldout correct | Post-training lesion correct | Acquisition failures <60% |\n|---|---|---|---|---|---|\n';
for (const task of ['location','cue','threat']) for (const mode of ['legacy','mb-v1','mb-v1-frozen','mb-v1-ablated']) {
 const row = phase=>learning.summary.find(r=>r.task===task&&r.mode===mode&&r.phase===phase);
 const a=row('acquisition-heldout'),b=row('reversal-heldout'),c=row('reversal-lesion-heldout');
 text+=`| ${task} | ${mode} | ${fmt(a.mean)} ± ${fmt(a.sd)} | ${fmt(b.mean)} ± ${fmt(b.sd)} | ${fmt(c.mean)} ± ${fmt(c.sd)} | ${a.failuresBelow60Percent}/10 |\n`;
}
const restarts = learning.rows.filter(r=>r.restartStateIdentical&&r.restartChoicesIdentical).length;
const changedHeldout = learning.rows.flatMap(r=>r.phases.filter(p=>p.phase.includes('heldout')&&p.weightsChanged));
text+=`\nRestart state and subsequent choice retention: **${restarts}/${learning.rows.length}** runs. Heldout phases with weight changes: **${changedHeldout.length}**. These checks restart from a serialized snapshot; separate service tests exercise disk backup/restore and actual older-binary compatibility.\n\n## Autonomous shared ecology\n\n[ecology.json](../../tests/results/phase2a/ecology.json): 10 identical initial worlds × four modes × ${ecology.protocol.ticks} ticks, 24 initial creatures, unchanged default resource/lifecycle parameters, no injected outcomes, actions, refills, visitors, disasters or resets. Policies can diverge naturally after their first choices. Decision-source counts separate model/reflex/rule selections. The conditioning results above do not imply ecological improvement.\n\n| Mode | Final population | Births | Deaths | Complete shelters | Creature-ticks hungry >70 |\n|---|---|---|---|---|---|\n`;
for (const mode of ['legacy','mb-v1','mb-v1-frozen','mb-v1-ablated']) {
 const stat=k=>{const r=ecology.summary.find(r=>r.mode===mode&&r.metric===k);return `${fmt(r.mean)} ± ${fmt(r.sd)}`;};
 text+=`| ${mode} | ${stat('population')} | ${stat('births')} | ${stat('deaths')} | ${stat('sheltersComplete')} | ${stat('hungryFraction')} |\n`;
}
text+='\n## Resource and protocol measurements\n\nLinux x86_64, Node 22; actual service, checksummed durable store, WebSocket clients and periodic inspector HTTP reads. Clients deliberately share the capped process, so their costs are included. Single-core affinity and a 0.75 CPU-time duty budget (30ms accounting burst), `--max-old-space-size=384`, and a sampled 512 MiB RSS watchdog were applied by `cap-process.py`. Process peak RSS is also reported by the kernel. **This is not cgroup/Docker verification**: RSS policing is sampled and the host is shared; an exact Ubuntu 1 GB total / 512 MB world container validation remains outstanding. The provided amd64 Compose profile sets the requested cgroup limits. No Docker or real browser was available here.\n\nAccelerated rows: 300 warmup + 1,200 measured ticks (20 simulated minutes) at unchanged 1,000ms world configuration; execution is intentionally faster to estimate throughput. Real-time rows: 120 ticks at an actual 1s cadence, from a fresh world. Snapshot work every 30 ticks is included in tick costs. No creatures are removed or reseeded to improve a result.\n\n| Mode | Initial → final population | Clients | Schedule | Tick p95 / p99 ms | CPU ms/tick | Peak RSS MiB | Delta p95 bytes | Gaps / agreement |\n|---|---|---|---|---|---|---|---|---|\n';
const names=fs.readdirSync(root).filter(n=>n.startsWith('capacity-')&&n.endsWith('.json')).sort();
let stale=[]; const benches=[];
for (const name of names) {
 const r=read(name);benches.push(r);
 if (!r.sourceHashes || Object.entries(r.sourceHashes).some(([k,v])=>crypto.createHash('sha256').update(fs.readFileSync(new URL(`../../server/src/${k}.js`,import.meta.url))).digest('hex')!==v)) stale.push(name);
 text+=`| ${r.mode} | ${r.initialPopulation} → ${r.finalPopulation} | ${r.clients} | ${r.realtime?'1 second':'accelerated'} | ${fmt(r.tickWallMs.p95)} / ${fmt(r.tickWallMs.p99)} | ${fmt(r.cpuMsPerTick)} | ${fmt(r.processMaxRssBytes/1048576)} | ${r.protocol.deltaBytes.p95} | ${r.protocol.sequenceGaps} / ${r.protocol.clientsSameEntities} |\n`;
}
text+='\nRaw tick durations, intervals, payloads, initial snapshot sizes, inspector sizes, population changes and code hashes are in the `capacity-*.json` files. Paired `supervisor-*.json` files report duty policing, kernel peak RSS, samples, cap exceedance and process exit. The CPU-per-tick estimate includes network parsing and client work outside the synchronous tick-duration bracket. Protocol deltas are per connection; bandwidth scales with client count.\n\n';
for (const r of benches.filter(r=>r.realtime)) text+=`- ${r.initialPopulation} creatures / ${r.clients} clients, 1s cadence: interval p95=${fmt(r.intervalMs.p95)}ms, p99=${fmt(r.intervalMs.p99)}ms, max=${fmt(r.intervalMs.max)}ms; tick p99=${fmt(r.tickWallMs.p99)}ms.\n`;
const unsupported=benches.filter(r=>!r.sustainableOneSecondTickByCpuBudget||r.processMaxRssBytes>512*1048576||r.protocol.sequenceGaps||!r.protocol.clientsSameEntities);
text+=`\nMeasured rows exceeding the short-run CPU/RSS/tick/protocol criteria: **${unsupported.length}**. ${unsupported.length ? unsupported.map(r=>`${r.mode}/${r.initialPopulation}/${r.clients}`).join(', ') + '. ' : ''}`;
text+='Meeting these criteria demonstrates short-run measured headroom only. It does not establish indefinite ecological survival, long-term storage growth, WAN behavior, a 1 GB whole-host guarantee, populations beyond 250, or arbitrary client counts. No scale beyond the measured rows is supported by this evidence; keep production legacy until operator review and real container validation.\n\n';
text+=`Exact-source check: **${stale.length} stale/missing hash rows**. All ${benches.length} capacity rows must match delivered simulation modules before release.\n`;
fs.writeFileSync(new URL('RESULTS.md', docs),text);
const failures=[];
if(learning.protocol.seeds.length<10)failures.push('fewer than ten seeds');
if(restarts!==learning.rows.length||changedHeldout.length)failures.push('retention/heldout failure');
if(stale.length)failures.push('stale capacity evidence: '+stale.join(', '));
for(const mode of ['legacy','mb-v1','mb-v1-frozen']) for(const pop of [24,100,250]) if(!benches.some(r=>r.mode===mode&&r.initialPopulation===pop&&r.clients===8&&!r.realtime))failures.push(`missing ${mode}/${pop}`);
for(const pop of [24,100,250])if(!benches.some(r=>r.mode==='mb-v1'&&r.initialPopulation===pop&&r.realtime))failures.push(`missing realtime/${pop}`);
console.log(text);
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
