// Bounded, disposable integration check. No production traffic; all server data lives in /tmp.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startExpanse } from '../../server/src/expanse/server.js';
import { inspect } from '../../server/src/expanse/view.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const project=spawnSync('node',['web/scripts/task.mjs','path'],{cwd:root,encoding:'utf8'}).stdout.trim();
const {chromium,webkit}=await import(pathToFileURL(path.join(project,'node_modules/playwright/index.mjs')));
const {default:AxeBuilder}=await import(pathToFileURL(path.join(project,'node_modules/@axe-core/playwright/dist/index.mjs')));
const output=path.resolve(process.argv[2]??'/tmp/stratoks-browser-results');
const engine=process.argv[3]??'chromium';
await fs.mkdir(output,{recursive:true});
const result={engine,started:new Date().toISOString(),checks:[],errors:[],screens:[],limitations:[]};
const record=(name,data={})=>{result.checks.push({name,passed:true,...data});console.log(`PASS ${name}`);};
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.woff2':'font/woff2'};
const preview=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://x').pathname;if(!p.startsWith('/preview/')){res.writeHead(404);res.end();return;}const rel=decodeURIComponent(p.slice(9))||'index.html';const file=path.resolve(root,'dist',rel);if(!file.startsWith(path.resolve(root,'dist')+path.sep))throw 1;const data=await fs.readFile(file);res.writeHead(200,{'content-type':types[path.extname(file)]??'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});
preview.listen(0,'127.0.0.1');await once(preview,'listening');
const origin=`http://127.0.0.1:${preview.address().port}`,site=`${origin}/preview/`;
const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'stratoks-browser-world-'));
let service=startExpanse({dataDir,seed:303,port:0,tickMs:60000,allowedOrigins:[origin]});await once(service.server,'listening');
const servicePort=service.server.address().port,base=`http://127.0.0.1:${servicePort}`;
service.world.run(220);
let browser;
let phase='preview';
try {
  browser=await (engine==='webkit'?webkit:chromium).launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const page=await context.newPage();const errors=[],failed=[],methods=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>{if(!r.failure()?.errorText.includes('ERR_ABORTED'))failed.push({url:r.url(),error:r.failure()?.errorText});});
  page.on('request',r=>{if(r.url().includes('/api/'))methods.push({url:r.url(),method:r.method()});});
  await page.goto(site);await page.getByRole('heading',{name:'Beyond the clearing'}).waitFor();await page.evaluate(()=>document.fonts.ready);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:width===1440?1000:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
    record(`preview reflow ${width}`);
    if(width===390){const box=await page.locator('.exp-start button').boundingBox();assert(box.y+box.height<=844);const name=`preview-${width}.jpg`;await page.screenshot({path:path.join(output,name),type:'jpeg',quality:80});result.screens.push(name);record('390 first screen contains product and main action',{buttonBottom:box.y+box.height});}
    if(width===1440){const name='preview-1440.jpg';await page.screenshot({path:path.join(output,name),type:'jpeg',quality:80});result.screens.push(name);}
  }
  const previewAxe=await new AxeBuilder({page}).analyze();result.previewAxe=previewAxe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));assert.equal(result.previewAxe.length,0);record('preview automated accessibility');
  const connect=page.getByRole('button',{name:'Connect server',exact:true});await connect.click();await page.getByRole('dialog',{name:'Connect to a world'}).waitFor();
  await page.getByLabel('World server URL').fill('http://remote.example');await page.getByRole('button',{name:'Connect to world',exact:true}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/HTTPS/);
  await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').count(),0);assert.equal(await connect.evaluate(e=>e===document.activeElement),true);record('server validation, modal Escape and focus return');
  await page.setViewportSize({width:390,height:844});await page.locator('.exp-start button').click();await page.waitForFunction(()=>Number(document.querySelector('.exp-app')?.dataset.tick)>1);await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.waitForTimeout(650);const stopped=await page.locator('.exp-app').getAttribute('data-tick');await page.waitForTimeout(650);assert.equal(await page.locator('.exp-app').getAttribute('data-tick'),stopped);record('isolated demo runs real ticks and pauses',{tick:Number(stopped)});
  await page.locator('.exp-resident').first().click();await page.locator('.exp-inspector[data-creature-id]').waitFor();assert(await page.locator('.exp-panel-title').evaluate(e=>e.getBoundingClientRect().top>=0&&e.getBoundingClientRect().top<innerHeight));
  await page.getByRole('button',{name:'Perception',exact:true}).click();await page.getByRole('heading',{name:'Last decision observation'}).waitFor();await page.getByRole('button',{name:'Show perception range',exact:true}).click();await page.getByRole('button',{name:'Learning',exact:true}).click();await page.getByRole('heading',{name:'Individually acquired'}).waitFor();
  await page.getByRole('button',{name:'Plans',exact:true}).click();assert(await page.locator('.exp-plan').count()>0);record('mobile resident selection, perception overlay, learning and plan inspector');
  await page.screenshot({path:path.join(output,'demo-inspector-390.jpg'),type:'jpeg',quality:80});result.screens.push('demo-inspector-390.jpg');
  assert.equal(methods.length,0,'browser demo must not request any world API');record('demo has no server/API traffic');
  await page.getByRole('button',{name:'Exit demo',exact:true}).click();await page.locator('.exp-start button').waitFor();assert.equal(await page.locator('.exp-app').getAttribute('data-tick'),null);record('exit demo clears private state');
  phase='shared';
  await page.setViewportSize({width:1440,height:1000});
  const two=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const p2=await two.newPage();
  const frames=[[],[]];const track=(p,index)=>p.on('response',async r=>{if(r.url().includes('/api/expanse/frame')&&r.ok())try{frames[index].push(await r.json());}catch{}});track(page,0);track(p2,1);
  await Promise.all([page.goto(`${site}?server=${encodeURIComponent(base)}`),p2.goto(`${site}?server=${encodeURIComponent(base)}`)]);
  await Promise.all([page.waitForFunction(()=>document.querySelector('.exp-app')?.dataset.connection==='connected'),p2.waitForFunction(()=>document.querySelector('.exp-app')?.dataset.connection==='connected')]);
  assert.equal(await page.locator('.exp-app').getAttribute('data-tick'),String(service.world.tick));assert.equal(await p2.locator('.exp-app').getAttribute('data-tick'),String(service.world.tick));record('two independent browser contexts share authoritative tick',{tick:service.world.tick,population:service.world.creatures.length});
  const id=service.world.creatures[0].id;
  for(const p of [page,p2]){await p.locator('.exp-resident').first().click();await p.locator(`.exp-inspector[data-creature-id="${id}"]`).waitFor();}
  async function evidence(p){const waiting=p.waitForEvent('download');await p.getByRole('button',{name:'Download actual creature evidence',exact:true}).click();const d=await waiting;return JSON.parse(await fs.readFile(await d.path(),'utf8'));}
  const [ev1,ev2]=await Promise.all([evidence(page),evidence(p2)]);assert.deepEqual(ev1,ev2);assert.deepEqual(ev1,JSON.parse(JSON.stringify(inspect(service.world,id))));record('both inspectors and downloaded JSON equal actual server evidence',{id,plan:ev1.currentPlan?.id,observationTick:ev1.observation?.tick});
  await fs.writeFile(path.join(output,'shared-inspector.json'),JSON.stringify(ev1,null,2));
  await page.locator('.exp-details').filter({has:page.locator('summary').filter({hasText:'Recent outcomes'})}).locator('summary').click();
  for(const plan of ev1.recentPlans){const visible=page.locator(`.exp-plan[data-plan-id="${plan.id}"]`);await visible.waitFor();for(const a of plan.actual)assert.equal((await visible.locator('.exp-plan-steps > li').nth(a.step).locator('.exp-actual b').innerText()).trim(),a.reward.toFixed(2));assert.equal(await visible.locator('[data-state=failed]').count(),plan.actual.filter(a=>!a.success).length);}
  record('expanded recent plans display actual successful and failed rewards',{plans:ev1.recentPlans.length,failed:ev1.recentPlans.filter(p=>!p.completed).length});
  const map=page.locator('.exp-canvas');await map.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(300);await page.screenshot({path:path.join(output,'keyboard-map-1440.jpg'),type:'jpeg',quality:80});result.screens.push('keyboard-map-1440.jpg');assert.equal(await page.getByRole('button',{name:'Follow creature',exact:true}).count(),1);
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();const beforeWheel=await page.locator('[data-testid=minimap-viewport]').getAttribute('width');await map.hover();await page.mouse.wheel(0,-100);await page.waitForTimeout(180);assert(Number(await page.locator('[data-testid=minimap-viewport]').getAttribute('width'))<Number(beforeWheel));record('wheel zoom changes observer viewport');await page.getByRole('button',{name:'Return to settlement',exact:true}).click();
  const mini=page.getByRole('button',{name:'Navigate using minimap. Arrow keys move the viewport.',exact:true});await mini.click({position:{x:8,y:8}});await page.waitForTimeout(400);await page.waitForFunction(()=>document.querySelector('.exp-map-coords')?.textContent.includes('-'));
  const last=frames[0].at(-1);assert(last.view.x0<0&&last.view.y0<0);assert.deepEqual(last.view.tiles.slice(0,30),Array.from({length:30},(_,i)=>service.world.tile(last.view.x0+i,last.view.y0)));record('keyboard pan, zoom, home and minimap fetch real negative-coordinate terrain',{view:{x:last.view.x0,y:last.view.y0,w:last.view.w,h:last.view.h,biome:last.view.biome}});
  await page.getByRole('button',{name:'Discoveries',exact:true}).click();const actualDiscoveries=frames[0].at(-1).discoveries;assert.equal(await page.locator('.exp-history li').count(),actualDiscoveries.length);record('discovery history matches engine, including empty state',{records:actualDiscoveries.length});
  await page.getByRole('button',{name:'Social',exact:true}).click();assert.equal(await page.locator('.exp-history li').count(),frames[0].at(-1).social.length);record('social history matches engine');
  await page.getByRole('button',{name:'Residents',exact:false}).first().click();await page.getByRole('searchbox',{name:'Find a resident'}).fill('impossible-name');assert.equal(await page.locator('.exp-resident').count(),0);await page.getByRole('button',{name:'Clear search',exact:true}).click();assert.equal(await page.locator('.exp-resident').count(),service.world.creatures.length);record('resident search and empty-state recovery');
  service.world.run(24);const later=service.world.tick;
  for(const p of [page,p2])await p.waitForFunction(t=>document.querySelector('.exp-app')?.dataset.tick===String(t),later);
  const [after1,after2]=await Promise.all([evidence(page),evidence(p2)]);assert.deepEqual(after1,after2);record('both clients synchronize after authoritative transitions',{tick:later});
  await page.getByRole('button',{name:'Perception',exact:true}).click();await page.getByRole('button',{name:'Show perception range',exact:true}).click();await page.getByRole('button',{name:'Plans',exact:true}).click();
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,'shared-world-1440.jpg'),type:'jpeg',quality:80});result.screens.push('shared-world-1440.jpg');
  const liveAxe=await new AxeBuilder({page}).analyze();result.sharedAxe=liveAxe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));assert.equal(result.sharedAxe.length,0);record('shared inspector automated accessibility');
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const fitting=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);if(!fitting){result.overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+.5).map(e=>({tag:e.tagName,class:e.className,right:e.getBoundingClientRect().right,text:e.textContent?.slice(0,100)})));await page.screenshot({path:path.join(output,'overflow.jpg'),type:'jpeg',quality:80});}assert(fitting,`shared overflow ${width}`);}record('shared inspector and map reflow 320/390/768/1440');
  await page.setViewportSize({width:390,height:844});await page.locator('.exp-inspector-panel').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'shared-inspector-390.jpg'),type:'jpeg',quality:80});result.screens.push('shared-inspector-390.jpg');
  service.world.run(1200-service.world.tick);const discoveryTick=service.world.tick;
  for(const p of [page,p2])await p.waitForFunction(t=>document.querySelector('.exp-app')?.dataset.tick===String(t),discoveryTick);
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Discoveries',exact:true}).click();
  assert(service.world.discoveries.length>0,'real transitions produced discoveries in fixed seed 303');
  assert.equal(await page.locator('.exp-history li').count(),service.world.discoveries.length);
  const discovery=service.world.discoveries.at(-1);assert.equal(await page.locator('.exp-history li').first().locator('strong').innerText(),discovery.what.replaceAll('_',' ').replace('combine:','').replace('fire:','Fire · '));
  await fs.writeFile(path.join(output,'discoveries.json'),JSON.stringify(service.world.discoveries,null,2));
  await page.locator('.exp-world-records').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'discovery-history-1440.jpg'),type:'jpeg',quality:80});result.screens.push('discovery-history-1440.jpg');
  await page.locator('.exp-history li').first().getByRole('button',{name:`Inspect #${discovery.by}`,exact:true}).click();await page.locator(`.exp-inspector[data-creature-id="${discovery.by}"]`).waitFor();assert.deepEqual(await evidence(page),JSON.parse(JSON.stringify(inspect(service.world,discovery.by))));
  record('nonempty discovery history and creator inspector match unforced engine transitions',{seed:303,tick:discoveryTick,records:service.world.discoveries.length,creator:discovery.by});
  const beforeStop=service.world.tick;await service.stop();await page.waitForFunction(()=>document.querySelector('.exp-app')?.dataset.connection==='stale');assert.equal(await page.locator('.exp-app').getAttribute('data-tick'),String(beforeStop));record('connection failure retains last frame with stale status',{tick:beforeStop});
  service=startExpanse({dataDir,port:servicePort,tickMs:60000,allowedOrigins:[origin]});await once(service.server,'listening');await page.waitForFunction(()=>document.querySelector('.exp-app')?.dataset.connection==='connected');assert.equal(service.world.tick,beforeStop);record('automatic reconnect after persistent server restart');
  phase='settlement';await page.getByRole('link',{name:'Settlement & sign-in',exact:true}).click();await page.getByRole('link',{name:'Return to Expanse',exact:true}).waitFor();await page.getByRole('button',{name:'Open settings',exact:true}).waitFor();record('preserved settlement route loads');await page.getByRole('link',{name:'Return to Expanse',exact:true}).click();await page.getByRole('heading',{name:'Beyond the clearing'}).waitFor();record('return from settlement');
  assert(methods.every(m=>m.method==='GET'));record('all world API traffic is GET only',{requests:methods.length});
  result.runtimeErrors=errors;assert.deepEqual(errors,[]);assert.equal(failed.filter(r=>r.url.startsWith(site)).length,0,'static assets load without failed requests');result.failedRequests=failed; // failed reconnect GETs are expected and retained.
  record('no browser runtime errors');
  await two.close();await context.close();
}catch(e){result.errors.push({phase,message:e.message,stack:e.stack});process.exitCode=1;console.error(e);}finally{if(browser)await browser.close();await service.stop();await new Promise(r=>preview.close(r));await fs.rm(dataDir,{recursive:true,force:true});result.finished=new Date().toISOString();await fs.writeFile(path.join(output,'checks.json'),JSON.stringify(result,null,2));}
