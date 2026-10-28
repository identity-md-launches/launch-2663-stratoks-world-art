export type Bubble = {
  text: string;
  emote: string;
  kind: "template";
  cause: string;
  tpl: string;
};
export type Entity = {
  k: string;
  x: number;
  y: number;
  kind?: string;
  id?: number;
  name?: string;
  sex?: string;
  face?: number;
  act?: string;
  phase?: string;
  stage?: string | number;
  age?: number;
  hunger?: number;
  energy?: number;
  health?: number;
  carry?: string | null;
  inside?: boolean;
  home?: number | null;
  partner?: number | null;
  pregnant?: boolean;
  bubble?: Bubble | null;
  amount?: number;
  wood?: number;
  units?: number;
  progress?: number;
  integrity?: number;
  stock?: { wood: number; stone: number };
  residents?: number;
  r?: number;
  intensity?: number;
  left?: number;
  wallet?: string;
};
export type Creature = Entity & {
  id: number;
  name: string;
  age: number;
  hunger: number;
  energy: number;
  health: number;
  act: string;
  stage: string;
};
export type WorldEvent = {
  seq: number;
  tick: number;
  type: string;
  [key: string]: unknown;
};
// Archive pages are separate from the bounded live event ring.
export type EventPage = {
  epoch?: string;
  events: WorldEvent[];
  latestSeq: number;
  nextAfter: number;
  hasMore: boolean;
  gap: { requestedAfter: number; oldestAvailableSeq: number; note?: string } | null;
  source: "memory" | "log";
};
export type HistoryPoint = {
  tick: number;
  pop: number;
  food: number;
  wood: number;
  stone: number;
  shelters: number;
  births: number;
  deaths: number;
  avgHealth: number;
  avgHunger: number;
};
export type WorldMeta = {
  worldId: string;
  status: "alive" | "extinct";
  width: number;
  height: number;
  tiles: string[];
  tick: number;
  tickMs: number;
  seq: number;
  population: number;
  food: number;
  shelters: number;
  sheltersComplete: number;
  births: number;
  deaths: number;
  pairs: number;
  learning: boolean;
  brainMode?: string;
  stages: Record<string, number>;
  deathsByCause: Record<string, number>;
};
export type Health = {
  overloaded: boolean;
  cpuPercent: number | null;
  rssMB: number | null;
  clients: number;
  lagMs: number;
  tickLatencyMs: {
    p50: number;
    p95: number;
    p99: number;
    max: number;
    budget: number;
  };
};
export type Snapshot = {
  epoch?: string;
  type: "snapshot";
  n: number;
  tick: number;
  seq: number;
  serverTime: number;
  world: WorldMeta;
  entities: Entity[];
  events: WorldEvent[];
  history: HistoryPoint[];
  health: Health;
  demoMode: boolean;
};
export type Delta = {
  epoch?: string;
  type: "delta";
  n: number;
  tick: number;
  seq: number;
  serverTime: number;
  upsert: Entity[];
  remove: string[];
  events: WorldEvent[];
  meta: Omit<WorldMeta, "tiles">;
  health: Health;
};
export type Detail = Creature & {
  brainBehavior?: BrainBehavior;
  dead?: boolean;
  cause?: string;
  generation: number;
  bornTick: number;
  personality: Record<string, number>;
  parents: { id: number; name: string }[];
  cooldown: number;
  relationships: {
    id: number;
    name: string;
    affinity: number;
    last?: number;
  }[];
  memories: { tick: number; kind: string; text: string; valence: number }[];
  decisions: {
    tick: number;
    action: string;
    utility: number;
    why: string[];
    hunger: number;
    energy: number;
  }[];
  speech: { tick: number; text: string; cause: string; kind: string }[];
  walletOpinions: { wallet: string; value: number; interactions: number }[];
  knownFood: number;
  learning: {
    enabled: boolean;
    updates: number;
    meanReward: number;
    topWeights: Record<string, number[]>;
  };
};
export type BrainBehavior = {
  interfaceVersion: number;
  mode: string;
  circuitVersion: number | null;
  learningEnabled: boolean;
  updates: number;
  decision: {
    tick: number;
    mode?: string;
    source: "reflex" | "rule" | "model";
    selectedAction: string;
    selectedTarget: number | null;
    sensed: { features: number[]; x?: number; y?: number; width?: number; height?: number; cues?: number[]; visible?: boolean };
    activeKCs: number[];
    candidates: { action: string; target: number | null; score: number; innate: number | null; preference: number | null }[];
  } | null;
  rewardHistory: { tick: number; mode?: string; action: string; reward: number; prediction: number | null; learned: boolean; source: string }[];
  note: string;
};
export type Session = {
  token: string;
  role: "visitor" | "developer";
  address: string;
  expiresAt: number;
};
export type ServiceConfig = { httpUrl: string; wsUrl: string };
export type Mode =
  "disconnected" | "connecting" | "connected" | "reconnecting" | "demo";
export type WorldState = {
  serverEpoch?: string;
  mode: Mode;
  world: WorldMeta | null;
  entities: Map<string, Entity>;
  events: WorldEvent[];
  history: HistoryPoint[];
  health: Health | null;
  n: number;
  seq: number;
  tick: number;
  lastUpdate: number | null;
  serverTime: number | null;
  demoMode: boolean;
  error: string | null;
};
export type Intervention = {
  id: string;
  type: "add_food" | "heal_area" | "fire" | "storm";
  x: number;
  y: number;
  radius: number;
  intensity: number;
};
