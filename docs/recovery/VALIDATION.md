# Local recovery — 27 October 2026

This is a recovered source candidate with local server, browser and container checks completed, NOT a deployed release. The IMD job itself has not been resumed.

Job: https://explorer.imd.fun/jobs/a314c4b3-1375-445e-b141-b94d8d1cab2c
Base: b57000a4c11af27369cce90d88f75d761a44ab9e
Recovered website: 81dac75fa39a050f0d6fe12db214a49ec081b560
Recovered revised backend: 48ee734d2d19b3942dad6588b09727dec3a340e5

## Recovery
All three accepted public Git bundles were downloaded and their SHA-256 hashes matched the API records. The revised backend was merged with the accepted website. Conflicts were resolved in deploy/check-docker.sh, server/docs/DURABILITY.md, server/src/service.js and server/src/store.js. The merge preserves pinned-descriptor history reads, rotation fsync, retained append queues, bounded committed cursors, and accumulated recovery evidence.

An integration failure was reproduced: backup.js still parsed the old numeric lock while the revised backend writes JSON. The backup CLI now uses writerIsLive. The shared parser also recognizes legacy numeric locks. The browser now uses the server boot epoch when replacing events, requesting resync and invalidating paged history; a regression covers a restart whose sequence has already caught up. The static dist was rebuilt.

## Verification performed here
- Original merged server run: 53 tests, 52 passed, one backup-lock failure.
- After backup correction: all 27 affected backup/durability/history/repair tests passed in an isolated, network-disabled x86 Docker container; the other 26 tests passed in the first run. Raw TAP logs are included. This is not native ARM64 verification.
- TypeScript check passed after correcting a regression-test fixture.
- Production Vite build passed; worker_threads externalization warning remains from a wallet dependency.
- All three frontend test files passed in the local runner; see web-tests.tap. The runner reports file-level results.
- Browser authenticated integration: **10/10 checks passed** against the real local service using synthetic wallet accounts, with no real payments. Evidence: browser-final/client-checks.json and browser-final.txt. The earlier Tools timeouts were due to the host lacking a Fontconfig setup; using the already installed local font configuration resolved them without changing Tools UI code. The test's public-read window was reset before the two HTTP allowance checks because the revised server correctly counts WebSocket upgrades against the same allowance.
- Actual deployment Dockerfile built for linux/amd64 and passed isolated container checks: health, allowed/foreign origins, graceful restart, SIGKILL restart, offline backup, history migration, and backup restore. Evidence: container-smoke.txt. No native ARM64, public HTTPS/WSS or sustained capacity claim.

## Remaining work
1. Deploy a separate test instance to the selected new VPS, then verify its architecture, persistent storage and HTTPS/WSS. No production server was changed in these checks.
2. Re-run independent reviews on this exact merged source.
3. Publish the merged source and rebuilt dist, then verify the public URL and returned bytes. No new public URL/CID is claimed.

The prior worker referenced artifacts/phase-1.1 files that were not included in its accepted Git bundle. Do not treat its historical validation counts as independently reproduced evidence. Current evidence is in this directory.

## Repeat browser checks on this host
```
FONTCONFIG_FILE=/tmp/unlk-visual-review/fonts.conf \
CHROMIUM_EXECUTABLE_PATH=/tmp/unlk-visual-review/browsers/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell \
LD_LIBRARY_PATH=/tmp/unlk-visual-review/libs/usr/lib/x86_64-linux-gnu \
PATH=/opt/imd-worker/node-v24.21.0-linux-x64/bin:$PATH \
node web/scripts/check-phase11.mjs docs/recovery/browser-final
```
These paths are specific to the recovery host. On another host install Playwright's normal browser and system dependencies, then omit those environment overrides. The source test also supports a normal `web/node_modules` install.
