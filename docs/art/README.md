# STRATOKS original art atlas delivery

This delivery covers the two requested generated art atlases. It does not change or deploy the frontend, simulation, server, world state or dependencies.

| Output | Format | Delivered dimensions | Intended contents |
| --- | --- | --- | --- |
| `artifacts/art/characters.png` | PNG, 8-bit RGBA | 1254 × 1254 px | 64 golden creature poses in eight rows and eight columns |
| `artifacts/art/world.png` | PNG, 8-bit RGBA | 1254 × 1254 px | 64 vegetation, resource, shelter and terrain assets across four biomes |

Both files contain actual alpha transparency, not a painted checkerboard. They were created with image generation and refined with the generated first passes as references. The named output PNGs are intentionally left untracked for separate artifact upload. Supporting documentation and the checker live outside `artifacts/`.

## Layout and extraction

Characters: intended direction order is southeast, southwest, northeast, northwest. Rows 0–3 contain four idle then four walk frames. Rows 4–7 contain two resting, two gathering, two carrying wood and two building poses in the corresponding direction. Frames remain the same golden long-eared creature; they are not identities assigned to particular residents.

World: row pairs 0–1 temperate, 2–3 arid, 4–5 cold, 6–7 coast. Within each pair the first row contains mature tree, smaller tree, berry bush, depleted bush, full stone, reduced stone, fallen wood, ground detail. The second row contains shelter frame, partial shelter, completed shelter, ground diamond, ground transition, shoreline, water ripple, foliage detail.

`manifest.json` records logical slots, dimensions, format, provenance and candidate anchors. `atlas-validation.json` records SHA-256 hashes, PNG integrity results, alpha counts, and measured alpha bounds for each *proposed* grid rectangle. Coordinates are top-left image pixels; bounds are half-open. Cell edges are `floor(index * dimension / 8)`, since 1254 is not divisible by eight. These grid rectangles are diagnostic and are **not approved cutouts**. They can clip sprites or include neighboring artwork. Do not implement blind uniform-grid extraction.

The conceptual ground anchor is bottom-center beneath the feet or ground contact. A suggested initial cell-local pivot is `(0.5 × cell width, 0.84 × cell height)`, but it is not a measured animation registration point. Extract and register individual silhouettes, then repack into padded cells before integration. The current files are editable raster originals; no layered or rigged sources exist. The visual specification and provenance are in `DIRECTION.md`.

## Checks and remaining visual requirements

Run from the repository root with Python 3 (no packages or network needed):

```sh
python3 tools/art/check_atlases.py
```

The checker validates signatures, all chunk CRCs, RGBA encoding, decoding of PNG filters, real transparent pixel coverage and grid alpha bounds. Both PNGs passed those file checks. Characters have 46.542% fully transparent pixels; world has 42.729%. These measurements do not certify visual quality or animation.

Unmet or unverified requirements:

- Requested 1536 × 1536 generation size was not honored; both actual outputs are 1254 × 1254.
- Generous, uniform transparent extraction padding was not achieved. Alpha above 16 reaches at least one proposed cell boundary in all 64 cells of each sheet. Faint colored fringe/ghost pixels remain outside some silhouettes after the cleanup pass. The sheets need manual silhouette isolation and repacking before production texture filtering.
- Poses and scale are visually consistent overall, but pivots, apparent foot position, direction fidelity and frame-to-frame registration vary. Seamless idle/walk loops have not been certified by animation playback. These are pose sequences, not a validated production animation rig.
- Rest, gather, carry and build are represented. No separate distress sequence is delivered. Wood carrying must only render when actual wood inventory is confirmed; an action string alone does not establish the held material.
- Four biome groups are recognizable, but they do not cover every engine node kind. There are no specific cactus, shellfish, lichen or flint sprites. Resource-bearing artwork must never be used as generic decorative filler.
- Terrain transitions are illustrative edge variants, not a complete seamless autotile set. Water ripples are single variants, not an animation sequence. There are no foliage or engine-gated fire animation frames. Shelter construction variants must remain unused where no corresponding construction stage is exposed by the API.
- No renderer integration, in-browser performance measurement, mobile testing, live movement recording, frontend build or hosting is claimed in this bounded art delivery.

## Explicit visual review step

Before integrating, review both full-resolution PNGs on light, dark and checkerboard backgrounds. Inspect each silhouette at 100% and 400%, isolate its full bounds, and register the ground anchor. Play each proposed direction's walk sequence and idle sequence, including last-to-first, with nearest and linear filtering. Check world tiles side-by-side for seams. Approve the cutouts and loops only after fringe cleanup, padding and registration have been resolved. This review remains outstanding; the byte validator is not visual approval.

Original generated artwork; no external art was used. Reuse/attribution details are in `DIRECTION.md` and the repository's client/art MIT license.
