# Stratoks · Beyond the clearing

A responsive window into the Phase 2B Expanse: navigate the real chunked world, follow a resident, and compare its recorded observations and plans with actual outcomes. Viewing is free. The finished static export is in **`dist/`**; it works at a gateway subpath with relative asset URLs.

Open **Explore demo** for an isolated, temporary browser world, or **Connect server** for an owner-hosted Phase 2B backend. The export ships with no production server configured. Nothing was deployed or written to the live reference.

## Install, check and rebuild

Use Node 22.12+ (Node 24 was used for validation). The restored frontend manifest and lockfile are retained from the pinned release. The build helper stages source, dependencies and caches under `/tmp`, keeping installed packages out of the submission:

```sh
node web/scripts/task.mjs install
node web/scripts/task.mjs typecheck
node web/scripts/task.mjs test
node web/scripts/task.mjs build
node web/scripts/preview.mjs 4173
```

Open `http://127.0.0.1:4173/preview/`. The publisher serves committed `dist/`; it does not rebuild. To rebuild using an ordinary local installation instead, run `npm ci`, `npm run typecheck` and `npm run build` inside `web/`. Vite writes `../dist/` with `base: './'`. Do not include installed packages or caches in a submission.

Backend regression checks, with no runtime dependencies:

```sh
node --test --test-concurrency=2 tests/*.test.js
```

Browser interaction validation starts and closes its own static server and disposable Expanse server. It does not contact production:

```sh
STRATOKS_TOOLS=$(node web/scripts/task.mjs path)
node "$STRATOKS_TOOLS/node_modules/playwright/cli.js" install chromium webkit
node web/scripts/check-expanse.mjs /tmp/stratoks-chromium chromium
node web/scripts/check-expanse.mjs /tmp/stratoks-webkit webkit
```

Playwright needs its platform libraries. The validation machine used temporary libraries and software rendering for WebKit; none are shipped. See [validation](artifacts/phase2b/VALIDATION.md) for exact results, coverage and limitations.

## Explore and inspect

- Drag or use arrow keys on the map to pan; use the wheel, buttons or `+`/`−` keys to zoom. The minimap supports clicking and arrow keys. Manual navigation stops following.
- Select a creature on the map or from **Residents**. **Follow creature** tracks its actual position. Searching the roster does not change the simulation.
- **Plans** shows selected sequences, model support, uncertainty, mb-v1 preference and measured outcomes. Unknown actions are labeled **Untested prior**. Pending and unexecuted steps have no fabricated outcome.
- **Perception** shows the last recorded decision observation and its tick, not an omniscient current view. Its overlay marks that historical perception range. The observer’s map and roster are broader than an agent’s knowledge.
- **Learning** shows actual inventories, bounded model/map counters, discoveries, episodes and social opinions. Download the actual inspector JSON with the download control.
- **Discoveries** exposes the latest 200 engine records, including origin, tick and whether the creature previously observed the combination. **Social** exposes the latest 100 social outcomes. Empty histories stay empty.

The atlas colors the **representative biome at each materialized chunk’s center**. Gray means unmaterialized, not “unexplored by every creature.” Observer navigation itself can materialize terrain. Cold and coast are now distinct in the API’s additive `minimap.biomes` field; the ambiguous legacy letter field remains for compatibility.

## Connect the authoritative backend

The complete `server/`, `shared/`, tests and deployment source from accepted work remain in this repository. The core world, learning, material and persistence engines are unchanged by this integration.

For a disposable local world, set `EXPANSE_DATA_DIR` to a directory outside the repository, `ALLOWED_ORIGINS` to the preview origin, and run:

```sh
EXPANSE_DATA_DIR=/tmp/stratoks-owner-preview ALLOWED_ORIGINS=http://127.0.0.1:4173 node server/src/expanse/server.js
```

Enter `http://127.0.0.1:8788` in **Connect server**. Shared state lives on this server and ticks without viewers. Remote connections require HTTPS; local HTTP is accepted only from HTTP previews. The browser polls `/api/expanse/frame` once a second, one request at a time, with cancellation, timeout and retry. Each frame includes a coherent viewport, roster, histories and selected inspector at one server tick. There is no new write API.

For a hosted default, set `httpUrl` in `web/public/expanse-config.json` and rebuild, or configure it in the client (saved in browser storage). `?server=<URL-encoded HTTPS base URL>` also selects a server; `?demo=1` explicitly opens an isolated demo. A backend mounted below a URL prefix is supported if the reverse proxy strips that prefix.

The **Settlement** route (`#settlement`, also linked in the mobile footer) preserves the pinned 56 × 56 client, HTTPS/WSS configuration, free viewing, wallet sign-in, learning lab and existing developer authorization. It uses its own settings and service. This Expanse integration uses HTTPS polling, not WebSocket streaming. The legacy and Expanse services do not share a writable world or dual-write; migration must be explicit.

Docker, copied-world migration, backup/restore and rollback instructions are in [deployment](deploy/expanse/CLIENT-DEPLOYMENT.md). Owner deployment follows review; no production access is required for this export.

## What was actually verified

Production build and typecheck pass. The backend suite passes **157/157**; client and transport tests pass **20/20**. Both Chromium and WebKit pass the interaction suite, including two independent browser contexts receiving identical server evidence, navigation beyond the original settlement, demo isolation, stale-frame handling and restart/reconnect. Automated accessibility scans report no violations in the tested preview and shared inspector states. The final taste probe passes **16/16** checks at 320, 390 and 1440 widths.

Raw results and browser screenshots are in [artifacts/phase2b](artifacts/phase2b/VALIDATION.md). [DESIGN.md](DESIGN.md) documents the implemented design. New full-frame capacity results and inherited scientific experiment limits are documented in [results](artifacts/phase2b/RESULTS.md). These are worker checks, not independent certification.

## Scope, provenance and limits

Pinned client baseline: `identity-md-launches/launch-2613-stratoks-phase-integrate-scientifically`, commit `8d4193ef8dc76cfcb1794f719e1a688e4355a01d`. This working tree already contained its backend plus the accepted Expanse foundation. The missing `web/` source and lockfile were restored, then extended; prior backend fixes and tests are preserved. [Source provenance](artifacts/phase2b/PROVENANCE.json) records the import.

The browser demo runs the same Expanse engine at up to four ticks a second in a worker, starting at tick zero with no guaranteed discoveries. It has no networked world API and is discarded on exit. Its Node snapshot serialization is deliberately not used; authoritative durable worlds belong to the backend.

No new contracts, tokens, payments, paid API, LLM or GPU runtime dependency were added. Learned quantities are the bounded action outcome model and mb-v1 weights. Physics, recipes, primitives, reflexes, drives and planner search remain designed. This is not a complete fly brain, consciousness or human intelligence.

The wider Phase 2B ecology still has documented failures: cold survival can be worse with planning, shelter construction was absent in the inherited discovery experiments, and water-source learning needs improvement. The integration does not establish an ARM64 capacity limit, unrestricted invention or full social reasoning. Physical-device, screen-reader and live owner deployment checks remain unperformed. An independent review of the platform’s final commit is still required before deployment; this worker did not create or independently review that commit.

Licenses: [client and art](docs/licenses/client-and-art.txt), [Manrope](docs/licenses/manrope.txt), [dependency notices](web/public/licenses/THIRD_PARTY_NOTICES.txt), and [Better Interface / Impeccable guidance](docs/licenses/better-interface.txt). Existing backend and scientific source notices remain in their original files.
