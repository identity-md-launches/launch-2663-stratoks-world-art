import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store, restoreBackup } from '../server/src/store.js';
import { startApp, tmpDir } from './helpers.js';

test('separate backup CLI refuses a live writer, exports a stopped backup, and restores exact committed state', async () => {
  const app=await startApp({}, {manualTicks:true});
  const cli=new URL('../server/bin/backup.js',import.meta.url);
  const run=(args=[])=>spawnSync(process.execPath,[cli.pathname,...args],{env:{DATA_DIR:app.dataDir},maxBuffer:16*1024*1024});
  try{
    const unsafe=run();assert.equal(unsafe.status,1);assert.match(unsafe.stderr.toString(),/Stop the world service/);
    // In-process backups are still valid: no other JS tick can run during the copy.
    app.svc.snapshot(true);assert(fs.existsSync(path.join(app.svc.store.backup(),'manifest.json')));
  }finally{await app.stop();}
  const committed=new Store(app.dataDir,app.cfg.persistence).readSnapshot(path.join(app.dataDir,'world.json'));
  const exported=run(['--tar']);assert.equal(exported.status,0,exported.stderr.toString());
  const dest=tmpDir('stratoks-offsite'),tarFile=path.join(dest,'backup.tar');fs.writeFileSync(tarFile,exported.stdout);
  const extraction=spawnSync('tar',['-xf',tarFile,'-C',dest],{encoding:'utf8'});assert.equal(extraction.status,0,extraction.stderr);
  const label=fs.readdirSync(dest).find(n=>fs.statSync(path.join(dest,n)).isDirectory());assert(label);
  const restored=tmpDir('stratoks-restored');restoreBackup(restored,path.join(dest,label));
  assert.deepEqual(new Store(restored,app.cfg.persistence).readSnapshot(path.join(restored,'world.json')).state,committed.state);
});
