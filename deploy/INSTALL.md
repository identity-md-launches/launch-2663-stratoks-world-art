# Installing the Stratoks world server on your own VPS

Target: Ubuntu ARM64, 2 shared vCPU, 4 GB RAM, 40 GB SSD. The recovered version passed isolated **linux/amd64 Docker** health, persistence, SIGTERM/SIGKILL, origins and backup/restore checks. See [current recovery evidence](../docs/recovery/VALIDATION.md). Native ARM64, public TLS/WSS and actual target capacity remain unverified. `bash deploy/check-docker.sh linux/arm64` runs an isolated check on the target host. It uses a unique container/image/volume name by default and does not touch the production service. Only set `CHECK_NAME` to a name reserved for disposable tests.

1. **DNS**: point an A/AAAA record (e.g. `world.example.com`) at the VPS. Open ports 80 and 443.
2. **Docker**: `curl -fsSL https://get.docker.com | sh` (Docker Engine + compose plugin), then `sudo usermod -aG docker $USER` and re-login.
3. **Get the code**: clone this repository, or extract the recovered source ZIP into your chosen installation directory, then enter its `deploy/` directory. The package includes the server, shared protocol, deployment files and operator docs. Keep existing data volumes when upgrading; follow the migration section below first.
4. **Configure**: `cp env.example stratoks.env` and edit:
   * `ALLOWED_ORIGINS` = the exact origin of the IMD-hosted client (e.g. `https://yourname.imd.example`).
   * `DEV_WALLETS` = your developer wallet address(es), lowercase.
   * Export the hostname for the proxy in that shell: `export SERVER_HOSTNAME=world.example.com` (use your real hostname).
5. **Start**: `docker compose up -d --build` — builds for `linux/arm64`, starts the server and Caddy (automatic HTTPS/WSS).
6. **Check**: `curl https://world.example.com/health` → `{"ok":true,...}`; `docker compose ps` should show `healthy`.
7. **Point the client** at `https://world.example.com` and `wss://world.example.com/ws` (the client's server-URL setting). Until it is set the client shows "World server not connected".
8. **Backups**: `./backup.sh` (also via cron, see script). It briefly stops the world, exports a consistent checksummed backup, and restarts it. Copy `backups-offsite/` off the VPS. Restore: `./restore.sh backups-offsite/<name>`. Do not run the separate `bin/backup.js` CLI against a live writer; use the authenticated in-process backup endpoint for an online backup.
9. **Upgrade**: `git pull && docker compose up -d --build`. Snapshots are migrated automatically (`src/migrations.js`); a newer-than-supported snapshot is refused.
   **Upgrading an existing Phase 1 world to 1.1**: back up first, run `node bin/check-history.js /data`, and follow `server/docs/DURABILITY.md` (non-destructive history repair, intervention-ID migration, rollback). If it reports a lost branch, stop the service and run `check-history.js /data --apply` before starting the new server; startup deliberately refuses ambiguous legacy histories.

## Operations
* Logs: `docker compose logs -f world` (container logs rotate at 10 MB × 3).
* Health: `/health` (liveness), `/api/status` (tick latency p50/p95/p99, lag, `overloaded`, CPU, RSS, clients). Watch `overloaded`.
* Stop/restart safely: `docker compose stop world` (30 s grace, writes a final snapshot). Crash/power loss: loses at most the last ~30 s of simulation (snapshot interval), except interventions, which are snapshotted before they are acknowledged. Log records past the last snapshot are moved to `/data/recovery/` on the next start so history matches the recovered world (`server/docs/DURABILITY.md`).
* Proxy: Caddy overwrites `X-Forwarded-For` with the real peer; the world port is only `expose`d on the compose network, never published. Keep it that way: with `TRUST_PROXY=1` the server believes the header only from private/loopback peers (`TRUSTED_PROXIES` to narrow).
* `LEARNING`: leave unset to keep the stored setting; `0`/`1` applies on restart without erasing weights (`server/docs/LEARNING.md`).
* **Downtime behaviour**: world time pauses while the server is down. On start at most 600 ticks of non-lethal, birth-free catch-up are simulated, a `downtime` event is logged, and the rest of the outage is skipped. An outage never kills the population.
* **Overload**: the world slows down and broadcasts are thinned; creatures are never deleted to save CPU.
* Reset (destructive, developer wallet only): `POST /api/dev/reset {"confirm":"RESET <worldId>"}`; the old world is archived under `/data/archive`.
* Manual restore without scripts: stop the container, then `docker compose run --rm --no-deps -v <dir>:/restore:ro world node bin/restore.js /restore`.

## Remaining operator setup / not done
* Domain, TLS, firewall (`ufw allow 80,443/tcp`), developer wallet list, client URL configuration.
* Native/emulated ARM64, the production Compose configuration and actual VPS capacity verification. Earlier x86_64 measurements in the historical handoff are not target-capacity guarantees.
* Off-site copy of `backups-offsite/` (e.g. rsync to another host).
* Phase 2+: payments, polished client art, public extinction/recovery policy (not part of this phase).
