// Fresh EIP-191 cross-check using the locked viem library, independently of the
// server's test signer and inherited ethers fixtures. No transactions or real keys.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { recoverAddress } from '../../server/src/wallet.js';
const prepared=spawnSync('node',['web/scripts/task.mjs','path'],{encoding:'utf8'});
assert.equal(prepared.status,0,prepared.stderr);
const project=prepared.stdout.trim().split('\n').at(-1);
const {privateKeyToAccount}=await import(pathToFileURL(path.join(project,'node_modules/viem/_esm/accounts/index.js')));
const {recoverMessageAddress}=await import(pathToFileURL(path.join(project,'node_modules/viem/_esm/index.js')));
const version=JSON.parse(await fs.readFile(path.join(project,'node_modules/viem/package.json'),'utf8')).version;
const rows=[];
const messages=['','Stratoks\nOrigin: https://client.test\nNonce: independent','ünïcødé ✓ 🌱','x'.repeat(900)];
for(let i=0;i<12;i++){
  const account=privateKeyToAccount('0x'+randomBytes(32).toString('hex'));
  const message=messages[i%messages.length]+(i>=4?` #${i}`:'');
  const signature=await account.signMessage({message});
  const expected=(await recoverMessageAddress({message,signature})).toLowerCase();
  assert.equal(expected,account.address.toLowerCase());assert.equal(recoverAddress(message,signature),expected);
  rows.push({case:'valid',index:i,passed:true});
  for(const [name,m,s] of [
    ['tampered message',message+'!',signature],
    ['flipped recovery id',message,signature.slice(0,-2)+(signature.endsWith('1b')?'1c':'1b')],
    ['truncated',message,signature.slice(0,-10)],
    ['zero r',message,'0x'+'00'.repeat(32)+signature.slice(66)],
  ]){
    let reference=null,actual=null;
    try{reference=(await recoverMessageAddress({message:m,signature:s})).toLowerCase();}catch{}
    try{actual=recoverAddress(m,s);}catch{}
    assert.notEqual(actual,expected,name);
    if(reference!==null)assert.equal(actual,reference,name);
    rows.push({case:name,index:i,passed:true,referenceRecovered:reference!==null});
  }
}
const result={library:`viem ${version}`,generator:'12 freshly random ephemeral accounts; independent signMessage + recoverMessageAddress; keys discarded; no transactions',valid:12,invalid:48,checks:rows};
console.log(JSON.stringify({library:result.library,valid:12,invalid:48,passed:rows.length}));
if(process.argv[2])await fs.writeFile(process.argv[2],JSON.stringify(result,null,2)+'\n');
