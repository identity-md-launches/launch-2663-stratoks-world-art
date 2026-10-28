// Wallet-signature verification (EIP-191 personal_sign) in pure JS: keccak256 + secp256k1 public-key recovery.
// No private keys are ever handled by the server. Verification only.
const M = (1n << 64n) - 1n;
const RC = [0x0000000000000001n,0x0000000000008082n,0x800000000000808an,0x8000000080008000n,0x000000000000808bn,0x0000000080000001n,0x8000000080008081n,0x8000000000008009n,0x000000000000008an,0x0000000000000088n,0x0000000080008009n,0x000000008000000an,0x000000008000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,0x8000000000008002n,0x8000000000000080n,0x000000000000800an,0x800000008000000an,0x8000000080008081n,0x8000000000008080n,0x0000000080000001n,0x8000000080008008n];
const ROT = [[0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]];
const rotl = (x, n) => n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M;

function keccakF(s) {
  for (let r = 0; r < 24; r++) {
    const C = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) s[x + 5 * y] ^= D;
    }
    const B = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x][y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = B[x + 5 * y] ^ (~B[(x + 1) % 5 + 5 * y] & M & B[(x + 2) % 5 + 5 * y]);
    s[0] ^= RC[r];
  }
}
export function keccak256(data) {
  const rate = 136;
  const msg = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  const padLen = rate - (msg.length % rate);
  const p = Buffer.alloc(msg.length + padLen);
  msg.copy(p);
  p[msg.length] ^= 0x01; p[p.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < p.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) s[i] ^= p.readBigUInt64LE(off + i * 8);
    keccakF(s);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(s[i], i * 8);
  return out;
}

// secp256k1
const P = 2n ** 256n - 2n ** 32n - 977n;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];
const mod = (a, m = P) => ((a % m) + m) % m;
function inv(a, m = P) {
  let [r0, r1, s0, s1] = [mod(a, m), m, 1n, 0n];
  while (r1 !== 0n) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  return mod(s0, m);
}
export function pointAdd(a, b) {
  if (!a) return b; if (!b) return a;
  if (a[0] === b[0]) { if (mod(a[1] + b[1]) === 0n) return null; }
  const l = a[0] === b[0] ? mod(3n * a[0] * a[0] * inv(2n * a[1])) : mod((b[1] - a[1]) * inv(b[0] - a[0]));
  const x = mod(l * l - a[0] - b[0]);
  return [x, mod(l * (a[0] - x) - a[1])];
}
export function pointMul(k, pt) {
  let r = null, a = pt;
  for (k = mod(k, N); k > 0n; k >>= 1n) { if (k & 1n) r = pointAdd(r, a); a = pointAdd(a, a); }
  return r;
}
export function addressFromPoint(pt) {
  const buf = Buffer.alloc(64);
  buf.writeBigUInt64BE(pt[0] >> 192n, 0); buf.writeBigUInt64BE((pt[0] >> 128n) & M, 8); buf.writeBigUInt64BE((pt[0] >> 64n) & M, 16); buf.writeBigUInt64BE(pt[0] & M, 24);
  buf.writeBigUInt64BE(pt[1] >> 192n, 32); buf.writeBigUInt64BE((pt[1] >> 128n) & M, 40); buf.writeBigUInt64BE((pt[1] >> 64n) & M, 48); buf.writeBigUInt64BE(pt[1] & M, 56);
  return '0x' + keccak256(buf).subarray(12).toString('hex');
}
export function personalHash(message) {
  const m = Buffer.from(message, 'utf8');
  return keccak256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${m.length}`, 'utf8'), m]));
}
export function recoverAddress(message, sigHex) {
  const hex = String(sigHex).replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{130}$/.test(hex)) throw new Error('bad signature format');
  const r = BigInt('0x' + hex.slice(0, 64)), s = BigInt('0x' + hex.slice(64, 128));
  let v = parseInt(hex.slice(128), 16); if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) throw new Error('bad recovery id');
  if (r <= 0n || r >= N || s <= 0n || s >= N) throw new Error('bad signature range');
  const z = BigInt('0x' + personalHash(message).toString('hex'));
  const y2 = mod(r ** 3n % P + 7n);
  let y = modPow(y2, (P + 1n) / 4n, P);
  if (mod(y * y) !== y2) throw new Error('bad point');
  if (Number(y & 1n) !== v) y = P - y;
  const rInv = inv(r, N);
  const Q = pointMul(rInv, pointAdd(pointMul(s, [r, y]), pointMul(N - z, G)));
  if (!Q) throw new Error('recovery failed');
  return addressFromPoint(Q);
}
function modPow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }

// Test-support only (never used by the server): deterministic signing from a private key.
export function signForTests(message, privHex) {
  const d = BigInt('0x' + privHex.replace(/^0x/, ''));
  const z = BigInt('0x' + personalHash(message).toString('hex'));
  for (let i = 1n; ; i++) {
    const k = mod(BigInt('0x' + keccak256(Buffer.from(privHex + message + i)).toString('hex')), N);
    if (k === 0n) continue;
    const R = pointMul(k, G);
    const r = mod(R[0], N); if (r === 0n) continue;
    let s = mod(inv(k, N) * (z + r * d), N); if (s === 0n) continue;
    let rec = Number(R[1] & 1n) | (R[0] >= N ? 2 : 0);
    if (s > N / 2n) { s = N - s; rec ^= 1; }
    return '0x' + r.toString(16).padStart(64, '0') + s.toString(16).padStart(64, '0') + (27 + rec).toString(16);
  }
}
export function addressFromPrivateKey(privHex) { return addressFromPoint(pointMul(BigInt('0x' + privHex.replace(/^0x/, '')), G)); }
export const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a));
export const shortAddr = (a) => a.slice(0, 6) + '…' + a.slice(-4);
