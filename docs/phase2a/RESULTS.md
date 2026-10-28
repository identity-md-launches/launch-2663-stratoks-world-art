# Measured Phase 2A results

Generated from committed raw JSON by `node tests/experiments/report-phase2a.mjs`. Standard deviations below are population SD across ten fixed seeds, not standard errors. No thresholds select or discard seeds.

## Controlled conditioning

All modes use seeds 1–10 and the same counterbalanced outcome schedule. Trials are synthetic component tasks using the real server adapter and circuit. Equal innate EAT scores cannot distinguish sites. Training includes 20% forced exposure and 10% outcome-sign noise; evaluation has no plasticity or forced choices. Heldout trials revisit the same sites with hunger 0.45 instead of 0.4, testing limited need-context generalization, not unseen-world transfer. The cue condition keeps both targets in the same spatial bin and distinguishes a visible fire cue; it deliberately counterbalances its reward meaning, bypasses reflexes, and is not a natural fire-safety demonstration. The threat condition pairs one location only with punishment and the other with no punishment.

Raw choices, realized rewards, forced-trial indices, state/weight digests, RNG endpoints, per-seed fractions, variability and below-60% failure counts are in [learning.json](../../tests/results/phase2a/learning.json). There is no expected site encoded in the policy.

| Task | Mode | Acquisition heldout correct | Reversal heldout correct | Post-training lesion correct | Acquisition failures <60% |
|---|---|---|---|---|---|
| location | legacy | 0.511 ± 0.042 | 0.480 ± 0.020 | 0.500 ± 0.036 | 9/10 |
| location | mb-v1 | 0.986 ± 0.021 | 0.983 ± 0.022 | 0.499 ± 0.032 | 0/10 |
| location | mb-v1-frozen | 0.495 ± 0.054 | 0.505 ± 0.026 | 0.499 ± 0.032 | 10/10 |
| location | mb-v1-ablated | 0.495 ± 0.054 | 0.505 ± 0.026 | 0.499 ± 0.032 | 10/10 |
| cue | legacy | 0.511 ± 0.042 | 0.480 ± 0.020 | 0.500 ± 0.036 | 9/10 |
| cue | mb-v1 | 0.971 ± 0.028 | 0.973 ± 0.019 | 0.499 ± 0.032 | 0/10 |
| cue | mb-v1-frozen | 0.495 ± 0.054 | 0.505 ± 0.026 | 0.499 ± 0.032 | 10/10 |
| cue | mb-v1-ablated | 0.495 ± 0.054 | 0.505 ± 0.026 | 0.499 ± 0.032 | 10/10 |
| threat | legacy | 0.511 ± 0.042 | 0.480 ± 0.020 | 0.500 ± 0.036 | 9/10 |
| threat | mb-v1 | 0.969 ± 0.025 | 0.967 ± 0.032 | 0.499 ± 0.032 | 0/10 |
| threat | mb-v1-frozen | 0.495 ± 0.054 | 0.505 ± 0.026 | 0.499 ± 0.032 | 10/10 |
| threat | mb-v1-ablated | 0.495 ± 0.054 | 0.505 ± 0.026 | 0.499 ± 0.032 | 10/10 |

Restart state and subsequent choice retention: **120/120** runs. Heldout phases with weight changes: **0**. These checks restart from a serialized snapshot; separate service tests exercise disk backup/restore and actual older-binary compatibility.

## Autonomous shared ecology

[ecology.json](../../tests/results/phase2a/ecology.json): 10 identical initial worlds × four modes × 5000 ticks, 24 initial creatures, unchanged default resource/lifecycle parameters, no injected outcomes, actions, refills, visitors, disasters or resets. Policies can diverge naturally after their first choices. Decision-source counts separate model/reflex/rule selections. The conditioning results above do not imply ecological improvement.

| Mode | Final population | Births | Deaths | Complete shelters | Creature-ticks hungry >70 |
|---|---|---|---|---|---|
| legacy | 42.500 ± 3.202 | 18.700 ± 3.132 | 0.200 ± 0.400 | 12.200 ± 0.748 | 0.038 ± 0.022 |
| mb-v1 | 37.300 ± 2.795 | 13.600 ± 2.835 | 0.300 ± 0.458 | 11.200 ± 0.748 | 0.062 ± 0.031 |
| mb-v1-frozen | 38.400 ± 3.323 | 15.100 ± 3.176 | 0.700 ± 0.781 | 11.100 ± 0.539 | 0.075 ± 0.028 |
| mb-v1-ablated | 38.400 ± 3.323 | 15.100 ± 3.176 | 0.700 ± 0.781 | 11.100 ± 0.539 | 0.075 ± 0.028 |

## Resource and protocol measurements

