#!/usr/bin/env bash
# Process-level smoke (no Docker needed; run from anywhere: bash deploy/smoke-process.sh): real server binary, SIGTERM + SIGKILL restarts, health, origin, LEARNING invalid/applied.
set -u
D=$(mktemp -d); P=18787; S=server/src/main.js; cd "$(dirname "$0")/.."
run() { env DATA_DIR=$D PORT=$P HOST=127.0.0.1 TICK_MS=50 ALLOWED_ORIGINS=https://client.test LOG_LEVEL=info "$@" node $S > $D/log.$RANDOM 2>&1 & pid=$!; }
waitup() { for i in $(seq 1 50); do curl -sf http://127.0.0.1:$P/health >/dev/null && return 0; sleep 0.1; done; return 1; }
run; waitup && echo "start1 health: $(curl -s http://127.0.0.1:$P/health)"
sleep 1.5; t1=$(curl -s http://127.0.0.1:$P/api/status | node -pe 'JSON.parse(require("fs").readFileSync(0)).tick')
echo "CORS allowed: $(curl -s -o /dev/null -D - -H 'Origin: https://client.test' http://127.0.0.1:$P/health | grep -i access-control-allow-origin | tr -d '\r')"
echo "CORS other origin header lines: $(curl -s -o /dev/null -D - -H 'Origin: https://evil.test' http://127.0.0.1:$P/health | grep -ci access-control-allow-origin)"
echo "events bad limit: $(curl -s "http://127.0.0.1:$P/api/events?limit=9999")"
kill -TERM $pid; wait $pid; echo "SIGTERM exit=$?"
run; waitup; t2=$(curl -s http://127.0.0.1:$P/api/status | node -pe 'JSON.parse(require("fs").readFileSync(0)).tick'); echo "tick before stop=$t1 after restart=$t2 (same world, no reseed)"
sleep 1; kill -KILL $pid; wait $pid 2>/dev/null; echo "SIGKILL done"
run LEARNING=0; waitup; echo "after SIGKILL + LEARNING=0: $(curl -s http://127.0.0.1:$P/api/status | node -pe 'const j=JSON.parse(require("fs").readFileSync(0)); JSON.stringify({tick:j.tick,learning:j.learning,action:j.learningPolicy.action})')"
grep -h "recovery\|LEARNING" $D/log.* | sed 's/^[^ ]* //'
kill -TERM $pid; wait $pid
env DATA_DIR=$D PORT=$P LEARNING=maybe node $S 2>&1 | grep -o "LEARNING=maybe is invalid[^.]*" | head -1; echo "invalid LEARNING exit=${PIPESTATUS[0]}"
DATA_DIR=$D node server/bin/backup.js | tail -1
node server/bin/check-history.js $D | node -pe 'const j=JSON.parse(require("fs").readFileSync(0)); JSON.stringify({irrecoverable:j.irrecoverable.length, lost:Object.values(j.logs).map(l=>l.lostBranchLines)})'
