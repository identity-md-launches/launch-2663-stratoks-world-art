import { DEFAULTS, deepMerge } from './base/server/src/config.js';
// Harsh ecology so births and deaths both happen within ~1,600 ticks (deterministic seed).
export const FIXED_NOW = 1_800_000_000_000;
export const crashConfig = (dir) => deepMerge(DEFAULTS, {
  server: { dataDir: dir, port: 0 },
  world: { tickMs: 1000, starveDamage: 1, hungerRate: 0.12 },
  interventions: { cooldownTicks: { add_food: 0, heal_area: 0 } },
});
