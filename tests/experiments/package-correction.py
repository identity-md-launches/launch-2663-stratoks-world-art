#!/usr/bin/env python3
"""Reproducible complete app/source/static VPS package; excludes generated deps/data.
Evidence stays in the enclosing submission. No Git writes, production files or tools.
"""
from pathlib import Path
import gzip
import hashlib
import io
import json
import tarfile

root = Path(__file__).resolve().parents[2]
trees = ['server', 'shared', 'web', 'dist', 'tests/fixtures', 'tests/experiments', 'tests/load', 'docs/correction', 'deploy/phase2a-demo']
single = ['README.md', 'DESIGN.md', 'deploy/Dockerfile', 'deploy/correction-vps-compose.yml', 'deploy/correction-benchmark.Dockerfile']
files = set(single)
for tree in trees:
    for p in (root / tree).rglob('*'):
        rel = p.relative_to(root).as_posix()
        if p.is_symlink():
            raise RuntimeError('Symlink in package: ' + rel)
        if p.is_file() and not any(v in ['node_modules', '.cache', '.npm', '__pycache__'] for v in p.parts):
            if rel not in ['docs/correction/PACKAGE.json', 'docs/correction/INTEGRITY.json'] and not rel.startswith('docs/correction/screens/'):
                files.add(rel)
files.update(p.relative_to(root).as_posix() for p in (root / 'tests').glob('*.js'))
# Preserve the older-binary compatibility fixture and migration/science explanations.
files.update(['docs/phase2a/MIGRATION.md', 'docs/phase2a/MODEL.md', 'docs/ASSETS.md'])
files.update(p.relative_to(root).as_posix() for p in (root / 'docs/licenses').glob('*') if p.is_file())
manifest = []
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode='w', format=tarfile.PAX_FORMAT) as archive:
    for rel in sorted(files):
        source = root / rel
        data = source.read_bytes()
        info = tarfile.TarInfo(rel)
        info.size = len(data)
        info.mode = 0o755 if source.stat().st_mode & 0o111 else 0o644
        info.uid = info.gid = 0
        info.uname = info.gname = ''
        info.mtime = 0
        archive.addfile(info, io.BytesIO(data))
        manifest.append({'file': rel, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
target = root / 'deploy/correction-vps.tar.gz'
with target.open('wb') as output:
    with gzip.GzipFile(filename='', fileobj=output, mode='wb', compresslevel=9, mtime=0) as zipped:
        zipped.write(buf.getvalue())
result = {'archive': target.relative_to(root).as_posix(), 'archiveBytes': target.stat().st_size,
          'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'files': manifest,
          'exclusions': ['Git metadata', 'production/configuration/data', 'dependency/cache/browser directories',
                         'historical and current experiment raw evidence (retained in enclosing repository)',
                         'CAR archive (delivered separately)', 'PACKAGE.json (avoids self-reference)'],
          'hosting': 'No deployment performed; owner review required. Docker profile is unverified on this worker.'}
(root / 'docs/correction/PACKAGE.json').write_text(json.dumps(result, indent=2) + '\n')
with tarfile.open(target, 'r:gz') as archive:
    for row in manifest:
        assert hashlib.sha256(archive.extractfile(row['file']).read()).hexdigest() == row['sha256']
print(json.dumps({'archive': result['archive'], 'bytes': result['archiveBytes'], 'sha256': result['sha256'], 'filesVerified': len(manifest)}))
