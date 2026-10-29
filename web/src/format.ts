import type { WorldEvent } from "./types";
export const actionNames: Record<string, string> = {
  IDLE: "Taking it in",
  WANDER: "Exploring",
  FORAGE: "Finding berries",
  EAT: "Eating",
  REST: "Resting",
  GATHER: "Gathering materials",
  GATHER_WOOD: "Collecting wood",
  GATHER_STONE: "Collecting stone",
  SOCIALIZE: "Making friends",
  BUILD: "Building a shelter",
  REPAIR: "Repairing a shelter",
  SOCIAL: "Making friends",
  MATE: "Tending a bond",
  FLEE: "Fleeing danger",
  APPROACH: "Approaching a visitor",
  AVOID: "Avoiding a visitor",
};
export const actionName = (action?: string) =>
  actionNames[action ?? "IDLE"] ??
  action?.toLowerCase().replaceAll("_", " ") ??
  "Exploring";
export const number = (n: number | undefined, decimals = 0) =>
  n === undefined
    ? "–"
    : n.toLocaleString("en", { maximumFractionDigits: decimals });
export const shortAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
export function eventText(e: WorldEvent): string {
  const who =
    typeof e.name === "string"
      ? e.name
      : typeof e.creatureName === "string"
        ? e.creatureName
        : e.creature
          ? `Stratok #${e.creature}`
          : "A Stratok";
  switch (e.type) {
    case "birth":
      return `${who} was born.`;
    case "death":
      return `${who} died: ${String(e.cause ?? "cause not supplied").replaceAll("_", " ")}.`;
    case "world_created":
      return `A world began with ${e.initialSeedCount} Stratoks.`;
    case "shelter_complete":
      return "A new shelter is ready.";
    case "shelter_started":
      return "Work began on a shelter.";
    case "shelter_stage":
      return `A shelter reached building stage ${e.stage}.`;
    case "shelter_destroyed":
      return "A shelter was destroyed.";
    case "bond":
      return "Two Stratoks formed a pair bond.";
    case "bond_end":
      return "A pair bond ended.";
    case "pregnancy":
      return "A pair is expecting a little one.";
    case "miscarriage":
      return "A pregnancy ended.";
    case "extinction":
      return "The last Stratok has died. This world’s history is preserved.";
    case "intervention":
      return `An intervention changed the world: ${String(e.kind).replaceAll("_", " ")}.`;
    case "fire_end":
      return "A fire has burned out.";
    case "storm_end":
      return "A storm has passed.";
    case "downtime":
      return "The world resumed after server downtime.";
    case "reset":
      return "A developer explicitly started a new world.";
    case "visitor_gift":
      return "A visitor left food.";
    case "visitor_harm":
      return "A visitor startled a Stratok.";
    case "bush_died":
      return "An exhausted berry bush died.";
    default:
      return e.type.replaceAll("_", " ") + ".";
  }
}
