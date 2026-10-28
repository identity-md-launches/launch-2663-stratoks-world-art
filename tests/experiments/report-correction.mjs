// Summarize preserved original evidence and final-source reruns; never edits inputs.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const oldLearning = read('tests/results/phase2a/learning.json'), learning = read('tests/results/correction/learning.json');
const oldEco = read('tests/results/phase2a/ecology.json'), eco = read('tests/results/correction/ecology.json');
for (const data of [learning, eco]) for (const [name, expected] of Object.entries(data.sourceHashes)) {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'server/src', name + '.js'))).digest('hex'), expected, 'Stale source hash: ' + name);
}
assert.deepEqual(learning.protocol.seeds, oldLearning.protocol.seeds);
assert.deepEqual(eco.protocol.worldConfig, oldEco.protocol.worldConfig);
assert.equal(eco.protocol.ticks, 5000); assert.equal(eco.protocol.seeds, 10);
assert(learning.rows.every(r => r.restartStateIdentical && r.restartChoicesIdentical));
assert(learning.rows.every(r => r.phases.filter(p => p.phase.includes('heldout')).every(p => !p.weightsChanged)));
assert(learning.rows.filter(r => ['mb-v1-frozen', 'mb-v1-ablated'].includes(r.mode)).every(r => r.phases.every(p => !p.weightsChanged && p.neuralUpdates === 0)));
// The reopened all-mode starvation correction intentionally changes legacy
// reflex decisions. Full ecology equality with the buggy legacy is no longer a
// valid assertion; the 4000-tick differential test changes ONLY that reference rule.
const priorEco = JSON.parse(gunzipSync(fs.readFileSync(path.join(root, 'tests/results/review/ca7a177-ecology.json.gz'))));
const priorLearning = JSON.parse(gunzipSync(fs.readFileSync(path.join(root, 'tests/results/review/ca7a177-learning.json.gz'))));
assert.deepEqual(learning.rows, priorLearning.rows, 'Controlled component learning unexpectedly changed');
assert(eco.rows.filter(r => ['mb-v1-frozen', 'mb-v1-ablated'].includes(r.mode)).every(r => r.neuralUpdates === 0));
const f = (v, n = 3) => Number(v).toFixed(n), pct = v => `${f(v * 100, 2)}%`;
const modes = ['legacy', 'mb-v1', 'mb-v1-frozen', 'mb-v1-ablated'];
const lines = [
  '# Corrected learning and ecology evidence', '',
  'These are local author measurements of the corrected source, not independent approval. Original raw evidence is unchanged in `tests/results/phase2a/`; final reruns are in `tests/results/correction/`. Both learning and ecology JSON files record hashes of the simulation modules. `node tests/experiments/report-correction.mjs` refuses stale hashes and altered seeds/resources.', '',
  '## Controlled learning', '',
  'Seeds 1–10, all four modes, all three original tasks, unchanged 300-trial acquisition / 400-trial reversal, 20% forced exposure, 10% reward noise and held-out hunger perturbation. This is a synthetic, two-target, one-action component task. It contains no emergency reflexes, navigation or competing action families. It tests conditional learned target preference; it cannot establish ecology fitness or the absence of action-count bias by itself.', '',
  '| Task | Mode | Acquisition held-out, original → corrected | Reversal held-out, original → corrected | Corrected acquisition SD | Acquisition / reversal seeds <60% |',
  '|---|---|---|---|---|---|'
];
for (const task of ['location', 'cue', 'threat']) for (const mode of modes) {
  const row = (data, phase) => data.summary.find(r => r.task === task && r.mode === mode && r.phase === phase);
  const a = row(learning, 'acquisition-heldout'), r = row(learning, 'reversal-heldout');
  lines.push(`| ${task} | ${mode} | ${pct(row(oldLearning, 'acquisition-heldout').mean)} → ${pct(a.mean)} | ${pct(row(oldLearning, 'reversal-heldout').mean)} → ${pct(r.mean)} | ${pct(a.sd)} | ${a.failuresBelow60Percent} / ${r.failuresBelow60Percent} |`);
}
lines.push('', `All ${learning.rows.length} serialized state and continuation comparisons agree. All held-out phases freeze weights. Frozen and ablated training now both produce zero neural updates. Earlier ablation scores already hid learned output, so its unchanged choice fraction concealed its plasticity defect; the new weight/counter regressions expose this. Run elapsed time: ${f(learning.elapsedMs / 1000, 2)} seconds.`, '',
  'The hierarchy retains a single per-creature random draw and conditional softmax. With only one action in these experiments, target choice probabilities are the same as before. Unchanged learning fractions are expected, not evidence that the ecology regressions are absent. Legacy cannot distinguish the equal-feature targets. Frozen and ablated choices remain near chance. No failed seed was dropped.', '',
  '## Autonomous ecology', '',
  'The same ten initial worlds, 24 initial creatures, 5,000 ticks per mode/seed, unchanged `DEFAULTS.world`, no culling, refill, resource adjustment, forced training, reseeding or interventions. Values below are means across ten seeds. Raw JSON includes each seed, SD, range, hunger exposure, decision sources and neural/linear update counts.', '',
  '| Mode | Population, original → corrected | Births | Deaths | Food | Complete shelters | Hungry creature-ticks (>70 hunger) |',
  '|---|---|---|---|---|---|---|'
);
for (const mode of modes) {
  const pair = (metric, percent = false) => {
    const a = oldEco.summary.find(r => r.mode === mode && r.metric === metric).mean, b = eco.summary.find(r => r.mode === mode && r.metric === metric).mean;
    return `${percent ? pct(a) : f(a, 2)} → ${percent ? pct(b) : f(b, 2)}`;
  };
  lines.push(`| ${mode} | ${pair('population')} | ${pair('births')} | ${pair('deaths')} | ${pair('food')} | ${pair('sheltersComplete')} | ${pair('hungryFraction', true)} |`);
}
lines.push('', '## Reopened review: previous correction versus final reflex', '',
  'The independent reviewer reproduced a remaining cap bug on ca7a177. Its raw learning/ecology evidence is retained losslessly in `tests/results/review/ca7a177-*.json.gz`. Only emergency food visibility changes in this revision; the learned candidate cap and action/target hierarchy are unchanged. The controlled component rows are identical to ca7a177.', '',
  '| Mode | Population, ca7a177 → final | Births | Deaths | Food | Complete shelters | Hungry creature-ticks (>70 hunger) |',
  '|---|---|---|---|---|---|---|');
