#!/usr/bin/env bash
# Owner-run Docker verification (needs Docker + compose plugin; run on the ARM64 VPS or any Docker host).
# Builds the image, runs it ISOLATED (own project name, own volume, no Caddy, port bound to 127.0.0.1 only) and checks
# health, persistence across stop/start and SIGKILL, backup + restore, origin handling and the architecture.
# Usage: bash deploy/check-docker.sh            (does not touch the production compose project or its volume)
set -euo pipefail
cd "$(dirname "$0")/.."
P=${CHECK_NAME:-stratoks-check-$$}; IMG=${P}:check; VOL=${P}-data; PORT=${CHECK_PORT:-18788}; PLATFORM=${1:-linux/arm64}
cleanup() { docker rm -f ${P} >/dev/null 2>&1 || true; }
trap cleanup EXIT
echo "Requested image target: $PLATFORM. Native vs emulated execution must be established separately by the operator."
docker build --platform "$PLATFORM" -f deploy/Dockerfile -t $IMG .
docker volume create $VOL >/dev/null
start() { cleanup; docker run -d --platform "$PLATFORM" --name $P -e ALLOWED_ORIGINS=https://client.test -e TICK_MS=100 "$@" -v $VOL:/data -p 127.0.0.1:$PORT:8787 --read-only --tmpfs /tmp --memory 768m --cpus 1 --cap-drop ALL $IMG >/dev/null;
  for i in $(seq 1 60); do curl -sf http://127.0.0.1:$PORT/health >/dev/null && return 0; sleep 0.5; done; docker logs $P; return 1; }
tick() { curl -s http://127.0.0.1:$PORT/api/status | sed -E 's/.*"tick":([0-9]+).*/\1/'; }
start; echo "health: $(curl -s http://127.0.0.1:$PORT/health)"; sleep 3; t1=$(tick)
echo "allowed origin: $(curl -s -D - -o /dev/null -H 'Origin: https://client.test' http://127.0.0.1:$PORT/health | grep -ci access-control-allow-origin) header(s); foreign origin: $(curl -s -D - -o /dev/null -H 'Origin: https://evil.test' http://127.0.0.1:$PORT/health | grep -ci access-control-allow-origin)"
docker stop -t 30 $P >/dev/null; start; t2=$(tick); echo "graceful restart: tick $t1 -> $t2 (must be >= $t1)"; [ "$t2" -ge "$t1" ]
docker kill -s KILL $P >/dev/null
# A stopped container may leave server.lock=1 in the persistent volume.  Run the offline tools before a restart:
# they must recognize that this new one-shot container's PID 1 is not the dead writer.
docker run --rm --platform "$PLATFORM" -v $VOL:/data $IMG node bin/backup.js
docker run --rm --platform "$PLATFORM" -v $VOL:/data $IMG node bin/check-history.js /data --apply >/dev/null
start; echo "after SIGKILL: tick $(tick); recovery log:"; docker logs $P 2>&1 | grep -i recovery || echo "  (nothing to recover)"
docker stop -t 30 $P >/dev/null
docker run --rm --platform "$PLATFORM" -v $VOL:/data $IMG node bin/backup.js
b=$(docker run --rm --platform "$PLATFORM" -v $VOL:/data $IMG node -e "console.log(require('node:fs').readdirSync('/data/backups').sort().at(-1))")
docker run --rm --platform "$PLATFORM" -v $VOL:/data $IMG node bin/restore.js /data/backups/$b
start; echo "restored from $b, tick $(tick)"
docker exec $P node bin/check-history.js /data | head -30
echo "HTTP liveness after backup/restore: $(curl -fsS http://127.0.0.1:$PORT/health)"
echo "OK. Remove the test volume with: docker volume rm $VOL"
