#!/usr/bin/env python3
"""Validate delivered atlas PNGs using only Python's standard library.

Does not modify the images. Bounds use alpha > 16 to ignore faint edge noise.
Run from repository root: python3 tools/art/check_atlases.py
"""
import hashlib
import json
import struct
import zlib
from collections import Counter
from pathlib import Path


def paeth(a, b, c):
    p = a + b - c
    ds = [abs(p - a), abs(p - b), abs(p - c)]
    return [a, b, c][ds.index(min(ds))]


def inspect(path):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'Not a PNG'
    chunks, pos = {}, 8
    while pos < len(data):
        size = struct.unpack('>I', data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        payload = data[pos + 8:pos + 8 + size]
        crc = struct.unpack('>I', data[pos + 8 + size:pos + 12 + size])[0]
        assert zlib.crc32(kind + payload) & 0xffffffff == crc, 'Invalid PNG CRC'
        chunks.setdefault(kind, []).append(payload)
        pos += size + 12
    w, h, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', chunks[b'IHDR'][0])
    assert depth == 8 and color == 6 and interlace == 0, 'Expected non-interlaced 8-bit RGBA'
    raw = zlib.decompress(b''.join(chunks[b'IDAT']))
    stride, rows, offset = w * 4, [], 0
    previous = bytearray(stride)
    for y in range(h):
        f = raw[offset]
        line = bytearray(raw[offset + 1:offset + 1 + stride])
        offset += stride + 1
        assert 0 <= f <= 4
        for x in range(stride):
            a, b, c = line[x - 4] if x >= 4 else 0, previous[x], previous[x - 4] if x >= 4 else 0
            predictor = (0, a, b, (a + b) // 2, paeth(a, b, c))[f]
            line[x] = (line[x] + predictor) & 255
        rows.append(line)
        previous = line
    alpha = [row[3::4] for row in rows]
    histogram = Counter(a for row in alpha for a in row)
    transparent = sum(row.count(0) for row in alpha)
    partial = sum(sum(0 < a < 255 for a in row) for row in alpha)
    assert transparent > w * h * .1, 'Insufficient transparent space'
    cells = []
    for r in range(8):
        for c in range(8):
            x0, x1, y0, y1 = c * w // 8, (c + 1) * w // 8, r * h // 8, (r + 1) * h // 8
            points = [(x, y) for y in range(y0, y1) for x in range(x0, x1) if alpha[y][x] > 16]
            bounds = [min(x for x, y in points), min(y for x, y in points), max(x for x, y in points) + 1, max(y for x, y in points) + 1] if points else None
            padding = [bounds[0] - x0, bounds[1] - y0, x1 - bounds[2], y1 - bounds[3]] if bounds else None
            cells.append({'row': r, 'column': c, 'rect': [x0, y0, x1 - x0, y1 - y0], 'alphaBounds': bounds, 'paddingLTRB': padding})
    return {'path': str(path), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'format': 'image/png', 'width': w, 'height': h, 'color': 'RGBA', 'bitDepth': depth, 'transparentPixels': transparent, 'partialAlphaPixels': partial, 'alphaHistogram': dict(sorted(histogram.items())), 'transparentFraction': round(transparent / (w * h), 5), 'emptyCells': sum(c['alphaBounds'] is None for c in cells), 'cellsTouchingBoundary': sum(min(c['paddingLTRB']) == 0 for c in cells if c['paddingLTRB']), 'grid': [8, 8], 'cells': cells}


if __name__ == '__main__':
    report = {'scope': 'PNG bytes, alpha and proposed 8x8 extraction grid; does not certify animation or semantics', 'assets': [inspect(Path('artifacts/art') / name) for name in ('characters.png', 'world.png')]}
    out = Path('docs/art/atlas-validation.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + '\n')
    for asset in report['assets']:
        print(json.dumps({k: v for k, v in asset.items() if k not in ('cells', 'alphaHistogram')}))
