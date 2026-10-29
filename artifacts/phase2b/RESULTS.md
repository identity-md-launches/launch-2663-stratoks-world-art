# Tested results and limits

This integration preserves the accepted simulation and learning engines. It adds a coherent read frame, exact biome names, navigation and inspectors. The results below distinguish new measurements from inherited scientific experiments.

## Current full-frame capacity measurement

Command for each row, run serially:

```sh
node tests/load/expanse-frame-bench.mjs 24 10000 /tmp/frame-24.json
node tests/load/expanse-frame-bench.mjs 100 10000 /tmp/frame-100.json
node tests/load/expanse-frame-bench.mjs 250 10000 /tmp/frame-250.json
```

Seed 4242; full learning/planning; Node v24.22.1, x64. Eight simulated observers serialize a 56 × 40 viewport, the full living roster, minimap, histories and selected inspector **every simulation tick**. Timings include all eight serializations in the combined column. This is accelerated CPU/serialization work, not eight browser or network connections. Two real independent browser contexts were verified separately in both engines. These are worker timing samples: other verification work was not CPU-isolated, and no exclusive host-capacity claim is made.

| Starting creatures | End | Simulation p95 / p99 | Simulation + 8 frames mean / p95 / p99 | Sampled RSS max | Frame mean / max | Gzip snapshot |
| --- | --- | --- | --- | --- | --- | --- |
| 24 | 6 | 1.200 / 3.201 ms | 2.007 / 3.079 / 4.611 ms | 228 MiB | 28,966 / 36,030 B | 79,776 B |
| 100 | 39 | 6.077 / 8.295 ms | 6.151 / 9.747 / 12.634 ms | 345 MiB | 47,556 / 56,344 B | 488,923 B |
| 250 | 149 | 15.741 / 18.349 ms | 14.170 / 20.889 / 23.649 ms | 429 MiB | 64,917 / 76,875 B | 1,974,897 B |

Raw per-run JSON and stdout: `raw/stratoks-frame-bench-{24,100,250}.{json,log}`. RSS is sampled every 250 ticks, not a kernel high-water measurement. The one-second default production tick is much larger than the measured combined p99 on this machine, but these numbers are **not an ARM64 or shared-vCPU guarantee**. No cgroup, actual 1.5 CPU ceiling, HTTPS, network backpressure or eight rendering clients was included. The measured envelope is 250 *starting* creatures over this run, with sampled RSS below 1536 MiB; sustained population growth beyond that is not certified.

Failures are retained. All populations declined. The 24 run lost 17 to starvation and 1 to exposure. The 100 run includes starvation, burns, exposure, old age and 3 `unknown` deaths. The 250 run includes starvation, exposure, dehydration, burns, old age, injuries and 12 `unknown` deaths. Births and all deaths were natural engine transitions; no resident was removed for a budget. See raw JSON for births, population samples and decision deferrals. The roster and public response cost still grow with living population. No rate limiter or shared-frame broadcast cache is added to the Expanse service in this integration.

These results differ from the historical Expanse benchmark. The older report predates `carry` and sends smaller viewport payloads only every five ticks, with an inspector for one viewer. Do not infer a scientific improvement from their numerical differences.

## New interaction and integrity evidence

Both Chromium and WebKit validate the committed export under `/preview/`, including:

- 320/390/768/1440 reflow and a visible main action at 390; preview and shared inspector accessibility scans.
- Real engine browser demo startup/pause, selection, perception overlay, learned-state view, and complete isolation from server APIs.
- Two independent browser contexts seeing the same authoritative tick and inspector downloads, byte-for-JSON equivalent to server inspection before and after transitions.
- Pan, wheel/button/key zoom, return-to-settlement camera and minimap navigation to negative coordinates; returned terrain is checked against actual engine tiles.
- Actual recent plan rewards, failures and unexecuted steps; empty discovery history, followed by nonempty history produced by unforced seed-303 transitions through tick 1200.
- Search, creator inspection, rejected configuration, modal keyboard behavior, stale state, persistent stop/restart/reconnect and the preserved settlement route.

`chromium/checks.json` and `webkit/checks.json` retain observations and expected failed GETs during the deliberate outage. Their discovery JSON and shared inspector JSON are actual server records. No discoveries were inserted or guaranteed in product code. This one browser discovery scenario is interaction coverage, not a claim of robust invention across seeds.

The backend regression suite includes conservation, water barriers, no spawn traps, migration, durable brain/history behavior, backup/restore and rollback on copied worlds, unauthorized writes and mb-v1 corrections. The added trajectory check compares an unviewed world with one receiving distant frames on every tick for 1000 ticks, and requires identical creatures, learning, RNG, fires and discoveries. Observer materialization and lazy resource accounting remain permitted; the test does not claim serialized chunk caches are identical.

## Inherited ten-seed science

The accepted raw experiment files remain in `tests/results/expanse/`, with the report in `docs/phase2b/README.md`. They compare full, frozen and no-planner modes across ten fixed seeds, main/reward-reversal and cold scenarios. They were not rerun as new causal experiments in this client integration, and that report explicitly says they predate `carry`.

Retained negative findings matter: full planning had worse cold survival than no-planner in most seeds; no shelters were built in those discovery runs; water-source context learning was insufficient; the full-versus-frozen reward-reversal difference did not establish a learning effect. These limitations are neither hidden nor fixed by adding a plan inspector. The new interface shows what happened rather than announcing a discovery schedule or claiming intelligence beyond the implemented model.

## Remaining verification gaps

No production service was accessed or changed. No Docker daemon was available; the owner-hosted image, ARM64 budget, real network load with eight clients, physical phones, screen-reader sessions, native zoom and independent final-commit review remain unverified. The static client, source and committed export are delivered for owner review, not as a deployed backend or a certified scientific release.
