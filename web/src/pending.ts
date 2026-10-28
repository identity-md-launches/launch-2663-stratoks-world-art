import type { Intervention } from "./types";

// Match server ownership, including after reload or switching accounts.
export function pendingKey(service: string, world: string, actor: string) {
  return `stratoks-pending-v2:${service}:${world}:${actor.toLowerCase()}`;
}
export function legacyPendingKey(service: string, world: string) {
  return `stratoks-pending:${service}:${world}`;
}
export function parsePending(raw: string | null): Intervention | null {
  try {
    const v = JSON.parse(raw ?? "null");
    return v && typeof v.id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v.id) &&
      ["add_food", "heal_area", "fire", "storm"].includes(v.type) &&
      [v.x, v.y, v.radius, v.intensity].every(Number.isFinite)
      ? { id: v.id, type: v.type, x: v.x, y: v.y, radius: v.radius, intensity: v.intensity }
      : null;
  } catch {
    return null;
  }
}
