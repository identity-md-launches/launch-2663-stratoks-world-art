# Test and measurement results (Stratoks server, Phase 1)

> Historical measurements from the earlier server contribution, preserved as recorded. Current client integration, 23-test server run, new local hardware/measurements and browser evidence are in [docs/VALIDATION.md](../docs/VALIDATION.md). The browser integration and viem signature cross-check listed as pending below have since been completed; ARM64/VPS/container and physical-wallet checks remain unperformed.

**Where this ran.** Everything below was run **locally** on one machine: Intel Xeon (Skylake, IBRS) VM, 8 vCPU @ 2.0 GHz, 32 GB RAM, Linux 6.8, **x86_64**, Node v24 (`tests/results/hardware-local.txt`).
**Not run:** Docker build/compose (no Docker on that machine), anything on **ARM64**, anything on the **real 2 vCPU / 4 GB VPS**. No capacity claim is made for the target VPS. The Phase 1 deployment package is therefore *untested as a container*.

## Automated tests — `cd server && npm test` (21 tests, all passing at the time of writing)
| Requirement | Test |
|---|---|
| wallet signatures, nonce, expiry, origin, roles | `wallet-auth.test.js` (keccak/secp256k1 vectors, replay, wrong origin, expired, forged signature) |
| two clients share state, reconnect without duplicate events | `service.test.js` (two real WebSocket clients, identical entity maps at same tick, no `n` gaps, `seq` unique after resume) |
| autonomous feeding/building with real costs, visible stages | `sim.test.js` (wood/stone consumed ≥ cost×shelters, stages 1–3 emitted) |
| reproduction/growth, recovery, lifecycle records | `sim.test.js` (no minor ever bonded/pregnant; births have 2 parents; every birth/death produces a record with cause) |
| starvation, scarcity suppresses births, extinction | `sim.test.js` (no births without food, health loss precedes starvation deaths, single `extinction` event, no births/deaths afterwards) |
| disaster damage, heal, add food, bounds, frequency limit | `sim.test.js` |
| creatures react to fire and recover | `sim.test.js` |
| learning: wallet opinions, retention, disabled mode | `sim.test.js`, `service.test.js` (weights, memories, relationships identical after restart; resumed run equals uninterrupted run) |
| restart recovery, never reseed, corrupt snapshot handling | `service.test.js` |
| downtime catch-up capped and non-lethal | `service.test.js` (7-day outage, 600 ticks simulated, nobody dies) |
| duplicate intervention rejected, durable across restart | `service.test.js` |
| unauthorized access (no token, visitor token, bad WS origin) | `service.test.js` |
| backup/restore incl. tampered backup, migration, developer reset | `service.test.js` |

## Learning on vs off — `tests/results/learning-comparison.md`
8 seeds × 8000 ticks, identical initial worlds. Learning ON: mean approach decisions toward helpful wallet 2636 vs 138 OFF; toward harmful wallet 4 vs 115; avoid-harmful 585 vs 25; mean adult distance to the helpful wallet 12.4 vs 14.5 tiles. Hungry-adult fraction 0.15 vs 0.24 (ON lower). Births/eaten were slightly *lower* with learning (differences within a few sd for 8 seeds). The visitor-discrimination effect is large and unambiguous; the survival effects are modest and should not be over-read.

## Long simulation — `tests/results/long-sim.json`
500,000 ticks (≈5.8 simulated days at 1 s/tick) headless in 131 s, default config, seed 20260101: the population stayed alive (peak 66, final 53), 2625 births, 2596 deaths (starvation 1587, old age 784, exhaustion 225). Tick CPU time p50 0.19 ms, p95 0.67 ms, p99 0.96 ms, max 14.9 ms; RSS peak 289 MB; snapshot 1.35 MB (20 ms to serialise). **Observation:** once the population saturates food, starvation is the main cause of death and ~half the deaths are of adults; this is partly a tuning weakness (creatures forage by wandering and memory is short). Earlier untuned runs went extinct at ~200k ticks; the current defaults did not in this one run (other seeds were only checked to 120k ticks: populations 42–63).

## Population scaling (simulation + view serialisation only, no network) — `tests/results/population-scaling.json`
| creatures | sim tick p50 / p95 / p99 ms | view JSON ms p95 | snapshot MB | RSS MB |
|---|---|---|---|---|
| 24 | 0.06 / 0.29 / 0.66 | 0.3 | 0.2 | 71 |
| 100 | 0.27 / 0.67 / 1.1 | 0.6 | 0.8 | 86 |
| 250 | 0.91 / 1.68 / 2.1 | 1.4 | 1.9 | 116 |
| 500 | 2.7 / 4.6 / 5.7 | 3.1 | 3.8 | 215 |
| 1000 | 7.3 / 10.2 / 11.0 | 5.3 | 7.5 | 277 |
| 2000 | 29 / 40 / 44 | 10.0 | 15.1 | 379 |
Cost is superlinear (nearest-creature scans are O(n²)). These are fast-x86 numbers; the 2 shared ARM vCPUs will be slower by an unmeasured factor.

## Client load — `tests/results/ws-*.json` (real server process, clients on the same machine)
* 100 WebSocket clients, 24 creatures, tick 250 ms, 30 s: 12,100 messages, 97.6 MB, 0 `n` gaps, 0 drops; server tick latency p95 8.6 ms, p99 14 ms, CPU 2–9 %, RSS ≤ 99 MB; never overloaded.
* 200 clients, 250 creatures, tick 250 ms, 30 s: 24,335 messages, 1.8 GB, 0 gaps, 0 drops; tick latency (incl. broadcast) p95 ≈ 80 ms, p99 ≈ 84 ms, CPU ≈ 31–42 % of one core, RSS ≤ 168 MB; not flagged overloaded. This is an unrealistically heavy stress (4 ticks/s) and mostly measures bandwidth; at the default 1 s tick it is ~4× lighter.
CPU percent is of one core as reported by the server. Client processes shared the machine, so server numbers are slightly pessimistic.

## Known gaps / unfinished
* Container build, ARM64 and VPS runs; TLS/Caddy path untested.
* Wallet signatures verified with a self-written secp256k1/keccak (checked against known keccak vectors and the key-1 address, plus sign/recover round trips with a test-only signer). It has **not** been cross-checked against a wallet-produced signature; this is not a security audit. Verification is slow (~100–300 ms CPU per sign-in), hence the auth rate limit.
* Rate limits and sessions are in memory (reset on restart).
* No browser client here; the client team's integration against `shared/protocol.md` / `shared/fixtures/` is pending.
* Public extinction/recovery policy, payments, polished assets: later phases.

## Phase 1.1
New regressions: `repair.test.js` (event history, rate limits, LEARNING, actor-scoped interventions), `durability.test.js` (SIGKILL crash consistency), `wallet-crosscheck.test.js` (ethers fixtures). Run `cd server && npm test`. Results and finding table: `docs/phase-1.1/FINDINGS.md`.
