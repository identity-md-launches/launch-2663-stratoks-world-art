# Reviewable source commit

`deploy/phase2a-source.bundle` is a supplemental, source-only Git commit. Its commit, SHA-256, size and exclusions are recorded in `RELEASE.json`. The contributor-network submission supplies the enclosing release commit. Root Git metadata is not modified by the packaging script.

To avoid duplicating large artifacts in the upload, the bundle excludes the recovered ZIP, raw result directory, the recovered world-client build, documentation, its own bytes and the release descriptor. **All these deliverables remain in the enclosing submission.** The original baseline ZIP, runtime assets, measured trials and historical visual evidence remain in the enclosing submission; one byte-identical screenshot is deduplicated with a documented canonical path. The bundle includes backend/component source, tests, experiment and benchmark programs, deployment scripts and static inspector source. It is a supplemental source artifact, not a standalone copy of all release evidence.

Offline review from the enclosing submission root:

```sh
git clone deploy/phase2a-source.bundle test/scratch/source-review
mkdir -p test/scratch/source-review/deploy/recovered
cp deploy/recovered/stratoks-09af84d.zip test/scratch/source-review/deploy/recovered/
cp -R tests/results test/scratch/source-review/tests/
cp -R deploy/phase2a-demo/world test/scratch/source-review/deploy/phase2a-demo/
cp -R docs test/scratch/source-review/
cd test/scratch/source-review
node --test --test-concurrency=2 tests/*.test.js
```

Rebuild with `node tests/experiments/inventory-phase2a.mjs` followed by `python3 tests/experiments/package-source.py`. The latter uses disposable Git metadata under `test/scratch`, a fixed build timestamp and an automated build identity, not a human reviewer or wallet identity. It needs no network or dependencies beyond Python and Git.

`inventory.json` hashes backend/component sources, baseline archive, static assets and raw results in the enclosing submission. `BASELINE.json` records the imported baseline inventory. The original archive remains checksum-verified and materializable with `deploy/materialize-recovered.py`.

See `VALIDATION.md` for evidence limits. Source hashes and passing tests do not constitute independent certification or production approval.
