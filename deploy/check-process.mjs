// Isolated, dependency-free smoke check of the delivered Node service.
// Uses only generated world data and explicitly supplied child configuration.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stratoks-process-check-'));
const port=Number(process.argv[2]??18790),base=`http://127.0.0.1:${port}`;
const origin='https://client.test';
const results={date:new Date().toISOString(),checks:[],errors:[],platform:'Node process only; no architecture or container inspection'};
const pass=(name,data={})=>{results.checks.push({name,passed:true,...data});console.log('PASS',name,JSON.stringify(data));};
let child,childExit;
const runCli=(file,args=[])=>{
  const r=spawnSync(process.execPath,[file,...args],{cwd:root,env:{DATA_DIR:dir},encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);return r.stdout;
};
async function boot(learning){
  const env={DATA_DIR:dir,HOST:'127.0.0.1',PORT:String(port),TICK_MS:'50',ALLOWED_ORIGINS:origin,LOG_LEVEL:'error'};
  if(learning!==undefined)env.LEARNING=learning;
  child=spawn(process.execPath,['server/src/main.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',d=>{log+=d;});child.stderr.on('data',d=>{log+=d;});
  let exited=false;childExit=new Promise(r=>child.once('exit',(code,signal)=>{exited=true;r({code,signal});}));
  const deadline=Date.now()+10_000;
  while(Date.now()<deadline){
    if(exited)throw Error('Service exited during startup: '+log);
    try{const r=await fetch(base+'/health');if(r.ok&&(await r.json()).ok)return;}catch{}
    await new Promise(r=>setTimeout(r,25));
  }
  throw Error('Service did not become healthy: '+log);
}
async function stop(signal='SIGTERM'){
  child.kill(signal);const exit=await childExit;child=null;
  if(signal==='SIGTERM')assert.equal(exit.code,0);else assert.equal(exit.signal,signal);
}
const status=async()=>fetch(base+'/api/status').then(r=>r.json());
async function upgrade(origin){
  return new Promise((resolve,reject)=>{
    const req=http.get(base+'/ws',{headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':randomBytes(16).toString('base64'),Origin:origin}});
    req.on('upgrade',(r,socket)=>{socket.destroy();resolve(r.statusCode);});
    req.on('response',r=>{r.resume();resolve(r.statusCode);});req.on('error',reject);
  });
}
try{
  await boot();const a=await status();
  assert(a.world.worldId);pass('real service starts healthy with a generated persistent world');
  const allowed=await fetch(base+'/health',{headers:{Origin:origin}});
  assert.equal(allowed.headers.get('access-control-allow-origin'),origin);
  const foreign=await fetch(base+'/health',{headers:{Origin:'https://other.test'}});
  assert.equal(foreign.headers.get('access-control-allow-origin'),null);
  assert.equal(await upgrade(origin),101);assert.equal(await upgrade('https://other.test'),403);
  pass('HTTP CORS and WebSocket upgrade enforce the configured browser origin');
  const bad=await fetch(base+'/api/events?after=-1&limit=1');assert.equal(bad.status,400);
  pass('invalid event cursor returns HTTP 400');
  await stop();
  const committed=JSON.parse(await fs.readFile(path.join(dir,'world.json'),'utf8'));
  await boot();const b=await status();
  assert.equal(b.world.worldId,a.world.worldId);assert(b.tick>=committed.state.tick);
  pass('SIGTERM/restart retains the same world without reseeding',{committedTick:committed.state.tick,restartedTick:b.tick});
  await stop('SIGKILL');await boot('0');const c=await status();
  assert.equal(c.world.worldId,a.world.worldId);assert.equal(c.learning,false);assert.equal(c.learningPolicy.action,'disabled');
  pass('SIGKILL recovery retains world identity and applies explicit LEARNING=0');
  await stop();
  const backup=runCli('server/bin/backup.js').trim().replace('backup written to ','');
  const beforeRestore=JSON.parse(await fs.readFile(path.join(dir,'world.json'),'utf8'));
  const manifest=JSON.parse(await fs.readFile(path.join(backup,'manifest.json'),'utf8'));
  assert(Object.keys(manifest.files).includes('world.json'));
  runCli('server/bin/restore.js',[backup]);
  await boot();const d=await status();
  assert.equal(d.world.worldId,a.world.worldId);assert.equal(d.learning,false);assert(d.tick>=beforeRestore.state.tick);
  pass('checksummed backup/restore and restart preserve the existing world and learning setting');
  await stop();
  const history=JSON.parse(runCli('server/bin/check-history.js',[dir]));
  assert.equal(history.irrecoverable.length,0);
  assert(Object.values(history.logs).every(l=>l.aheadOfSnapshot===0));
  pass('history checker finds no irrecoverable inconsistencies or records ahead of the final snapshot');
}catch(e){results.errors.push(String(e.stack));console.error(e);process.exitCode=1;}
finally{
  if(child)await stop().catch(()=>{});
  await fs.rm(dir,{recursive:true,force:true});
  if(process.argv[3])await fs.writeFile(process.argv[3],JSON.stringify(results,null,2)+'\n');
}
