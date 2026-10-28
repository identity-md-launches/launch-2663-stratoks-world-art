# Static release handoff and HTTPS boundary

The corrected static export is `dist/`, with relative asset URLs, complete runtime assets, metadata/favicon/share image, source and original lockfile. It works under `/preview/` in Chromium/WebKit and can run its private simulation and learning experiments without any backend. The normal shared-world backend address is intentionally owner-settable rather than guessed.

`RELEASE.json` records the accepted revision parent `ca7a1770779b3c55e519fc98ed80abe4b983fa7f` (the original integration was `99e50b1c275b9422c14f279498b3e192b151992b`), exact per-file source/export hashes and the locally computed release CID:

`bafybeifukwi4jdpv4sf572jkdung5zgkhe76nkchsxl2gmd5g62mpetqpm`

`deploy/correction-client.car.gz` is a gzip-compressed CAR v1 rooted at that CID. All CAR block hashes were checked and all 19 files traversed with an independent UnixFS exporter and compared byte-for-byte with `dist/`. This proves the archive's contents, not public availability. CIDv1, raw leaves, a wrapping directory, fixed 262,144-byte chunks and the exact importer version/settings are recorded. Another publisher may choose different import settings and therefore a different valid CID for identical files; verify served bytes instead of assuming the CID matches.

No authenticated publishing tool is available to this worker. It has no control of IMD pinning, ENS records, gateway DNS, certificates or the final Git submission commit. No publishing credentials or local account configuration were read. `submissionCommit` remains null because the contributor service creates it after this run; it is not replaced with an invented hash. Once assigned, record the real final commit and compare this manifest against that checkout using `node tests/experiments/check-correction.mjs`.

The original ENS gateway `https://stratoks-a-little-world-unf-0d68.identitymd.eth.limo/` reproduced curl exit 35 (`tlsv1 alert internal error`). Requests to `https://<computed-CID>.ipfs.dweb.link/` and `https://ipfs.io/ipfs/<computed-CID>/` returned HTTP 429. `HTTPS.json` retains exact requests, statuses, errors and response hashes. No working public HTTPS URL to the corrected export is claimed. Testing a locally valid CAR cannot certify a gateway, and the prior release CID cannot identify this correction.

The platform can publish the committed `dist/` normally. An operator with their own IPFS node can alternatively import the supplied exact CAR (these commands were not run here):

```sh
gzip -dc deploy/correction-client.car.gz > /tmp/stratoks-correction-client.car
ipfs dag import /tmp/stratoks-correction-client.car
ipfs pin add bafybeifukwi4jdpv4sf572jkdung5zgkhe76nkchsxl2gmd5g62mpetqpm
```

After pinning, select an actually serving HTTPS gateway or the repaired ENS URL and run:

```sh
node web/scripts/check-correction-https.mjs <actual-https-base-url-ending-in-slash>
```

It requires HTTPS throughout redirects, HTTP 200 and matching SHA-256 for **every** export file. It rejects stale releases, challenge/error pages and partial availability, records `HTTPS.json`, and returns nonzero unless an exact gateway passes. Then open that URL in a browser and repeat the demo/inspector/lab interactions. Only after these checks should `publicHttpsVerified` be reported true. Backend hosting remains separate.

To rebuild the optional CAR and byte manifest from the finished export, install release-only tools outside the repository, then run:

```sh
npm --prefix /tmp/stratoks-release-tools --cache /tmp/stratoks-npm-cache install --no-audit --no-fund ipfs-unixfs-importer@17.1.1 ipfs-unixfs-exporter@16.2.3 @ipld/car@5.4.7
node web/scripts/release-correction.mjs /tmp/stratoks-release-tools
```

These tools are not application dependencies and are not shipped. The pre-existing application manifests and lockfile are unchanged. The CAR and VPS archive are required delivery artifacts; no npm cache, registry mirror, dependency tarballs, node_modules or Git submodule is included.
