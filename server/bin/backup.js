#!/usr/bin/env node
import { Store, writerIsLive } from '../src/store.js';
import { loadConfig } from '../src/config.js';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
const cfg = loadConfig();
// Unlike the authenticated in-process endpoint, this CLI is a separate process:
// copying while the simulator appends/rotates cannot form a consistent backup.
if (writerIsLive(cfg.server.dataDir)) throw new Error('Stop the world service before running the backup CLI, or use the authenticated /api/dev/backup endpoint.');
const s = new Store(cfg.server.dataDir, cfg.persistence);
const dest = s.backup();
if (!process.argv.includes('--tar')) console.log('backup written to', dest);
else {
  // A portable tar stream lets Docker operators copy the stopped-volume backup
  // offsite without installing Node on the host or changing volume permissions.
  const label = path.basename(dest);
  const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
  const write = async (buf) => { if (!process.stdout.write(buf)) await once(process.stdout, 'drain'); };
  for (const file of [...Object.keys(manifest.files), 'manifest.json']) {
    const data = fs.readFileSync(path.join(dest, file));
    const h = Buffer.alloc(512);
    h.write(`${label}/${file}`, 0, 100, 'utf8');
    const oct = (n, off, size) => h.write(n.toString(8).padStart(size - 1, '0') + '\0', off, size, 'ascii');
    oct(0o644, 100, 8); oct(0, 108, 8); oct(0, 116, 8); oct(data.length, 124, 12); oct(0, 136, 12);
    h.fill(32, 148, 156); h[156] = 48; h.write('ustar\0', 257, 6, 'ascii'); h.write('00', 263, 2, 'ascii');
    const checksum = h.reduce((a, b) => a + b, 0);
    h.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    await write(h); await write(data);
    if (data.length % 512) await write(Buffer.alloc(512 - data.length % 512));
  }
  await write(Buffer.alloc(1024));
}
