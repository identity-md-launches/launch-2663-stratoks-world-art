#!/usr/bin/env bash
# Briefly stop the world, create a consistent backup, copy it to ./backups-offsite/, restart.
# Cron example (daily 03:15):  15 3 * * * cd /opt/stratoks/deploy && ./backup.sh >> backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups-offsite
docker compose stop world
trap 'docker compose start world' EXIT
docker compose run --rm --no-deps -T world node bin/backup.js --tar | tar -xf - -C backups-offsite
echo "Consistent backup copied to backups-offsite/; restarting world."