Linux x86_64, Node 22; actual service, checksummed durable store, WebSocket clients and periodic inspector HTTP reads. Clients deliberately share the capped process, so their costs are included. Single-core affinity and a 0.75 CPU-time duty budget (30ms accounting burst), `--max-old-space-size=384`, and a sampled 512 MiB RSS watchdog were applied by `cap-process.py`. Process peak RSS is also reported by the kernel. **This is not cgroup/Docker verification**: RSS policing is sampled and the host is shared; an exact Ubuntu 1 GB total / 512 MB world container validation remains outstanding. The provided amd64 Compose profile sets the requested cgroup limits. No Docker or real browser was available here.

Accelerated rows: 300 warmup + 1,200 measured ticks (20 simulated minutes) at unchanged 1,000ms world configuration; execution is intentionally faster to estimate throughput. Real-time rows: 120 ticks at an actual 1s cadence, from a fresh world. Snapshot work every 30 ticks is included in tick costs. No creatures are removed or reseeded to improve a result.

| Mode | Initial → final population | Clients | Schedule | Tick p95 / p99 ms | CPU ms/tick | Peak RSS MiB | Delta p95 bytes | Gaps / agreement |
|---|---|---|---|---|---|---|---|---|
| legacy | 100 → 100 | 8 | accelerated | 9.905 / 45.864 | 3.768 | 151.992 | 29426 | 0 / true |
| legacy | 24 → 30 | 8 | accelerated | 3.612 / 31.216 | 1.496 | 138.469 | 8965 | 0 / true |
| legacy | 250 → 250 | 8 | accelerated | 34.875 / 78.850 | 15.714 | 189.785 | 71140 | 0 / true |
| mb-v1 | 100 → 100 | 8 | accelerated | 9.940 / 75.169 | 4.513 | 169.906 | 29219 | 0 / true |
| mb-v1 | 100 → 100 | 8 | 1 second | 14.775 / 65.960 | 12.679 | 148.441 | 33395 | 0 / true |
| mb-v1 | 24 → 24 | 100 | accelerated | 27.529 / 47.821 | 12.953 | 163.457 | 8108 | 0 / true |
| mb-v1 | 24 → 24 | 8 | accelerated | 4.247 / 34.250 | 1.702 | 137.336 | 8105 | 0 / true |
| mb-v1 | 24 → 24 | 8 | 1 second | 7.304 / 41.835 | 7.079 | 105.844 | 8918 | 0 / true |
| mb-v1 | 250 → 250 | 100 | accelerated | 171.647 / 259.600 | 137.332 | 297.652 | 70736 | 0 / true |
| mb-v1 | 250 → 250 | 8 | accelerated | 49.827 / 179.786 | 21.040 | 227.156 | 70733 | 0 / true |
| mb-v1 | 250 → 250 | 8 | 1 second | 27.048 / 133.545 | 32.596 | 194.836 | 83326 | 0 / true |
| mb-v1-frozen | 100 → 100 | 8 | accelerated | 10.158 / 74.282 | 4.755 | 167.563 | 29448 | 0 / true |
| mb-v1-frozen | 24 → 24 | 8 | accelerated | 3.932 / 31.083 | 1.617 | 132.977 | 8102 | 0 / true |
| mb-v1-frozen | 250 → 250 | 8 | accelerated | 47.494 / 185.796 | 20.353 | 225.063 | 71142 | 0 / true |

Raw tick durations, intervals, payloads, initial snapshot sizes, inspector sizes, population changes and code hashes are in the `capacity-*.json` files. Paired `supervisor-*.json` files report duty policing, kernel peak RSS, samples, cap exceedance and process exit. The CPU-per-tick estimate includes network parsing and client work outside the synchronous tick-duration bracket. Protocol deltas are per connection; bandwidth scales with client count.

- 100 creatures / 8 clients, 1s cadence: interval p95=1001.326ms, p99=1001.846ms, max=1003.410ms; tick p99=65.960ms.
- 24 creatures / 8 clients, 1s cadence: interval p95=1001.320ms, p99=1001.533ms, max=1002.207ms; tick p99=41.835ms.
- 250 creatures / 8 clients, 1s cadence: interval p95=1001.679ms, p99=1001.983ms, max=1002.738ms; tick p99=133.545ms.

Measured rows exceeding the short-run CPU/RSS/tick/protocol criteria: **0**. Meeting these criteria demonstrates short-run measured headroom only. It does not establish indefinite ecological survival, long-term storage growth, WAN behavior, a 1 GB whole-host guarantee, populations beyond 250, or arbitrary client counts. No scale beyond the measured rows is supported by this evidence; keep production legacy until operator review and real container validation.

Exact-source check: **0 stale/missing hash rows**. All 14 capacity rows must match delivered simulation modules before release.
