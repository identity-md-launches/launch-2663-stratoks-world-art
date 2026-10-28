#!/usr/bin/env node
import { exportLegacyBackup } from '../src/rollback.js';
if (process.argv.length !== 4) { console.error('usage: node server/bin/export-legacy-backup.js VERIFIED_BACKUP NEW_OUTPUT_DIRECTORY'); process.exit(2); }
console.log(JSON.stringify(exportLegacyBackup(process.argv[2], process.argv[3]), null, 2));
