# Upload-size repair

The previous supplemental Git bundle duplicated the complete recovered archive, generated evidence and static assets inside the submission. The rebuilt bundle is source-only; all required assets and raw evidence remain in the enclosing submission. See SOURCE.md for its exact scope and offline reconstruction commands. The source bundle is about 160 KB instead of 8.2 MB.

Learning JSON now uses compact whitespace. Re-running all ten seeds across three tasks and four modes reproduces all 120 rows exactly as parsed JSON, including every recorded choice, reward, digest and RNG endpoint. No trial or field was discarded. The experiment generator emits the compact format on subsequent runs.

One byte-identical historical screenshot was deduplicated: `docs/recovery/browser-keyboard/before-tools.png` points, through its new SCREENSHOT.md, to the retained `browser-debug/before-tools.png`. BASELINE.json records its delivered path. Both original paths also remain in the checksum-verified recovered ZIP. No application source, runtime asset, original test or unique visual evidence was removed.

Checks after repair:

- Working-tree regression suite: 68 passed, 0 failed.
- Source-bundle clone with documented offline asset overlays: 68 passed, 0 failed.
- Ten-seed experiment rerun: all 120 rows identical to prior evidence as parsed JSON.
- Report generator: exit 0; no stale capacity source hashes or retention/heldout failures.
- Baseline ZIP SHA-256 matches the task's expected checksum.
- `python3 tests/experiments/check-package.py` builds a complete offline ZIP under `test/scratch`, checks it against 8 MiB, and verifies the inventory and bundle/baseline hashes. The upload service may use different framing/compression; this check is a local size proxy, not its certification.

No new simulation or capacity changes were made, so the existing measured benchmarks remain applicable. Exact Docker/cgroup qualification, public client publication, independent external review and recovered-backend licensing remain unresolved as documented in VALIDATION.md.
