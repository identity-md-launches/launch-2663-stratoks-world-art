# Stratoks server ⇄ client interface (v1)

This is the agreed contract between the world server (`server/`) and the static browser client. The server is the only authority. Sample payloads produced by the real server are in `shared/fixtures/` (use them as the client mock; they are labelled fixtures, not live data).

Base URL: configurable HTTPS (`https://host`) and WSS (`wss://host/ws`). Until configured the client must show **"World server not connected"** and no fabricated data. Local demo/test mode = server started with `DEMO_MODE=1` (accepts `http://localhost:*` origins; `/api/status` and the snapshot carry `demoMode: true`, the client must label it).

## Public read (CORS: only origins in `ALLOWED_ORIGINS`)
| Route | Result |
|---|---|
| `GET /health` | `{ok,tick,status,overloaded}` |
| `GET /api/status` | health + metrics: `tickLatencyMs{p50,p95,p99,max,budget}`, `lagMs`, `overloaded`, `cpuPercent`, `rssMB`, `clients`, `population`, `world{...}`, `demoMode`, `learning`, `learningPolicy{enabled,configured,source,action,policy,log}` |
| `GET /api/world` | full snapshot (same as WS `snapshot`) |
| `GET /api/creatures` / `GET /api/creatures/:id` | compact list / inspector detail (needs, personality, relationships, memories, decisions, speech, wallet opinions, weights). Dead id → `{dead:true,cause,...}` |
| `GET /api/events?after=SEQ&limit=N` | cursor page: `{events[], latestSeq, committedSeq, epoch, nextAfter, hasMore, gap, source}`, events with `seq > after` ascending through the durable `committedSeq`. `after` integer 0..2^53-1 (default 0), `limit` integer 1..500 (default 100); anything else → 400 `bad_after`/`bad_limit`. Pass `nextAfter` as the next `after`; reset a retained cursor if `epoch` changes. `gap:{requestedAfter,oldestAvailableSeq}` when older events were rotated away (retention: live log + 2 rotated 5 MB files). Served from the memory ring or a bounded indexed log read; 503 `event_history_busy` + `Retry-After` when the concurrent-read cap is hit. |
| `GET /api/history?limit=N` | population/resource series, one point per 30 ticks |
| `GET /api/graveyard` | recorded deaths with cause |

## WebSocket `/ws[?after=SEQ]`
First message `snapshot`: `{type,n,tick,seq,liveSeq,epoch,serverTime,world{worldId,status,width,height,tiles[],tickMs,population,...},entities[],events[],history[],health,demoMode}`.
Then one `delta` per broadcast: `{type,n,tick,seq,liveSeq,epoch,serverTime,upsert[],remove[],events[],meta,health}`. `seq` and events never exceed the durable commit point; `liveSeq` is presentation-only current simulation state.
* Entities are keyed by `k`: `c:` creature, `b:` bush, `t:` tree, `s:` stone node, `h:` shelter (`stage` 0..3, `progress`, `integrity`), `f:` fire, `z:` storm, `v:` visitor, `p:` worn path tile.
* `n` increases by exactly 1 per message. If `n` skips, or `epoch` changes, send `{"type":"resync","after":lastSeq}` (or reconnect with `?after=`) and replace local state with the new snapshot.
* Events carry a unique, increasing `seq`; clients de-duplicate by `seq`. Types: `world_created, birth, death(cause), pregnancy, miscarriage, bond, bond_end, shelter_started, shelter_stage, shelter_complete, shelter_destroyed, intervention, fire_end, storm_end, visitor_gift, visitor_harm, bush_died, downtime, extinction, reset, learning_changed`.
* Rate limits: every public `GET` except `/health` (including `/api/creatures/:id`) and the WS upgrade/resync snapshot path share one per-client fixed-window limit (default 600/min, `server.rateLimit`), checked before any serialization. HTTP 429 bodies are `{error:"rate_limited",retryAfterSec,limit,windowMs}` with a `Retry-After` header; an already-upgraded throttled socket closes with 1013.
* Client → server: `{"type":"ping"}`, `{"type":"resync","after":N}`.
* Creature bubbles: `bubble{text,emote,kind:"template",tpl,cause}` – always template-generated, show an honest label.
* `world.status` is `alive` or `extinct`.
* Under overload the server thins broadcasts (the world slows down); it never removes creatures.

## Wallet sign-in
1. `POST /api/auth/nonce {address}` (Origin header must be allowed) → `{nonce,message,expiresAt}`.
2. Wallet signs `message` with `personal_sign` (EIP-191). No transaction, no key leaves the wallet.
3. `POST /api/auth/verify {address,message,signature}` → `{token,role:"visitor"|"developer",address,expiresAt}`. Nonce is single-use, 5 min; message binds address+origin+expiry.
4. Send `Authorization: Bearer <token>` afterwards. Wallets are accounts, not unique people.

## Visitors (any signed-in wallet)
* `POST /api/visitor/presence {x,y}` – places the wallet's avatar (expires after 300 ticks without refresh).
* `POST /api/visitor/action {type:"gift_food"|"startle"}` – needs presence; per-wallet cooldowns (429 + `retryAfterTicks`); `startle` is capped per wallet and deals 3 damage to the nearest creature.

## Developer (role `developer` only; 401 without token, 403 for visitors)
* `POST /api/dev/interventions {id,type:"add_food"|"heal_area"|"fire"|"storm",x,y,radius,intensity}` – `id` is `[A-Za-z0-9_-]{8,64}`. Idempotency is scoped to (world, authenticated developer wallet, id). First call applies and returns `{duplicate:false,record}`; a retry by the same wallet with the same id and body returns `{duplicate:true,record}` and does nothing; same wallet + same id + different body → 409. A different developer wallet using the same id gets its own intervention attributed to it (`record.actor`), never the first wallet's record. The response is sent only after the snapshot containing the intervention is committed; if the save fails the answer is 503 `not_durable_retry_same_id` (outcome not yet durable; retrying the same id is safe and applies at most once). Limits (422/429) come from the `interventions` config block. Records have a `payment:null` slot reserved for confirmed IMD payments later; no money is collected.
* `GET /api/dev/interventions`, `POST /api/dev/backup`.
* `POST /api/dev/reset {confirm:"RESET <worldId>", seed?, initialSeedCount?}` – the only way to start a new world.

Errors: `{error:"code", ...}` with HTTP status.
