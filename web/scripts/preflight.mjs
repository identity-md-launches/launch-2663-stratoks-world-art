// Repository-only handoff checks. No Git metadata or machine configuration read.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=path.join(root,'artifacts/phase-1.1');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sourceDirs=['web','server','shared','deploy','tests'];
const excluded=new Set(['.git','.github','.imd','.playwright-mcp','node_modules','__pycache__','.cache']);
async function walk(relative){
  const found=[];
  for(const e of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
    if(e.name==='node_modules'||e.name==='__pycache__'||e.name==='.cache')throw Error('Generated dependency/cache directory in delivery: '+relative+'/'+e.name);
    if(excluded.has(e.name)||e.name.startsWith('.env')||e.name.endsWith('.env')||e.name==='stratoks.env')continue;
    const rel=path.posix.join(relative,e.name);
    if(rel==='test/scratch'||rel==='tests/results')continue;
    assert(!e.isSymbolicLink(),'Deliverable contains a symlink: '+rel);
    if(e.isDirectory())found.push(...await walk(rel));
    else if(e.isFile())found.push(rel);
  }
  return found.sort();
}
const required=['dist/index.html','dist/favicon.svg','dist/share.png','dist/world-config.json','web/index.html','web/package.json','web/package-lock.json','README.md','DESIGN.md','server/docs/DURABILITY.md','artifacts/phase-1.1/VALIDATION.md','artifacts/phase-1.1/publication.json','artifacts/phase-1.1/stratoks-vps-source.tar.gz'];
for(const rel of required){const b=await fs.readFile(path.join(root,rel));assert(b.length>0,rel);}
const index=await fs.readFile(path.join(root,'dist/index.html'),'utf8');
for(const re of [/<title>Stratoks/,/name="description"/,/property="og:title"/,/property="og:image"/,/rel="icon"/])assert.match(index,re);
const urls=[...index.matchAll(/(?:src|href|content)="([^"<>]+)"/g)].map(m=>m[1]).filter(u=>u.startsWith('./'));
assert(urls.some(u=>u.endsWith('.js'))&&urls.some(u=>u.endsWith('.css')),'Missing relative entry assets');
assert(!/(?:src|href)="\/(?!\/)/.test(index),'Root-relative entry asset');
for(const url of urls)await fs.access(path.join(root,'dist',url));
const config=JSON.parse(await fs.readFile(path.join(root,'dist/world-config.json'),'utf8'));
assert.deepEqual(config,{httpUrl:'',wsUrl:''},'No fabricated/preconfigured backend');
const sourceFiles=[...(await Promise.all(sourceDirs.map(walk))).flat(),'README.md','DESIGN.md','docs/CLIENT.md','docs/VALIDATION.md','docs/phase-1.1/FINDINGS.md','docs/delivery.json'].sort();
const source=[];
for(const file of sourceFiles){const b=await fs.readFile(path.join(root,file));source.push({file,bytes:b.length,sha256:hash(b)});}
const staticFiles=[];
for(const file of await walk('dist')){const b=await fs.readFile(path.join(root,file));staticFiles.push({file,bytes:b.length,sha256:hash(b)});}
for(const f of [...source,...staticFiles])if(f.file.endsWith('.json'))JSON.parse(await fs.readFile(path.join(root,f.file),'utf8'));
const artifacts=await walk('artifacts');
for(const file of artifacts)if(file.endsWith('.json'))JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
const touched=[
  'README.md','DESIGN.md','docs/CLIENT.md','docs/VALIDATION.md','docs/phase-1.1/FINDINGS.md','docs/delivery.json',
  'server/src/store.js','server/src/service.js','server/bin/backup.js','server/README.md','server/docs/DURABILITY.md',
  'deploy/backup.sh','deploy/check-docker.sh','deploy/check-process.mjs','deploy/INSTALL.md',
  'tests/backup-cli.test.js','tests/event-boundaries.test.js','tests/repair.test.js',
  'web/src/App.tsx','web/src/Panels.tsx','web/src/service.ts','web/src/types.ts','web/src/store.ts','web/src/store.test.ts',
  'web/src/pending.ts','web/src/pending.test.ts','web/src/service.test.ts',
  'web/scripts/task.mjs','web/scripts/check-revision.mjs','web/scripts/check-interface.mjs','web/scripts/check-phase11.mjs','web/scripts/check-signatures.mjs','web/scripts/verify-publication.mjs','web/scripts/preflight.mjs',
];
// A conservative bound: count complete touched files, all artifacts and all dist,
// rather than just added bytes. Reserve 64 KiB for these two generated manifests.
const budgetFiles=[...new Set([...touched,...artifacts,...staticFiles.map(f=>f.file)])];
let countedBytes=0;
for(const file of budgetFiles)countedBytes+=(await fs.stat(path.join(root,file))).size;
const reservedBytes=65_536,limitBytes=8_388_608;
assert(countedBytes+reservedBytes<limitBytes,`Conservative added-path budget exceeds 8 MiB: ${countedBytes}`);
const shaTree=rows=>hash(Buffer.from(rows.map(f=>f.file+'\0'+f.sha256+'\n').join('')));
const pkg=await fs.readFile(path.join(out,'stratoks-vps-source.tar.gz'));
const release={release:'Stratoks Phase 1.1',at:new Date().toISOString(),baselineCommit:'b57000a4c11af27369cce90d88f75d761a44ab9e',commit:null,publicationUrl:null,cid:null,sourceTreeSha256:shaTree(source),exportTreeSha256:shaTree(staticFiles),indexSha256:hash(Buffer.from(index)),exportBytes:staticFiles.reduce((n,f)=>n+f.bytes,0),installationPackage:{file:'artifacts/phase-1.1/stratoks-vps-source.tar.gz',bytes:pkg.length,sha256:hash(pkg)},sourceFiles:source,staticFiles};
await fs.writeFile(path.join(out,'release.json'),JSON.stringify(release,null,2)+'\n');
const result={at:new Date().toISOString(),passed:true,requiredFiles:required,allRequiredFilesReadBack:true,metadata:true,relativeEntryUrls:urls,defaultBackendUnconfigured:true,sourceFileCount:source.length,exportFileCount:staticFiles.length,parsedJson:true,symlinksOrDependencyCachesInCheckedPaths:false,ignoreFilesChanged:false,budget:{countedBytes,reservedBytes,upperBoundBytes:countedBytes+reservedBytes,limitBytes,scope:'complete touched files + all artifacts + complete dist, conservatively overcounts baseline assets; final Git bundle not inspected'},sourceTreeSha256:release.sourceTreeSha256,exportTreeSha256:release.exportTreeSha256};
await fs.writeFile(path.join(out,'preflight.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:true,exportBytes:release.exportBytes,installationPackageBytes:pkg.length,conservativeBudgetBytes:result.budget.upperBoundBytes,limitBytes,sourceTreeSha256:release.sourceTreeSha256,exportTreeSha256:release.exportTreeSha256},null,2));
