# Phase 2B integration validation

| Area | Final worker result |
| --- | --- |
| Scoped requirements | 12 met, 0 missing, 0 faked |
| Known broken primary interactions | 0 in the tested states |
| Product and main action on first 390px screen | Yes; demo action bottom at about 247px |
| taste@1 | 16 / 16 checks pass |
| Unresolved copy findings | 0 in the new interface |
| Share metadata | Title, description, favicon, og:title and local og:image present |

**Complete for the stated client integration scope.** This is worker evidence, not independent network certification. Final platform-commit review and owner deployment happen afterwards and were not performed here. The larger scientific/host rollout still has the concrete limits below.

## Scope and assumptions

The accepted working tree already contained the corrected Phase 2A backend and Expanse foundation. The pinned client source and lockfile were restored, with the current Expanse added as the default route. The original settlement/auth/learning client remains at `#settlement`. No runtime owner address or secret is needed; an owner-settable server URL is provided, initially empty. The unconnected first screen is labeled terrain preview, without residents, running counters or fake events. The optional browser demo runs the real engine from tick zero, with no scheduled success, and cannot write to a shared server.

The visual authority is the pinned client’s existing Manrope/paper/forest palette and mascot. The pinned Better Interface workflow and all six core domains were read before implementation. `DESIGN.md` documents the final source values; guidance attribution and both licenses are retained in `docs/licenses/better-interface.txt`.

## Acceptance coverage

| Requirement | Status and evidence |
| --- | --- |
| “a usable website … working primary interactions and responsive layouts” | Met: both browser suites, reflow at 320/390/768/1440. |
| “dist/index.html and its assets … alongside source and lockfile” | Met: committed export, restored `web/`, pinned manifest/lock; Vite `base: './'`. |
| “production build, typecheck … useful interaction validation” | Met: raw command output and actual browser results included. |
| “pinned Better Interface … six domains … fixes … coverage” | Met: consolidated review below and `DESIGN.md`. |
| “first screen at 390 … product and main action … metadata” | Met: both engines’ `preview-390.jpg` and taste share check. |
| “DESIGN.md … tokens, typography, components and responsive behavior” | Met: source-derived root document. |
| “README … install, preview and rebuild” | Met: root README, normal install and outside-tree helper. |
| “real large-world navigation” | Met: actual negative-coordinate terrain, bounded viewport, wheel/button/key zoom, minimap, home and follow. |
| “truthful creature plan/discovery inspectors” | Met: downloads equal server JSON; current/recent steps, support, uncertainty, failures, absent outcomes and actual discovery origins. |
| “Preserve the full backend source” | Met: core simulation, brain, material, persistence and legacy service source retained; additive view/service changes only, plus Docker data-directory ownership. |
| “configurable server and isolated demos” | Met: URL validation, owner config file, separate settings/storage, worker engine with no shared API traffic. |
| “verify two-client synchronization” | Met: independent browser contexts in each engine; same tick/evidence before and after transitions, then restart/reconnect. |

IMD publication follows delivery of committed `dist/`. No publishing or production write command was run.

## Six-domain review

| Domain | Coverage, evidence and limits |
| --- | --- |
| Accessibility | Checked native controls, names, landmarks, pressed/disabled state, meters, labeled URL/search inputs, modal Escape/focus return, keyboard map and minimap, roster alternative, reduced motion and axe scans. Preview and shared inspector scans report 0 violations in each engine. Screen-reader sessions and physical devices not reviewed. Focus-ring visibility is checked on the recorded keyboard map state, not every possible artwork pixel. |
| Layout | Checked rendered 320/390/768/1440, map/inspector/atlas stacking, long plan/resource keys, search empty state, modal and scroll access. Both engines assert no page overflow. Native 200% browser zoom, pseudo-localized text and RTL mirroring not reviewed; no localized interface is claimed. |
| Writing | Checked preview/demo/shared/stale labels, plain actions, next-step errors, bounded-history explanations, historical observation ticks and designed-versus-learned description. No fake speech, guaranteed success, live-looking sample counts or intelligence claims. Existing settlement copy retained. |
| Typography | Checked single local Manrope face, six token sizes, three used weights, wrapping, dense evidence and 16px phone inputs. Local font assets resolve and fonts are awaited in browser checks. No separate physical Safari font rendering review or translated text check. |
| Colors | Source tokens preserved. The final probe passes its rendered solid-background contrast check; six declared solid pairs are additionally calculated in `raw/stratoks-contrast.json`. Map/atlas focus uses a paper backing beneath the ring. Canvas artwork and arbitrary blended pixels are not blanket-certified. Need meters distinguish high hunger/thirst from high health/energy/warmth. |
| UI | Checked loading, actual empty data, selection/follow, predictions/results, disclosure, pause, connection error/retry and restart recovery. Quiet borders and tonal groups, one filled initial action, 44px map controls and reduced-motion guards. No staged or endless animation exists in the Expanse; a 10%-speed animation-panel walk was not applicable. |

