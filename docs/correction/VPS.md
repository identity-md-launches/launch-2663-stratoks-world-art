# Owner validation package — 1 GB x86_64 target

No command in this document was run against production. Only the owner deploys after review. Production remains legacy. `deploy/correction-vps.tar.gz` is a reproducible source/runtime package, not a hosted service. Its per-file hashes are in `docs/correction/PACKAGE.json` (outside the archive to avoid a self-reference).

## Package and configuration

Extract into a new review checkout. The package contains `server/`, `shared/`, `web/` source with its original manifest/lockfile, `dist/`, server regressions/fixtures/experiment/benchmark tools, release/migration guidance and the existing Dockerfile. Dependencies are not vendored; the server needs only Node 22+, and the completed static client needs no build service. Rebuilding the client uses npm normally through `web/scripts/task.mjs`.

Do not use the historical `deploy/docker-compose.yml` for this target: it describes an older ARM64 / larger-memory setup. The new `deploy/correction-vps-compose.yml` explicitly targets `linux/amd64`, 512 MiB memory, 512 MiB memory+swap (no extra swap), 0.75 CPU, read-only filesystem, bounded logs, a dedicated review volume and loopback port 18787. It defaults explicitly to legacy. It does not name or mount any production volume. The existing production compose/Dockerfile were not edited.

The owner sets `STRATOKS_CLIENT_ORIGIN` to the exact real static-client origin once published. Until then the default allowed-origin list is empty. This is an owner-settable setting, not a guessed server or wallet identity. If reviewing developer tools, supply the existing authorized wallet allowlist through the existing `DEV_WALLETS` / JSON configuration mechanism; no owner address/key is supplied or invented here. Preserve the owner's existing authentication, proxy trust and allowed-origin configuration when eventually preparing production; the review profile intentionally does not read it.

Build the isolated image and inspect its resolved configuration:

```sh
docker compose -f deploy/correction-vps-compose.yml config
docker compose -f deploy/correction-vps-compose.yml build world
```

Start with an empty review volume only when a new disposable world is intended:

```sh
docker compose -f deploy/correction-vps-compose.yml up -d world
curl --fail http://127.0.0.1:18787/health
docker compose -f deploy/correction-vps-compose.yml stop world
```

The bind is loopback only. A reverse proxy, real HTTPS/WSS hostname, origin policy and owner review are separate deployment steps. This package does not configure DNS/TLS or host a backend. No contract changes or payments are needed.

## Validate a copy of an existing world

1. The owner obtains a consistent backup with the existing authenticated backup endpoint, or stops the writer and runs its backup CLI. Retain an immutable original independently. Do not copy files while the service appends/rotates logs, and do not point these review commands at production.
2. Set `REVIEW_BACKUP` to the absolute directory of that copied, checksummed backup. It contains `manifest.json`, snapshots and logs, not merely `world.json`. Do not use the source archive as a data backup.
3. Stop the review writer before restoring. The existing restore CLI verifies checksums and refuses a live writer. Restore only into this profile's dedicated review volume:

```sh
docker compose -f deploy/correction-vps-compose.yml stop world
docker compose -f deploy/correction-vps-compose.yml run --rm --no-deps \
  -v "${REVIEW_BACKUP:?set an absolute copied backup directory}:/review-backup:ro" \
  world node bin/restore.js /review-backup
docker compose -f deploy/correction-vps-compose.yml up -d world
curl --fail http://127.0.0.1:18787/api/status
docker compose -f deploy/correction-vps-compose.yml logs --tail=100 world
```

Record world id, tick, seed, population, family/relationships, wallet memory and history before/after. Normal startup applies the existing bounded downtime policy; simulated time may advance. For exact same-time comparisons use the automated tests' injected clock and disabled catch-up, rather than mistaking elapsed time for a reset.

Schema 2 → 3 migration adds mode/interface metadata without erasing linear weights, world RNG, identity, memories or relationships. Existing schema 3 needs no new schema migration. The correction adds bounded optional inspection/outcome metadata. Unsupported future schemas remain refused. No snapshot deletion, seed change or population reseeding is required.

On the review copy, activate explicitly only after validating legacy:

```sh
STRATOKS_REVIEW_BRAIN_MODE=mb-v1 docker compose -f deploy/correction-vps-compose.yml up -d --force-recreate world
```

To test controls, substitute `mb-v1-frozen` or `mb-v1-ablated`. Both preserve circuit matrices/counters. Frozen uses retained outputs; ablated suppresses them. Revert with explicit `STRATOKS_REVIEW_BRAIN_MODE=legacy`. No mode transition transfers learned knowledge between linear and circuit weights. An unset `BRAIN_MODE` in a direct server invocation keeps the stored mode; this review compose deliberately supplies legacy by default. In-flight actions cannot train a different mode after a switch. Wallet opinions retain their separate world `LEARNING` policy; `LEARNING=0` freezes both policies and wallet learning without deleting existing memory.

Stop/start the review service and inspect the same world again. Test a stopped-volume backup and restore with the existing tools before production consideration:

```sh
docker compose -f deploy/correction-vps-compose.yml stop world
docker compose -f deploy/correction-vps-compose.yml run --rm --no-deps world node bin/backup.js --tar > review-backup.tar
```

Extract that backup into a new directory, verify its manifest, and repeat the copied-backup restore procedure. Do not extract onto the source backup or a running volume. The checksummed backup and legacy-export tests already ran on disposable stores here; Docker execution itself remains unverified.

Rolling back **policy** uses the corrected server with `BRAIN_MODE=legacy` and retains MB state. Running the older schema-2 binary requires the separately verified compatibility exporter and another stopped copy. Follow `docs/phase2a/MIGRATION.md`; do not hand-edit schema numbers or weaken checksum/schema checks.

## Qualify resource limits before claiming capacity

From the unpacked source on a native x86_64 Docker/cgroup v2 host:

```sh
node tests/load/correction-docker.mjs
node --test --test-reporter=tap --test-concurrency=2 tests/*.test.js
```

The benchmark builds its own image and runs isolated `--network none` containers with no host ports, mounts or production volumes. Each run contains the real Service, fsynced snapshots every 30 ticks, HTTP inspector polling, and multiple actual WebSocket clients. Ecology/births/deaths remain enabled. It checks `docker inspect` memory/swap/CPU settings plus cgroup `memory.max=536870912` and `cpu.max=75000 100000`, records memory events/peak and CPU throttling before/after, and removes each container. An OOM, wrong limit, architecture mismatch, client gap/disagreement or nonzero exit is a failure, not a capacity pass.

The matrix has all four policies × 24/100/250 creatures × 8 clients for 1,200 measured accelerated ticks after 300 warm-up ticks, mb-v1 at each population for 180 real-time ticks, and 250 creatures/32 clients accelerated. Runners write raw JSON and failure logs under `tests/results/correction/capacity/`; `--out=` selects another evidence directory. `--ticks=` and `--realtime-ticks=` allow short smoke tests. The real-time matrix takes about nine minutes plus accelerated work. The program's timers are normal benchmark operation, not required waiting before implementation.

This worker has no Docker executable and no writable cgroup delegation, so the delivered Docker runner/profile are **unverified**. The separate `--local` results document actual process runtime/RSS/CPU/tick latency but have no requested enforcement. No supported population/client ceiling on a 1 GB VPS is established. Even successful short runs do not establish whole-host headroom for the OS/proxy/backups, WAN behavior, a full lifespan or unbounded storage growth. Choose capacity only after the enforced matrix and a longer owner-observed soak pass.
