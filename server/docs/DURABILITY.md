# Durability and crash recovery (Phase 1.1)

## Files in the data directory
| file | role |
|---|---|
| `world.json` (+ `world.prev.json`) | checksummed snapshot: world state, RNG state, every creature's learning weights/memories, accepted intervention keys, totals. **The commit point.** |
| `events.jsonl`, `events.jsonl.1`, `events.jsonl.2` | event log; every line has `seq`. Rotates at 5 MB; live + 2 rotated files are kept (unchanged retention). |
| `lifecycle.jsonl` | birth/death records, each with the `seq` of its event |
| `interventions.jsonl` | accepted developer interventions, each with `seq` |
| `recovery/` | log lines that were moved aside on recovery, and unreadable snapshots. Never deleted automatically. |

## Protocol
1. Records are appended to the logs as the simulation produces them (each tagged with `seq`).
2. Before a snapshot is written, pending events are flushed and **all logs are fsync'd**. Rotation fsyncs the outgoing event generation before closing it, since the next snapshot can only sync the new live descriptor. Then the snapshot is written to `world.json.tmp`, fsync'd, renamed over `world.json`, and the directory is fsync'd. So a committed snapshot with `seq = S` has every log line with `seq <= S` on disk (subject to the documented event-retention policy).
3. On start, after loading the snapshot (or its fallback), every log line with `seq > S` is **moved** to `recovery/<file>.after-S.orphaned` and the log is truncated to the last line with `seq <= S` (a torn trailing line is moved too). The orphan file is fsync'd before truncating. Evidence is appended rather than overwritten if a later failed startup has another tail at the same `S`; recovery files are never deleted automatically.
   If a Phase-1 sequence rewind (a lost branch followed by lower/equal sequence numbers) is found, startup refuses without changing logs. Run the non-destructive branch migration below first; this avoids retaining the lost branch while discarding the surviving one.
4. Startup then commits a fresh snapshot (including catch-up and LEARNING-policy changes) before serving.
5. A developer intervention is acknowledged only after step 2 completed for a snapshot that contains it. A save failure returns 503 `not_durable_retry_same_id`; the in-memory application is kept, and a retry with the same id is a duplicate that just retries the commit. Exactly-once: an unacknowledged intervention that never reached a snapshot is moved aside by step 3 and applies once when retried; one that reached a snapshot but whose ack was lost is a duplicate on retry.

Consequence: after SIGKILL or power loss the world, its RNG/learning state, lifecycle records, events and intervention acknowledgements all describe the same point in time. A creature whose death was logged but not committed is alive again in the recovered world and its old death record is in `recovery/`, so when it dies again it has exactly one death record. The simulation work since the last snapshot (≤ 30 s by default) is lost, as before.

Tests (`tests/durability.test.js`) SIGKILL real child processes at: after lifecycle records but before the snapshot (births and deaths), `lifecycle-appended`, `events-appended`, `snapshot-tmp-written`, `snapshot-committed`, during recovery (`recovery-orphan-written`), `intervention-appended`, and after an intervention commit with the ack lost; plus injected save failures. Each case checks: no record ahead of the snapshot, no duplicate birth/death ids, no recorded-dead creature alive, strictly increasing event seqs, death records == committed death total, and that a second recovery changes nothing. Fault points are enabled only by the `STRATOKS_CRASH_AT` environment variable.

## Existing Phase 1 data: migration, backup, rollback
Phase 1 data may already contain a "lost branch": records written before a crash, followed by re-used seqs after the restart (that is how the duplicate death records arose). Upgrade procedure:

