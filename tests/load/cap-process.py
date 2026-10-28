#!/usr/bin/env python3
"""Linux benchmark supervisor: one core, CPU-time budget, sampled RSS watchdog.
Not a cgroup: peak RSS can overshoot between samples. Never call this Docker evidence.
Usage: python3 tests/load/cap-process.py report.json -- node benchmark.mjs ...
"""
import json, os, pathlib, resource, signal, subprocess, sys, time
report_path = pathlib.Path(sys.argv[1])
command = sys.argv[sys.argv.index('--') + 1:]
cores = os.sched_getaffinity(0)
def child_setup():
    os.sched_setaffinity(0, {min(cores)})
child = subprocess.Popen(command, preexec_fn=child_setup)
start = time.monotonic(); hz = os.sysconf('SC_CLK_TCK')
peak_rss = 0; samples = 0; stopped_seconds = 0; exceeded = False
limit = 512 * 1024 * 1024
try:
    while child.poll() is None:
        try:
            # stat comm may contain spaces, so split after the final ')'.
            stat = pathlib.Path(f'/proc/{child.pid}/stat').read_text().rsplit(')', 1)[1].split()
            cpu_seconds = (int(stat[11]) + int(stat[12])) / hz
            rss = int(stat[21]) * os.sysconf('SC_PAGE_SIZE')
        except (FileNotFoundError, ProcessLookupError):
            break
        samples += 1; peak_rss = max(peak_rss, rss)
        if rss > limit:
            exceeded = True; child.kill(); break
        # 75% of one logical CPU; allow 30ms burst for coarse /proc accounting.
        debt = cpu_seconds - (time.monotonic() - start) * 0.75 - 0.03
        if debt > 0:
            pause = min(0.02, debt / 0.75)
            child.send_signal(signal.SIGSTOP)
            t = time.monotonic(); time.sleep(pause); stopped_seconds += time.monotonic() - t
            child.send_signal(signal.SIGCONT)
        else:
            time.sleep(0.005)
    code = child.wait()
finally:
    if child.poll() is None:
        child.send_signal(signal.SIGCONT); child.kill(); child.wait()
elapsed = time.monotonic() - start
usage = resource.getrusage(resource.RUSAGE_CHILDREN)
report = dict(method='one-core affinity + 0.75 CPU-time duty budget + sampled 512 MiB RSS watchdog; NOT cgroup',
              limits=dict(logicalCores=1, cpuBudget=0.75, rssBytes=limit, burstSeconds=0.03),
              elapsedSeconds=elapsed, cpuSeconds=usage.ru_utime + usage.ru_stime,
              cpuFraction=(usage.ru_utime + usage.ru_stime) / elapsed,
              peakSampledRssBytes=peak_rss, peakRusageRssBytes=usage.ru_maxrss * 1024,
              watchdogSamples=samples, stoppedSeconds=stopped_seconds,
              memoryExceeded=exceeded, exitCode=code)
report_path.parent.mkdir(parents=True, exist_ok=True)
report_path.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
sys.exit(code if code >= 0 else 128 - code)