for (const mode of modes) {
  const pair = (metric, percent = false) => {
    const a = priorEco.summary.find(r => r.mode === mode && r.metric === metric).mean, b = eco.summary.find(r => r.mode === mode && r.metric === metric).mean;
    return `${percent ? pct(a) : f(a, 2)} → ${percent ? pct(b) : f(b, 2)}`;
  };
  lines.push(`| ${mode} | ${pair('population')} | ${pair('births')} | ${pair('deaths')} | ${pair('food')} | ${pair('sheltersComplete')} | ${pair('hungryFraction', true)} |`);
}
lines.push('',
  '**Regressions and limits:** remaining food decreases in every mode versus ca7a177, despite lower hunger and more births/survivors. Food remaining alone cannot distinguish consumption from future scarcity. Final mb-v1 still has lower population/births, fewer shelters, less food and more hunger than final legacy. Its mean deaths tie legacy in this sample; no overall fitness or learned-survival claim follows. Frozen/ablated remain identical in initially untrained worlds with zero neural updates. **Unmodified legacy ecology is no longer equivalent**: the requested nearest feasible reflex in every mode changes legacy starvation choices too. The legacy non-emergency engine matches an independently adapted recovered reference over 4000 ticks, with only the specified reflex changed in that reference; that is not a claim of equivalence to the buggy unmodified engine.', '',
  `Ecology elapsed time: ${f(eco.elapsedMs / 1000, 2)} seconds. SD in the experiment scripts uses division by n; these are descriptive samples, with no significance or generalization claim.`, '',
  '**Confounds and limits:** simultaneous fixes change emergency targets and action-family probabilities; these runs do not identify each fix’s separate contribution. Candidate availability, fixed priors, spatial binning, competition and shaped rewards remain engineered influences. Frozen/ablated worlds start untrained; trained-weight retention is tested separately. Seeds pair initial conditions, but changed choices diverge world RNG consumption through navigation/ecology, so later environments are not identical exposures. Five thousand ticks do not cover a full lifespan, extinction risk, long-term learning stability or storage growth. Survival reflexes are counted separately from model decisions; a later update after a reflex is an exposure, not evidence of learned selection.', '',
  '## Capacity', '',
  '**Real 512 MiB / 0.75 CPU Docker qualification is unverified:** Docker is unavailable on this worker. `tests/results/correction/docker/status.json` records the failed capability check. The runnable isolated runner is `node tests/load/correction-docker.mjs`; it enforces Docker memory/swap/CPU settings, checks `docker inspect` and in-container cgroup v2 values, and keeps service plus real clients inside that budget. No production data/volume/network is mounted.', ''
);
const capPath = path.join(root, 'tests/results/correction/capacity/status.json');
if (fs.existsSync(capPath)) {
  const status = JSON.parse(fs.readFileSync(capPath, 'utf8'));
  lines.push('The following completed fallback runs have **no requested resource enforcement**. They are diagnostic only; they do not establish supported VPS capacity. The service and clients share one process; all ecology stays enabled. Accelerated runs have 300 warm-up ticks plus 1,200 measured ticks; real-time runs have no warm-up and 180 ticks at a nominal one-second cadence. The runner’s process runtime includes initialization/warm-up/shutdown; measured runtime brackets only the measured ticks and a network drain.', '',
    '| Mode | Initial → final creatures | Clients | Cadence | Measured runtime s | Process runtime s | Peak RSS MiB | Tick p95 / p99 ms | CPU ms/tick |',
    '|---|---|---|---|---|---|---|---|---|');
  for (const entry of status.rows) {
    const row = JSON.parse(fs.readFileSync(path.join(path.dirname(capPath), entry.file), 'utf8'));
    for (const [name, expected] of Object.entries(row.sourceHashes)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'server/src', name + '.js'))).digest('hex'), expected, 'Stale benchmark ' + entry.file);
    assert.equal(row.protocol.sequenceGaps, 0); assert.equal(row.protocol.clientsSameEntities, true);
    assert.equal(row.protocol.clientsClosedDuringRun, 0);
    lines.push(`| ${row.mode} | ${row.initialPopulation} → ${row.finalPopulation} | ${row.clients} | ${row.realtime ? '1 second' : 'accelerated'} | ${f(row.elapsedMs / 1000, 2)} | ${f(entry.elapsedMs / 1000, 2)} | ${f(row.rssPeakBytes / 1048576, 2)} | ${f(row.tickWallMs.p95)} / ${f(row.tickWallMs.p99)} | ${f(row.cpuMsPerTick)} |`);
  }
  lines.push('', `Completed rows: ${status.rows.length} / 16. Platform, Node version, source hashes, tick durations/intervals, every client’s final tick, delta sizes, inspector payloads, population changes, process CPU/RSS and observed cgroup counters are retained with each row. Observed host cgroup counters do not demonstrate the requested limits. **Supported capacity on the 1 GB x86_64 VPS: not established.** Validate the real Docker matrix there before choosing a supported population/client ceiling. There is no automatic population cap.`, '');
}
fs.mkdirSync(path.join(root, 'docs/correction'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/correction/RESULTS.md'), lines.join('\n') + '\n');
console.log('Wrote docs/correction/RESULTS.md; seeds/resources/legacy/controls/source hashes verified.');
