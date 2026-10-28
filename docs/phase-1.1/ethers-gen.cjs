// Generates signatures with ethers (independent maintained library) from freshly random, throwaway keys.
const { Wallet, verifyMessage, Signature, version } = require('ethers');
(async () => {
  const valid = [], invalid = [];
  const msgs = ['hello', 'stratoks wants you to sign in with your wallet.\nAddress: x\nNonce: 00112233445566778899aabbccddeeff', 'ünïcødé ✓ 🌱', '', 'x'.repeat(900)];
  for (let i = 0; i < 12; i++) {
    const w = Wallet.createRandom(); const message = msgs[i % msgs.length] + (i >= msgs.length ? ` #${i}` : '');
    const signature = await w.signMessage(message);
    if (verifyMessage(message, signature) !== w.address) throw new Error('ethers self-check');
    valid.push({ address: w.address, message, signature });
  }
  const v0 = valid[0], v1 = valid[1];
  invalid.push({ case: 'tampered message', address: v0.address, message: v0.message + '!', signature: v0.signature, ethersRecovers: verifyMessage(v0.message + '!', v0.signature) });
  invalid.push({ case: 'signature from another key', address: v0.address, message: v0.message, signature: v1.signature, ethersRecovers: verifyMessage(v0.message, v1.signature) });
  const s = Signature.from(v0.signature); const flipped = Signature.from({ r: s.r, s: s.s, v: s.v === 27 ? 28 : 27 }).serialized;
  invalid.push({ case: 'flipped recovery id', address: v0.address, message: v0.message, signature: flipped, ethersRecovers: verifyMessage(v0.message, flipped) });
  invalid.push({ case: 'truncated signature', address: v0.address, message: v0.message, signature: v0.signature.slice(0, 120), ethersRecovers: null });
  invalid.push({ case: 'r = 0', address: v0.address, message: v0.message, signature: '0x' + '00'.repeat(32) + s.s.slice(2) + '1b', ethersRecovers: null });
  console.log(JSON.stringify({ generator: `ethers ${version} (npm), Wallet.createRandom + signMessage (EIP-191 personal_sign); keys discarded, never funded`, valid, invalid }, null, 1));
})();
