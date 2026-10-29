# STRATOKS world art and interface validation

This is the worker's measured report for the rebuilt `dist/`, not independent certification. Scope is the frontend from pinned `fc1df0f9e641d05b7e32e1c96cb1b963e61576aa`, building on the accepted original atlas contribution. Server, shared simulation, tests, deployment source, dependencies and build configuration were preserved. No owner VPS deployment or second shared world was performed.

## Completion and scope

Complete for the frontend implementation and local review scope. Direct IMD CLI publication was refused (exit 2): the tool states that job websites are hosted by the plane after submission, rather than on the contributor’s personal-site route. The tested export is ready for that automatic step; no worker-published URL is claimed. See `publication.json`. The static review deliberately starts as a **recorded preview**, because a direct browser read of the owner service is blocked by CORS. The actual live API was exercised through a test-only read-only Playwright route proxy. That proxy is not part of the application or export. Recorded, live and private demo are never silently substituted for one another.

The implemented idea is a bright, painted miniature living world surrounded by a compact dark moss observer HUD. Source and prebuilt export are delivered together, with a compressed source patch against the pinned commit. `.git/` was not modified; the patch is the review-branch installation path allowed under the task's restriction.

| Area | Observed result |
| --- | --- |
| Functional illustrated world | 134 transparent registered sprites integrated in the real canvas renderer |
| Product/main action at 390 | Yes; map and Explore demo are on the first screen |
| Production build / typecheck | Both exit 0 |
| Client tests | 17 passed |
| Expanse tests | 7 passed, including projection and appearance gates |
| Browser flow | Chromium at 320, 390, 851 and 1440; WebKit mobile; no unexpected JS/resource errors |
| Picking | 12 browser zoom/chunk combinations plus numeric invariants across all tested aspects |
| Design probe | 16/16 checks passed |
| Accessibility scan | 0 axe violations in the tested recorded mobile view |
| Public live connection | Blocked cross-origin; accurately labeled fallback and runtime owner configuration supplied |
| IMD review publication | After submission by the plane; direct job publication refused by CLI |
| Owner VPS / simulation changes | None |

## Commands actually run

- `cd web && npm ci --ignore-scripts --cache /tmp/stratoks-npm-cache --no-audit --no-fund` — installed the unchanged locked dependencies.
- `cd web && npm run typecheck` — exit 0; see `typecheck.txt`.
- `cd web && npm test` — 17/17 passed; learning, stored requests, service errors, snapshots/deltas and reconnect/recovery behavior.
- `cd web && npx tsx --test src/expanse/*.test.ts` — 7/7 passed: inverse/basis projection, negative/chunk coordinates, API coverage, pointer-centered zoom, minimap round trips, confirmed appearance gates, transport configuration and incompatible frames.
- `cd web && npm run build` — exit 0 after the final source change; see `build.txt`. Existing Node-module externalization warnings remain; the built private worker and live client both ran without JS errors.
- `PYTHONPATH=/tmp/stratoks-art-tools python3 tools/art/prepare_renderer.py` — prepared the committed runtime atlases from committed raster masters.
- `PYTHONPATH=/tmp/stratoks-art-tools python3 tools/art/validate_renderer.py` — 134/134 safe rectangles, dimensions, hashes, alpha and anchors; see `atlas-check.txt`.
- `node web/scripts/overhaul-check.mjs --live` — completed against the production export at a local `/preview/` subpath. `browser-results.json` records actual outcomes.
- `node web/scripts/biomes-check.mjs` with the static preview serving — actual isolated worker cold/arid/coast frames, computed HUD contrast, loaded font, and a visible focused canvas; see `biomes-results.json`.
- `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` with `IMD_PLAYWRIGHT` pointing at the installed module — 16/16; copied result in `taste.json`.
- `git diff --exit-code fc1df0f9e641d05b7e32e1c96cb1b963e61576aa -- server shared tests deploy web/package.json web/package-lock.json web/vite.config.ts web/tsconfig.json` — exit 0. No backend regression-suite pass is claimed for this contribution; those sources did not change.

