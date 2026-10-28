# Phase 1.1 revision evidence

This revision repairs the reopened server findings against the current source revision. It does not publish or alter the browser client; this bounded revision is the server/durability and deployment-package component.

| Finding | Fix and files | Reproduction before → after |
|---|---|---|
| `4bcd496…` failed intervention history append | `server/src/service.js`, `server/src/store.js`, `server/src/world.js` retain lifecycle, intervention and event queues until a complete append succeeds; append errors roll partial bytes back and short writes are completed. | One-shot `ENOSPC` on either `events.jsonl` or `interventions.jsonl`: before, first POST could fail and a same-ID retry acknowledged an incomplete history; after, first POST is `503 not_durable_retry_same_id`, retry is a duplicate only after exactly one event and ledger line are durable. Covered by `tests/repair.test.js` and `tests/durability.test.js`. |
| `03f1dc…` Phase-1 lost branch recovery | `server/src/store.js`, `server/docs/DURABILITY.md`, `server/bin/check-history.js` | Before, startup retained the prefix of a lost branch and orphaned the later surviving branch. Now it detects a sequence rewind before changing any log and refuses with the exact non-destructive `check-history.js … --apply` remedy. The migration keeps the surviving branch and archives originals. |
| `05a98b…` overwritten recovery evidence | `server/src/store.js`, `server/docs/DURABILITY.md` | Before, a second uncommitted tail at the same snapshot sequence overwrote `recovery/*.after-S.orphaned`. Recovery now appends/fsyncs evidence; regression verifies both tails remain. |
| `49f1b0…` WebSocket resync limiter bypass | `server/src/http.js`, `tests/repair.test.js` | Before, upgrade and each resync performed full serialization outside the public GET bucket. Upgrade and every resync now use that exact per-IP bucket before serialization; a rate-limited upgrade receives HTTP 429 and an exhausted established socket closes 1013. |
| `18039d…` cursor reuse after crash | `server/src/service.js`, `server/src/store.js`, `server/docs/DURABILITY.md` | Before, API/WS could issue in-memory sequences ahead of the last snapshot, then reuse them after a restart. `/api/events`, snapshot and delta cursor fields now stop at `committedSeq`; an ephemeral `epoch` changes per process boot so clients can reset retained state. |
| `5ab5d6…` stale container PID locks | `server/src/store.js`, `server/bin/check-history.js`, `deploy/check-docker.sh`, `server/docs/DURABILITY.md` | New locks include PID namespace. Offline history migration/restore only reject a writer alive in the same namespace; legacy PID 1 matching the one-shot maintenance process is stale. The Docker smoke script now runs backup and `check-history --apply` after SIGKILL and before restart. |

## Measured history read regression

`tests/repair.test.js` built three event logs totaling 15,000,000 bytes (64,709 events), then made 40 `after=0&limit=1` requests at concurrency 4 while ticking the simulation. Results are recorded in [event-bounds.json](event-bounds.json): 65,536 bytes read/request, one parsed line/request, 303 ms total, tick p50/p99 1.19/9.86 ms, maximum event-loop delay 31.97 ms. Reads use an in-memory sparse index and positioned async reads; their request work is bounded by one 64 KiB chunk plus the page, not total retained history.

## Checks run

* `node --test tests/durability.test.js tests/repair.test.js` — 23 passing tests, including real SIGKILL boundaries, append errors, short writes, branch refusal, recovery evidence, public HTTP/WS limiting, cursor restart, learning policy, and actor-scoped idempotency.
* `node --test tests/service.test.js tests/sim.test.js tests/client-integration.test.js tests/wallet-auth.test.js tests/wallet-crosscheck.test.js` — 26 passing tests. The corrupt-snapshot fallback uses a controlled clock and explicitly asserts 30 catch-up ticks.
* `git diff --check` — clean.
* Docker/Compose could not be run here: `docker: command not found`. No ARM64, x86 Docker, emulation, TLS/WSS, persistent-volume, or container health claim is made. `deploy/check-docker.sh` is the runnable isolated check for a Docker host and now includes stopped-volume backup/history migration immediately after SIGKILL.

## Outstanding operator work

Run the provided Docker check on the target Ubuntu ARM64 VPS, configure the owner’s hostname/origins/wallets, and independently re-test the six rows above against this revision. Historical Phase-1 logs with a lost branch require the documented `check-history --apply` migration before this server starts; irrecoverable items reported by that tool remain intentionally operator-review items.
