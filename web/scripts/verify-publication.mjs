// After IMD assigns this release's CID, verify every served byte over HTTPS.
// This never pins content or reads a machine publishing identity.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const raw=process.argv[2];
if(!raw)throw Error('Usage: node web/scripts/verify-publication.mjs <https-release-base-url/> [output.json]');
const base=new URL(raw);
if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||!base.pathname.endsWith('/'))
  throw Error('Use an HTTPS base URL with a trailing slash, without credentials, query or fragment.');
const root=fileURLToPath(new URL('../../dist/',import.meta.url));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function files(dir,prefix=''){
  const out=[];
  for(const e of await fs.readdir(dir,{withFileTypes:true})){
    if(e.isSymbolicLink())throw Error('Export contains a symlink');
    const rel=prefix+e.name;
    if(e.isDirectory())out.push(...await files(path.join(dir,e.name),rel+'/'));
    else if(e.isFile())out.push(rel);
  }return out.sort();
}
const result={at:new Date().toISOString(),baseUrl:base.href,checks:[],errors:[],passed:false};
try{
  for(const rel of await files(root)){
    const local=await fs.readFile(path.join(root,rel));
    const response=await fetch(new URL(rel,base),{redirect:'follow',signal:AbortSignal.timeout(30_000)});
    assert.equal(response.status,200,rel+': HTTP '+response.status);
    assert.equal(new URL(response.url).protocol,'https:',rel+': insecure redirect');
    const served=Buffer.from(await response.arrayBuffer());
    assert.equal(hash(served),hash(local),rel+': release bytes differ (challenge pages and stale releases fail)');
    const mime=response.headers.get('content-type')??'';
    if(rel.endsWith('.html'))assert.match(mime,/text\/html/);
    if(rel.endsWith('.js'))assert.match(mime,/(javascript|ecmascript)/);
    result.checks.push({file:rel,status:response.status,bytes:local.length,sha256:hash(local)});
  }
  result.passed=true;console.log(`PASS: ${result.checks.length} release files served unchanged over HTTPS`);
}catch(e){result.errors.push(String(e.message));console.error(String(e.message));process.exitCode=1;}
finally{if(process.argv[3])await fs.writeFile(process.argv[3],JSON.stringify(result,null,2)+'\n');}