Playwright browsers, Python tools and WebKit/Mesa platform libraries were installed/extracted only under `/tmp`. WebKit needed software EGL and extracted libraries to start; it then completed the actual mobile demo/selection/follow flow. No browser binaries, libraries, caches, npm archives or installed dependencies are part of the submission. The source patch was applied to a fresh archive of the pinned commit and rebuilt; all exported static files matched byte for byte (`reproduction.json`). The ordinary rebuild only needs the existing npm lockfile; Python is optional for art regeneration. The wrapper's video encoder compressed the actual screen recording to VP9 at 12fps for delivery; this video encoding rate is not a performance claim about the renderer.

## Browser interactions and evidence

`browser-results.json` is the authoritative worker log for these observations. The actual export was served under `/preview/`, exercising relative assets, JSON configuration and module worker URLs. Chromium covered 320×844, 390×844, 851×1000 and 1440×900. The additional short landscape render is 851×393. WebKit covered the 390×844 private demo, roster selection and Follow.

Primary flow at each Chromium width: open the recorded scene; open/close world settings with Tab and Escape/focus return; search an actual captured resident by ID; select it; read Plans, expand Perception, show its historical range and expand Learning; Follow; stop following with keyboard pan; close the panel; zoom; and navigate the minimap. The private engine separately advanced, paused and resumed; Chromium touch events verified single-finger pan and two-finger pinch. A focused synthetic pinch regression also confirmed that ending a pinch over a resident does not select it and that a later intentional tap does. The retired `#settlement` route displayed the retirement notice with the shipped `legacyAvailable:false` configuration. No old wallet client was exposed.

Reduced motion produced an unchanged recorded-canvas image across two captures. The visual pause control and CSS preference guards were source-reviewed. The canvas keyboard focus was also visibly inspected through the provided browser tool, and captured in `focus-851.jpg`. Native modal Tab containment was sampled and focus return tested; exhaustive Tab-stop/screen-reader combinations were not tested. Inspector JSON download uses the retained download implementation; its source was checked, but no download was captured in this run.

Rendered screenshots (actual browser output):

- `recorded-390.jpg`, `recorded-851.jpg`, `recorded-1440.jpg`: first screen and main action.
- `inspector-390.jpg`, `inspector-1440.jpg`: responsive resident panel with actual captured evidence.
- `isolated-demo-390.jpg`, `webkit-demo-390.jpg`: explicitly private running engine.
- `landscape-851.jpg`: horizontal tools, zoom and collapsed atlas without clipped controls.
- `connection-blocked-390.jpg`: direct cross-origin failure with recorded fallback clearly labeled.
- `demo-cold-851.jpg`, `demo-arid-851.jpg`, `demo-coast-851.jpg`: actual private-worker terrain and resource nodes, including the supplemental art.
- `live-proxy-inspector-1280.jpg`: real API data, explicitly labeled read-only validation proxy.
- `live-interactions.webm`: actual live movement and all requested navigation/reconnect operations; no conceptual animation or synthetic population is substituted for this recording.

## Actual live observation

World ID **`world-20260101-0`** stayed the same. The recording read **10 coherent frames**, from tick **176465** to **176477**, with **152** living residents in the final frame and **121** common residents changing position. The selected resident was `Midu · #608 · gather`. The video shows selection, follow, keyboard pan, zoom, minimap navigation, an intentional 503 interruption retaining the last state, and Reconnect to the same world. These are reads of the existing owner service; no server process was started or configured.

The direct (unproxied) browser test separately returned `stale` and logged the browser's missing `Access-Control-Allow-Origin` error. The page kept its recorded scope and offered Reconnect. The default preview does not repeatedly claim to be connected. For owner installation, the runtime `startMode: "live"` setting enables the existing same-origin service. Cross-origin hosting requires the owner to allow its origin; that external policy remains unchanged.

## Synthetic performance, separate from live

These are **synthetic population fixtures**, not real ecology or a server-capacity result. Each uses 24/120/250/500 labeled fixture residents, the captured resource/shelter scenery, a 1440×900 Chromium viewport and DPR 1. No simulation rules or authoritative population were changed. Each RAF interval sample runs for approximately two seconds after settling; draw-time samples include initial terrain builds and subsequent cached frames. The renderer deliberately caps visual updates at **30 Hz**; browser RAF intervals do not establish game fps. No 60fps claim is made.

