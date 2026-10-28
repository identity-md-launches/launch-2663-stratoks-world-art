# Reopened review: final correction

Local worker validation on 2026-10-28; not independent certification. Revision parent: `ca7a1770779b3c55e519fc98ed80abe4b983fa7f`. Original integration: `99e50b1c275b9422c14f279498b3e192b151992b`. Both reported defects reproduced before source changes. The full application, reduced mushroom-body-inspired circuit, original scientific evidence, world migration and separate wallet-memory policy remain. Production data, contracts and the owner's VPS were not accessed; production stays legacy pending owner validation. No art or payment work.

## Issue-to-fix table

| Finding | Reproduction before the fix | Final change | Recheck |
|---|---|---|---|
| `42deefc9…978`: starvation behind the ten-site cap | In all four modes, nine depleted bushes followed by full sites 10/20 at distances 1/11 choose the first inserted full bush. Reversing them selects site 20. With ten depleted bushes both full sites disappear from memory and the creature wanders. | `server/src/actions.js:32`: emergency selection merges retained memory **before perception truncation** with **all current observations**, overriding stale amounts with sensed values. It filters food amount, walkability and path feasibility, then selects by distance and numeric id. `decide` allows this reflex even when the capped learned memory contains no food. Perception, linear scoring, learned target limits and non-emergency selection are unchanged. | 36 new server regressions, including both orders, 9/10 depleted sites, ties, unreachable goals, remembered/sensed union, stale depletion, actual consumption, non-emergency cap preservation, every mode and accepted-parent restarts. All pass. The reopened parent fails 16 of the same 36 tests. Sources remain explicitly `reflex` / `rule`. |
| `ba8ef6e4…b9d`: old decisions attributed to the current policy | The **unmodified accepted-parent modules** produced a trained mb-v1 snapshot with no `decision.mode`, EAT total `+3.761`, association `+0.750`, and active units `[93,79,62,9,40,46,48,105]`. Starting the delivered service explicitly in legacy without a new decide showed “Totals use the linear policy…” and hid the trace. Confirmed in the old production export at 390×844 in Chromium. | `web/src/BrainBehavior.tsx:28`: **Decision mode unrecorded** appears on its own line; unknown-mode candidate explanations make no policy/target-method attribution. A retained trace controls sparse disclosure when capture metadata is absent. Current mode, learning flags and original numbers remain separately visible. No stored history is rewritten. | Actual accepted-parent snapshot → disposable Store → explicit service startup in each mode → final dist client. No tick/decide runs. Chromium and WebKit each pass all 12 combinations of four modes × 320/390/1440px. Candidate totals/associations and all eight indices match the retained record; no overflow or application/resource errors. |

Machine-readable dispositions: root `.imd-responses.json`. Raw review evidence is in `artifacts/phase2a-client/review/`; retained mobile/desktop screenshots are in `docs/correction/screens/review/`. TAP files are losslessly gzip-compressed, not summarized replacements.

## Reproduce independently

```sh
node tests/experiments/reproduce-review.mjs --check-regressions
node --test --test-reporter=tap tests/review-regressions.test.js
node --test --test-reporter=tap --test-concurrency=2 tests/*.test.js
node web/scripts/task.mjs typecheck
node web/scripts/task.mjs test
node web/scripts/task.mjs build
node web/scripts/check-review.mjs chromium
node web/scripts/check-review.mjs webkit
node web/scripts/check-phase2a.mjs chromium /tmp/stratoks-review-interactions/chromium
node web/scripts/check-phase2a.mjs webkit /tmp/stratoks-review-interactions/webkit
```

The first command extracts the immutable parent modules through read-only `git show` into `test/scratch/`, asserts the insertion-order failure in each mode, and runs the final regression tests against ca7a177 (expected **20 pass / 16 fail**). It also recreates the accepted-parent snapshot in memory. The delivered compressed fixture was generated with `--write-fixture`; `reproduced.json` records its SHA-256 and actual decision. It is not a fabricated response or a state made with the new `decide`. The Git extraction requires those commits in the checkout; packaged restart tests use the retained fixture without Git.

`check-review.mjs chromium --before` verifies the former wrong attribution against the old export; `chromium-before/checks.json` and its screenshot retain that result. On the final export the normal command asserts the corrected wording and trace instead. The browser runner reads actual GET/WS data from a disposable service; it asserts that tick, decision count, inspection and recorded scores did not change after startup. Server regressions additionally restart each mode twice and compare circuit weights.

## Actual checks and results

