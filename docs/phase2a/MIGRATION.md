# Migration, persistence and rollback

Production remains `legacy` by default. No production service, account, volume or world was accessed. Run these operations first on a copied world, and stop the relevant writer before using filesystem/CLI restore operations.

## Import and provenance

Baseline ZIP: `deploy/recovered/stratoks-09af84d.zip`, source commit `09af84d67722e30c0cb0c096ab8a8189a3b03166`, SHA-256 `8816bfda36545436f85d4ca0b13bd439be14fb3a6be285f25bd39f3edf8abd9e` (verified before extraction). Permitted baseline directories were imported before implementation. All other application files, including the full client source/lockfile and original tests, remain byte-for-byte in the archive. This avoids creating root-level files outside this component's permitted paths. The recovered `server/docs/LEARNING.md` and `docs/recovery/VALIDATION.md` were inspected; historical results are not new verification claims.

To inspect/build the complete original application in an empty directory:

```sh
python3 deploy/materialize-recovered.py test/scratch/recovered
```

Overlay the delivered `server/` and `shared/` there when doing final full-client integration. Server tests run directly from this deliverable without extraction or installation. Original backend modules also appear byte-for-byte in `tests/fixtures/legacy09af84d/` solely for actual old-binary compatibility checks.

## Schema 2 → 3

The snapshot envelope uses schema 3. Migration adds `state.brainMode:"legacy"` if absent and `brain.version:1` to existing brains. It does not touch legacy weights, wallet opinions, identity, world age, needs, family, history, relationships or global RNG. Existing schema-0/1 migrations still run in sequence. Unknown newer schemas are refused; corrupt storage still follows the recovered safe recovery behavior, never silently creating a new world.

The new circuit is initialized **only when activated**, from a deterministic world-seed/creature-ID-derived seed. Its projections are synthetic and its two output matrices start at zero. Legacy `brain.w` remains in place. There is no equivalence mapping or learned-knowledge transfer claim. Personalities, feasible actions, wallet memory and game rules still contribute independently.

Activation on a validation copy:

```sh
DATA_DIR=/path/to/copied-world BRAIN_MODE=mb-v1 node server/src/main.js
```

Use the operator's real copied directory; no identity/address/key is needed for mode selection. This is startup configuration, not an API. A JSON config may set `world.brainMode` equivalently. `BRAIN_MODE=mb-v1-frozen` keeps trained weights but prevents circuit updates. `BRAIN_MODE=mb-v1-ablated` removes learned outputs from scoring while leaving the circuit available for measurement. `LEARNING=0` retains both brains and opinions and disables all further learning.

An unset `BRAIN_MODE` keeps the stored mode on an existing world; it does **not** silently revert an activated world. Explicit `BRAIN_MODE=legacy` rolls policy back on startup and retains the new circuit. Do not delete the snapshot or change its seed to switch modes. Actions already in progress finish normally; an action captured in a different mode is not trained into either newly selected policy.

## What survives restart and backup

Snapshot/backup stores projections, every new weight, internal update/reward counters, the bounded reward history, per-creature RNG and any in-flight eligibility trace. Hunger/energy/health remain in ordinary creature state. The global world RNG, legacy weights, wallet memory and existing history persist through the unchanged atomic checksummed snapshot/rotating-log implementation. No second database or external state file is introduced.

Tests verify normal restart at exactly the same simulated time, identical serialized future after further ticks, read-back of weights, real backup/restore, and mode rollback on a **separate copied directory** with unchanged original bytes. JSON serialization canonicalizes signed zero in rounded display telemetry; persistence equivalence is measured on the serialized state, without rounding learned weights.

## Older binary rollback on a copy

The recovered schema-2 server correctly refuses a raw schema-3 snapshot. Do not hand-edit the original snapshot or weaken its schema guard. To create a separately verified compatible backup:

```sh
node server/bin/export-legacy-backup.js /path/to/verified-backup /path/to/new-export
```

The output must not exist, must have an existing parent, and cannot overlap the input directory. The exporter validates allowed filenames, regular files, all manifest checksums and snapshot state checksums before writing. It exports schema-2 current/previous snapshots in a new backup, selects legacy mode, preserves every creature's MB object and all ordinary state, and recomputes checksums. It accepts a schema-2 previous snapshot alongside the schema-3 current snapshot during an initial upgrade. Restore that exported backup into a **different stopped data directory**, using `server/bin/restore.js`, then start the actual recovered server against the copy. Logs remain at the same committed history and its normal recovery handles any suffix beyond the snapshot.

`tests/brain-compatibility.test.js` performs this operation against byte-identical recovered server modules, runs the older server for another 60 ticks, reopens it with this release, explicitly reactivates MB mode, and checks that MB weights/RNG/history survived. The older server ignores but retains extra per-brain fields; it continues learning only the legacy policy. The original backup remains byte-identical. Population evolution during the legacy interval is ordinary simulation, not rollback culling.

Retain the original schema-3 backup independently. Exporting compatibility is an explicit review tool, not permission for a production downgrade. No production migration or deployment was performed.
