# Baseline archives not carried in this commit

This commit leaves out four binary package archives from the baseline tree
(`identity-md-launches/launch-2613-stratoks-phase-integrate-scientifically` at
`8d4193ef8dc76cfcb1794f719e1a688e4355a01d`). Together they total about 7.2 MB, and keeping them would push the submission over the 8 MiB upload
limit. They are redundant generated packages of earlier releases. No Phase 2B code, test or
experiment reads them. Baseline docs (`docs/correction/*`, `docs/phase2a/*`) still list
them by hash. To get them back byte-for-byte, check them out from the pinned baseline commit and
verify the hashes below:

| Path | Bytes | sha256 |
|---|---|---|
| `deploy/recovered/stratoks-09af84d.zip` | 4187512 | `8816bfda36545436f85d4ca0b13bd439be14fb3a6be285f25bd39f3edf8abd9e` |
| `deploy/correction-vps.tar.gz` | 2128976 | `01474f7890a0874419de76ff7fba9d8ed9259a02281b7cef60efec44faa6cae2` |
| `deploy/correction-client.car.gz` | 685097 | `aa09f9be01c9f907a12a5c577eaef61926ec8f3f138fc8056d43e722f1d53593` |
| `deploy/phase2a-source.bundle` | 159349 | `e17b50ad11e2d2bf17ad6f287f6fec2649d935ed2fd155445b5d1ab278feb49a` |

```sh
git fetch https://github.com/identity-md-launches/launch-2613-stratoks-phase-integrate-scientifically 8d4193ef8dc76cfcb1794f719e1a688e4355a01d
git checkout FETCH_HEAD -- deploy/recovered/stratoks-09af84d.zip deploy/correction-vps.tar.gz deploy/correction-client.car.gz deploy/phase2a-source.bundle
sha256sum deploy/recovered/stratoks-09af84d.zip deploy/correction-vps.tar.gz deploy/correction-client.car.gz deploy/phase2a-source.bundle
```

All other in-scope baseline files are imported unchanged, including raw results, screenshots and the Phase 2A demo bundle.
