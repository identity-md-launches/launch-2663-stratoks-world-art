# Final-tree review and handoff

The implementing worker reviewed the source and production export listed in `RELEASE.json`. This is a self-review, not an independent review of a Git commit. No separate reviewing agent was available. The repository's `.git/` is outside the assignment's write scope; the submission platform assigns the final commit after collecting these files. Independent review of that exact commit remains pending before owner deployment.

## Reviewed behavior

- **Authority:** `server/src/expanse/server.js:26` exposes a synchronous read frame. Its existing non-GET/HEAD rejection remains in place. Browser interaction checks record GET-only world traffic. Timers persist and progress without viewers; the UI does not write simulation state.
- **Evidence:** `server/src/expanse/view.js:28` projects recorded plans and observations. `web/src/expanse/Inspector.tsx:14` renders those predictions, support, uncertainty, actual rewards, costs and missing outcomes. Downloaded inspectors match server JSON in two independent browser contexts. No future simulation query or generated dialogue is added.
- **Navigation:** `web/src/expanse/Map.tsx:15` renders authoritative viewport tiles and supports observer movement across chunks. Negative-coordinate tiles match the engine in browser checks. Following changes the camera only. Observer geography is explicitly broader than creature knowledge. Non-finite and enormous legacy viewport inputs are bounded before spatial loops.
- **Isolation:** `web/src/expanse/demo.worker.ts:14` initializes the real engine in a private worker. It has no world-API transport. Pause/exit and zero shared API calls are checked in both engines. The initial preview fixture contains terrain only, with no sample residents or history.
- **Preservation:** Direct comparison with the pinned archive confirms all original backend/shared/tests files remain unchanged. Accepted Expanse physics, mb-v1, material rules and persistence code are unchanged relative to the starting working tree. Existing tests and negative scientific findings are retained.
- **Configuration:** Server URLs permit HTTPS and local HTTP previews, reject credentials and mixed content, and preserve URL prefixes. Both public configuration files ship with empty endpoints. The old settlement/authentication route is retained with separate settings.
- **Export:** Vite uses `base: './'`; local JS, CSS, font, icon, share image and notices ship in `dist/`. The actual export is tested beneath `/preview/`. No dependency installation or cache is included. The frontend manifest and lockfile match the pinned release.
- **Design:** The six-domain review, actual source locations, fixed findings, screenshots, measured solid-color contrast and unperformed checks are in `VALIDATION.md` and root `DESIGN.md`. Mobile/desktop Chromium and WebKit checks pass. The 390px first screen visibly contains the product and primary action.

## Findings resolved during final review

The legacy viewport allowed non-finite or enormous coordinates to reach spatial queries. Bounding before iteration now prevents invalid chunk keys and nonadvancing loops; HTTP regression tests pass. The more precise reward interaction check initially depended on whitespace from browser layout; it now compares the actual numeric element to the server value, and both complete suites pass. The build helper shares a temporary staging directory, so its install/typecheck/test/build commands must run sequentially; a colliding invocation was rerun successfully.

## Remaining review and operational limits

No primary defect was found in the tested client states. This does not establish completeness over every possible payload or viewport. Docker execution, ARM64/cgroup capacity, eight real networked rendering clients, owner HTTPS deployment, physical phones, native browser zoom and screen-reader sessions were not tested. The Expanse response includes the whole living roster and has no added rate limiter. Atlas samples are coarse chunk representatives; histories and agent memory are bounded. Browser demos are ephemeral.

The new capacity probe includes eight frame serializations on each of 10000 ticks at 24/100/250 starting creatures. It is a CPU/serialization test, not an eight-browser network test. Natural population declines and unknown death causes are reported. The broader ten-seed causal results are inherited, predate `carry`, and retain their survival/discovery failures. This integration does not resolve them.

Before deployment, the independent reviewer should verify the collected commit against `RELEASE.json`, examine the two additive Expanse service/view changes, reproduce the build and interaction suite, and run the copied-world and host/container checks described in `deploy/expanse/CLIENT-DEPLOYMENT.md`. This is an outstanding owner review step, not an approval or certification from this worker.
