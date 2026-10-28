# Owner deployment, migration and rollback

This integration ships a static client and the full backend source. It does not deploy to or change the live reference. Keep the existing Phase 2A service and its data intact while reviewing the Expanse on a separate volume.

## Static client

Serve the committed `dist/` directory as static files. Relative asset paths and hash routing work under a gateway subpath; no route rewrites are needed. The entry point includes a title, description, favicon and local share image. Configure the Phase 2B URL in **Connect server**, or set `web/public/expanse-config.json` and rebuild. Never put credentials into static configuration.

The Expanse needs only GET access over HTTPS. It polls `/api/expanse/frame?x=…&y=…&w=…&h=…&creature=…` once a second. The optional creature is a living resident ID from the roster. The returned `tick` covers viewport, histories and inspector together. Legacy `/info`, `/view`, `/minimap`, `/creature/:id` and `/discoveries` reads remain available. All non-GET/HEAD requests are refused. CORS allows only explicitly listed origins and sends `Vary: Origin`; it is not authentication. Public world reads intentionally require no sign-in.

The pinned settlement client remains at `#settlement`, with separate HTTPS/WSS service settings and unchanged authorization. Do not point it at an Expanse API or assume the two services share state.

## Backend container

From the repository root:

```sh
docker build -f deploy/expanse/Dockerfile -t stratoks-expanse:review .
docker volume create stratoks-expanse-review
docker run --name stratoks-expanse-review --restart unless-stopped \
  --cpus=1.5 --memory=1536m \
  -p 127.0.0.1:8788:8788 \
  -v stratoks-expanse-review:/data \
  -e ALLOWED_ORIGINS="$STRATOKS_CLIENT_ORIGIN" \
  stratoks-expanse:review
```

Set `STRATOKS_CLIENT_ORIGIN` to the exact origin of the static client before running this command. No value is guessed in the export. Alternatively use `deploy/expanse/compose.yml` after setting its `ALLOWED_ORIGINS`. The image runs as `node`; `/data` is created with that user’s ownership so a new named volume is writable. For a bind mount, arrange matching ownership first.

`node:22-bookworm-slim` provides an ARM64 variant. Pin a reviewed base-image digest for production. Docker was unavailable on the authoring machine: this image and target-host cgroup behavior are **not verified**. Local Node HTTP service, persistence and browser interaction were tested.

Put the loopback backend behind the owner’s HTTPS reverse proxy. For a dedicated world domain, a minimal Caddy site is:

```caddy
{$STRATOKS_WORLD_DOMAIN} {
    reverse_proxy 127.0.0.1:8788
}
```

Set the domain in the owner’s Caddy service environment. Keep 8788 private. For a prefixed mount, use `handle_path /expanse/*` to strip `/expanse` before proxying and configure the client with that prefix. Caddy handles HTTPS; no Expanse WebSocket endpoint is implied. The preserved legacy service still uses its existing `deploy/Caddyfile` for WSS.

Check `/healthz` and two independent clients against the new review service. With every viewer closed, confirm that `tick` still increases. The service slows down rather than burst-catching up on late ticks; nobody is removed for budget.

## Migrate a copy

Never migrate the only copy of an existing world. Stop a **review copy** of the source service so its snapshot and logs are consistent, copy the complete data directory to a separately named backup, and verify its manifest/checksum. The legacy service continues to use its original data.

```sh
node server/bin/expanse-migrate.js "$STRATOKS_COPIED_PHASE2A/world.json" "$STRATOKS_NEW_EXPANSE_DATA"
```

Both paths are owner settings. The CLI validates the source checksum, refuses an existing destination snapshot, and does not write the source. Compare creature IDs, positions, brain weights, memories and migration history before running the new service against the destination. This preserves the original settlement and learned mb-v1 state; new Expanse behavior is a rules extension, not a claim of identical future trajectories.

Do not run both engines on one directory. Do not route production visitors to the review service until the owner has reviewed the exact final commit and copied-world results.

## Backup, restore and rollback on copies

Stop the review Expanse service first. SIGTERM performs a final save. Expanse snapshots use `expanse.json.gz` plus `manifest.json`, with three previous generations. Keep an independent copy of the **whole directory** as well as the snapshot backup; generation files are needed for rollback. Use the explicit Expanse persistence functions, not the legacy backup CLI:

```sh
node --input-type=module -e 'import {backup} from "./server/src/expanse/persist.js"; console.log(backup(process.argv[1],process.argv[2]))' "$STRATOKS_STOPPED_REVIEW_DATA" "$STRATOKS_REVIEW_BACKUP"
node --input-type=module -e 'import {restore,load} from "./server/src/expanse/persist.js"; restore(process.argv[1],process.argv[2]); console.log(load(process.argv[2]).tick)' "$STRATOKS_REVIEW_BACKUP" "$STRATOKS_RESTORE_COPY"
node --input-type=module -e 'import {rollback,load} from "./server/src/expanse/persist.js"; console.log(rollback(process.argv[1])); console.log(load(process.argv[1]).tick)' "$STRATOKS_ROLLBACK_COPY"
```

Every variable names a separate owner-controlled copied directory, never a running production directory. Restore verifies the checksum and preserves the replaced snapshot as `pre-restore-*`. Rollback preserves the replaced snapshot as `rolled-back-*`. Restart a review instance on the restored copy and compare IDs, mind/model/brain state and timeline tick. Last observations are transient and honestly unavailable until the next decision after restart; saved memories and plans remain.

To roll back the **integration deployment**, restore the previous static export and backend image/config, and attach the untouched prior data copy appropriate to that engine. An Expanse snapshot is not backward-compatible with the Phase 2A service. Keep the review export and its release manifest for analysis. Do not delete residents or reset brains as part of rollback.

## Tested extent

`tests/expanse.test.js` covers migration, conservation, exact save/load continuation, checksum refusal, backup/restore and rollback on temporary copies. `tests/expanse-client.test.js` covers coherent frames, unchanged agent evidence, CORS, rejected writes, two readers and persistence. Browser checks compare two independent contexts with actual server inspectors before and after transitions, then stop/restart the disposable server and verify recovery. These checks do not establish production storage crash guarantees beyond the existing implementation, host performance or an independent final-commit review.
