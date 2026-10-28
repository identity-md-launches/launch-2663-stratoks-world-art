import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = new URL('../../', import.meta.url);
const files=[];
function visit(dir) {
 for(const e of fs.readdirSync(new URL(dir+'/',root),{withFileTypes:true})) {
  const name=path.posix.join(dir,e.name);
  if(e.isDirectory()) visit(name);
  else if(!e.isFile()) throw new Error('nonregular source entry '+name);
  else if(!name.endsWith('phase2a-source.bundle'))files.push({path:name,bytes:fs.statSync(new URL(name,root)).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(new URL(name,root))).digest('hex')});
 }
}
for(const dir of ['server','shared','deploy'])visit(dir);
for(const dir of ['tests'])visit(dir);
files.sort((a,b)=>a.path.localeCompare(b.path));
fs.writeFileSync(new URL('docs/phase2a/inventory.json',root),JSON.stringify({algorithm:'SHA-256',scope:'server/shared/deploy/tests (source bundle excluded to avoid self-reference); docs/evidence retained in enclosing submission',files},null,2)+'\n');
console.log(`${files.length} source, asset, test and raw-evidence files inventoried`);
