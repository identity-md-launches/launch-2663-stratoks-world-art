// Configuration: defaults < JSON file (STRATOKS_CONFIG) < environment variables.
import fs from 'node:fs';

export const DEFAULTS = {
  server: {
    host: '0.0.0.0', port: 8787, dataDir: './data',
    allowedOrigins: [],            // exact origins allowed for CORS, WS and wallet sign-in
    demoMode: false,               // local demo/test mode: localhost origins + demo dev wallet policy
    maxWsClients: 200, maxWsBufferBytes: 1_000_000,
    trustProxy: false,
    trustedProxies: [],            // CIDRs whose X-Forwarded-For is believed when trustProxy; empty = loopback + private ranges
    rateLimit: { windowMs: 60_000, publicGet: 600, auth: 20, presence: 120, action: 30, maxBuckets: 50_000 },
  },
  auth: {
    developerWallets: [],          // lowercase 0x addresses allowed to use /api/dev/*
    nonceTtlMs: 5 * 60_000, sessionTtlMs: 60 * 60_000, domain: 'stratoks',
  },
  world: {
    seed: 20260101, initialSeedCount: 24, // initial seed only, NOT a population cap
    width: 56, height: 56,
    tickMs: 1000,
    learning: true,                // for an EXISTING world only an explicitly configured value applies (see LEARNING.md)
    learningSource: 'default',     // set by loadConfig: 'default' | 'file' | 'env'
    adultAge: 1500, elderAge: 14000, lifespanBase: 20000,
    hungerRate: 0.05, juvenileHungerFactor: 0.6,
    starveDamage: 0.08, severeHungerDamage: 0.02,
    mateHungerMax: 50, foodPerCapitaMin: 4,
    gestation: 80, reproCooldown: 500, shelterCapacity: 4,
    shelterCost: { stone: 2, wood: 6 }, shelterWork: 90,
    bush: { capacity: 5, regrow: 0.004, floor: 0.25, spread: 0.0004, maxCount: 90, deadAfter: 4000, lakeBonus: 1.5, initial: 40 },
    tree: { wood: 8, regrowEvery: 800, count: 70 },
    stone: { units: 12, regrowEvery: 1500, count: 12 },
    perceptionRadius: 12, memorySize: 40, decisionLog: 12,
    learningRate: 0.05, temperature: 0.35, inheritBlend: 0.5, mutation: 0.05,
    visitor: { ttl: 300, giftCooldown: 120, harmCooldown: 240, harmDamage: 3, harmMaxPerWallet: 20, radius: 8 },
    catchup: { maxTicks: 600, lethal: false },
    historyEvery: 30, historyMax: 2000, eventRing: 3000, graveyardMax: 5000,
  },
  interventions: {
    enabled: true,
    maxRadius: 8, maxIntensity: 1, maxPerTypePerWindow: 6, windowTicks: 3600,
    cooldownTicks: { add_food: 30, heal_area: 30, fire: 300, storm: 600 },
    fireDuration: 120, stormDuration: 90, foodUnitsMax: 40,
  },
  persistence: {
    snapshotEveryMs: 30_000, backupKeep: 10,
    eventLogMaxBytes: 5_000_000, eventLogFiles: 3, maxConcurrentEventReads: 4,
  },
};

function merge(a, b) {
  for (const k of Object.keys(b ?? {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') merge(a[k], b[k]);
    else a[k] = b[k];
  }
  return a;
}
export function deepMerge(base, over) { return merge(structuredClone(base), over); }

export function loadConfig(env = process.env, argv = process.argv.slice(2)) {
  let cfg = structuredClone(DEFAULTS);
  if (env.STRATOKS_CONFIG) {
    const file = JSON.parse(fs.readFileSync(env.STRATOKS_CONFIG, 'utf8'));
    merge(cfg, file);
    if (file?.world && 'learning' in file.world) {
      if (typeof file.world.learning !== 'boolean') throw new Error(`world.learning in ${env.STRATOKS_CONFIG} must be true or false`);
      cfg.world.learningSource = 'file';
    }
  }
  const list = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);
  if (env.PORT) cfg.server.port = Number(env.PORT);
  if (env.HOST) cfg.server.host = env.HOST;
  if (env.DATA_DIR) cfg.server.dataDir = env.DATA_DIR;
  if (env.ALLOWED_ORIGINS) cfg.server.allowedOrigins = list(env.ALLOWED_ORIGINS);
  if (env.DEV_WALLETS) cfg.auth.developerWallets = list(env.DEV_WALLETS).map((x) => x.toLowerCase());
  if (env.TICK_MS) cfg.world.tickMs = Number(env.TICK_MS);
  if (env.INITIAL_SEED_COUNT) cfg.world.initialSeedCount = Number(env.INITIAL_SEED_COUNT);
  if (env.WORLD_SEED) cfg.world.seed = Number(env.WORLD_SEED);
  if (env.LEARNING !== undefined && env.LEARNING !== '') {
    const v = String(env.LEARNING).trim().toLowerCase();
    if (!['0', '1', 'true', 'false'].includes(v)) throw new Error(`LEARNING=${env.LEARNING} is invalid: use LEARNING=1 (enable) or LEARNING=0 (disable), or leave it unset to keep the world's stored setting`);
    cfg.world.learning = v === '1' || v === 'true'; cfg.world.learningSource = 'env';
  }
  if (env.TRUST_PROXY === '1') cfg.server.trustProxy = true;
  if (env.TRUSTED_PROXIES) cfg.server.trustedProxies = list(env.TRUSTED_PROXIES);
  if (env.DEMO_MODE === '1' || argv.includes('--demo')) cfg.server.demoMode = true;
  cfg.auth.developerWallets = cfg.auth.developerWallets.map((x) => x.toLowerCase());
  return cfg;
}
