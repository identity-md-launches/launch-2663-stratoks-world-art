#!/usr/bin/env node
import { loadConfig } from './config.js';
import { Service } from './service.js';
import { createServer } from './http.js';

const cfg = loadConfig();
const levels = { error: 0, warn: 1, info: 2 };
const log = (lvl, msg) => { if ((levels[lvl] ?? 2) <= (levels[process.env.LOG_LEVEL ?? 'info'] ?? 2)) console.log(`${new Date().toISOString()} ${lvl} ${msg}`); };
const svc = new Service(cfg, { log });
svc.start();
const server = createServer(svc);
server.listen(cfg.server.port, cfg.server.host, () => {
  log('info', `stratoks server on ${cfg.server.host}:${cfg.server.port} demoMode=${cfg.server.demoMode} learning=${svc.world.learning}`);
  if (cfg.server.demoMode) log('warn', 'DEMO/TEST MODE: localhost origins accepted. Do not use for production.');
  if (!cfg.server.allowedOrigins.length && !cfg.server.demoMode) log('warn', 'ALLOWED_ORIGINS is empty: browsers cannot use this server until it is set');
});
let closing = false;
const shutdown = (sig) => { if (closing) return; closing = true; log('info', `${sig}: saving and exiting`); server.close(); svc.stop(); setTimeout(() => process.exit(0), 200); };
process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (e) => { log('error', e.stack); try { svc.snapshot(); } catch { /* ignore */ } process.exit(1); });
