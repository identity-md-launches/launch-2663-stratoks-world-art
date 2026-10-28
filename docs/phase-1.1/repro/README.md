Baseline reproductions used for the "Before" column of FINDINGS.md. They import the baseline code from `./base`:
`mkdir base && git archive b57000a server tests | tar -x -C base`, then run `node before-events.mjs` and `node before-crash.mjs` from this directory.
Outputs: `../events-before.json`, `../crash-before.json`.
