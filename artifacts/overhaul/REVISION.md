# STRATOKS reopened-review validation

Complete for the eight reported frontend findings and the tested revision scope. This report describes the final renderer/interface; the original accepted report is retained in `VALIDATION.md`. These are worker observations, not independent certification.

## Scope and preserved behavior

This is a targeted revision of the accepted implementation. It retains the generated PNG artwork, authoritative coordinate system, transport/API contracts, world selection, live polling, resident evidence, follow/search/minimap and private-worker demo. Server, shared simulation, deployment source, build configuration, package manifests/lockfiles, saves, identities, memories and learned state are unchanged. No shared engine or owner VPS was started, replaced or deployed. The archived settlement still fails closed with `legacyAvailable:false`.

`dist/` is the rebuilt static export, served during checks at `/preview/` to verify relative URLs. The default remains explicitly **recorded**, because direct cross-origin live reads are blocked. The shipped runtime config supports the owner's same-origin installation. The IMD submission plane publishes the committed export after submission; no worker-published URL is claimed. `.git/` remained untouched, so the refreshed compressed source patch is the installation path on a separate owner-created review branch.

## Reproduction and fixes

All eight reports reproduced before their corresponding fixes. `revision-before.json` records the initial geometry and measured recorded-preview trace. The pre-revision phone action was intercepted at 667×390, the vertical rail was clipped/covered at the three reported short sizes, Enter moved the minimap camera to a negative edge, and the 320px follow banner intercepted Connect live. The pose input returned gather/build/rest or idle during travel; the normal test command ran only 17 tests. The raster provenance contradiction and absent path pass were confirmed in source and actual rendered views. The recorded camera-change trace included ~80–128ms terrain rebuild spikes on this machine.

| Finding | Final source | Change and recheck |
| --- | --- | --- |
| `b9410899` short phones | `web/src/expanse/expanse.css:1740` | Horizontal phone rail, collapsed atlas, separate notice/tool/zoom rows; compact landscape title/actions. Short inspector drops its overflowing map minimum. Both browsers expose every tested action at all reported sizes. |
| `cd087315` terrain cache | `web/src/expanse/ground.ts:24`, `worldRenderer.ts` | World-coordinate 8×8 tile rasters; received tile/shoreline-halo signatures, offscreen culling and 96-entry LRU. Camera changes translate/scale existing paint. A DPR-sized viewport composition is reused when stable; active gestures can blit chunks directly. Unit invariants and moving-camera measurements below. |
| `04b2e057` provenance | `docs/ASSETS.md:3`, `docs/licenses/client-and-art.txt:5` | Active generated PNGs and archived code-native art are distinguished. Documentation, public/dist licenses and manifest consistently credit original STRATOKS artwork generated with OpenAI image generation, 2026, under MIT. Manifest copies and preparation source share the updated pose gates/earth swatch. |
| `04a72c70` test discovery | `web/src/expanse.test.ts:1`, `web/scripts/task.mjs` | The protected manifest is unchanged. A top-level test entry imports projection, appearance, transport and terrain suites. Standard `npm test` now passes 27 tests; redundant transport-only invocation removed. |
| `21c1b932` minimap keyboard | `web/src/expanse/Map.tsx:479` | Coordinate clicks with `detail===0` are ignored. Actual Enter/Space preserve the camera in Chromium and WebKit; arrows move a chunk and real pointer clicks select accurate world coordinates. |
| `221989a1` follow/connection overlap | `web/src/expanse/expanse.css:1307`, `:1416`, `:1566` | Phone messages flow with an 8px gap, respecting actual wrapped notice height. The reported 320px banner moves below the notice to y222. Related title overlaps after closing the phone/tablet inspector also reproduced and were fixed. Interruption/reconnect messages remain operable. |
| `7b99288e` travelling work poses | `web/src/expanse/worldRenderer.ts:30`, `appearance.test.ts` | Adjacent confirmed travel precedes destination work/rest poses. Carrying requires inspected wood; stationary work resumes after arrival. Regression covers gather/build/rest/socialize/use/follow/flee and identity/inventory gates. |
| `e0b3061e` settlement paths | `web/src/expanse/paths.ts:9`, `worldRenderer.ts` | Soft earth-textured approaches/short clear connections around reported shelters, plus bounded observed adjacent travel segments. Bare-earth atlas crop excludes resource decoration. Water/cliffs/blocking nodes/corners excluded; tests confirm no frame mutation. Visible in the refreshed settlement screenshots. |

