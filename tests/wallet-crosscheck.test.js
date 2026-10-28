// Cross-check of the server's dependency-free EIP-191 recovery against signatures generated independently with
// ethers v6 (fixture tests/fixtures/ethers-signatures.json; generator script in docs/phase-1.1/ethers-gen.cjs).
// Throwaway random keys only; no real wallets, no transactions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recoverAddress, signForTests, addressFromPrivateKey } from '../server/src/wallet.js';

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/ethers-signatures.json', import.meta.url), 'utf8'));

test('server recovers the signer of every ethers-generated valid signature', () => {
  assert.ok(fx.valid.length >= 10);
  for (const v of fx.valid) assert.equal(recoverAddress(v.message, v.signature), v.address.toLowerCase(), v.message.slice(0, 30));
});

test('invalid signatures never recover the claimed address (and agree with ethers where ethers recovers)', () => {
  for (const c of fx.invalid) {
    let got = null; try { got = recoverAddress(c.message, c.signature); } catch { /* rejected */ }
    assert.notEqual(got, c.address.toLowerCase(), c.case);
    if (c.ethersRecovers) assert.equal(got, c.ethersRecovers.toLowerCase(), `${c.case}: same (wrong) signer as ethers`);
  }
});

test('server-side test signer output is a canonical signature ethers-compatible in shape', () => {
  const key = '0000000000000000000000000000000000000000000000000000000000000b22';
  const sig = signForTests('cross', key);
  assert.match(sig, /^0x[0-9a-f]{130}$/);
  assert.equal(recoverAddress('cross', sig), addressFromPrivateKey(key));
});
