// Current client frame capacity probe. Eight observers serialize the real /frame payload EACH tick.
// Accelerated CPU workload, not eight network/browser clients; see check-expanse.mjs for real synchronization.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { Expanse } from '../../server/src/expanse/engine.js';
import { frame } from '../../server/src/expanse/view.js';
const population=Number(process.argv[2]??24),ticks=Number(process.argv[3]??10000),output=process.argv[4];
const e=Expanse.create({initialCount:population},{seed:4242});
const steps=[],observers=[],combined=[],rss=[],pops=[],payload=[];
for(let i=0;i<ticks;i++){
  const start=performance.now();e.step();const stepped=performance.now();
  for(let k=0;k<8;k++){
    const c=e.creatures[(k*7)%Math.max(1,e.creatures.length)];
    const msg=JSON.stringify(frame(e,{x:(c?.x??28)-28,y:(c?.y??28)-20,w:56,h:40,creature:c?.id??null}));
    if(i%250===0)payload.push(Buffer.byteLength(msg));
  }
  const end=performance.now();steps.push(stepped-start);observers.push(end-stepped);combined.push(end-start);
  if(i%250===0){rss.push(process.memoryUsage().rss);pops.push(e.creatures.length);}
}
const stats=(a)=>{const s=a.slice().sort((a,b)=>a-b);const q=p=>Math.round(s[Math.min(s.length-1,Math.floor(s.length*p))]*1000)/1000;return {mean:Math.round(a.reduce((s,v)=>s+v,0)/a.length*1000)/1000,p95:q(.95),p99:q(.99),max:q(1)};};
const result={seed:4242,populationStart:population,ticks,observers:8,framesPerTick:8,populationEnd:e.creatures.length,populationSamples:pops,births:e.totals.births,deaths:e.totals.deathsByCause,deferred:e.totals.deferred,
  simulationTickMs:stats(steps),eightFramesMs:stats(observers),combinedMs:stats(combined),rssMiB:{max:Math.round(Math.max(...rss)/1048576),samples:rss.map(v=>Math.round(v/1048576))},frameBytes:{mean:Math.round(payload.reduce((s,v)=>s+v,0)/payload.length),max:Math.max(...payload)},snapshotGzipBytes:zlib.gzipSync(JSON.stringify(e.toState())).length,
  node:process.version,arch:process.arch,note:'Accelerated single process. No ARM64 verification, CPU/memory cgroup, network, browser rendering or HTTPS overhead. Natural births/deaths retained. Each observer requests the full roster and selected inspector every tick.'};
if(output)fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