## Findings, fixes and rechecks

Locations refer to final source, rather than built bundles. These findings were consolidated during implementation; none of the listed primary defects remains open.

| Finding | Source and evidence | Correction / recheck |
| --- | --- | --- |
| High: existing working tree lacked its website source/export | `web/src/Router.tsx:1`, `web/vite.config.ts:8`; initial tree had backend only. | Restore the pinned client and lockfile, add Expanse and root export. Typecheck, build and both browser suites pass. |
| High: letter-based atlas conflated cold/coast | `server/src/expanse/view.js:24`, `minimap`; both legacy values were “c”. | Add exact `biomes` representatives, retain legacy letters; new atlas uses full names. API test checks biome vocabulary and navigation reads actual tiles. |
| High: viewer requests could otherwise mix tick evidence | `server/src/expanse/view.js:44`, `frame`; separate view/inspector calls can cross ticks. | One synchronous GET frame. Independent client downloads match the authoritative inspector exactly. |
| Medium: selected current-plan payload omitted provenance fields | `server/src/expanse/view.js:28`, `inspect`; tick, alternatives, index and planner version were missing. | Expose recorded fields, no recomputation. UI labels source/prior/pending/unexecuted; recent outcomes are checked against actual rewards. |
| High: logo accessible name did not include its visible subtitle | `web/src/expanse/App.tsx:68`, `.exp-brand`; first axe run reported `label-content-name-mismatch`. | Remove overriding aria-label and use native link text. Both final scans have 0 violations. |
| High: Safari record tabs exceeded 320px by about 2px | `web/src/expanse/expanse.css:174`, final 360px media rule; WebKit diagnostics identified the Social button at x≈322. | Hide redundant icons and tighten padding only at 360px and below. WebKit and Chromium final 320px reflow pass. |
| Medium: selecting a resident left its inspector above the current scroll | `web/src/expanse/App.tsx:62`, `select`; observed on phone and desktop after scrolling the roster. | Bring inspector into view and focus its heading; show an honest loading state until evidence arrives. Mobile interaction assertion passes in both engines. |
| Medium: inherited generic label/input styles added spacing and a nested search border | `web/src/main.tsx:6`, `web/src/expanse/expanse.css:79` / `:128`, `.exp-needs` / `.exp-search`; rendered/source inspection found inherited label margins. | Load base CSS first, reset scoped margins and field decoration. Final screenshots and overflow checks confirm the adjusted component. |
| Medium: dense needs could visually imply high hunger is healthy | `web/src/expanse/Inspector.tsx:34`, need meters. | Native low/high/optimum semantics reverse hunger/thirst polarity; actual values remain unchanged and labeled. Final build/browser scans pass. |
| Medium: a single map focus color crosses varying terrain | `web/src/expanse/expanse.css:48` / `:153`, canvas/minimap focus rules. | Add paper inset behind the existing 3px ring, preserve forced-colors outline. Keyboard screenshot retained and reviewed; no all-artwork contrast claim. |
| High: legacy public viewport accepted non-finite or enormous coordinates | `server/src/expanse/view.js:7`; `NaN` could poison chunk keys and `1e300` could prevent loop progress. | Bound dimensions/coordinates before spatial queries. HTTP regression covers NaN, Infinity and enormous finite inputs; all 157 backend checks pass. |

## Commands and actual results

All new installations, temporary worlds, package caches and library archives stayed under `/tmp`. Existing manifests and lockfiles are unchanged. The new root `.gitignore` narrowly includes `artifacts/phase2b/**` with a 2 MiB path budget, while excluding installed packages and caches at every depth; no other artifact directory is admitted.

