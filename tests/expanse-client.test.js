import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Expanse } from '../server/src/expanse/engine.js';
import { frame, inspect } from '../server/src/expanse/view.js';
import { startExpanse } from '../server/src/expanse/server.js';

test('frame returns real bounded navigation, coherent ticks and the unchanged recorded plan', () => {
  const e=Expanse.create({}, {seed:101}); e.run(150);
  const c=e.creatures[0], before=structuredClone({brain:c.brain,mind:c.mind,lastObs:c.lastObs,plan:c.plan}), rng=e.rng.s;
  const f=frame(e,{x:-90,y:-90,w:60,h:40,creature:c.id});
  assert.equal(f.tick,e.tick); assert.equal(f.view.tick,e.tick);
  assert(f.minimap.biomes.every(([, , kind])=>['temperate','arid','cold','coast'].includes(kind)));
  assert.equal(f.view.x0,-90); assert.equal(f.view.y0,-90); assert.equal(f.view.tiles.length,2400);
  assert.deepEqual(f.residents.map(r=>r.id),e.creatures.map(r=>r.id));
  assert.deepEqual(f.inspector,inspect(e,c.id));
  assert.deepEqual(f.inspector.observation,c.lastObs);
  if(c.plan){ assert.equal(f.inspector.currentPlan.tick,c.plan.tick);assert.equal(f.inspector.currentPlan.alternatives,c.plan.alternatives);assert.deepEqual(f.inspector.currentPlan.actual,c.plan.actual); }
  assert.equal(e.rng.s,rng); assert.deepEqual({brain:c.brain,mind:c.mind,lastObs:c.lastObs,plan:c.plan},before,'viewing distant terrain cannot reveal facts to a creature');
  const bounded=frame(e,{x:Infinity,y:-999999,w:9999,h:NaN,creature:999999});
  assert.equal(bounded.view.w,96);assert.equal(bounded.view.h,32);assert.equal(bounded.view.y0,e.bounds().y0);assert.equal(bounded.inspector,null);
  const edge=frame(e,{x:999999,y:999999,w:96,h:96});assert.equal(edge.view.x0+edge.view.w,e.bounds().x1);assert.equal(edge.view.y0+edge.view.h,e.bounds().y1);
});

test('two independent HTTP viewers receive identical authoritative evidence; writes are refused and restart retains minds', async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stratoks-frame-test-'));
  let app=startExpanse({dataDir:dir,seed:303,port:0,tickMs:60000,allowedOrigins:['https://viewer.example']});
  await once(app.server,'listening');
  try{
    app.world.run(180);const id=app.world.creatures[0].id;
    const base=`http://127.0.0.1:${app.server.address().port}`;
    const route=`/api/expanse/frame?x=0&y=0&w=56&h=40&creature=${id}`;
    const [a,b]=await Promise.all([fetch(base+route),fetch(base+route)]);const [fa,fb]=await Promise.all([a.json(),b.json()]);assert.deepEqual(fa,fb);
    for(const query of ['x=NaN&y=Infinity','x=1e300&y=-1e300','w=Infinity&h=NaN']){
      const r=await fetch(`${base}/api/expanse/view?${query}`);assert.equal(r.status,200);const v=await r.json();
      assert(v.w<=96&&v.h<=96);assert(v.tiles.every(t=>Number.isInteger(t)&&t>=0&&t<=10));
      assert(v.x0>=app.world.bounds().x0&&v.x0+v.w<=app.world.bounds().x1);
    }
    assert([...app.world.chunks.keys()].every(k=>!k.includes('NaN')));
    const pre=JSON.stringify(app.world.toState());
    for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']){const r=await fetch(base+route,{method,headers:{Origin:'https://evil.example'}});assert.equal(r.status,405);assert.equal(r.headers.get('access-control-allow-origin'),null);}
    assert.equal(JSON.stringify(app.world.toState()),pre);
    const cors=await fetch(base+route,{headers:{Origin:'https://viewer.example'}});assert.equal(cors.headers.get('access-control-allow-origin'),'https://viewer.example');assert.equal(cors.headers.get('vary'),'Origin');
    const remembered=JSON.parse(JSON.stringify(app.world.getCreature(id).mind));const brain=JSON.parse(JSON.stringify(app.world.getCreature(id).brain));
    await app.stop();app=startExpanse({dataDir:dir,port:0,tickMs:60000});await once(app.server,'listening');
    assert.equal(app.world.tick,180);assert.deepEqual(app.world.getCreature(id).mind,remembered);assert.deepEqual(app.world.getCreature(id).brain,brain);
    const restored=frame(app.world,{creature:id});assert.equal(restored.inspector.observation,null,'last observation is honestly unavailable until next decision after restart');
  }finally{await app.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

test('observer navigation does not change creature trajectories or learning',()=>{
  const quiet=Expanse.create({}, {seed:606}),viewed=Expanse.create({}, {seed:606});
  const cameras=[[-112,-112],[72,-92],[-92,72],[64,64]];
  for(let t=0;t<1000;t++){
    quiet.step();viewed.step();
    const [x,y]=cameras[t%4];frame(viewed,{x,y,w:72,h:56,creature:viewed.creatures[0]?.id??null});
  }
  assert.equal(viewed.rng.s,quiet.rng.s);
  assert.deepEqual(viewed.toState().creatures,quiet.toState().creatures);
  assert.deepEqual(viewed.fires,quiet.fires);assert.deepEqual(viewed.discoveries,quiet.discoveries);
});
