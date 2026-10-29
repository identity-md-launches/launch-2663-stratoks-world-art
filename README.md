# STRATOKS · A little world, unfolding

A working illustrated observer for the existing Expanse simulation. The frontend uses original transparent sprite atlases, a coordinate-accurate isometric renderer, touch/keyboard navigation, resident search, follow, minimap and expandable scientific evidence. The matching static export is **`dist/`**, with relative URLs for gateway subpaths.

The review opens a **recorded preview** of `world-20260101-0` at tick 171,933, captured on 29 October 2026. It is labeled throughout. **Explore demo** starts the existing engine in an isolated browser worker, discarded on exit. **Connect live** reads the owner-operated service at https://stratoks.2-29-11-211.sslip.io. That service currently blocks cross-origin browser reads; a static preview cannot change its policy. No connection is fabricated. The recording's detailed inspector exists only for the resident returned in that capture; other residents explicitly report missing inspector evidence.

## Install, preview and rebuild

Use Node 22.12+; Node 24 was used here. The existing frontend manifest and lockfile are unchanged.

```sh
cd web
npm ci
npm run typecheck
npm test
npx tsx --test src/expanse/*.test.ts
npm run build
cd ..
node web/scripts/preview.mjs 4173
```

Open `http://127.0.0.1:4173/preview/`. The preview command only serves the static export; stop it with Ctrl+C. Vite retains `base: './'` and writes `../dist/`. Use HTTP rather than opening `index.html` as a file, because the demo uses module workers and runtime JSON. Dependencies and caches must stay out of Git. The existing `web/scripts/task.mjs` helper can alternatively install/build in `/tmp`; the added Expanse tests should also be run with the explicit command above.

The source patch at `artifacts/overhaul/stratoks-source.patch.gz` applies against pinned commit `fc1df0f9e641d05b7e32e1c96cb1b963e61576aa`. It includes editable source, art and documentation; the matching prebuilt `dist/` and rendered validation evidence are delivered alongside it, rather than duplicated inside the patch. Apply it on a separate review branch, then rebuild with the commands above:

```sh
git switch -c review/stratoks-world-art fc1df0f9e641d05b7e32e1c96cb1b963e61576aa
gzip -dc /path/to/stratoks-source.patch.gz | git apply --binary
```

This worker left `.git/` untouched under the task's explicit restriction, so delivery uses a patch rather than a worker-created commit or branch. Earlier accepted artwork documentation remains included. The network can commit the complete working tree, including `dist/`.

## Owner installation on the existing world

Only replace the static frontend after review. Do not start another shared server, reset the world, migrate saves or replace server source. The existing `server/`, `shared/`, tests, deployment source, world identity and simulation contracts are unchanged.

The shipped `dist/expanse-config.json` contains:

```json
{
  "httpUrl": "https://stratoks.2-29-11-211.sslip.io",
  "legacyAvailable": false,
  "startMode": "recording"
}
```

For the owner's same-origin installation, set `startMode` to `live` in that runtime file. Set the same values in `web/public/expanse-config.json` before future rebuilds. Existing owner configs with `httpUrl` and no `startMode` still connect automatically. A deliberate remembered source choice takes precedence. Keep `legacyAvailable:false`; the archived `#settlement` route fails closed and exposes no wallet or old writable client. The production build does not eagerly load its wallet providers.

Other owner endpoints can be selected through **Choose world**, or `?server=<URL-encoded HTTPS base URL>`. A local HTTP endpoint is accepted only from a local HTTP preview. `?demo=1` explicitly opens the private demo. HTTPS server prefixes are supported by the existing API transport. Cross-origin deployment needs the owner to allow that frontend origin; same-origin deployment needs no CORS change. There are no frontend credentials, contracts, payments or new write APIs.

Live polling remains one coherent `/api/expanse/frame` GET per second, one request at a time, with the real viewport and selected creature. A timeout retains the last confirmed frame; Reconnect retries. Manual navigation stops following. Tick is the engine's world-time unit; no date, thoughts or social meaning are invented.

## Art and interaction

