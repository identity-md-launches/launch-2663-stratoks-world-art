# Stratoks design system

## Overview

Stratoks is an observation tool for a persistent world of small learning creatures. The final client keeps the pinned release’s warm paper, forest greens, Manrope typography, mascot and line icons. The Expanse uses an overhead terrain map to make large-world navigation legible; the original isometric settlement remains available at `#settlement`.

The working product takes priority over introductory copy. At 390px, the name, **Connect server**, **Explore demo** and terrain map are visible on the first screen. The main visual idea is a quiet field atlas with real evidence beside the landscape. There are no decorative gradients, invented metrics, fake conversations or entrance animations.

Canonical global tokens live in `web/src/styles.css`; Expanse composition and component styles live in `web/src/expanse/expanse.css`. `web/src/main.tsx` loads the base styles before the Expanse extension. Preserve the legacy settlement’s established surfaces outside this integration.

## Colors

These are the implemented CSS custom properties, retained in hex notation:

| Token | Value | Role |
| --- | --- | --- |
| `--paper` | `#fafaf1` | Page, panel and button surface |
| `--surface` | `#f3f4e8` | Quiet strips and grouped evidence |
| `--soft` | `#e9eddf` | Selected controls, meters and number markers |
| `--ink` | `#263f31` | Primary text |
| `--muted` | `#5c6c58` | Secondary text and instructions |
| `--line` | `#d9dece` | Structural separators and outlines |
| `--accent` | `#315d40` | Filled primary action |
| `--accent-hover` | `#244b32` | Primary hover |
| `--danger` | `#98462e` | Error text and critical need meter |
| `--danger-bg` | `#f4e5da` | Connection/validation error surface |
| `--focus` | `#29592e` | Keyboard focus ring |

The text/background token pairs were calculated with WCAG 2 sRGB luminance and checked against their rendered roles: ink/paper 10.89:1, muted/paper 5.35:1, muted/surface 5.06:1, primary text/accent 7.22:1, danger/danger-bg 5.25:1. See `artifacts/phase2b/raw/stratoks-contrast.json`. The taste probe measures resolved solid backgrounds; it does not establish contrast over every canvas pixel or blended background. Focus on maps has a paper inset beneath the green ring so it stays distinct from terrain.

Map artwork is encoded in `web/src/expanse/Map.tsx`, separately from UI status colors. Atlas representatives are temperate `#819b69`, arid `#cfb47b`, cold `#becbd0`, coast `#78a5ae`; gray `#e0e2d5` means unmaterialized. Terrain uses eleven actual engine tile classes, with lakes, sea, shallows and streams distinguished from traversable ground. A legend names categories; color is accompanied by text or geometry. Creature art is gold and selection adds a light ring. Higher hunger/thirst is worse; native need meters use the opposite optimum from health, energy and warmth, with `#b47b47` for intermediate and danger for critical values.

## Typography

The only text family is **Manrope Variable**, with `Manrope, Arial, sans-serif` fallbacks. `@font-face` loads the local WOFF2 provided by `@fontsource-variable/manrope` and declares the font’s 200–800 range. The interface uses three weights: 400 for prose/data, 600 for controls and subheadings, 800 for the brand and main heading. No additional font is fetched at runtime.

| Token | Size | Use |
| --- | --- | --- |
| `--text-xs` | 12px | Dense evidence, map chrome, captions, secondary data |
| `--text-sm` | 14px | Short descriptions, panel titles, major buttons |
| `--text-md` | 16px | Inputs and mobile inspector empty heading |
| `--text-lg` | 20px | Desktop empty state, phone brand |
| `--text-xl` | 24px | Desktop brand, creature name, phone main heading |
| `--text-display` | 32px | Desktop main heading |

Body line-height is 1.5–1.6; the main heading uses 1.2. Display/brand tracking is −0.04em; other content uses natural spacing. Headings use balanced wrapping; prose uses pretty wrapping. Dynamic coordinates, meter values and predictions use tabular numerals where defined. Important IDs, outcomes and observations wrap rather than truncate; the episode list permits long keys to break. Mobile search and URL fields are 16px. The map compass is artwork rather than a seventh text size.

## Layout

The page is capped at 1440px. Desktop main padding is 28px; the header shares the page edge. The map and inspector use `minmax(0,1fr) 350px` with a 24px gap. Records and atlas repeat the same column widths below them. Containers allow intrinsic text growth; normal document scrolling reaches the complete interface.

Spacing is pragmatic and extracted from the implementation: 4–10px within compact control/data rows, 12–16px inside groups, 18–24px between groups, and 28–32px for outer sections. Do not invent another spacing or type system for a new panel.

Responsive rules in `expanse.css`:

