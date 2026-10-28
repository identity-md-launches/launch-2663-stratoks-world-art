#!/usr/bin/env bash
# Restore a backup directory (as created by backup.sh). Stops the world container, restores, starts it again.
# usage: ./restore.sh backups-offsite/<name>      (the current data is moved to /data/archive/pre-restore-*, never deleted)
set -euo pipefail
cd "$(dirname "$0")"
src="${1:?usage: restore.sh <backup-dir>}"
docker compose stop world
docker compose run --rm --no-deps -v "$(cd "$src" && pwd):/restore:ro" world node bin/restore.js /restore
docker compose start world
