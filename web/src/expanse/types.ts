export type Bounds = { x0: number; y0: number; x1: number; y1: number };
export type Camera = { x: number; y: number; span: number };
export type Resident = {
  id: number;
  name: string;
  x: number;
  y: number;
  health: number;
  action: string | null;
};
export type Step = {
  prim: string;
  key?: string;
  item?: string;
  a?: string;
  b?: string;
  on?: string;
  kind?: string;
  purpose?: string;
  target?: number;
  x?: number;
  y?: number;
};
export type Prediction = {
  reward: number;
  sigma: number;
  success: number;
  duration: number;
  n: number;
};
export type Outcome = {
  step: number;
  success: boolean;
  reason: string | null;
  reward: number;
  duration: number;
  energy: number;
  produced: Record<string, number>;
};
export type Plan = {
  id: number;
  tick: number;
  source: string;
  steps: Step[];
  predicted: Prediction[];
  actual: Outcome[];
  utility: number;
  mbPreference: number;
  alternatives: number;
  index?: number;
  completed?: boolean;
  plannerVersion?: number;
};
export type Observation = {
  version: number;
  tick: number;
  radius: number;
  self: { x: number; y: number; temp: number };
  ambient: { biome: string; rain: boolean };
  nodes: { id: string; kind: string; x: number; y: number; units: number }[];
  creatures: { id: number; x: number; y: number; act: string | null }[];
  water: { x: number; y: number } | null;
  saltWater: { x: number; y: number } | null;
  fires: unknown[];
  piles: unknown[];
};
export type Inspector = {
  v: number;
  id: number;
  name: string;
  age: number;
  x: number;
  y: number;
  needs: Record<string, number>;
  inventory: Record<string, number>;
  personality: Record<string, number>;
  observation: Observation | null;
  currentPlan: Plan | null;
  recentPlans: Plan[];
  episodes: {
    tick: number;
    key: string;
    success: boolean;
    reason: string | null;
    reward: number;
    duration: number;
  }[];
  knownNodes: number;
  knownWater: { x: number; y: number; t: number }[];
  discoveries: string[];
  modelEntries: number;
  mbUpdates: number;
  mode: string;
  learning: boolean;
  relationships: Record<string, number>;
  reputation: Record<string, number>;
  following: { id: number; until: number } | null;
  note: string;
};
export type Discovery = {
  tick: number;
  what: string;
  by: number;
  firstInWorld: boolean;
  selfFound: boolean;
};
export type WorldFrame = {
  worldId?: string | null;
  v: number;
  tick: number;
  seed: number;
  mode: string;
  bounds: Bounds;
  summary: {
    population: number;
    fires: number;
    shelters: number;
    births: number;
    deaths: number;
    chunks: number;
    byBiome: Record<string, number>;
  };
  view: {
    v: number;
    tick: number;
    x0: number;
    y0: number;
    w: number;
    h: number;
    tiles: number[];
    biome: string;
    nodes: [string, string, number, number, number][];
    creatures: [number, string, number, number, string | null, number][];
    fires: [number, number, number][];
    shelters: [number, number, number][];
  };
  minimap: {
    cx0: number;
    cy0: number;
    cx1: number;
    cy1: number;
    chunks: [number, number, string][];
    biomes: [number, number, string][];
  };
  residents: Resident[];
  inspector: Inspector | null;
  discoveries: Discovery[];
  social: {
    tick: number;
    type: string;
    actor: number;
    target: number | null;
    result: unknown;
  }[];
};
export type FrameQuery = {
  x: number;
  y: number;
  w: number;
  h: number;
  creature?: number;
};
export type Source =
  | { kind: "server"; url: string }
  | { kind: "demo"; seed: number }
  | { kind: "recording" };
