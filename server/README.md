# Stratoks world server (Phase 1.1)

Authoritative, persistent, zero-dependency Node.js (>= 22) simulation service. It runs the world with or without browsers connected and exposes the simulation API/WebSocket protocol to the separately hosted static client.

* Contract: `../shared/protocol.md` · rules: `docs/WORLD.md` · learning: `docs/LEARNING.md`
* Deploy on your own Ubuntu ARM64 VPS: `../deploy/INSTALL.md`
* Current integration and recovery evidence: `../artifacts/phase-1.1/VALIDATION.md`. Earlier measurements in `../docs/VALIDATION.md` and `../tests/RESULTS.md` remain historical.
* Static client, build and preview: `../README.md` and `../web/`.
* IMD hosts only the static client; **this server is delivered as source and is not deployed by publishing the client.** There are no tokens, NFTs, contracts, pools or payments in this phase (the intervention record has an unused `payment` slot).

## Run locally (demo/test mode)
```
cd server
DEMO_MODE=1 DATA_DIR=./data node src/main.js     # http://localhost:8787, localhost origins accepted
npm test                                          # unit + integration tests
```
Layout: `src/world.js` (state, ecology, lifecycle), `actions.js` (decisions/actions), `brain.js` (learning), `speech.js`, `service.js` (tick loop, broadcast, overload), `http.js`/`ws.js`/`auth.js`/`wallet.js` (API, WebSocket, wallet signatures), `store.js`/`migrations.js` (persistence), `view.js` (render projection — the sim never imports it).

Configuration: `src/config.js` defaults < JSON at `$STRATOKS_CONFIG` < env (`PORT, DATA_DIR, ALLOWED_ORIGINS, DEV_WALLETS, TICK_MS, INITIAL_SEED_COUNT, WORLD_SEED, LEARNING, TRUST_PROXY, DEMO_MODE`).

Data directory: `world.json` (+`world.prev.json`, sha256-checked, atomic), `lifecycle.jsonl` (every birth/death with cause, append-only, ~150 B per record), `interventions.jsonl`, `events.jsonl*` (rotating, 5 MB × 3), `backups/`, `archive/`. A world is created exactly once; if world data exists but cannot be read the server refuses to start rather than creating a new one.

Assets: this component ships no art or audio, so there are no asset licenses to list; the client package owns them. All code in this directory is original.

Integration durability note: intervention IDs are retained for the lifetime of a world, including past 20,000 records. Mutation and backup acknowledgments require a successful snapshot. Monitor the growing lifecycle/intervention ledgers and snapshot size; keep offsite backups. These fixes are covered by `tests/client-integration.test.js`.

Phase 1.1: see `docs/DURABILITY.md` before upgrading an existing world. The snapshot commits world/RNG/learning state and intervention ownership; uncommitted log tails are preserved under `recovery/`. Explicit LEARNING changes apply on restart without erasing learned state. Event history uses bounded async pages with pinned log descriptors and streaming UTF-8 decoding. The standalone backup CLI now requires a stopped service; `node bin/backup.js --tar` exports the checksummed directory as a tar stream, while the authenticated in-process backup API remains safe online. From the repository root, run `node deploy/check-process.mjs` for the process smoke check.
