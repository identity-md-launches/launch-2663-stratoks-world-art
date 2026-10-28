# Client and service integration

## Authority and modes

`server/src/world.js` is the only simulation implementation. The VPS service owns persistent shared state. The client’s `WorldStore` is a rendering projection; it never predicts births, invents populations, caps population or deletes creatures for load management. The unconfigured canvas uses separately labeled procedural terrain with no creatures, live metrics or made-up events.

The private demo imports that same world/action/brain/view code into `web/src/demo.worker.ts`. Build-time `DEFAULTS` are injected by Vite, so there is no second ecological configuration to drift. It creates 24 creatures once, computes 900 real ticks, then runs in that browser’s worker. No shared-server credentials or fake wallet identity are involved. Its `local-demo` actor labels local interventions and is never sent to the service. The browser demo is deliberately ephemeral; persistent restart guarantees belong to the VPS.

## Rendering

`WorldCanvas.tsx` owns pointer capture, pinch, pan, keyboard navigation and accessible instructions. `renderer.ts` caches isometric terrain and draws depth-sorted original sprites at at most 30 FPS, with device-pixel ratio capped at 2. Walk interpolation uses received positions; eating, rest, work, carry, distress and speech use actual engine actions/needs/events. The real engine uses `go`/`do` phases and `GATHER_WOOD`, `GATHER_STONE`, `SOCIALIZE` action names. Missing updates freeze interpolation. Reduced motion disables cosmetic movement, while actual state can still update.

A native Residents list is the keyboard alternative to canvas selection. Native meters expose needs; SVG charts have textual descriptions and CSV export. DOM inspectors fetch actual detail from `/api/creatures/:id` or the demo worker.

## Transport and resynchronization

`service.ts` validates HTTPS/WSS URLs, with localhost HTTP/WS permitted only from local HTTP preview. It opens `/ws?after=lastSeq`. A `snapshot` replaces the entity map. A `delta` must have `n == previousN + 1`; otherwise it is withheld and the client requests a snapshot. A changed world ID requests events from sequence zero and clears selected identities. Restoring an earlier snapshot discards events from the abandoned timeline.

Events merge by `seq`, with the newest 500 retained in the client. History comes from the snapshot and refreshes from `/api/history` every 15 seconds. A connection receives an application ping every 5 seconds. A silent connection is closed after at least 15 seconds (or four configured tick periods). Reconnect backs off from 1 second to at most 15 seconds. No reconnect path starts a demo or fabricates fresh data.

The inspector polls details every 2.5 seconds while open. HTTP calls time out after 10 seconds. Last received update time is visibly distinct from the server’s tick. Reconnect status can show a frozen last view; it does not claim that the last-known server health is current. After reset, old selected creature IDs and tools panels are cleared.

The two configured URLs must lead to the same service. The current protocol does not cryptographically bind a separate HTTP origin to its WSS origin; operators must configure them consistently.

## Accounts and interventions

The client uses wagmi discovery and injected connectors, plus the Coinbase SDK. Mobile app-browser links are constructed from the current URL; there is no WalletConnect relay or project ID. No chain RPC is called by the unconnected page. The configured mainnet is wallet-connector metadata, not a payment/contract chain.

Sign-in obtains a nonce and origin/address-bound message. The client checks these bindings before signing; the server checks the signature, expiry and single-use nonce. The bearer session stays in memory, expires, and clears on account/connection changes. Private keys never reach the application server. The browser integration uses a randomly generated, ephemeral viem test account to independently cross-check the server’s signature recovery.

Connection is separate from authentication. Coinbase smart accounts may connect, but EIP-1271/EIP-6492 verification is absent in the delivered server; unsupported signatures get a clear message. No signing, switching, passkey or external-wallet success is claimed beyond the synthetic provider integration test.

Visitor presence and actions require the session. Presence refreshes every 30 seconds while its panel is open; server TTL/cooldowns are authoritative. Developer tools require the server-returned `developer` role; the server rejects anonymous and visitor requests independently of the UI.

An intervention gets a `crypto.randomUUID()` before dispatch. The request body and ID are retained in session storage under the service URL/world ID until a known result, including across panel navigation/reload. No bearer token is stored there. Network failure or 5xx preserves the body for an exact retry. A 4xx denial clears it. The pending request is displayed with its type, position, radius, intensity and ID. Destructive first submissions require explicit confirmation. The browser never retries a mutation using a newly generated ID automatically.

The server keeps the complete ID registry for each world, scoped to the lowercase authenticated actor. Its intervention and backup API requires a successful snapshot before acknowledging. The delivery adds regression tests for snapshot failures and retries past 20,000 accepted records. The existing durable `payment: null` slot is preserved; nothing collects money.

Phase 1.1 stores pending requests under `stratoks-pending-v2:<service>:<world>:<lowercase actor>`. Tools remounts on actor/server/world changes. The original actor can reload, sign in and retry; another actor never inherits that request. Unknown-owner legacy browser IDs are displayed without a replay control and block new actions until reviewed/dismissed. A failed retry cannot clear an earlier uncertain outcome merely because the new response is 401/403/429.

Saved history uses `/api/events?after=N&limit=100`; only one archived page is retained/rendered, separately from the 500-event live store. Next uses `nextAfter` unchanged; a gap notice reports removed history. Errors preserve the displayed page and retry the requested cursor. World changes and sequence rollback clear the archive; snapshots also discard abandoned live events when only `seq` rewinds within the same tick. Inspector polling backs off to the API's `retryAfterSec` and supports explicit retry after a 429 window.

## Static hosting

`dist/` contains HTML, hashed JS/CSS, the worker, one local WOFF2, favicon, share image, wallet marks and an empty service configuration. Assets use relative URLs and there are no pathname routes needing rewrites. The client was exercised at `/preview/`, not only origin root. Secrets never belong in static configuration.
