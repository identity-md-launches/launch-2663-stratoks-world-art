import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, addressFromPrivateKey, signForTests, recoverAddress } from '../server/src/wallet.js';
import { startApp, api, login, DEV_KEY, VIS_KEY, ORIGIN } from './helpers.js';

test('keccak256 and address derivation known vectors', () => {
  assert.equal(keccak256('').toString('hex'), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(keccak256('abc').toString('hex'), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  assert.equal(addressFromPrivateKey('01'), '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
});
test('signature roundtrip and tamper detection', () => {
  const sig = signForTests('hello stratoks', VIS_KEY);
  assert.equal(recoverAddress('hello stratoks', sig), addressFromPrivateKey(VIS_KEY));
  assert.notEqual(recoverAddress('hello stratoks!', sig), addressFromPrivateKey(VIS_KEY));
});
test('sign-in: nonce single-use, origin bound, expiry, roles', async () => {
  const app = await startApp();
  try {
    const addr = addressFromPrivateKey(VIS_KEY);
    const bad = await api(app.base, 'POST', '/api/auth/nonce', { body: { address: addr }, origin: 'https://evil.test' });
    assert.equal(bad.status, 403);
    const n = await api(app.base, 'POST', '/api/auth/nonce', { body: { address: addr } });
    assert.equal(n.status, 200);
    const sig = signForTests(n.json.message, VIS_KEY);
    // wrong origin on verify
    assert.equal((await api(app.base, 'POST', '/api/auth/verify', { body: { address: addr, message: n.json.message, signature: sig }, origin: 'https://evil.test' })).status, 403);
    // nonce survived? origin rejected before consumption; now valid
    const ok = await api(app.base, 'POST', '/api/auth/verify', { body: { address: addr, message: n.json.message, signature: sig } });
    assert.equal(ok.status, 200); assert.equal(ok.json.role, 'visitor');
    // replay
    assert.equal((await api(app.base, 'POST', '/api/auth/verify', { body: { address: addr, message: n.json.message, signature: sig } })).status, 401);
    // signature by another key
    const n2 = await api(app.base, 'POST', '/api/auth/nonce', { body: { address: addr } });
    const forged = signForTests(n2.json.message, DEV_KEY);
    assert.equal((await api(app.base, 'POST', '/api/auth/verify', { body: { address: addr, message: n2.json.message, signature: forged } })).json.error, 'signature_does_not_match_address');
    // expiry
    const n3 = app.server.auth.issueNonce(addr, ORIGIN, Date.now() - 10 * 60_000);
    assert.throws(() => app.server.auth.verify({ address: addr, message: n3.message, signature: signForTests(n3.message, VIS_KEY) }, ORIGIN), /nonce_expired/);
    const dev = await login(app.base, DEV_KEY);
    assert.equal(dev.json.role, 'developer');
  } finally { await app.stop(); }
});
