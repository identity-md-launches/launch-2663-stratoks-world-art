# Corrected learning and ecology evidence

These are local author measurements of the corrected source, not independent approval. Original raw evidence is unchanged in `tests/results/phase2a/`; final reruns are in `tests/results/correction/`. Both learning and ecology JSON files record hashes of the simulation modules. `node tests/experiments/report-correction.mjs` refuses stale hashes and altered seeds/resources.

## Controlled learning

Seeds 1–10, all four modes, all three original tasks, unchanged 300-trial acquisition / 400-trial reversal, 20% forced exposure, 10% reward noise and held-out hunger perturbation. This is a synthetic, two-target, one-action component task. It contains no emergency reflexes, navigation or competing action families. It tests conditional learned target preference; it cannot establish ecology fitness or the absence of action-count bias by itself.

| Task | Mode | Acquisition held-out, original → corrected | Reversal held-out, original → corrected | Corrected acquisition SD | Acquisition / reversal seeds <60% |
|---|---|---|---|---|---|
| location | legacy | 51.15% → 51.15% | 48.00% → 48.00% | 4.15% | 9 / 10 |
| location | mb-v1 | 98.60% → 98.60% | 98.30% → 98.30% | 2.06% | 0 / 0 |
| location | mb-v1-frozen | 49.55% → 49.55% | 50.50% → 50.50% | 5.40% | 10 / 10 |
| location | mb-v1-ablated | 49.55% → 49.55% | 50.50% → 50.50% | 5.40% | 10 / 10 |
| cue | legacy | 51.15% → 51.15% | 48.00% → 48.00% | 4.15% | 9 / 10 |
| cue | mb-v1 | 97.05% → 97.05% | 97.30% → 97.30% | 2.81% | 0 / 0 |
| cue | mb-v1-frozen | 49.55% → 49.55% | 50.50% → 50.50% | 5.40% | 10 / 10 |
| cue | mb-v1-ablated | 49.55% → 49.55% | 50.50% → 50.50% | 5.40% | 10 / 10 |
| threat | legacy | 51.15% → 51.15% | 48.00% → 48.00% | 4.15% | 9 / 10 |
| threat | mb-v1 | 96.90% → 96.90% | 96.70% → 96.70% | 2.50% | 0 / 0 |
| threat | mb-v1-frozen | 49.55% → 49.55% | 50.50% → 50.50% | 5.40% | 10 / 10 |
| threat | mb-v1-ablated | 49.55% → 49.55% | 50.50% → 50.50% | 5.40% | 10 / 10 |

All 120 serialized state and continuation comparisons agree. All held-out phases freeze weights. Frozen and ablated training now both produce zero neural updates. Earlier ablation scores already hid learned output, so its unchanged choice fraction concealed its plasticity defect; the new weight/counter regressions expose this. Run elapsed time: 7.32 seconds.

The hierarchy retains a single per-creature random draw and conditional softmax. With only one action in these experiments, target choice probabilities are the same as before. Unchanged learning fractions are expected, not evidence that the ecology regressions are absent. Legacy cannot distinguish the equal-feature targets. Frozen and ablated choices remain near chance. No failed seed was dropped.

## Autonomous ecology

The same ten initial worlds, 24 initial creatures, 5,000 ticks per mode/seed, unchanged `DEFAULTS.world`, no culling, refill, resource adjustment, forced training, reseeding or interventions. Values below are means across ten seeds. Raw JSON includes each seed, SD, range, hunger exposure, decision sources and neural/linear update counts.

| Mode | Population, original → corrected | Births | Deaths | Food | Complete shelters | Hungry creature-ticks (>70 hunger) |
|---|---|---|---|---|---|---|
| legacy | 42.50 → 43.60 | 18.70 → 19.70 | 0.20 → 0.10 | 247.38 → 238.84 | 12.20 → 12.40 | 3.84% → 1.34% |
| mb-v1 | 37.30 → 41.60 | 13.60 → 17.70 | 0.30 → 0.10 | 178.77 → 192.11 | 11.20 → 11.70 | 6.18% → 2.86% |
| mb-v1-frozen | 38.40 → 43.30 | 15.10 → 19.40 | 0.70 → 0.10 | 201.81 → 212.67 | 11.10 → 12.20 | 7.53% → 2.68% |
| mb-v1-ablated | 38.40 → 43.30 | 15.10 → 19.40 | 0.70 → 0.10 | 201.81 → 212.67 | 11.10 → 12.20 | 7.53% → 2.68% |

## Reopened review: previous correction versus final reflex

The independent reviewer reproduced a remaining cap bug on ca7a177. Its raw learning/ecology evidence is retained losslessly in `tests/results/review/ca7a177-*.json.gz`. Only emergency food visibility changes in this revision; the learned candidate cap and action/target hierarchy are unchanged. The controlled component rows are identical to ca7a177.

| Mode | Population, ca7a177 → final | Births | Deaths | Food | Complete shelters | Hungry creature-ticks (>70 hunger) |
|---|---|---|---|---|---|---|
| legacy | 42.50 → 43.60 | 18.70 → 19.70 | 0.20 → 0.10 | 247.38 → 238.84 | 12.20 → 12.40 | 3.84% → 1.34% |
| mb-v1 | 39.70 → 41.60 | 16.20 → 17.70 | 0.50 → 0.10 | 207.89 → 192.11 | 11.60 → 11.70 | 7.53% → 2.86% |
| mb-v1-frozen | 40.60 → 43.30 | 17.20 → 19.40 | 0.60 → 0.10 | 223.13 → 212.67 | 11.90 → 12.20 | 6.88% → 2.68% |
| mb-v1-ablated | 40.60 → 43.30 | 17.20 → 19.40 | 0.60 → 0.10 | 223.13 → 212.67 | 11.90 → 12.20 | 6.88% → 2.68% |

