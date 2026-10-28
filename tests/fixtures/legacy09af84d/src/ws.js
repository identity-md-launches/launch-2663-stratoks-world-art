// Minimal RFC 6455 server (text frames, ping/pong, close). No dependencies.
import crypto from 'node:crypto';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function acceptUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const acc = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
  return new Conn(socket);
}

export class Conn {
  constructor(socket) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.frag = []; this.alive = true; this.onmessage = null; this.onclose = null;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.#data(d));
    socket.on('close', () => this.#closed()); socket.on('error', () => this.#closed());
  }
  #closed() { if (this.alive) { this.alive = false; this.onclose?.(); } }
  #data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (this.buf.length > 70_000) return this.close(1009);
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80); let len = b[1] & 0x7f, off = 2;
      if (!masked) return this.close(1002);
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; } else if (len === 127) return this.close(1009);
      if (len > 64_000) return this.close(1009);
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op === 0x8) return this.close(1000);
      if (op === 0x9) { this.#frame(0xa, payload); continue; }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x0) {
        this.frag.push(payload);
        if (fin) { const msg = Buffer.concat(this.frag).toString('utf8'); this.frag = []; this.onmessage?.(msg); }
      }
    }
  }
  #frame(op, payload) {
    if (!this.alive) return;
    const n = payload.length; let h;
    if (n < 126) h = Buffer.from([0x80 | op, n]); else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); } else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
    this.socket.write(Buffer.concat([h, payload]));
  }
  send(text) { this.#frame(0x1, Buffer.from(text)); }
  get backlog() { return this.socket.writableLength; }
  close(code = 1000) { if (!this.alive) return; const p = Buffer.alloc(2); p.writeUInt16BE(code); this.#frame(0x8, p); this.alive = false; this.socket.end(); this.onclose?.(); }
}
