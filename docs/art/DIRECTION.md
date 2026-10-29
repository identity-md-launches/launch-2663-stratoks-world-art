# STRATOKS atlas art direction

These are original generated raster assets for the bounded atlas assignment. No stock images, remote textures, existing characters or third-party reference artwork were supplied. Generation used the installed OpenAI image tools; the generated first passes were used as references for a transparency/padding refinement pass.

The PNGs themselves are the editable raster originals. There is no layered painting, skeletal rig, vector source or authored 3D model. This document records the reproducible visual specification; image generation is nondeterministic and cannot reproduce identical pixels.

## Shared specification

Isometric 30-degree miniature game art, hand-painted storybook shading with light from the upper left. Lush emerald, turquoise, honey timber and warm stone. Crisp alpha silhouettes, no background scene, lettering, emoji or grid lines. Eight columns and eight rows of isolated sprites, with transparent extraction gutters. Initial target resolution was 1536×1536; actual delivered dimensions are recorded in `atlas-validation.json`.

## Characters

Golden pear-shaped creature with long leaf-shaped ears, amber ear tips, cream muzzle and belly, small dark eyes, broad tiny feet and a teardrop tail. Same identity and proportions in every frame. Four diagonal directions. First four rows: four subtle idle frames followed by four walk frames per direction. Last four rows: two resting, two kneeling/reaching gathering, two carrying wood, two arranging wood/building frames per direction. No speech, implied emotions, tools, fire, social roles or UI icons.

Requested refinement: preserve all 64 frames, remove colored fringe and ghost noise, reduce each sprite within its cell, maintain consistent foot baseline and add fully transparent gutters. See the README for observed deviations rather than assuming the generator followed every instruction.

## World

Biome pairs, top to bottom: temperate woodland, arid desert, snowy highlands, rocky coast. First row of each pair: mature tree, smaller tree, berry shrub, depleted shrub, full stone resource, depleted stone resource, fallen timber, ground detail. Second row: shelter frame, partial shelter, completed shelter, ground diamond, dirt/gravel transition diamond, shoreline transition diamond, isolated turquoise ripple, foliage detail.

Requested refinement: preserve the arrangement, remove colored fringe and ghost pixels, contain every sprite inside its cell with generous transparent padding, and omit shelter chimneys. No residents, boats, factories, fantasy resources, roads, smoke or fire. No decorative asset is authority to create a resource or a building in the world.

## Attribution and reuse

Attribution: original STRATOKS contributor artwork generated with OpenAI image generation, 2026. No third-party art was incorporated intentionally. New artwork and accompanying documentation/scripts are offered under MIT, consistent with the client artwork license at `docs/licenses/client-and-art.txt`. This attribution describes provenance; it does not certify copyright eligibility or uniqueness.
