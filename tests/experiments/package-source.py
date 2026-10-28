#!/usr/bin/env python3
"""Build a deterministic source-only Git bundle; evidence/assets stay in submission.
Uses only Python/Git, writes disposable Git metadata under test/scratch.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
EXCLUSIONS = [
    'deploy/phase2a-source.bundle',
    'deploy/recovered/stratoks-09af84d.zip',
    'tests/results',
    'deploy/phase2a-demo/world',
    'docs',
    'docs/phase2a/RELEASE.json',
    'docs/phase2a/PACKAGING.md',
]

def excluded(path):
    return any(path == e or path.startswith(e + '/') for e in EXCLUSIONS) or path.endswith('.png')

scratch = ROOT / 'test/scratch'
scratch.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='source-bundle-', dir=scratch) as temp:
    dest = Path(temp)
    for tree in ['server', 'shared', 'tests', 'deploy', 'docs']:
        for source in sorted((ROOT / tree).rglob('*')):
            relative = source.relative_to(ROOT)
            if source.is_file() and not excluded(relative.as_posix()):
                target = dest / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
                target.chmod(0o755 if source.stat().st_mode & 0o111 else 0o644)
    env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null',
               GIT_AUTHOR_NAME='Stratoks component build', GIT_AUTHOR_EMAIL='build@invalid',
               GIT_COMMITTER_NAME='Stratoks component build', GIT_COMMITTER_EMAIL='build@invalid',
               GIT_AUTHOR_DATE='2026-10-27T00:00:00Z', GIT_COMMITTER_DATE='2026-10-27T00:00:00Z')
    def git(*args):
        return subprocess.check_output(['git', '-C', str(dest), *args], env=env, stderr=subprocess.STDOUT).decode().strip()
    git('init', '-q', '-b', 'component')
    git('add', '.')
    git('commit', '-qm', 'Reduced mushroom-body circuit and reproducible component source')
    commit = git('rev-parse', 'HEAD')
    bundle = ROOT / 'deploy/phase2a-source.bundle'
    git('bundle', 'create', str(bundle), 'HEAD')
    git('bundle', 'verify', str(bundle))
    release_path = ROOT / 'docs/phase2a/RELEASE.json'
    release = json.loads(release_path.read_text())
    release.update(sourceCommit=commit, sourceBundleSha256=hashlib.sha256(bundle.read_bytes()).hexdigest(),
                   sourceBundleBytes=bundle.stat().st_size,
                   bundleExclusions=EXCLUSIONS + ['**/*.png'],
                   bundleScope='Source-only supplemental commit. Excluded evidence, baseline ZIP and PNGs remain in enclosing submission; see SOURCE.md.')
    release_path.write_text(json.dumps(release, indent=2) + '\n')
    print(json.dumps({'sourceCommit': commit, 'bundleBytes': bundle.stat().st_size}))
