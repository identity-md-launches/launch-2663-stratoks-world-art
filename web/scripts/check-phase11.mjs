// Production-browser integration against the real repaired service.
// Synthetic accounts are generated in memory; no wallet keys are persisted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Service } from '../../server/src/service.js';
import { DEFAULTS, deepMerge } from '../../server/src/config.js';
import { createServer } from '../../server/src/http.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
// Prefer a normal local npm-ci installation; preserve the original isolated build workflow.
let project=path.join(root,'web');
try { await fs.access(path.join(project,'node_modules/playwright/index.mjs')); }
catch {
  const prepared=spawnSync('node',['web/scripts/task.mjs','path'],{cwd:root,encoding:'utf8'});
  assert.equal(prepared.status,0,prepared.stderr);
  project=prepared.stdout.trim().split('\n').at(-1);
}
const {chromium}=await import(pathToFileURL(path.join(project,'node_modules/playwright/index.mjs')));
const {privateKeyToAccount}=await import(pathToFileURL(path.join(project,'node_modules/viem/_esm/accounts/index.js')));
const accounts=[0,1].map(()=>privateKeyToAccount('0x'+randomBytes(32).toString('hex')));
const baseline=process.argv.includes('--baseline');
const out=path.resolve(process.argv.find((a,i)=>i>1&&!a.startsWith('--'))??'artifacts/phase-1.1');
await fs.mkdir(out,{recursive:true});
const results={date:new Date().toISOString(),baseline,checks:[],errors:[],observations:{}};
const pass=(name,data={})=>{results.checks.push({name,passed:true,...data});console.log('PASS',name);};
const preview=spawn('node',['web/scripts/preview.mjs','4195'],{cwd:root,stdio:['ignore','pipe','inherit']});
await new Promise((r,j)=>{preview.stdout.once('data',r);preview.once('error',j);});
const origin='http://127.0.0.1:4195',url=origin+'/preview/';
const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'stratoks-phase11-'));
let time=Date.now();
const cfg=deepMerge(DEFAULTS,{
  server:{host:'127.0.0.1',port:0,dataDir,allowedOrigins:[origin]},
  world:{tickMs:1000},
  auth:{developerWallets:accounts.map(a=>a.address.toLowerCase())},
  interventions:{cooldownTicks:{add_food:0,heal_area:0}},
});
const svc=new Service(cfg,{now:()=>time});svc.start();clearTimeout(svc.timer);clearInterval(svc.snapTimer);
const server=createServer(svc);
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
cfg.server.rateLimit={publicGet:2,windowMs:10_000};
const limited=createServer(svc);
await new Promise(r=>limited.listen(0,'127.0.0.1',r));
const limitedBase='http://127.0.0.1:'+limited.address().port;
let browser;
const unexpected=[];
async function connect(page,target=base){
  await page.getByRole('button',{name:'Open settings',exact:true}).click();
  await page.getByLabel('World service URL').fill(target);
  await page.getByLabel('WebSocket URL (optional)').fill('');
  await page.getByRole('button',{name:'Connect to world',exact:true}).click();
  await page.locator('[data-mode="connected"]').waitFor();
}
async function signIn(page,first=false){
  await page.locator('.wallet-button').click();
  if(first)await page.getByRole('button',{name:'Phase 1.1 wallet',exact:true}).click();
  await page.getByRole('button',{name:'Sign in to world',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'detached'});
}
async function tools(page){await page.getByRole('button',{name:'Observe',exact:true}).click();await page.getByRole('button',{name:'Tools',exact:true}).click();}
try{
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.CHROMIUM_EXECUTABLE_PATH} : {})});results.chromium=browser.version();
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.exposeFunction('phaseSign',(index,message)=>accounts[index].signMessage({message:{raw:message}}));
  await context.addInitScript(({addresses})=>{
    let account=0,granted=false;
    const listeners=new Map();
    const provider={request:async({method,params})=>{
      if(method==='eth_accounts')return granted?[addresses[account]]:[];
      if(method==='eth_requestAccounts'){granted=true;return [addresses[account]];}
      if(method==='eth_chainId')return '0x1';
      if(method==='net_version')return '1';
      if(method==='personal_sign')return window.phaseSign(account,params[0]);
      throw Error('Unsupported synthetic wallet method '+method);
    },on:(event,fn)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);},
    removeListener:(event,fn)=>listeners.get(event)?.delete(fn)};
    window.phaseAccount=(index)=>{account=index;for(const fn of listeners.get('accountsChanged')??[])fn([addresses[account]]);};
    window.ethereum=provider;
    const announce=()=>dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'e4b0cf6f-51ad-4a70-8a39-036c2d1b5216',name:'Phase 1.1 wallet',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',rdns:'test.stratoks.phase11'},provider}}));
    addEventListener('eip6963:requestProvider',announce);announce();
  },{addresses:accounts.map(a=>a.address)});
  const page=await context.newPage();page.on('pageerror',e=>unexpected.push(e.message));
  await page.goto(url);await connect(page);await signIn(page,true);await tools(page);
  svc.store.failNextSaves=1;
  const failed=page.waitForResponse(r=>r.url().endsWith('/api/dev/interventions')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Apply intervention',exact:true}).click();
  assert.equal((await failed).status(),503);
  await page.getByRole('button',{name:'Retry same intervention',exact:true}).waitFor();
  assert.equal(svc.world.totals.interventions,1);
  const pendingId=(await page.locator('.request-id').innerText()).replace('Request ID: ','');
  results.observations.uncertainId=pendingId;
  const saved=await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('stratoks-pending')));
  results.observations.savedKeyIncludesActor=saved.some(k=>k.endsWith(accounts[0].address.toLowerCase()));
  if(!baseline)assert.equal(results.observations.savedKeyIncludesActor,true);
  pass('a real snapshot save failure returns 503 and keeps the exact retry ID');

  if(!baseline){
    await page.route('**/api/dev/interventions',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'auth_required'})}));
    await page.getByRole('button',{name:'Retry same intervention',exact:true}).click();
    await page.getByText('Your session ended. Sign in again.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Retry same intervention',exact:true}).waitFor();
    assert.equal(svc.world.totals.interventions,1);
    await page.unroute('**/api/dev/interventions');
    pass('an expired-session response to a retry cannot erase its earlier uncertain outcome');
  }

  await page.evaluate(()=>window.phaseAccount(1));
  await signIn(page);await tools(page);
  const leaked=await page.getByRole('button',{name:'Retry same intervention',exact:true}).count();
  results.observations.actorBSeesActorARetry=!!leaked;
  if(baseline){assert.equal(leaked,1);pass('baseline reproduced: actor B inherits actor A\'s uncertain request');}
  else{assert.equal(leaked,0);assert.equal(svc.world.totals.interventions,1);pass('account switch never offers another actor\'s uncertain retry');}

  if(!baseline){
    await page.evaluate(()=>window.phaseAccount(0));await signIn(page);await tools(page);
    await page.getByText('Request ID: '+pendingId,{exact:true}).waitFor();
    await page.reload();await page.locator('[data-mode="connected"]').waitFor();await signIn(page,true);await tools(page);
    await page.getByText('Request ID: '+pendingId,{exact:true}).waitFor();
    await page.getByRole('button',{name:'Retry same intervention',exact:true}).click();
    await page.getByText(/Already applied; no duplicate effect/).waitFor();
    assert.equal(svc.world.totals.interventions,1);
    assert.equal(svc.store.readSnapshot(path.join(dataDir,'world.json')).state.totals.interventions,1);
    pass('original actor reloads, signs in again and commits the same request exactly once');

    const legacy={id:'legacy-browser-0001',type:'heal_area',x:28,y:28,radius:4,intensity:0.5};
    await page.evaluate(({key,body})=>sessionStorage.setItem(key,JSON.stringify(body)),{key:`stratoks-pending:${base}:${svc.world.id}`,body:legacy});
    await tools(page);
    await page.getByText(/older saved request has no recorded wallet/).waitFor();
    assert.equal(await page.getByRole('button',{name:'Apply intervention',exact:true}).isEnabled(),false);
    assert.equal(await page.getByRole('button',{name:'Retry same intervention',exact:true}).count(),0);
    await page.getByRole('button',{name:'Dismiss legacy request after checking',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Apply intervention',exact:true}).isEnabled(),true);
    pass('legacy unowned payload stays inspectable and cannot be silently assigned to a wallet');

    for(let i=0;i<240;i++)svc.world.emit('phase11_fixture',{label:'Synthetic event pagination fixture'});
    svc.snapshot(true);
    // Drop the oldest ordinary events from the retained log to exercise an honest gap.
    const log=path.join(dataDir,'events.jsonl');
    const lines=(await fs.readFile(log,'utf8')).trim().split('\n');
    svc.store.release();await fs.writeFile(log,lines.filter(l=>JSON.parse(l).seq>=20).join('\n')+'\n');svc.store.init();
    svc.world.events=svc.world.events.filter(e=>e.seq>=20);
    for(const c of svc.clients)c.send(svc.snapshotMessage());
    await page.getByRole('button',{name:'History',exact:true}).click();
    const response=page.waitForResponse(r=>r.url().includes('/api/events?after=0&limit=100'));
    await page.getByRole('button',{name:'Browse saved events',exact:true}).click();
    const first=await (await response).json();
    assert.equal(first.events.length,100);assert(first.gap);assert.equal(first.gap.oldestAvailableSeq,20);
    await page.getByText(/Older events were removed by log rotation/).waitFor();
    const next=page.waitForResponse(r=>r.url().includes(`/api/events?after=${first.nextAfter}&limit=100`));
    await page.getByRole('button',{name:'Next saved page',exact:true}).click();
    const second=await (await next).json();assert.equal(second.events[0].seq,first.nextAfter+1);
    assert.equal(await page.locator('[data-event-seq]').count(),100);
    await page.getByRole('button',{name:'Life',exact:true}).click();
    await page.getByText('No events in this view yet.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'All events',exact:true}).click();
    assert.equal(await page.locator('[data-event-seq]').count(),100);
    await page.screenshot({path:path.join(out,'saved-history-390.jpg'),type:'jpeg',quality:75});
    pass('saved history follows nextAfter, caps the rendered page at 100, filters and shows retention gaps');

    let busy=true;
    await page.route('**/api/events?*',async route=>{
      if(busy){busy=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'event_history_busy',retryAfterSec:1})});}
      else await route.continue();
    });
    await page.getByRole('button',{name:'Next saved page',exact:true}).click();
    await page.getByText(/Saved history is busy/).waitFor();
    await page.getByRole('button',{name:'Retry saved page',exact:true}).click();
    await page.getByText(/Saved events #220/).waitFor();
    await page.unroute('**/api/events?*');
    assert.equal(await page.getByRole('button',{name:'Next saved page',exact:true}).isEnabled(),false);
    pass('busy history retains its page and retries the same cursor, then disables paging at the end');
    await page.getByRole('button',{name:'Show recent events',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Browse saved events',exact:true}).count(),1);

    await page.getByRole('button',{name:'Browse saved events',exact:true}).click();
    await page.getByRole('button',{name:'Next saved page',exact:true}).waitFor();
    const restored=JSON.parse(svc.snapshotMessage());restored.seq=10;restored.tick=0;restored.world.seq=10;restored.events=restored.events.filter(e=>e.seq<=10);
    for(const c of svc.clients)c.send(JSON.stringify(restored));
    await page.getByRole('button',{name:'Browse saved events',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Next saved page',exact:true}).count(),0);
    assert.equal(await page.locator('[data-event-seq]').count(),0);
    pass('snapshot recovery rewinds the same-world archive instead of retaining an abandoned page');

    const ratePage=await browser.newPage({viewport:{width:390,height:844}});
    await ratePage.goto(url);await connect(ratePage,limitedBase);
    // WebSocket upgrade now shares the public-read budget. Start a fresh
    // controlled window before testing the two allowed HTTP requests.
    time+=10_000;
    const id=svc.world.creatures[0].id;
    for(const p of [`/api/creatures/${id}`,'/api/creatures'])assert.equal((await fetch(limitedBase+p)).status,200);
    assert.equal((await fetch(limitedBase+'/api/creatures')).status,429);
    await ratePage.getByRole('button',{name:'Residents',exact:true}).click();
    await ratePage.locator('.resident-row').first().click();
    const rateError=ratePage.locator('.error').filter({hasText:'Too many requests. Try again in 10 seconds.'});
    await rateError.waitFor();
    time+=10_000;
    await ratePage.getByRole('button',{name:'Retry details',exact:true}).click();
    await rateError.waitFor({state:'detached'});
    await ratePage.getByRole('button',{name:'Learning',exact:true}).click();
    await ratePage.waitForFunction(()=>document.querySelector('.facts dd')?.textContent!=='–');
    pass('real detail/list 429s show wait guidance and details recover after the controlled server window');
    await ratePage.close();
  }
  assert.deepEqual(unexpected,[]);pass('no uncaught application errors in Phase 1.1 integration flows');
  await context.close();
}catch(e){results.errors.push(String(e.stack));console.error(e);process.exitCode=1;}
finally{
  await browser?.close();svc.stop();
  for(const s of [server,limited]){s.closeAllConnections();await new Promise(r=>s.close(r));}
  preview.kill('SIGTERM');await fs.rm(dataDir,{recursive:true,force:true});
  await fs.writeFile(path.join(out,baseline?'client-before.json':'client-checks.json'),JSON.stringify(results,null,2)+'\n');
}
