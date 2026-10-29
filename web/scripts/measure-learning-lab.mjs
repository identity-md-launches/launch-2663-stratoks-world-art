// Record raw results for the exact browser experiment module, not a reimplementation.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
if (!process.argv.includes('--run')) {
  const project = spawnSync('node', ['web/scripts/task.mjs', 'path'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const run = spawnSync(process.execPath, [path.join(project, 'node_modules/tsx/dist/cli.mjs'), fileURLToPath(import.meta.url), '--run'], { cwd: root, stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
} else {
  const { LearningLab, LAB_MODES } = await import('../src/learningLab.ts');
  const rows = [];
  for (let seed = 1; seed <= 10; seed++) for (const task of ['location', 'cue', 'threat']) {
    const lab = new LearningLab(seed, task);
    for (const cmd of ['evaluate', 'acquire', 'evaluate', 'retention', 'reverse', 'evaluate', 'ablate']) lab.run(cmd);
    rows.push(lab.report());
  }
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const summary = [];
  for (const task of ['location', 'cue', 'threat']) for (const mode of LAB_MODES) for (const [phase, index] of [['baseline', 0], ['acquisition-heldout', 2], ['reversal-heldout', 4], ['ablated-heldout', 5]]) {
    const values = rows.filter(r => r.task === task).map(r => r.history[index].results.find(r => r.mode === mode).autonomousFractionGood);
    summary.push({ task, mode, phase, seeds: values.length, mean: mean(values), sd: Math.sqrt(mean(values.map(v => (v - mean(values)) ** 2))), min: Math.min(...values), max: Math.max(...values), failuresBelow60Percent: values.filter(v => v < 0.6).length });
  }
  const retentionFailures = rows.flatMap(r => r.retention).filter(r => !r.stateIdentical || !r.choicesIdentical).length;
  const heldoutWeightChanges = rows.flatMap(r => r.history.filter(p => ['Held-out evaluation', 'Learned output removed'].includes(p.phase)).flatMap(p => p.results)).filter(r => r.weightsChanged).length;
  const out = path.join(root, 'artifacts/phase2a-client'); await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, 'lab-results.json'), JSON.stringify({ seeds: [1,2,3,4,5,6,7,8,9,10], scope: 'Exact browser lab module executed in Node; synthetic controller task, not world ecology or constrained-capacity validation', retentionFailures, heldoutWeightChanges, summary, rows }) + '\n');
  console.table(summary); console.log(JSON.stringify({ retentionFailures, heldoutWeightChanges, cohorts: rows.length, policyRuns: rows.length * LAB_MODES.length }));
  if (retentionFailures || heldoutWeightChanges) process.exitCode = 1;
}
