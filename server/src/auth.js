// Wallet sign-in: nonce + expiry + origin binding, EIP-191 signatures. Wallets are accounts, not unique people.
import crypto from 'node:crypto';
import { recoverAddress, isAddress } from './wallet.js';

export class Auth {
  constructor(cfg) { this.cfg = cfg; this.nonces = new Map(); this.sessions = new Map(); }
  originAllowed(origin) {
    if (!origin) return false;
    if (this.cfg.server.allowedOrigins.includes(origin)) return true;
    return this.cfg.server.demoMode && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  }
  message(address, origin, nonce, issued, expires) {
    return `${this.cfg.auth.domain} wants you to sign in with your wallet.\nThis is a signature only: it sends no transaction, costs nothing, and moves no funds.\nAddress: ${address}\nOrigin: ${origin}\nNonce: ${nonce}\nIssued At: ${new Date(issued).toISOString()}\nExpiration Time: ${new Date(expires).toISOString()}`;
  }
  issueNonce(address, origin, now = Date.now()) {
    if (!isAddress(address)) throw httpErr(400, 'bad_address');
    if (!this.originAllowed(origin)) throw httpErr(403, 'origin_not_allowed');
    this.#gc(now);
    if (this.nonces.size > 5000) throw httpErr(429, 'too_many_pending');
    const addr = address.toLowerCase(), nonce = crypto.randomBytes(16).toString('hex'), expires = now + this.cfg.auth.nonceTtlMs;
    this.nonces.set(nonce, { addr, origin, expires });
    return { nonce, message: this.message(addr, origin, nonce, now, expires), expiresAt: expires };
  }
  verify({ address, message, signature }, origin, now = Date.now()) {
    if (!isAddress(address) || typeof message !== 'string' || message.length > 1000) throw httpErr(400, 'bad_request');
    if (!this.originAllowed(origin)) throw httpErr(403, 'origin_not_allowed');
    const nonce = /\nNonce: ([0-9a-f]{32})\n/.exec(message)?.[1];
    const rec = nonce && this.nonces.get(nonce);
    if (!rec) throw httpErr(401, 'unknown_or_used_nonce');
    this.nonces.delete(nonce); // single use, even if verification fails
    if (now > rec.expires) throw httpErr(401, 'nonce_expired');
    const addr = address.toLowerCase();
    if (rec.addr !== addr) throw httpErr(401, 'address_mismatch');
    if (rec.origin !== origin) throw httpErr(401, 'origin_mismatch');
    const expected = this.message(addr, rec.origin, nonce, rec.expires - this.cfg.auth.nonceTtlMs, rec.expires);
    if (message !== expected) throw httpErr(401, 'message_mismatch');
    let rec2; try { rec2 = recoverAddress(message, signature); } catch { throw httpErr(401, 'bad_signature'); }
    if (rec2 !== addr) throw httpErr(401, 'signature_does_not_match_address');
    const token = crypto.randomBytes(32).toString('hex');
    const role = this.cfg.auth.developerWallets.includes(addr) ? 'developer' : 'visitor';
    const s = { addr, role, origin, expires: now + this.cfg.auth.sessionTtlMs };
    this.sessions.set(crypto.createHash('sha256').update(token).digest('hex'), s);
    return { token, role, address: addr, expiresAt: s.expires };
  }
  session(token, now = Date.now()) {
    if (!token) return null;
    const h = crypto.createHash('sha256').update(token).digest('hex'), s = this.sessions.get(h);
    if (!s) return null;
    if (now > s.expires) { this.sessions.delete(h); return null; }
    return s;
  }
  #gc(now) { for (const [k, v] of this.nonces) if (v.expires < now) this.nonces.delete(k); for (const [k, v] of this.sessions) if (v.expires < now) this.sessions.delete(k); }
}
export function httpErr(status, error) { const e = new Error(error); e.status = status; e.code = error; return e; }