| Synthetic population | Draw samples | Median draw ms | p95 draw ms | Max draw ms (includes terrain rebuild) | p95 browser RAF interval ms | Drawn / culled objects |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 24 | 105 | 0.8 | 2.5 | 148.5 | 16.8 | 143 / 567 |
| 120 | 90 | 1.2 | 7.4 | 129.8 | 66.6 | 238 / 568 |
| 250 | 105 | 1.9 | 5.9 | 123.4 | 33.3 | 368 / 568 |
| 500 | 75 | 3.7 | 13.0 | 212.3 | 83.3 | 618 / 568 |

These short headless measurements have startup spikes and show degraded scheduling at 500 residents. They do not establish physical phone, long-session, GPU, high-DPR or server scalability. Offscreen terrain caching and sprite culling are active; cache rebuilds remain a limitation.

## Better Interface coverage across all six domains

The pinned guide and design critic references were read and applied during implementation. The brief's painted art, compact HUD and accurate simulation evidence remained the design authority. Wallet guidance is not applicable to this read-only interface; existing archived wallet source was preserved and deferred behind the disabled legacy route.

| Domain | Coverage and evidence | Not reviewed / limits |
| --- | --- | --- |
| Accessibility | Checked native controls/disclosures/dialog, labels, status landmark, icon names, keyboard map and roster route, visible focus, modal Escape/return, reduced motion, touch targets and axe. | No screen-reader session, physical device, exhaustive focus-stop walk, forced-colors render or native 200% zoom. |
| Layout | Checked the first-screen product/action at 390, all requested widths, 320 reflow, landscape, panel scrolling, inspector/map separation and minimap. No horizontal overflow or clipped tested controls. | No RTL mirror, localization/pseudo-localization or device safe-area hardware test. |
| Writing | Checked action labels, live/recorded/private scopes, errors/retry paths, pending/untested evidence and bounded count scopes. No invented speech, thoughts, friendships or leadership. | Engine-supplied names, resource keys and outcome text remain actual evidence, not rewritten scientific conclusions. |
| Typography | Checked six-size/three-weight scale, natural tracking, loaded local Manrope, system serif fallback, 16px inputs, wrapping names and tabular counters. Probe passed. | No guarantee about the specific system serif installed on another device. |
| Colors | Checked computed solid HUD foreground/background pairs, status text plus icons, primary fill, and the two-color focus ring. Probe passed its measurable pairs. | The probe explicitly leaves text over canvas/gradients unmeasured; all possible art-background combinations were not certified. |
| UI | Checked functional source controls, pressed/disabled/loading/error states, actual atlas usage, collapsible inspector, dialogs, restrained effects, visual pause and reduced motion. | No 10%-speed animation-panel session, physical-device gesture test or anatomically rigid animation certification. |

Measured from computed active HUD tokens (also in `biomes-results.json`):

| Foreground / background | Contrast |
| --- | ---: |
| `#f5efd9` / `#25362e` | 11.08:1 |
| `#bdc8b6` / `#25362e` | 7.35:1 |
| `#bdc8b6` / `#405347` | 4.75:1 |
| `#1d2b25` / `#e8c36e` | 8.75:1 |
| `#e8c36e` / `#1d2b25` | 8.75:1 |
| `#ffe1a0` / `#25362e` | 10.04:1 |

All of those pairs meet 4.5:1. The loaded Manrope face reported weight range `200 800`; the implemented UI uses 400, 600 and 800. The title uses the system serif stack and no downloaded serif is assumed.

## Findings, fixes and rechecks