The complete IDs and per-finding responses are in the repository-root `.imd-responses.json`. No reported finding was left disputed or unreproduced.

## Actual commands and browser results

- `node web/scripts/task.mjs typecheck`: exit 0 (`tsc --noEmit`).
- `node web/scripts/task.mjs test`: exit 0, **27/27** via the unchanged standard npm test script. Includes the 17 prior client tests and 10 Expanse tests.
- `node web/scripts/task.mjs build`: exit 0; current static export copied to `dist/`. Existing browser-externalization warnings for engine config/worker modules remain warnings; runtime demo and browser flows pass.
- `python3 tools/art/validate_renderer.py` with external Pillow/numpy: exit 0; **134** padded sprites, matching manifests, dimensions, hashes, transparency and anchors.
- `node web/scripts/revision-check.mjs`: exit 0. **16** layout/minimap cases: Chromium and WebKit at **320×568, 320×844, 390×600, 390×844, 667×390, 851×393, 851×1000, 1440×900**. Checks control clipping/obstruction, horizontal overflow, search, exact selection, follow, close, Enter/Space/arrow/pointer minimap navigation. Synthetic transport also exercises interrupted connection and reconnect. `revision-results.json` has no JavaScript/resource errors.
- `node web/scripts/overhaul-check.mjs --live`: exit 0. Actual export/subpath, source settings, focus return, evidence disclosures, 12 picking cases across zoom/positive and negative chunk boundaries, private-engine tick/pause/resume, touch pan/pinch and pinch-release selection regression, reduced motion, archived-settlement refusal, Chromium and WebKit interactions. **0 axe violations** in its tested recorded mobile state; no unexpected JavaScript or local asset errors.
- `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste`: final export, **16/16** checks passed, including first-screen/reflow at 320/390/1440 and share metadata. Machine-readable result is `taste.json`.

Dependencies/builds and browser/platform libraries stayed outside the repository. The supplied managed browser could not start because its configured Chrome binary was absent; actual rendered checks used installed Playwright Chromium and WebKit instead. The existing overhaul script was executed from the external staging tree against its byte-identical build to resolve its local dependencies. The revision script directly served repository `dist/`. No unavailable managed-browser result is represented as a rendered observation.

Screenshots: `recorded-1440.jpg`, `recorded-851.jpg`, `recorded-390.jpg`, `inspector-1440.jpg`, `inspector-390.jpg`, `revision-667x390.jpg`, `revision-390x600.jpg`, `revision-320x568.jpg`, `revision-follow-320.jpg`, plus private demo, WebKit, connection-error and live-proxy views. The follow screenshot is captured after the 150ms pressed-color transition settles. Existing unmodified biome/focus captures are retained as original-round evidence.

## Live evidence, separately from fixtures

`live-interactions.webm` is a fresh recording from the existing **world-20260101-0**, via a clearly labeled **read-only Playwright validation proxy**. It contains real movement, selection, follow, pan, zoom, minimap, intentional interruption and reconnect: 9 received frames, ticks **180987–180998**, 224 residents in the last roster, and 184 residents with changed confirmed positions across the recording. Selected resident: **Haye #626 · socialize**. No production server changes were made. The proxy is not shipped. The clip is VP9, 960×600, 12 encoded frames/sec; encoded video fps is not a display-performance claim.

Direct CORS access still reported `stale`; the application displayed the recorded scope and reconnect guidance honestly. Neither the private demo nor synthetic fixture is described as the shared live experiment.

## Moving-camera performance

