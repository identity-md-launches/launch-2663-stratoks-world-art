# STRATOKS interface system

## Overview

STRATOKS is an observer interface for the existing Expanse simulation. A bright, painted miniature world fills the screen; compact dark moss controls sit over it. The artwork and the HUD have separate jobs: creatures, resources and shelters explain the world, while the HUD identifies the source, time, residents and evidence. The static review opens a **recorded preview**, with an explicit isolated demo and an owner-server connection option.

Canonical implementation: `web/src/expanse/expanse.css`, `App.tsx`, `Map.tsx`, `Inspector.tsx`, `worldRenderer.ts`, and `projection.ts`. The archived settlement retains its existing design and is disabled by the shipped runtime configuration.

## Colors

Tokens are scoped to `.exp-app`; reuse these roles rather than copying a nearby color.

| Token | Value | Role |
| --- | --- | --- |
| `--hud-deep` | `#1d2b25` | Header, footer, recessed fields |
| `--hud` | `#25362e` | Floating surfaces and inspector |
| `--hud-raised` | `#30443a` | Neutral controls |
| `--hud-hover` | `#405347` | Hover and active neutral controls |
| `--hud-text` | `#f5efd9` | Primary text |
| `--hud-muted` | `#bdc8b6` | Secondary text |
| `--gold` | `#e8c36e` | Primary button fill, selected controls, focus |
| `--gold-hover` | `#f0d494` | Primary hover |
| `--hud-line` | `#4c6050` | Structural dividers |
| `--hud-danger` | `#f3b3a1` | Recorded failures and errors |
| `--focus` | `#ffe1a0` | DOM control focus outlines |

A connection also has a written label; color alone never distinguishes live, recorded, private demo or offline state. The renderer uses terrain colors indexed by the server's existing tile IDs, locally bundled paint textures, and turquoise water. Fog outside received terrain is blue gray. The art palette does not determine physics. Measured HUD contrast and unmeasured canvas pairs are recorded in `artifacts/overhaul/VALIDATION.md`.

## Typography

The existing local Manrope Variable WOFF2 is defined in `web/src/styles.css`; use weights 400, 600 and 800. The world title and resident name use the system stack Georgia / Times New Roman / serif at weight 400. No remote font is required, and no particular installed serif face is assumed.

The six sizes are 12, 14, 16, 20, 24 and 32 CSS pixels. Captions and evidence data use 12; controls and dense inspector prose use 14; form inputs and section headings use 16; the compact brand uses 20; resident names and the narrow world title use 24; the wide world title uses 32. Body line height is 1.5–1.6; short headings use 1.15–1.25. Brand tracking is −0.025em and the large title is −0.02em; body tracking is natural. Counters use tabular numerals. Names, resource keys and evidence wrap instead of being truncated. Inputs stay at 16px on phones.

## Layout

The application occupies `100dvh`, with `100vh` fallback. Desktop rows are a 68px header, 34px status strip, flexible world and 34px footer. Header/footer rows add the corresponding safe-area inset. Floating controls use 24–28px outer insets, 8–12px local gaps and 16–24px spacing between groups. Controls are usually 40–44px, with 32–36px controls in the compact landscape toolbar.

The world is the primary content, without a marketing hero. Above 700px the optional inspector takes 352px, increasing to 368px above 1100px. At 1000px and below, chrome becomes more compact. At 700px and below, the header/status/footer are 60/32/30px plus safe areas; the inspector becomes a scrolling bottom sheet occupying 44% of the workspace. The remaining map is a separate viewport, so the sheet does not cover its selected creature. Selection recenters on phones, and following recenters against the actual resized canvas. At widths of 360px and below, the brand and control spacing tighten.

Short landscape windows below 500px height use a horizontal tool rail and zoom group; the atlas collapses to a toggle. Content panels retain their own scroll area. The application itself does not scroll horizontally. Rendered checks cover 320×844, 390×844, 851×1000, 851×393 and 1440×900. Physical safe-area behavior is not independently device-tested.

## Elevation & Depth

HUD panels have solid moss backgrounds and restrained transparent shadows. Divider borders communicate evidence/list structure; ordinary raised HUD surfaces do not combine a border and shadow. Layer order is terrain, sorted world objects, map controls, inspector, then the native modal dialog. Canvas sprites sort by projected ground depth. Sunlight is a restrained observer treatment, not invented simulation weather.

The canvas focus indicator is inset within the clipping boundary and uses a two-color gold/charcoal perimeter. Other controls use the focus token. Decorative layers do not intercept pointers.

## Shapes

Buttons and fields use 8px radii, tool groups 10–12px, the scene title a 3px leading corner with 18px outer corners, and the modal 18px. Mobile inspector top corners are 16px. Portraits use circular recessed surfaces. The world itself uses transparent painted silhouettes, not rectangular entity cards.

## Components

- `WorldMap` in `Map.tsx`: canvas pan, pointer picking, keyboard arrows and +/−, pointer-centered wheel zoom, two-finger pinch, home control, visual loading/error state. `onAspect` reports its real size. The canvas has an accessible description and a complete roster-based selection alternative.
- `MiniMap` in `Map.tsx`: materialized chunk biomes, living roster, original settlement boundary and an isometric viewport polygon. Click and arrow navigation share the world coordinate transform. The atlas can expand; short landscape layouts start compact.
- `WorldRenderer` in `worldRenderer.ts`: caches terrain in an offscreen canvas, culls objects, depth-sorts sprites and interpolates only adjacent confirmed positions. Distant changes snap because intermediate paths are unavailable. Idle/walk sequences use deterministic per-ID phase and fur glints; no personality is inferred from their appearance. Animation is limited to 30 visual updates per second and stops under reduced motion or Pause visual motion. Simulation polling continues.
- `CreatureInspector` in `Inspector.tsx`: actual identity, needs and inventory; Follow; JSON evidence download; native expandable Plans, Perception and Learning panels. Predictions, uncertainty, actual results and missing evidence remain distinct. A capture without that resident's inspector says so explicitly.
- `.exp-side-panel`: one responsive panel for residents, inspector or records. Close/Escape returns focus to the map; selecting a roster entry focuses its resident heading. It is not a modal.
- `Modal` in `web/src/Modal.tsx`: native dialog, inert background, Tab containment, Escape and focus return. World settings use a visible URL label, native URL input, inline validation and focused invalid field. Help explains source scopes and controls.
- `.exp-button.primary`, `.exp-button`, `.exp-icon`, `.exp-text-button`: gold primary, moss secondary, named icon action and compact text action. Hover, focus, pressed, pending and disabled states are explicit. Transitions name only background, color and scale; press scale is 0.96 with motion preference respected.
- `Portrait` and `drawSprite` in `art.tsx`: reuse the same bundled character sheet in HUD and world. `web/public/art/manifest.json` defines sprite rectangles, dimensions, anchors, appearance gates, provenance and licenses. Editable raster sources live in `web/art-source/`.

## Do's and Don'ts

Start another observer surface with these tokens, button classes and native disclosure/dialog patterns. Keep the bright world visible, use one source scope consistently, and put actions beside the content they affect. Use `projection.ts` for every camera, viewport, minimap or picking calculation; never adjust world coordinates to make art fit.

Only draw resources and shelters supplied by the API. Fire requires an engine fire record; carrying wood requires inspected wood inventory plus the matching action. Keep unavailable construction stages unused. Do not add pretend thoughts, speech, usable roads, resources, shops or control actions. Keep the isolated demo separate from the existing world. Detailed art, validation and remaining limits are documented in `docs/art/INTEGRATION.md` and `artifacts/overhaul/VALIDATION.md`.
