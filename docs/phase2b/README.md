# STRATOKS Phase 2B: expanse world and learning-agent foundation (component report)

> Historical backend component report. The subsequent client integration is now present in `web/` and `dist/`; see the root `README.md` and `artifacts/phase2b/VALIDATION.md`. The absence-of-client statements and older benchmark/experiment extent below describe the earlier accepted component, not the current integrated export.

## What this commit contains

The baseline is `identity-md-launches/launch-2613-stratoks-phase-integrate-scientifically` at `8d4193ef8dc76cfcb1794f719e1a688e4355a01d` (mb-v1 correction). Its in-scope trees `server/`, `shared/`, `tests/`, `deploy/` and `docs/` are imported **byte-for-byte unchanged**, except four redundant binary package archives that were left out to stay under the upload limit (see `docs/phase2b/OMITTED-BASELINE-ARCHIVES.md`; they can be restored from the pinned commit).

`web/`, `dist/`, `artifacts/`, `README.md` and `DESIGN.md` are **not** imported, because this assignment may only write `server`, `shared`, `tests`, `deploy` and `docs`. They are still in the baseline repository, so integration has to merge this commit with that commit's root and `web/` tree.

New Phase 2B code is additive. It lives in `server/src/expanse/`, with these supporting files:

- the CLI `server/bin/expanse-migrate.js`
- tests in `tests/expanse.test.js`
- experiment and benchmark scripts in `tests/experiments/expanse-*.mjs` and `tests/load/expanse-bench.mjs`
- raw results in `tests/results/expanse/`
- deployment files in `deploy/expanse/`

The Phase 2A service (`server/src/main.js`, `service.js`, `world.js`) is untouched and still the production engine. The expanse runs as a separate, read-only service until the owner integrates it.

| Module | Role |
|---|---|
| `expanse/terrain.js` | deterministic 28×28 biome chunks around the preserved 56×56 settlement |
| `expanse/agent.js` | versioned observation, episodic memory, outcome model, planner and map knowledge |
| `expanse/engine.js` | authoritative simulation: primitives, tool, fire, social acts, needs, lifecycle and persistence state |
| `expanse/persist.js` | atomic gzip snapshots with sha256, generations, rollback, backup/restore, migrations, Phase 2A import |
| `expanse/view.js` | read-only viewport, minimap and inspector payloads |
| `expanse/server.js` | headless ticking service with GET-only JSON API; non-GET requests return 405 |

## World

- **Settlement preserved.** Tiles in `[0,56)²` come from the unchanged Phase 2A generator for the same seed. Trees, stones and bushes keep their coordinates and keep their numeric IDs with a prefix (`t#`, `s#`, `b#`). Creatures keep their IDs, names, coordinates, brains (including mb-v1 weights), memories and relationships. A test checks all of this.
- **Extent.** By default there are 4 chunks of 28 tiles on every side, giving 280×280 tiles = **25×** the settlement area (16× is the floor; tested).
- **Chunk generation.** Chunks are generated lazily from `(seed, cx, cy)` only, so an unvisited chunk is reproducible (tested).
  - A chunk that has been modified ("dirty") is saved whole: tiles, nodes and piles.
  - A generated but untouched chunk is saved only as a key and regenerated on load.
- **Biomes and their physics.** These are designed rules, not learned:
  - **Temperate forest:** grass and forest floor, lakes. Has trees, bushes, deadfall (sticks), scrub (fiber) and some stone.
  - **Arid:** sand and dunes (move cost 1.5–1.6). Fresh water only in rare oases. Has cactus fruit (food plus water), flint and scrub. Hot days raise thirst (×(1+(T−26)/8)) and fire is more likely to light and spread.
  - **Cold highlands:** rock and snow (move cost 2–2.5), impassable cliffs, drinkable streams. Has stone, flint, lichen and sparse trees. Below 10 °C warmth drains, health falls under 25 warmth (death cause `exposure`), and hunger rises ×1.3 under 5 °C.
  - **Coast and islands:** sea is impassable and salty. Shallows can be waded (cost 3, −6 °C). Has sand, shellfish and driftwood. **Drinking salt water raises thirst and costs health.**