Separate **synthetic 120-resident fixture**, using captured scenery clipped to each real viewport request, with synthetic grass outside the capture and an explicit synthetic label. Confirmed fixture positions alternate for follow; all phases use the functioning production client. Continuous pan/wheel phases run about 5 seconds each; follow is sampled across 6 seconds. Each table entry uses the final rolling **120 renderer CPU-duration samples** after warm-up. No other browser probe ran concurrently during this final measurement. Idle frames within each gesture interval are included; this is not a per-input latency benchmark or a measured display fps.

| Viewport / DPR | Phase | Samples | Median ms | p95 ms | Max ms |
| --- | --- | ---: | ---: | ---: | ---: |
| 1440×900 / 1 | idle | 120 | 1.1 | 2.0 | 2.5 |
| 1440×900 / 1 | pan | 120 | 1.1 | 3.6 | 37.0 |
| 1440×900 / 1 | zoom | 120 | 0.8 | 29.4 | 115.1 |
| 1440×900 / 1 | follow | 120 | 1.4 | 2.5 | 34.5 |
| 390×844 / 2 | idle | 120 | 1.0 | 1.9 | 3.0 |
| 390×844 / 2 | pan | 120 | 1.0 | 6.2 | 44.9 |
| 390×844 / 2 | zoom | 120 | 1.0 | 33.4 | 93.3 |
| 390×844 / 2 | follow | 120 | 1.6 | 3.0 | 48.8 |

The cache fixes the every-camera-frame 80×80 terrain repaint. It does **not** guarantee smooth zoom or 30/60 fps: newly exposed/changed raster chunks, viewport composition and dense sprite work still cause measured spikes, especially during zoom (up to the maxima above). Fixed raster resolution can soften terrain at high zoom. The renderer retains its existing 30 Hz visual cap. Ground-raster memory is bounded to about 52 MB plus one viewport composition; total browser memory was not profiled. The original static-camera population tables are historical; the current raw static fixture results remain separately in `browser-results.json`.

## Better Interface coverage

| Domain | Checked in this revision | Remaining coverage limits |
| --- | --- | --- |
| Accessibility | Native minimap activation versus chosen pointer coordinates, visible controls, focus return, search/selection/follow, keyboard pan/zoom, reduced motion and existing axe flow. | No screen-reader or physical-phone session; no full assistive-technology matrix or native 200% browser zoom. |
| Layout | Reproduced phone obstruction; checked short/tall phone, tablet and desktop entry/inspector/closed states, wrapped notice/follow stack, control bounds and first-screen product/actions. Viewed actual final screenshots. | No exhaustive arbitrary-size/safe-area hardware, localization or RTL test; expanded atlas is a deliberate temporary map overlay. |
| Writing | Preserved recorded/live/private scope, actual tick/population, reconnect language and scientific uncertainty. Corrected conflicting art provenance. | Existing engine evidence wording was preserved; no new scientific conclusions are inferred. |
| Typography | Kept the six-size/three-weight local font system; compact title reuses 24px. Checked labels, wrapping and first-screen readability; probe passes. | No physical text enlargement or platform serif guarantee. |
| Colors | Retained canonical dark moss/gold tokens; final probe passes its measurable solid pairs. Follow pressed text was checked after its 150ms transition settled. | Canvas/image/gradient backgrounds and every transition frame are not contrast-certified. |
| UI | Kept functional controls and motion settings, added no pretend actions; checked minimap keyboard/pointer states, accurate selection/follow, reconnect and actual integrated worn art. | No 10%-speed Animations-panel review or every possible world-state/expanded-overlay combination. |

`DESIGN.md` documents actual tokens, components, responsive rules and caches. Original generated-art limitations remain: no rig, subtle pose variation, only inspected wood carrying, no unreported construction stages and no reconstructed paths across distant observations. Session wear is cosmetic and unsaved. Owner installation/IMD publication are outside this local validation; source and static output are ready for the submission plane. Full-file size and protected-path integrity are recorded in `integrity.json`; source-patch application and byte-identical rebuild results are in `reproduction.json`.
