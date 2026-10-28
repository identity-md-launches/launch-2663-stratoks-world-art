#!/usr/bin/env python3
"""Offline packaging check/export; no application files are mutated."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[2]
output = root / 'test/scratch/phase2a-export.zip'
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for tree in ['server', 'shared', 'tests', 'deploy', 'docs']:
        for path in sorted((root / tree).rglob('*')):
            if path.is_file():
                archive.write(path, path.relative_to(root).as_posix())
limit = 8 * 1024 * 1024
size = output.stat().st_size
assert size <= limit, f'Full offline export {size} exceeds {limit}'
release = json.loads((root / 'docs/phase2a/RELEASE.json').read_text())
assert hashlib.sha256((root / release['sourceBundle']).read_bytes()).hexdigest() == release['sourceBundleSha256']
assert hashlib.sha256((root / 'deploy/recovered/stratoks-09af84d.zip').read_bytes()).hexdigest() == release['baselineSha256']
for entry in json.loads((root / 'docs/phase2a/inventory.json').read_text())['files']:
    data = (root / entry['path']).read_bytes()
    assert len(data) == entry['bytes'], entry['path']
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['path']
print(json.dumps({'exportBytes': size, 'limitBytes': limit,
                  'baselineChecksum': 'verified', 'bundleChecksum': 'verified',
                  'inventory': 'verified', 'export': 'test/scratch/phase2a-export.zip'}))