See [DESIGN.md](DESIGN.md) for the implemented tokens, typography, components and responsive rules, and [art integration](docs/art/INTEGRATION.md) for the 134 registered sprites, dimensions, anchors, animation gates, source derivatives and licenses. Runtime manifests and PNGs live in `web/public/art/`; editable raster masters are in `web/art-source/`.

Drag or use arrow keys to pan. Scroll, pinch, use +/−, or use the zoom controls. Select a creature or search **Find residents**. Follow tracks its confirmed position. The atlas supports pointer and arrow navigation. Plans, Perception and Learning retain actual predictions, uncertainty, observations, inventories, memories and outcomes. JSON downloads contain the actual inspector. Counts are scoped to the indicated world/capture and tick. World records retain the API's bounded history.

The map and inspector use separate viewports on phones. Canvas picking, pointer-centered zoom, viewport requests, camera limits, knowledge overlays and the atlas share the same projection module. Terrain is cached offscreen, and sprites are culled and sorted by ground depth. Decorative art never changes pathfinding or adds a resource/building.

## Validation and review evidence

Actual results are recorded in [artifacts/overhaul/VALIDATION.md](artifacts/overhaul/VALIDATION.md), with raw browser results, rendered desktop/tablet/mobile screenshots and `live-interactions.webm`. The live recording uses a clearly labeled **read-only validation proxy in Playwright** to observe the existing API despite CORS; that proxy is not shipped. It shows real movement, selection, follow, pan, zoom, minimap, interruption and reconnect. Separate synthetic fixtures measure renderer performance; no 60fps claim is made.

Reproduce browser validation after building:

```sh
cd web
npx playwright install chromium webkit
cd ..
node web/scripts/overhaul-check.mjs
# Optional: contact the existing public world read-only, test CORS and record live interactions.
node web/scripts/overhaul-check.mjs --live
# With the static preview running, also render the actual private-worker biomes.
node web/scripts/biomes-check.mjs
```

Playwright needs its platform libraries. On this machine, browser binaries and extracted WebKit/Mesa libraries were installed only under `/tmp`; none are shipped. `IMD_PLAYWRIGHT` can point at an external Playwright `index.mjs`. `STRATOKS_FFMPEG` can select a VP9 encoder; the script also finds Playwright's bundled encoder for compact recording output. Without `--live`, validation uses the static capture, browser demo and labeled synthetic fixtures.

The pinned Better Interface review covers all six domains; findings, fixes and coverage limits are in the validation document. Build, typecheck, 17 existing client tests, 7 Expanse tests, browser flows and the design probe were run. These are worker observations, not independent certification. Earlier backend/scientific reports remain in their existing documentation and are not substituted for these frontend checks.

## Limits and provenance

The snapshot covers only its recorded 80×80 viewport, and detailed evidence for one resident. The demo/live service supplies new views; the capture does not invent terrain beyond its coverage. Generated animation frames have subtle shape variation. Only adjacent confirmed movement is interpolated; larger changes snap because intermediate paths are unavailable. Carrying art is limited to confirmed wood; incomplete shelter stages remain unused because the API does not expose them. Biome decoration uses the API's representative chunk biome. Cosmetic motion respects reduced motion and has a pause control. The renderer caps visual updates at 30 Hz; heavy synthetic populations and terrain rebuild spikes are documented.

Physical phones, assistive screen readers, native 200% browser zoom, RTL/localization, all canvas-background contrast combinations and owner installation were not independently checked. No change was deployed to the owner's VPS. IMD publication is a separate review preview, recorded in `artifacts/overhaul/publication.json` when available.

Repository source: https://github.com/kilicsln/stratoks, pinned at the commit above, plus the earlier accepted art contribution. Existing recovery/deployment/science documents remain under `docs/`, `deploy/` and `artifacts/phase2b/`.

Licenses: [client and artwork](docs/licenses/client-and-art.txt), [Manrope](docs/licenses/manrope.txt), [dependency notices](web/public/licenses/THIRD_PARTY_NOTICES.txt), [Better Interface / Impeccable guidance](docs/licenses/better-interface.txt). Original backend and scientific notices remain in place.