- **Weather and shelter.** There is a day/night temperature swing and night reduces perception from 7 to 5 tiles. Seeded rain episodes lower temperature, block fire spread and burn fuel faster. A shelter (4 wood + 2 stone, 30 work ticks) raises effective temperature to at least 17 °C.
- **Traversal.** Water, cliffs, trees and stones block movement. Paths use a bounded A* with terrain costs, so there is no teleporting. Spawns are only in the settlement, and a test checks that each tested spawn reaches at least 600 tiles.
- **Resources.**
  - Nodes regrow by whole units on a fixed period, evaluated lazily and **exactly**: computing late gives the same value as ticking every tick.
  - The Phase 2A logistic bush regrowth is replaced by this integer rule in the expanse. This is a documented rules change; Phase 2A itself is unchanged.
  - Items exist only in node units, inventories, ground piles or fire fuel. A dead creature's inventory is dropped as a pile, not deleted.
  - Conservation is tested in both directions: item ledger = holdings, and nodes = initial + regrown − gathered − burned.

## Agents: learned vs designed

| Learned per creature, from transitions | Designed (fixed) |
|---|---|
| **Outcome model** (`agent.js`, v1). Keyed by `(action, argument, context)`, e.g. `gather\|tree\|tool` or `combine\|flint+stick\|`. Keeps a Welford mean/variance of reward, success rate, mean duration, energy cost and the items produced. Bounded to 96 entries with least-supported eviction. Uncertainty is σ/√(n+1) plus a prior term. | Primitive set, physics, recipes, ignition rule, need dynamics |
| **mb-v1 circuit weights.** The unchanged `mushroom.js` encodes 12 need features, a 4×4 position, and 4 cues (thirst, cold, fire seen, tool held). It is reinforced with the realised reward of the first step of each chosen sequence. | Reward = change in need-based wellbeing, plus small drives: +0.12 per item gained, +0.4 for a never-held item, +0.3 for lighting a fire, plus social terms scaled by personality |
| **Map knowledge.** Up to 40 seen nodes (removed when seen depleted), 6 freshwater sites, and 384 visited 8×8 cells. | Reflexes, labelled `source:"reflex"`: step out of fire; drink or eat when need is above 88 *and* a source is known |
| **Episodic memory.** 48 episodes, keeping the most salient. | Planner search: beam 5, branch 7, horizon 3, discount 0.9; value = (r̂ + bonus·σ)·p̂ − λ·duration − μ·energy |

- **Affordances are generic.** The agent sees "combine any two held items", "use any held item on self, pile or fire", "place any fuel item", and "gather any known node". It is **not** given the recipe table or the ignition rule.
- **What the planner may assume.** It chains a later step only through items the *model* predicts the earlier step produces. An unlearned combination cannot be assumed to yield a tool (tested). The planner never reads simulator state beyond the creature's own observation and memory.
- **Scoring.** `u = innate(mb label) + 2.5·mb-v1 readout + planner value`. The mb-v1 `pickMushroom` softmax selects among candidate sequences.
- **What is recorded.** Every executed plan stores the selected steps, the per-step prediction (reward, σ, success, duration, n), the alternatives count and mb preference, and the per-step actual outcome. Creatures keep 8 recent plans; the inspector shows them.
- **Observational learning.** A creature that sees another's act and its visible result updates its **own** model at weight 0.3. Memory is never copied. Discoveries record whether the creature found something itself or had first seen it done (`selfFound`).
- **Modes.**
  - `full`: learning and planning.
  - `frozen`: no model updates and no mb-v1 plasticity; the planner runs on priors.
  - `no-planner`: single-step choice by innate + mb-v1 only; the model still learns but is not used.