| Check | Actual result | Raw evidence |
|---|---|---|
| New regressions before / after | **20/36 → 36/36**; all 16 original failures reproduced on ca7a177 | `before.tap.gz`, `regressions.tap.gz`, `reproduced.json` |
| Full server suite | **137 pass, 0 fail**: 68 existing, 33 earlier correction, 36 review regressions | `server-tests-final.tap.gz` |
| Earlier original failures | Accepted integration fails **22 of 33** earlier regressions as expected | `original-correction-regressions.tap.gz` |
| Client tests | **17 pass, 0 fail** | `web-tests.tap.gz` |
| TypeScript / production build | Both exit **0**; dist contains 19 complete export files with relative URLs | `typecheck.txt`, `build.txt` |
| Main interactions, Chromium / WebKit | **16 pass each**; two clients agree; all-mode flags/history, keyboard, reconnect, error/retry, local worker, needs/memories/history, lab conditioning/reversal/ablation/download/restore and pause/resume | `interactions-{chromium,webkit}.json` and `.txt` |
| Accepted-parent history, Chromium / WebKit | **12 pass each**, all modes × three widths, no new decisions | `{chromium,webkit}/checks.json` |
| Pinned design probe | **16/16 pass**, 320/390/1440px; title, favicon, description, og:title and og:image present | `taste.json`, `taste-command.json` |
| Learning / ecology | All **120 learning** and **40 ecology** rows, original seeds/resources unchanged | `tests/results/correction/{learning,ecology}.json`, `RESULTS.md` |
| Docker/cgroups | Exit **2**: Docker executable unavailable. Requested limits **unverified** | `docker.txt`, `tests/results/correction/docker/status.json` |
| Local service/client capacity | 16 diagnostic runs; actual runtime/RSS/CPU/tick p95/p99 and client agreement; **no requested resource enforcement** | `capacity.txt`, `tests/results/correction/capacity/*.json`, `RESULTS.md` |
| Static CAR | All 19 files traverse and match export SHA-256; every CAR block hash verified offline | `release.txt`, `RELEASE.json` |
| Public HTTPS | ENS curl **35** (TLS error); both exact-CID gateways **429**. No tested working public URL | `https.txt`, `HTTPS.json` |
| VPS archive / final integrity | Rebuilt deterministic archive, re-read every file against inventory; source/export/budget checks | `PACKAGE.json`, `INTEGRITY.json` |
| Historical integration-only preflight | Exit **1**: it expects the pre-correction mushroom companion hash and no changes to any tracked file. That assumption already conflicts with accepted ca7a177; the companion is unchanged by this revision. It is retained as historical tooling, not reported as a passing correction check | `preflight.txt`; the correction-specific inventory check passes |

Build warnings about browser-externalized Node modules are retained in the build log. The real private-world worker and isolated learning worker both run successfully in the production-browser checks. Dependencies, browser binaries and extracted shared libraries stay under `/tmp`, outside the submission.

WebKit required locally extracted system libraries and software Mesa, an external wrapper adjustment preserving the supplied library path, and `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` because the package-manager probe does not see extracted libraries. Actual WebKit execution and interactions passed; this is not a claim that the host dependency check passed or that a physical iPhone was tested. Set the external Playwright/browser/library paths for that environment, or install the normal Playwright dependencies on a supported host.

## Legacy comparison and test repairs

The first full-suite attempt is retained as `server-tests.tap.gz`: the legacy worker received SIGKILL while comparing divergent states, and two assumptions about the old ecology failed. A large assertion diff is a possible cause of the kill; its resource cause was not verified. The comparator now checks concise hashes before attempting a large diff. These results were investigated, not discarded as passing checks.

Unmodified recovered legacy first diverges at **tick 2712** for creature 22 at hunger 80.409: old legacy wanders although a full sensed site is feasible; the corrected engine selects it by reflex. `legacy-divergence.json` records both actions and food memory. Exact equality to that buggy behavior conflicts with the requested fix **in every mode**. The updated 4,000-tick differential test copies the immutable recovered engine into scratch and applies **only an independently implemented version of the specified emergency rule**. Every other recovered module, resource, linear score, target cap and random stream stays unchanged. Canonical states then match, including births and construction. It does not establish equivalence to unmodified legacy ecology.

Two existing assertions were repaired for their actual purpose. The crash test formerly replayed an arbitrary 1,500 ticks, shorter than the corrected child's time to its first death. It now replays to the child's recorded `killedAtTick` and requires **exact** birth/death equality. The fire test formerly compared aggregate population health despite births and concurrent healing; it now checks actual health loss on fire-damage calls and requires positive fire damage, while retaining the shelter/intervention checks. No production behavior or ecology resources were changed to satisfy these tests.

