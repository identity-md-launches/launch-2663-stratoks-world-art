# Renderer art integration

This completes the integration of the earlier contributor's generated atlases; it does not replace that contribution or alter the simulation. The earlier `README.md`, `DIRECTION.md`, diagnostic manifest and validation file describe the original inputs. The runtime manifest is **`web/public/art/manifest.json`**, mirrored for typed imports in `web/src/expanse/atlas.json`.

## Delivered art

| Sheet | Dimensions | Registered sprites | Runtime PNG |
| --- | --- | --- | --- |
| Characters | 1024×1024 | 64 | `web/public/art/characters.png` |
| World | 1024×1024 | 64 | `web/public/art/world.png` |
| Supplemental resources/effects | 384×256 | 6 | `web/public/art/extra.png` |

All are real alpha PNG atlases, bundled in `dist/art/` as well. Sprite cells are 128×128 with a nominal 8px packing gutter and measured antialiased paint kept at least 4px from the cell edge. Every rectangle and its cell-local ground anchor is in the manifest. Character widths are 2.6 half-tile units; mature trees use 3.9, shelters 3.8, and smaller resources 1.5–2.4. The renderer's unit is the isometric tile's half-width.

The two supplied 1254×1254 RGBA inputs were visually inspected, then stored as editable 256-color raster masters in `web/art-source/characters.png` and `world.png`. Their original input hashes remain in the runtime manifest and the earlier source documentation. Palette conversion is a size-conscious derivative; these masters do not claim byte identity with the original inputs. A newly generated `extra.png` master adds cactus, flint, lichen, shellfish and two campfire poses in the same miniature painted style. No remote art is loaded. No layered painting, rig or authored 3D model exists.

Attribution: original STRATOKS contributor artwork generated with OpenAI image generation, 2026; extraction, registration, supplemental art and renderer integration by the interface contributor. Reuse is offered under the repository's client/art MIT license (`docs/licenses/client-and-art.txt`, also bundled under `dist/licenses/`). No third-party artwork was intentionally incorporated.

## Reproduce technical preparation

Ordinary frontend builds use the committed PNGs and do not require Python. To regenerate the atlases from the committed editable masters, install Pillow, numpy and scipy in an external virtual environment, then run:

```sh
python tools/art/prepare_renderer.py
python tools/art/validate_renderer.py
```

The preparer identifies the 64 disconnected opaque silhouettes in each supplied sheet, removes disconnected edge ghosts using a three-pixel halo, crops complete silhouettes rather than uniform grid cells, registers ground contacts and repacks. It records source rectangles and runtime pivots. It normalizes source scale, clamps packing positions to retain complete silhouettes, and exports 256-color PNGs. The validator checks all 134 sprites, dimensions, hashes, real transparency, safe paint bounds, anchors and matching manifest copies. `--import-inputs` is only for the original task inputs; normal reproduction does not need them.

## Runtime gates and animation

Four diagonal directions have idle (four poses, 2fps, ping-pong) and walking (four poses, 6fps) loops. Resting uses two poses at 1fps; gathering, carrying and building use two at 3fps. These are registered generated pose sequences, not a skeletal rig. Identity phase/fur glint derives from the resident ID and is stable across sessions.

Position interpolation is restricted to adjacent confirmed roster positions. While those confirmed endpoints are being interpolated, directional walking takes precedence over the destination action (including gather/build/rest/socialize/use/follow); the engine walks toward those targets before executing work. Inspected positive wood inventory permits the carrying appearance during that movement. After interpolation completes, rest/gather/build appearances require the corresponding engine action; stationary carrying also requires carry/move. Larger changes snap; no omitted intermediate path is inferred. Other residents' inventories are not guessed. Low health below 30 uses a static distress ring. No speech or invented affect is displayed.

Resource kinds map to actual engine nodes; bushes and stone have depleted/reduced variants. Empty trees and exhausted loose resources disappear. Four biome art families use the API's representative chunk biome; the API does not expose an exact biome for every tile. Completed shelter art is used only for reported shelters. Frame and partial-shelter sprites remain shipped but unused because the API exposes no construction stage. The illustrative shoreline/water variants remain reusable artwork; renderer shoreline edges instead follow exact server tile neighbors, avoiding decorative resource rocks in unreported locations. Every received ground tile is clipped to its correct isometric diamond and painted with the supplied ground texture.

Worn ground uses the manifest's `presentation.wornGround` bare-earth swatch from `arid.ground` (20×12 pixels at sheet coordinate 438,449). It excludes the rocks/plants in the full transition sprites. Soft strokes mark clear approaches and short clear connections around reported shelters, plus at most 256 adjacent travel segments observed during the current viewer session. Water, cliffs, blocking tree/stone nodes and blocked diagonal corners are excluded. This is cosmetic settlement wear, with no usable-road claim, route search, terrain mutation, movement-cost change or saved simulation memory.

Water ripples and slight foliage motion are restrained procedural presentation effects over real tiles/nodes. Fire frames are used only for `view.fires`. Reduced motion and the visual pause control freeze cosmetic loops, wind, water, fire and interpolation; authoritative positions still update. Recorded preview positions and creature poses stay frozen. No extra buildings or resource-bearing decoration are invented.

`GroundCache` retains at most 96 fixed 8×8-tile rasters at 32 pixels per half tile, independent of camera position, zoom and DPR. The signature includes received tile data and a one-tile shoreline halo. Offscreen rasters are culled and least-recently-used paint is released. Changed terrain and world identity/rollback invalidate paint; a new view can rebuild newly exposed or changed edge chunks. Camera changes otherwise scale and translate cached chunks instead of repainting the entire view. A separate viewport-sized composition at the current DPR is reused between camera/terrain changes, avoiding repeated chunk compositing during stationary animation and between follow updates.

## Honest limits

Generated silhouettes vary subtly between poses; these loops are not anatomically rigid. There are no eight-direction or skeletal animations, growth/age body stages, material-specific carrying art beyond confirmed wood, or engine-unreported shelter stages. Interpolation cannot reconstruct a path omitted between polls. Coarse biome decoration can differ from a sub-chunk biome boundary. New terrain rasterization still has startup spikes; fixed-size caches can soften at high zoom. The revision validation measures pan, zoom and follow separately from the earlier live test and static synthetic population measurements.
