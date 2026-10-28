#!/usr/bin/env python3
"""Materialize the complete verified baseline into an empty review/build directory.
No network/install needed. Run outside production; overlay current server/shared/tests
and deploy/Dockerfile afterward if building the Phase 2A backend with the old client.
"""
import hashlib, pathlib, sys, zipfile
archive = pathlib.Path(__file__).parent / 'recovered/stratoks-09af84d.zip'
assert hashlib.sha256(archive.read_bytes()).hexdigest() == '8816bfda36545436f85d4ca0b13bd439be14fb3a6be285f25bd39f3edf8abd9e', 'baseline checksum mismatch'
if len(sys.argv) != 2:
    raise SystemExit('usage: python3 deploy/materialize-recovered.py EMPTY_OUTPUT_DIRECTORY')
dest = pathlib.Path(sys.argv[1])
if dest.exists() and any(dest.iterdir()):
    raise SystemExit('output directory must be empty; refusing overwrite')
with zipfile.ZipFile(archive) as z:
    for info in z.infolist():
        p = pathlib.PurePosixPath(info.filename)
        if p.is_absolute() or '..' in p.parts or '.git' in p.parts:
            raise SystemExit('unsafe archive path')
    z.extractall(dest)
print('Verified recovered baseline 09af84d67722e30c0cb0c096ab8a8189a3b03166 materialized.')
