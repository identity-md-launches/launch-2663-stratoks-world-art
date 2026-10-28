# Phase 2A component delivery and checks

The assigned deliverable is the reduced circuit, compatible backend integration, migration/rollback, reproducible experiments and resource measurements. The optional static companion inspector makes it locally inspectable. The recovered application is preserved, including the complete original source ZIP; this is not a production deployment or a completed public-client integration release.

Start with [model/citations/licensing](MODEL.md), [interface](../../shared/brain-v1.md), [migration/rollback](MIGRATION.md), [measured results](RESULTS.md), and [review/remaining limitations](REVIEW.md). Raw current evidence is `tests/results/phase2a/`; older directories retain their historical meaning.

## Reproduce offline

Runtime and server/component checks use **Node >=22 with zero npm dependencies**. Python 3 standard library is used only for archive materialization and Linux benchmark supervision. No package install, network, paid inference, GPU, LLM, model download or restricted scientific dataset is needed for these commands. Node 22's built-in WebSocket client drives the actual server in transport tests. Test concurrency is limited to two workers to reduce test-runner memory.

From the deliverable root:

```sh
node --test --test-concurrency=2 tests/*.test.js
node tests/experiments/mushroom-learning.mjs 10
node tests/experiments/mushroom-ecology.mjs 5000 10
python3 tests/load/cap-process.py tests/results/phase2a/supervisor-mb-v1-24-8.json -- node --max-old-space-size=384 tests/load/brain-capacity.mjs 24 mb-v1 8 1200
node tests/experiments/report-phase2a.mjs
```

Repeat the benchmark for populations `24`, `100`, `250` and modes `legacy`, `mb-v1`, `mb-v1-frozen`; use `100` clients for the additional 24/250 high-client rows. To measure actual cadence rather than accelerated throughput:

```sh
python3 tests/load/cap-process.py tests/results/phase2a/supervisor-mb-v1-24-8-realtime.json -- node --max-old-space-size=384 tests/load/brain-capacity.mjs 24 mb-v1 8 120 realtime
```

Repeat real-time rows for 100/250 creatures. This is a benchmark program executing timed ticks, not a request to delay deployment or poll production. All runs are isolated, finite, and use fresh disposable stores. `report-phase2a.mjs` checks all required cohorts and refuses stale capacity source hashes. Its report summarizes actual raw data rather than embedding desired preferences or performance numbers.

Current regression log: [regression.tap](regression.tap). **68/68 tests passed**, including all 53 recovered tests (two schema-version assertions updated to 3), circuit/causality checks, migration, frozen learning, actual food consumption/health punishment, deterministic disk restart, backup restore, mode rollback on a copy, actual recovered-binary compatibility, real two-client agreement, and inspector transport/control isolation.

The inspector test's tiny DOM scaffold is explicitly a mock of the browser DOM. The server, HTTP/WS reads and circuit implementation in that test are real. It verifies behavior and asset parity, not browser rendering, cross-origin enforcement by a browser, font rendering or screenshots. Existing recovered HTTP authorization/origin and wallet tests run unchanged.

## Inspectable local demo

```sh
node server/bin/phase2a-demo.js
```

Open `http://127.0.0.1:8880/` in two browser tabs. This command ignores production environment/configuration, starts an mb-v1 world in a fresh temporary directory, binds both services to loopback, and serves the static inspector plus the unchanged recovered client/art. It prints only the local demo URL. The recovered client connects to that disposable backend, so its game actions cannot affect production. Use Ctrl-C to stop and remove temporary state.

The inspector shows the actual selected creature's mode, sensory input, action candidates, learned output contribution, decision source, selected target and recent reward. Conditioning/reversal/threat/freeze/lesion controls operate on a separate circuit inside the browser tab and make no server mutation request. Heldout evaluation changes no weights. Do not confuse its synthetic rewards with events in the shared world below it.

`deploy/phase2a-demo/` is a self-contained static folder. Its inspector may be hosted separately and configured with `?server=https://<operator-server-origin>` or its connection input. HTTPS maps to WSS; loopback HTTP/WS is accepted only for local tests. The server must allow that static client's origin under the existing CORS/WS policy. No backend, account, wallet address, key or guessed hostname is embedded. A static host may omit `demo-config.json`; in that case the optional local-world frame remains hidden and the browser-only circuit experiment still works.

## Docker and hardware status

`deploy/Dockerfile` pins Node 22.22.1/bookworm-slim by verified OCI index digest (recorded in `deploy/phase2a-node-image.json`). The amd64 validation profile `deploy/phase2a-compose.yml` sets **512 MB / 0.75 CPU** for a separate world volume and loopback port. It does not reuse the legacy production Compose volume. The original production profile remains available; no deployment was performed.

```sh
docker compose -f deploy/phase2a-compose.yml up --build
```

**Docker was not installed on this machine; the image was not built or run here.** The requested exact cgroup and Ubuntu 1 GB whole-host qualification remains unresolved. The committed measurements use Linux x86_64 single-core affinity, CPU-time duty policing and an RSS watchdog, with kernel peak RSS additionally reported; they must not be presented as cgroup validation. Each run includes clients and server in one process budget. No capacity beyond the measured rows is established.

## Release integration still required

- An independent reviewer must assess this exact component and its evidence. `REVIEW.md` is the author's review, not external approval.
- Validate the actual Docker limits and long-duration growth/storage on the target Ubuntu host, including the whole-host 1 GB budget.
- Integrate the compact panel into the main client's chosen UI. The companion inspector preserves the recovered layout/art but is not a claim that the original React UI was modified.
- Run real-browser two-tab checks/screenshots, public HTTPS/WSS verification and IMD static publication. This task environment provided no browser or IMD publication tool. **No new public client URL or browser screenshot is claimed.** The local URLs above are local tests, not public deliverables.
- Resolve the recovered backend's standalone redistribution license with the owner. No restricted scientific dataset blocks this independently implemented circuit, but importing FlyWire or other scientific assets later requires a fresh data-license decision.
- Review ecological tradeoffs: this implementation's conditioning succeeds, while some autonomous population/birth outcomes remain worse than legacy. Legacy remains the production default until explicit operator activation after validation.