## Scientific comparisons

Same seeds 1–10, all tasks/modes, unchanged autonomous resources and experiment protocols. Controlled learning rows are identical to ca7a177; all held-out phases remain frozen, all 120 serialized continuation comparisons agree, and frozen/ablated learning has zero updates. Prior correction learning/ecology raw evidence is retained losslessly under `tests/results/review/ca7a177-*.json.gz`; original `tests/results/phase2a/` stays unchanged.

Versus ca7a177, mb-v1 population rises **39.7 → 41.6**, hungry exposure falls **7.53% → 2.86%**, and deaths fall **0.5 → 0.1**, but remaining food falls **207.89 → 192.11**. **All modes lose remaining food**; more consumption does not establish sustainable supply. Final legacy also changes (**42.5 → 43.6** population, **3.84% → 1.34%** hunger) because its reflex is corrected too. Frozen/ablated have identical untrained-world outcomes. Final mb-v1 still trails final legacy on population, births, shelters, remaining food and hunger; deaths tie in this sample. See `RESULTS.md` for every metric, seed and comparison. These short, shaped, divergent ecologies are not biological validation or causal evidence of a learned survival benefit. A survival reflex is never reported as learned behavior.

## Better Interface recheck: six domains

Applied the pinned workflow and core principles while making the scoped inspector correction. Existing illustration, palette, typography, spacing, wallet flows and panel layout remain. Product idea: observe the small illustrated world and inspect a resident's actual decisions. `DESIGN.md` records implemented tokens and the unknown-history state.

| Domain | Checked coverage and correction | Unperformed limits |
|---|---|---|
| Accessibility | Native paragraphs/details/table semantics and focus styles retained; text identifies uncertainty and source; keyboard entry/dialog focus return and axe on entry/inspector/lab in both engines pass | Screen-reader, switch-control and full manual WCAG review |
| Layout | Entry and final retained inspector screenshots viewed; 390px first screen contains world/main action; retained-history panel reflows at 320/390/1440 in both engines. The first implementation joined the uncertainty label to the tick; changed to its own paragraph and rechecked | Native 200% zoom, RTL and physical devices |
| Writing | **Medium**, `BrainBehavior.tsx:27` / `:45`: current policy was attributed to uncaptured history. Corrected explicit unknown label and neutral explanation, with actual source and scores preserved | No inferred historical mode is claimed |
| Typography | Existing six-size Manrope scale, normal tracking and tabular score digits retained; no new font/weight/size. Final label wraps on its own line | Arbitrary text scaling and multilingual names |
| Colors | No token changes; probe and both engines' automated solid-background contrast audits pass | Probe explicitly leaves canvas/image/gradient backgrounds unmeasured; no claim of contrast against every scene state |
| UI | Existing native sparse disclosure now follows the retained trace when mode is unknown; toggled in both engines. Current mode/plasticity remain separate. No new animation or surface style | Physical touch/hover, slow-motion animation-panel audit |

The assigned browser tool also loaded the finished export, started the real private simulation, selected a resident and opened Learning; no console errors were observed. Mobile entry and final retained-history screenshots were viewed from actual Playwright captures. Browser evidence supplements source review; none of these checks represents screen-reader/native-device certification.

## Release, migration and remaining boundaries

`dist/` is rebuilt and ready for the platform's static publication. Exact offline CID: **bafybeifukwi4jdpv4sf572jkdung5zgkhe76nkchsxl2gmd5g62mpetqpm**. `RELEASE.json` records exact source/export hashes and CAR settings; `deploy/correction-client.car.gz` reconstructs the export. The final submission commit is assigned by the network after this run and remains unset in the manifest; no future commit or public pin is invented.

`deploy/correction-vps.tar.gz` is refreshed with final source/export/fixtures, and `VPS.md` retains exact configuration, copied-backup migration and owner validation steps. Schema is unchanged by this revision; no reset or history rewrite is required. Absent captured decision mode remains explicitly unknown. Ablation/freeze and wallet-memory policies are unchanged.

**Complete for the scoped repository fixes and local checks.** Real 512 MiB / 0.75 CPU Docker qualification remains **unverified**; the runnable isolated benchmark is delivered. The local fallback establishes no supported capacity on a 1 GB VPS and can share host resources with other worker checks. Public pinning, ENS DNS/TLS repair, a working HTTPS gateway and the final network commit remain platform boundaries, and no backend hosting is claimed. The requester need not provide anything to submit these fixes; independent review and owner production validation remain separate.