- At 1100px and below: inspector/atlas columns become 320px, main padding becomes 24px and the map’s secondary heading label is hidden.
- At 850px and below: inspector moves below the map; its empty state becomes a compact horizontal explanation. The loaded inspector scrolls within a bounded 620px evidence area. The atlas and records can still share a row.
- At 600px and below: main padding is 16px, main heading is 24px, the map becomes square, records and atlas stack, and the header keeps the brand and server control visible. Settlement remains available in the footer and connection dialog. The long start-strip explanation is hidden, while its action remains visible.
- At 360px and below: redundant record-tab icons disappear and their padding decreases. This fixes the measured WebKit overflow at 320px without hiding any label or view.

The canvas uses its measured aspect ratio for the requested viewport and minimap outline. Device-pixel ratio is capped at 2. Map controls remain 44px. Atlas navigation has a keyboard equivalent. Touch panning and button zoom are supported; pinch zoom is not implemented.

Rendered reflow was checked at 320, 390, 768 and 1440 in Chromium and WebKit. Native device, browser-native 200% zoom and RTL layout were not tested.

## Elevation & Depth

Panels use a single structural border with no shadow. Within a panel, evidence is grouped by spacing and quiet tonal strips, not stacked cards. The floating map-control rail has a small `0 3px 12px #263f3120` shadow and no enclosing border. Its internal separators are functional. The base `--shadow` remains `0 8px 32px #243e3020` for preserved settlement overlays. Native modal dialogs retain the legacy backdrop and top-level elevation. No decorative depth is added to ordinary content rows.

## Shapes

Expanse panels use 12px corners; ordinary buttons and fields use 8px; map captions and evidence strips use 6px; status dots, selection rings and numbered step markers are circular. The retained base `--radius: 16px` belongs to existing settlement surfaces. The mascot, line-icon paths and favicon remain original pinned assets. The map clips only its artwork; labels, error text and evidence remain reachable.

## Components

| Source / pattern | Purpose and states |
| --- | --- |
| `expanse/App.tsx` | Product shell, connection/demo state, polling lifecycle, roster search, discovery/social views. Explicit preview, connecting, connected and stale states. Server changes clear the old projection; errors retain and label the last frame. |
| `expanse/Map.tsx` · `WorldMap` | Real viewport rendering, pointer/keyboard pan, wheel/button/key zoom and selection. Decorated geometry never substitutes for simulator movement. Controls are disabled in terrain-only preview. Manual movement stops following. |
| `expanse/Map.tsx` · `MiniMap` | Materialized chunk representatives, settlement outline and current camera footprint. Pointer navigation plus arrow-key equivalent. No claim that the atlas is an agent’s knowledge. |
| `expanse/Inspector.tsx` · `CreatureInspector` | Actual need meters, follow/download controls and Plans/Perception/Learning views. Loading, unavailable and empty states are explicit. Mobile resident selection scrolls to the inspector and focuses its heading. |
| `expanse/Inspector.tsx` · `PlanEvidence` | Numbered selected steps. Prediction and actual outcome share one layout across current/recent plans. Untested priors, failures, pending and unexecuted steps are distinct text states. |
| `expanse/transport.ts` | HTTPS configuration validation, coherent v1 frame validation, request cancellation/timeouts and isolated worker transport. No world write method. |
| `Modal.tsx` | Retained native `<dialog>` with focus trapping, Escape/backdrop closure and focus restoration. Shared by connection and help. |
| `.primary`, `.exp-button`, `.exp-icon`, `.exp-text-button` | One filled action per view; outlined/quiet alternatives; hover, pressed, disabled and visible keyboard focus states. The 44px control target is used for map/header actions. |
| `icons.tsx` · `Icon`, `Mascot` | Original reusable decorative SVG artwork. Line icons use current color and a consistent 1.7 stroke. Accessible names belong to the containing control. |

Evidence disclosure uses native `details/summary`, meters use native semantics, and lists use real list markup. The record view selectors and inspector selectors are native pressed buttons rather than partially implemented ARIA tabs. New async status copy uses an existing polite region. Periodic simulation ticks are not announced to assistive technology on every update.

Only color/transform properties transition, for 150ms, under `prefers-reduced-motion: no-preference`. Press scale is 0.96. There are no autoplay animations to pause; the private simulation itself has a Pause control. Reduced motion does not stop server state from progressing.

## Do’s and Don’ts

- Reuse the six text tokens, existing Manrope, current icons and paper/forest color roles for another panel. Start from `.exp-panel-title` plus ordinary spaced content or a native disclosure.
- Put controls above the data they change. Keep the map and main action on the phone’s first screen; keep evidence and error text readable without ellipsis.
- Label data origin, observation tick, missing outcomes and bounded history. Keep observer geography separate from an agent’s memory.
- Use a secondary action when another filled primary is already visible. Use borders for structure and shadows only for floating controls/overlays.
- Keep demos visibly isolated and temporary. Never fill an empty discovery feed, invent a successful plan, treat a prior as a learned result or imply that viewing changes the world’s physics.
- Do not add speech, an assigned leader, token/payment flows, arbitrary motion or a second font as decorative polish.
