#!/usr/bin/env node
import { restoreBackup } from '../src/store.js';
import { loadConfig } from '../src/config.js';
const cfg = loadConfig();
if (!process.argv[2]) { console.error('usage: restore.js <backup-dir>   (stop the server first)'); process.exit(2); }
console.log(JSON.stringify(restoreBackup(cfg.server.dataDir, process.argv[2]), null, 2));