**Regressions and limits:** remaining food decreases in every mode versus ca7a177, despite lower hunger and more births/survivors. Food remaining alone cannot distinguish consumption from future scarcity. Final mb-v1 still has lower population/births, fewer shelters, less food and more hunger than final legacy. Its mean deaths tie legacy in this sample; no overall fitness or learned-survival claim follows. Frozen/ablated remain identical in initially untrained worlds with zero neural updates. **Unmodified legacy ecology is no longer equivalent**: the requested nearest feasible reflex in every mode changes legacy starvation choices too. The legacy non-emergency engine matches an independently adapted recovered reference over 4000 ticks, with only the specified reflex changed in that reference; that is not a claim of equivalence to the buggy unmodified engine.

Ecology elapsed time: 95.47 seconds. SD in the experiment scripts uses division by n; these are descriptive samples, with no significance or generalization claim.

**Confounds and limits:** simultaneous fixes change emergency targets and action-family probabilities; these runs do not identify each fix’s separate contribution. Candidate availability, fixed priors, spatial binning, competition and shaped rewards remain engineered influences. Frozen/ablated worlds start untrained; trained-weight retention is tested separately. Seeds pair initial conditions, but changed choices diverge world RNG consumption through navigation/ecology, so later environments are not identical exposures. Five thousand ticks do not cover a full lifespan, extinction risk, long-term learning stability or storage growth. Survival reflexes are counted separately from model decisions; a later update after a reflex is an exposure, not evidence of learned selection.

## Capacity

**Real 512 MiB / 0.75 CPU Docker qualification is unverified:** Docker is unavailable on this worker. `tests/results/correction/docker/status.json` records the failed capability check. The runnable isolated runner is `node tests/load/correction-docker.mjs`; it enforces Docker memory/swap/CPU settings, checks `docker inspect` and in-container cgroup v2 values, and keeps service plus real clients inside that budget. No production data/volume/network is mounted.

The following completed fallback runs have **no requested resource enforcement**. They are diagnostic only; they do not establish supported VPS capacity. The service and clients share one process; all ecology stays enabled. Accelerated runs have 300 warm-up ticks plus 1,200 measured ticks; real-time runs have no warm-up and 180 ticks at a nominal one-second cadence. The runner’s process runtime includes initialization/warm-up/shutdown; measured runtime brackets only the measured ticks and a network drain.

| Mode | Initial → final creatures | Clients | Cadence | Measured runtime s | Process runtime s | Peak RSS MiB | Tick p95 / p99 ms | CPU ms/tick |
|---|---|---|---|---|---|---|---|---|
| legacy | 24 → 30 | 8 | accelerated | 2.73 | 3.65 | 133.94 | 1.761 / 13.842 | 2.260 |
| legacy | 100 → 100 | 8 | accelerated | 6.65 | 8.52 | 277.69 | 3.320 / 30.619 | 5.676 |
| legacy | 250 → 250 | 8 | accelerated | 14.74 | 18.47 | 371.39 | 6.616 / 61.644 | 12.985 |
| mb-v1 | 24 → 26 | 8 | accelerated | 2.61 | 3.48 | 138.54 | 1.519 / 17.476 | 2.334 |
| mb-v1 | 100 → 100 | 8 | accelerated | 7.76 | 9.79 | 305.04 | 3.743 / 56.390 | 6.863 |
| mb-v1 | 250 → 250 | 8 | accelerated | 18.44 | 22.86 | 427.42 | 7.705 / 130.482 | 16.115 |
| mb-v1-frozen | 24 → 26 | 8 | accelerated | 2.59 | 3.41 | 137.43 | 1.479 / 15.356 | 2.271 |
| mb-v1-frozen | 100 → 100 | 8 | accelerated | 6.85 | 8.78 | 286.40 | 3.163 / 45.328 | 5.994 |
| mb-v1-frozen | 250 → 250 | 8 | accelerated | 16.78 | 20.99 | 417.07 | 7.120 / 111.699 | 14.292 |
| mb-v1-ablated | 24 → 26 | 8 | accelerated | 2.74 | 3.69 | 136.63 | 1.653 / 17.046 | 2.238 |
| mb-v1-ablated | 100 → 100 | 8 | accelerated | 7.94 | 10.01 | 285.23 | 4.254 / 54.555 | 6.990 |
| mb-v1-ablated | 250 → 250 | 8 | accelerated | 18.49 | 23.09 | 416.68 | 8.697 / 121.926 | 16.117 |
| mb-v1 | 24 → 24 | 8 | 1 second | 179.13 | 179.35 | 97.26 | 8.546 / 21.674 | 6.859 |
| mb-v1 | 100 → 100 | 8 | 1 second | 179.16 | 179.53 | 141.62 | 8.637 / 49.703 | 12.143 |
| mb-v1 | 250 → 250 | 8 | 1 second | 179.25 | 179.74 | 209.89 | 22.309 / 125.091 | 39.408 |
| mb-v1 | 250 → 250 | 32 | accelerated | 48.67 | 60.47 | 441.66 | 24.531 / 148.554 | 51.477 |

Completed rows: 16 / 16. Platform, Node version, source hashes, tick durations/intervals, every client’s final tick, delta sizes, inspector payloads, population changes, process CPU/RSS and observed cgroup counters are retained with each row. Observed host cgroup counters do not demonstrate the requested limits. **Supported capacity on the 1 GB x86_64 VPS: not established.** Validate the real Docker matrix there before choosing a supported population/client ceiling. There is no automatic population cap.