1. **High, art: three building silhouettes reached packed cell edges.** `tools/art/prepare_renderer.py:49` (packing clamp and ground anchor). Now: generated platform/foot pivots could push a crop beyond its cell. Change: clamp complete silhouette placement within the gutter and record the adjusted cell-local ground anchor. Why: actual transparent reusable art cannot clip during filtering. Evidence/recheck: the initial bounds checker identified `se.build.0`, `sw.build.0` and `nw.build.0`; the final `validate_renderer.py` passes all 134 rectangles. Registered contact sheets and actual live/demo rendered frames were visually inspected; subtle generated shape variation remains and complete loop continuity is not certified.
2. **High, layout: zoom and tool groups overlapped in a short desktop viewport.** `web/src/expanse/expanse.css:1525` and `:1585`. Now: vertical groups could occupy the same lower-left space. Change: distinct tool/zoom zones, with horizontal compact controls and collapsed atlas in short landscape. Why: pan/zoom must remain available without clipped controls. Recheck: actual 1280×720 provided-browser inspection, 851×393 screenshot and browser control-bound checks passed.
3. **Medium, accessibility: status content sat outside a named landmark.** `web/src/expanse/App.tsx:320`, `role="region" aria-label="World status"`. Now: axe initially reported two status-strip nodes outside landmarks. Change: name the status region. Recheck: 0 axe violations in the recorded mobile state.
4. **High, accessibility: the canvas focus outline lay outside its clipped viewport.** `web/src/expanse/expanse.css:1695`, inset outline and gold/charcoal pseudo-element. Now: a normal outward outline could disappear at the canvas bounds. Change: keep the focus perimeter inside the canvas clip. Recheck: visible in the provided browser screenshot and `focus-851.jpg`; computed gold/charcoal pair is 8.75:1. Contrast against every possible underlying art pixel is not claimed.
5. **Medium, writing/accessibility: search needed a persistent visible label and invalid server fields needed focus.** `web/src/expanse/App.tsx:597` and `:859`. Change: bind Search residents to its input and focus the invalid URL field while exposing the inline error. Why: a disappearing placeholder is not a persistent label. Recheck: source labels/ARIA reviewed and search/selection/settings flows completed at all tested widths.
6. **Medium, source status: cross-origin installation cannot assume a live connection.** `web/public/expanse-config.json`, `web/src/expanse/App.tsx:257`. The external service's CORS restriction remains. Change: ship a clearly frozen recorded view, explicit private demo, readable connection failure/loading states and owner runtime configuration, with no silent fake live state. Recheck: direct browser request blocked as expected; proxy-only live validation observed actual movement and reconnect. This is an external limitation, not a claim that CORS was repaired.

7. **Medium, touch interaction: the final finger lift after a pinch could select a resident.** `web/src/expanse/Map.tsx:85` and its pointer-up handler. The original two-finger release reset the remaining gesture to an unmoved single pointer. A synthetic 390px browser probe ending over one known resident opened an inspector unexpectedly. Change: retain pinch suppression until all pointers have lifted; a new intentional tap starts a fresh selection. The dedicated browser regression asserts no selection on pinch release and correct selection on a subsequent tap.

No unresolved reproduced high-impact frontend finding remains in the tested scope. The design probe is evidence for its own entry-state checks; it is not proof of complete accessibility or all runtime behavior.

## Remaining limits

- A source patch is delivered rather than a worker-created branch/commit because `.git/` was explicitly off limits. The complete static output is provided separately and is included in the submission working tree.
- Owner installation and live VPS changes were not performed. IMD publication is only a review frontend, with the recorded/default connection scope described above.
- The capture has an 80×80 terrain view and one detailed inspector. Beyond it, the recorded view has no new terrain/evidence; demo or live supplies new frames.
- Generated poses vary subtly; no layered painting, skeleton, eight-direction rig or extra material-specific carry stages were available. Completed shelter artwork is used; unsupported construction stages stay unused. Distress is a health-gated ring, not invented emotion.
- Position interpolation uses adjacent confirmed endpoints only. Larger changes snap, and crowded residents can share screen space; the searchable roster provides exact identity selection. No omitted path is reconstructed.
- Biome art uses the API's representative chunk biome rather than inventing precise per-tile biome metadata. Terrain/pathfinding coordinates are unchanged.
- Heavy synthetic populations and terrain cache rebuilds show performance spikes. The measurements above do not guarantee a frame rate on another device.
- Physical devices, screen readers, localization/RTL, native 200% browser zoom, all image-background contrasts and all scientific behavior beyond the exposed evidence remain unverified.

Source and tests are reusable; no dependency archives, browser caches, node_modules or a second shared service are required or submitted.