| Command | Result / raw evidence |
| --- | --- |
| `node web/scripts/task.mjs typecheck` | Pass, exit 0; `raw/typecheck.txt`. |
| `node web/scripts/task.mjs build` | Pass, exit 0; `raw/build.txt`. Node-only `fs` and a wallet dependency’s `worker_threads` emit browser externalization notices. These paths are not used by the isolated engine flow; both runtime suites have no script errors. |
| `node --test --test-concurrency=2 tests/*.test.js` | 157 / 157 pass, including 3 new frame/integration tests; `raw/backend.tap`. |
| `node web/scripts/task.mjs test` | 17 restored client tests and 3 transport tests pass; `raw/client.tap`. |
| `node web/scripts/check-expanse.mjs <out> chromium` | Pass; `chromium/checks.json`, `raw/chromium.txt`. |
| `node web/scripts/check-expanse.mjs <out> webkit` | Pass with temporary platform libraries and software rendering; `webkit/checks.json`, `raw/webkit.txt`. |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | 16 / 16 pass, using installed Playwright selected by `IMD_PLAYWRIGHT`; `raw/taste.json`. |
| Full-frame benchmark at 24/100/250 × 10000 ticks | Complete, 8 serializations every tick. Raw JSON/logs and measured limits in `RESULTS.md`. |
| `git diff --check` and bundle inspection | Checked; final release manifest records allowed added/modified paths and byte count. No installed dependencies, caches, submodules or archives added. |

The final helper commands ran sequentially because they share a temporary staging tree. A concurrent typecheck attempt collided with staging-copy operations; the sequential rerun passed. A new reward assertion initially depended on rendered whitespace; it was corrected to compare the numeric element directly, then both complete browser suites passed. Neither incident is hidden as a product success.

Both browser probes use headless production engines and the committed static export at a real URL subpath. The exact WebKit run also set `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`, `LIBGL_ALWAYS_SOFTWARE=1` and `EGL_PLATFORM=surfaceless`, with required shared libraries extracted into temporary storage. This bypasses the installer’s host-library check, not a browser test assertion. The engine actually rendered and ran the complete interactions. Docker was unavailable and no image-build success is claimed.

Browser checks deliberately stop the test backend. The recorded `ERR_CONNECTION_REFUSED`/equivalent GETs during that outage are expected and retained, followed by successful reconnect. There are no failed static asset requests or browser runtime errors in the final suites.

## Browser evidence

Each of `chromium/` and `webkit/` includes:

- `preview-390.jpg`, `preview-1440.jpg`: actual final first screens.
- `demo-inspector-390.jpg`: isolated real engine and mobile selection.
- `keyboard-map-1440.jpg`: focused map after keyboard navigation.
- `shared-world-1440.jpg`, `shared-inspector-390.jpg`: authoritative data and selected evidence.
- `discovery-history-1440.jpg`, `discoveries.json`: actual seed-303 discoveries through tick 1200, without inserting an event or forcing a successful creature.
- `shared-inspector.json`, `checks.json`: raw inspector and recorded results.

The assigned browser tool also inspected the actual export at 390 and 1440 and exercised demo selection/perception/plans. Its accessibility snapshot was not treated as a screen-reader session. Screenshots and measurements describe the final export, not a mockup.

## Remaining limits and review handoff

The Expanse uses HTTPS polling; WSS remains a capability of the preserved settlement service. Atlas cells are coarse representatives, observer navigation can materialize terrain, and individual creature observations are historical/bounded. The browser demo is ephemeral, uses button/wheel/key zoom rather than pinch, and does not claim persistent restart. The public frame carries the full roster and has no additional Expanse read-rate limiter.

The current 8-observer benchmark is serialization work, not eight networked browsers. Docker, ARM64 CPU/RAM ceilings, HTTPS proxy deployment, production storage and real phones remain unverified. Wider discovery/ecology results are inherited with their pre-`carry` limitation; they do not establish cold survival, shelter learning or robust water learning. See `RESULTS.md` and the preserved historical report.

No separate reviewing agent was available in this session, and repository `.git/` was outside write scope. The platform assigns the final Git commit after collection. `RELEASE.json` pins the submitted source/export files; a source review is documented in `REVIEW.md`, but **independent review of the exact final commit remains pending**. Owner deployment must follow that review. No commit ID or certification has been invented.