- **Not claimed.** This is not a complete fly brain, consciousness, human intelligence or open-ended invention. It does no language or speech. It has no LLM, paid API or GPU dependency.

## Primitives, tool, fire

- **Primitives:** `move`, `inspect`, `gather`, `carry` (pick up one item from a ground pile on the creature's tile), `combine`, `use`, `place`, `build`, `rest`. Each has a reach of 1 tile (threaten: 3), an inventory capacity of 10 weight units (wood and stone weigh 2), energy costs and a duration.
- **Tools.** `flint+stick → hand_axe` makes tree, deadfall, driftwood and scrub gathering yield 2 units in 3 ticks instead of 1 in 6 (tested). `stick+stone → stone_club` adds attack damage. `fiber+stick → bundle` is tinder. All other pairs fail and waste 4 ticks.
- **Fire.**
  - *Ignition:* strike flint on a pile containing fuel while also holding stone. The chance is 30%, +35% with fiber or bundle tinder, ×0.25 when wet (rain, snow, shallows) and ×1.3 in arid land.
  - *Warmth:* +20 °C within 1 tile, +10 °C within 3.
  - *Damage:* 4 health per tick on the fire's tile (cause `burns`).
  - *Spread:* to adjacent flammable nodes, depending on dryness; the burned units are accounted.
  - *Extinguishing:* fuel runs out, rain, or any non-fuel item used on the fire (smothering).
  - Feeding fuel extends a fire. All of this is tested.
- **No scripted discovery.** There is no scheduled invention, forced success or discovery dialogue. Discoveries are logged only when they actually happen.

## Social interfaces

| Behaviour | Status |
|---|---|
| share (give one food item to a hungry neighbour; relationship +; observers' reputation of the giver +) | operational |
| socialize (relationships, which gate reproduction) | operational |
| follow / refuse (follower asks; the target refuses if its relationship to the follower is below −0.15 or it is weak) | operational |
| leadership = count of distinct voluntary followers in the last 2000 ticks (`leadership()`); nobody is assigned | operational, observed metric only |
| threaten (range 3, energy 2; target yields if boldness×health is lower and its gathering is interrupted) | operational |
| attack (range 1, energy 5, hit 65% ± boldness, 5–10 damage +5/+7 armed, bleeding injury); death only through the health rule, cause `injury` | operational, tested |
| flee (move 6 tiles away from attacker/threatener) | operational |
| reputation (each perceiving creature keeps its own opinion: share +0.08, attack −0.15, threaten −0.06, refuse −0.02, follow +0.02) | operational |
| coalitions, punishment, trade, teaching, territory | future work |

## Persistence, migration, scale

- **What is saved.** Chunks (dirty ones in full, pristine ones as keys), inventories, piles, fires, shelters, minds (models, memory, knowledge, plans), mb-v1 weights, the RNG state, discoveries, the social log and totals.
- **Exact restart.** Saving at tick 400 and running 300 more ticks gives a state byte-identical to running 700 ticks straight (tested).
- **Migrations:**
  - expanse v1 → v2 (tested), and a newer schema is refused.
  - Phase 2A snapshot → expanse (`fromLegacySnapshot`, CLI `server/bin/expanse-migrate.js <world.json> <new-dir>`). The CLI checks the source sha256 and never writes the source. Brains, IDs, memories and tick are preserved (tested in unit tests and on a `Store`-written copy).
- **Backup and rollback.** Backup, restore (moves the current snapshot to `pre-restore-*`) and rollback to the previous generation (keeps `rolled-back-*`) are tested on temporary copies. A corrupted snapshot is refused by its checksum.
- **Scheduling.** At most 64 decisions per tick, served oldest-waiting first. Waiting creatures keep their needs and lifecycle every tick. **No resident is ever removed for budget.** Births, ageing, starvation and other deaths are natural.
- **Offscreen and lower-frequency approximation.** All creatures run full ticks everywhere. The only lazy evaluation is node regrowth, which is exact (zero error).
- **Bounded memory and logs.** Events are capped at 400, the social log at 300, the graveyard at 5000, history at 1000, discoveries at 500. Every per-creature structure has a cap.

## Results (raw data in `tests/results/expanse/`, nothing filtered)

The experiment and benchmark runs below were made **before** the `carry` primitive (picking items up from piles) was added at the end of this session, so they do not include it. The tests were re-run afterwards (17/17 pass). Rerun the scripts to get numbers for the final code.

**Experiments.** `tests/experiments/expanse-experiments.mjs` was run with 10 fixed seeds (101…1010) × 3 conditions × 2 scenarios × 3000 ticks with 24 creatures, 60 runs in total. Raw per-run files are `raw/exp-*.json`; aggregates and per-seed paired differences are in `summary.json`.

- **main** starts in the settlement. Berries become harmful at tick 1500 (reward reversal).
- **cold** relocates the population into the highlands.

| Condition | Survivors | Exposure deaths | hand_axes | Fire lighters | Berry eaten after/before reversal | \|pred−actual\| reward |
|---|---|---|---|---|---|---|
| main / full | 19.4 | 0.1 | 4.1 | 1.5 | 0.457 | 0.046 |
| main / frozen | 20.1 | 0.3 | 1.4 | 0.8 | 0.462 | 0.101 |
| main / no-planner | 16.4 | 0.1 | 0.7 | 0.0 | 0.894 | 0.048 |
| cold / full | 16.3 | 7.4 | 22.5 | 7.0 | – | 0.078 |
| cold / frozen | 14.4 | 8.4 | 19.8 | 3.3 | – | 0.128 |
| cold / no-planner | **20.9** | **3.9** | 5.6 | 1.5 | – | 0.066 |

What these numbers show, including failures:

1. **Tool and fire discovery depend on the planner and on learning.**
   - Full crafted more hand_axes than no-planner in 7/10 (main) and 9/10 (cold) seeds, and never fewer.
   - Full had more fire lighters than no-planner in 6/10 (main) and 10/10 (cold) seeds.
   - Versus frozen, full had more fire lighters in 8/10 cold seeds.
   - Several runs still discovered nothing.
2. **Prediction error.** The learned model's error is about half the frozen prior's in 10/10 (main) and 9/9 (cold) seeds.
3. **Reward reversal.**
   - Full and frozen both cut berry eating by about 54% after the reversal, so in this design the drop is mostly depletion and toxicity effects plus reflexes, **not learning**. Full vs frozen shows no causal learning effect (diff −0.005 ± 0.20).
   - No-planner keeps eating berries (ratio 0.89; full is lower in 10/10 seeds). The effect therefore comes from the planner using the learned model; mb-v1 single-step learning alone does not reverse within 1500 ticks.
4. **Cold survival — a failure.** The planner-disabled baseline survives better than full in 8/10 seeds (+4.6 survivors, −3.5 exposure deaths). Full creatures spend time exploring and crafting (stone_clubs are over-produced because of the novelty and acquisition drives) instead of resting warm. Discovering tools and fire did not turn into survival benefit in 3000 ticks. **No shelters were built in any run.**
5. **Water barriers — not learned within the run.** Salt-water drinking failures did not fall from the first to the second half under full learning (8.8 → 13.7 in main). Context keys do not separate sea sources well enough. This is a known gap.
6. **Exploration.** About 23 of 24 creatures went 20 or more tiles from home in main; 19.6 (full) and 22.8 (no-planner) returned within 8 tiles.
7. **Births are rare** (≤1.1 per run) because the birth gate needs a shelter or fire plus bonding.

**Capacity.** `tests/load/expanse-bench.mjs` ran 10,000 ticks, accelerated, with 8 simulated viewers each serialising a viewport (plus the inspector for one of them) every 5 ticks. It ran on an x64 machine with 12 cores and **no cgroup limit**; the ARM64 1.5 CPU / 1536 MB budget is **not verified**.

| Start pop | End pop | Tick mean / p95 / p99 (ms) | Max RSS | Snapshot (gzip) | Viewer payload mean / max |
|---|---|---|---|---|---|
| 24 | 2 (22 starvation) | 1.7 / 4.7 / 22.7 | 169 MiB | 35 KB | 5.5 / 16.7 KB |
| 100 | 55 | 11.9 / 29.8 / 101 | 335 MiB | 677 KB | 6.5 / 19.1 KB |
| 250 | 177 | 28.8 / 66.3 / 164 | 426 MiB | 2.2 MB | 8.1 / 20.9 KB |

- At the 1000 ms production tick, 250 creatures use about 3% of a core on average, and p99 is well under the tick.
- **Supported limit, as measured here: 250 creatures within 1536 MB.** This must be re-measured on the ARM64 host; shared vCPUs are slower.
- **Populations decline in every benchmark.** Starvation dominates at 24 creatures (seed 4242). This is an ecology-tuning gap, not a culling mechanism.
- Some deaths are recorded with cause `unknown`, because there is no damage attribution for low energy or salt water. This is a known bug.

**Checks run.**

- `node --test tests/*.test.js`: **153/153 pass** (137 baseline + 16 expanse).
- With the service test added, `tests/expanse.test.js` has 17 tests, all passing. The service test covers ticking with no viewer, two clients agreeing, POST/PUT/DELETE/PATCH returning 405, and restart resuming the same world.

## Integration notes and mocks

- **Not wired.** The expanse is **not** wired into the Phase 2A HTTP/WS service, wallet auth or the React client. `expanse/server.js` is a stand-alone read-only API that integration should replace or mount.
- **Viewer payloads are a simulation.** The `viewport()`/`inspect()` JSON from `view.js` (v1) is the agreed payload shape. The benchmark's 8 "clients" are serialisations of these payloads, not WebSocket clients.
- **No UI.** Pan/zoom, minimap, biome indicators, follow-creature, discovery history and the plan/outcome inspector are **not implemented** in the client, because `web/` is outside this assignment. The data is available from `/api/expanse/{view,minimap,discoveries,creature/:id}`. No browser evidence, IMD static publication or HTTPS/WSS client configuration was produced.
- **Docker.** `deploy/expanse/Dockerfile` and `compose.yml` were not built here (no Docker available) and are unverified. The base image should be pinned by digest.

## Deploy and roll back (owner)

1. Copy the live Phase 2A `data/world.json` to a scratch directory. Never point tools at production data.
2. `node server/bin/expanse-migrate.js /copy/world.json /srv/expanse-data`
3. `docker compose -f deploy/expanse/compose.yml up -d`, then put it behind Caddy for HTTPS.
4. Backup and restore: `persist.backup(dir, dest)` / `persist.restore(dest, dir)`.
5. Roll back to the previous saved generation: `persist.rollback(dir)`.
6. Full rollback to Phase 2A: stop the expanse container. The Phase 2A data was never modified.

## Reproduce

```sh
node --test tests/*.test.js
node tests/experiments/expanse-experiments.mjs 3000 out.json 0 10
node tests/experiments/expanse-report.mjs tests/results/expanse/raw
node tests/load/expanse-bench.mjs 250 10000 bench-250.json
```

## Remaining gaps

- Client UI and browser evidence.
- WS streaming and multi-client protocol integration.
- An ARM64 cgroup-enforced benchmark.
- Shelter building never occurs.
- Cold-survival regression of the full agent.
- Salt-water avoidance not learned.
- `unknown` death causes.
- Ecology decline at 24 creatures.
- Coalition and trade social behaviours.
- Licence notices: no new third-party dependencies were added; the baseline's notices in `docs/licenses/` apply.
- Independent review of the final commit has not been done; this report is the author's own.