1. **Stop and prepare the new tools**: from `deploy/`, `docker compose stop world`; obtain the new source and run `docker compose build world`. Building the image does not change the data volume. Keep the old image/source for rollback. Do not start the new service yet.
2. **Back up before migrating data**: `mkdir -p backups-offsite`, then `docker compose run --rm --no-deps -T world node bin/backup.js --tar | tar -xf - -C backups-offsite`. Check the pipeline's exit status with `set -o pipefail` in Bash, verify the copied `manifest.json`, and copy that directory off the VPS. The stopped-volume backup preserves the original snapshot bytes/schema. A separate backup CLI must not run concurrently with the simulation; it now refuses a live writer. The authenticated in-process `/api/dev/backup` endpoint remains available for online backups (it first commits the world and copies without yielding to another tick).
3. **Report** (read-only, world still stopped): `docker compose run --rm --no-deps world node bin/check-history.js /data`. Exit code 3 = `irrecoverable` items exist. Review these explicitly before continuing; do not treat a zero exit after hiding records as a repair.
4. **Repair lost branches** (required when reported, non-destructive): `docker compose run --rm --no-deps world node bin/check-history.js /data --apply`. It keeps the surviving (later) branch of each log, writes the lost-branch lines to `archive/pre-history-migration-<ts>/<log>.lost-branch.jsonl` and copies the original files there first.
5. Start: `docker compose up -d world`. The snapshot is migrated v1 → v2 automatically (intervention keys re-keyed to `<actor>:<id>`, see below) and logs ahead of the snapshot are moved to `recovery/`.
6. **Rollback**: stop the server; either restore the backup from step 2 (`bin/restore.js <dir>`, which moves the current files aside rather than deleting them) or copy the files from `archive/pre-history-migration-<ts>/` back. A v2 snapshot cannot be read by the Phase 1 server (it refuses newer schemas), so rolling back the code requires restoring the step-2 backup before restarting the old image. Restore the whole backup, not just `world.json`.

For routine backups after the upgrade, `deploy/backup.sh` stops the service, exports a checksummed backup into `deploy/backups-offsite/`, and restarts it even if export fails. `deploy/restore.sh <backup-directory>` verifies checksums and moves the current data aside. Neither script deletes the persistent volume. The offsite export/restore path is tested with generated data in `tests/backup-cli.test.js`; Docker execution remains unperformed on this worker.

### What cannot be repaired automatically (reported as `irrecoverable`)
* the same creature with more than one death or birth record on the surviving branch;
* a death record covered by the snapshot for a creature that is alive in the snapshot;
* an intervention logged twice on the surviving branch, or logged but missing from the committed snapshot.
These need operator review; the tool never edits the snapshot. Events that were rotated out before the upgrade are gone (retention gap, reported by `/api/events` as `gap`). For the baseline reproduction (crash after a death record, restart, continue) `check-history` found 14 lost-branch event lines and 2 lost-branch lifecycle lines, `--apply` moved them aside, and no irrecoverable items remained.

### Container locks and offline tools
`server.lock` now records both a PID and Linux PID namespace. A PID alone is not meaningful across Docker containers (both a stopped service and a one-shot maintenance container can be PID 1). `check-history --apply` and restore reject a live writer only when that identity is live in the same namespace. A legacy numeric lock equal to the maintenance process PID is treated as stale, allowing backup, restore, and history migration immediately after a killed container. For a legacy lock naming another live local process, stop that process first; do not delete a lock while the service is running.

### Cursor durability
`/api/events` returns only events through the committed snapshot sequence (`committedSeq`). Snapshot and delta messages carry that same `seq`, plus a per-process `epoch`; clients must reset a retained cursor when the epoch changes. Events beyond the last snapshot can be lost after a crash, but are never issued as durable cursors and therefore cannot be silently reused for a different event after restart.

### Intervention ID migration (schema v1 → v2)
Keys become `<lowercase actor wallet>:<id>`. Each Phase 1 record already stored its actor, so every old ID stays owned by the wallet that created it: that wallet's retries are still duplicates, another developer wallet reusing the ID now gets a separate intervention attributed to itself. Records without an actor (Phase 1 never wrote any) are kept under `legacy-unknown:<id>`; `migratedFromKey` keeps the old key.

The corrected browser stores pending IDs by server + world + lowercase authenticated actor. Old browser records lack an actor and cannot be migrated automatically: the Tools panel displays their ID/body, blocks replay/new submission, and asks the original developer to check the server ledger before explicitly dismissing them. It never assigns an unknown browser record to the wallet that happens to be connected. After an uncertain response, a failed retry (including 401/403/429) does not establish the earlier outcome; the ID remains saved for the same actor.
