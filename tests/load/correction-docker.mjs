// Run native amd64 service + multiple real clients in an isolated Docker cgroup.
// No host ports, mounts, persistent volumes, production data or owner configuration.
// --local provides explicitly UNENFORCED measurements when Docker is unavailable.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const local = process.argv.includes('--local');
const out = path.resolve(process.argv.find(a => a.startsWith('--out='))?.slice(6) ?? path.join(root, 'tests/results/correction/capacity'));
const ticks = Number(process.argv.find(a => a.startsWith('--ticks='))?.slice(8) ?? 1200);
const realtimeTicks = Number(process.argv.find(a => a.startsWith('--realtime-ticks='))?.slice(17) ?? 180);
if (![ticks, realtimeTicks].every(n => Number.isInteger(n) && n > 0 && n <= 100000)) throw Error('Ticks must be positive integers <= 100000');
fs.mkdirSync(out, { recursive: true });
const run = (cmd, args, options = {}) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
const status = { local, target: { memoryBytes: 536870912, cpuQuota: 75000, cpuPeriod: 100000, platform: 'linux/amd64' }, dockerAvailable: false, enforced: false, verified: false, rows: [], limitations: [] };
const statusFile = path.join(out, 'status.json');
if (!local) {
  const info = run('docker', ['info', '--format', '{{.OSType}}']);
  if (info.status !== 0) {
    status.limitations.push(info.error?.code === 'ENOENT' ? 'Docker executable is unavailable. No Docker/cgroup tests ran.' : 'Docker daemon did not respond successfully. No Docker/cgroup tests ran.');
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2) + '\n');
    console.error(status.limitations[0]); process.exit(2);
  }
  status.dockerAvailable = true;
  const build = run('docker', ['build', '--platform', 'linux/amd64', '-f', 'deploy/correction-benchmark.Dockerfile', '-t', 'stratoks-correction-bench', '.']);
  fs.writeFileSync(path.join(out, 'build.log'), build.stdout + build.stderr);
  if (build.status !== 0) throw Error('Benchmark image build failed; see build.log');
} else status.limitations.push('UNENFORCED local fallback: no requested 512 MiB / 0.75 CPU cgroup. These results cannot qualify the VPS.');
const specs = [];
for (const mode of ['legacy', 'mb-v1', 'mb-v1-frozen', 'mb-v1-ablated']) for (const n of [24, 100, 250]) specs.push({ mode, n, clients: 8, ticks, cadence: 'accelerated' });
for (const n of [24, 100, 250]) specs.push({ mode: 'mb-v1', n, clients: 8, ticks: realtimeTicks, cadence: 'realtime' });
// Also observe a larger fanout with the largest measured population.
specs.push({ mode: 'mb-v1', n: 250, clients: 32, ticks, cadence: 'accelerated' });
for (const spec of specs) {
  const label = `${spec.mode}-${spec.n}-${spec.clients}-${spec.cadence}`;
  const name = 'stratoks-correction-' + process.pid;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stratoks-bench-output-'));
  const target = local ? path.join(temp, 'result.json') : '/tmp/result.json';
  const args = [String(spec.n), spec.mode, String(spec.clients), String(spec.ticks), spec.cadence, target];
  let result;
  const start = performance.now();
  try {
    if (local) result = run(process.execPath, ['tests/load/brain-capacity.mjs', ...args]);
    else {
      // Kept stopped briefly for docker cp + inspection, then always removed.
      result = run('docker', ['run', '--name', name, '--platform', 'linux/amd64', '--network', 'none', '--memory', '512m', '--memory-swap', '512m', '--cpus', '0.75', '--pids-limit', '64', '--read-only', '--tmpfs', '/tmp:rw,size=256m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', 'stratoks-correction-bench', ...args]);
      const inspection = run('docker', ['inspect', '--format', '{{json .HostConfig}}', name]);
      const state = run('docker', ['inspect', '--format', '{{json .State}}', name]);
      const host = JSON.parse(inspection.stdout), stopped = JSON.parse(state.stdout);
      const copied = run('docker', ['cp', `${name}:/tmp/result.json`, path.join(temp, 'result.json')]);
      fs.writeFileSync(path.join(out, `${label}-enforcement.json`), JSON.stringify({ memory: host.Memory, memorySwap: host.MemorySwap, nanoCpus: host.NanoCpus, state: { exitCode: stopped.ExitCode, oomKilled: stopped.OOMKilled }, copied: copied.status === 0 }, null, 2) + '\n');
      if (host.Memory !== 536870912 || host.MemorySwap !== 536870912 || host.NanoCpus !== 750000000) throw Error('Docker did not apply the requested limits');
    }
    fs.writeFileSync(path.join(out, `${label}.log`), result.stdout + result.stderr);
    if (result.status !== 0) throw Error(`${label}: benchmark exited ${result.status}`);
    const row = JSON.parse(fs.readFileSync(path.join(temp, 'result.json'), 'utf8'));
    if (!local) {
      const cg = row.cgroup.before;
      if (row.platform !== 'linux/x64' || cg['memory.max'] !== '536870912' || cg['cpu.max'] !== '75000 100000') throw Error('In-container architecture/cgroup verification failed');
    }
    row.enforcementVerified = !local;
    fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify(row, null, 2) + '\n');
    status.rows.push({ ...spec, exitCode: result.status, elapsedMs: performance.now() - start, file: `${label}.json` });
    console.log(`PASS ${label} (${Math.round(performance.now() - start)}ms); ${local ? 'UNENFORCED' : '512 MiB / 0.75 CPU verified'}`);
  } finally {
    if (!local) run('docker', ['rm', '-f', name]);
    fs.rmSync(temp, { recursive: true, force: true });
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2) + '\n');
  }
}
status.enforced = status.verified = !local;
status.limitations.push('Short benchmark only. Docker image is amd64; native x86_64 target must still be checked on the VPS. Clients consume the same cgroup budget as the service. No whole-host 1 GB, long-term survival, WAN, or unbounded history capacity claim.');
fs.writeFileSync(statusFile, JSON.stringify(status, null, 2) + '\n');
