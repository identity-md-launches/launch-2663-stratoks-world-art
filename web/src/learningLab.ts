// Isolated synthetic experiment. Imports the real server controller and engine;
// deliberately has no network, wallet, service-store or production configuration.
import { World } from "../../server/src/world.js";
import { DEFAULTS, deepMerge } from "../../server/src/config.js";
import { scoreCandidate, selectCandidate, rewardAction } from "../../server/src/controller.js";
import { Rng } from "../../server/src/rng.js";
import { MB_PARAMS } from "../../server/src/mushroom.js";

export const LAB_MODES = ["legacy", "mb-v1", "mb-v1-frozen"] as const;
export type LabMode = typeof LAB_MODES[number];
export type LabTask = "location" | "cue" | "threat";
export type LabCommand = "acquire" | "evaluate" | "reverse" | "ablate" | "retention";
type Lane = { mode: LabMode; world: any; creature: any; env: Rng; config: any };
export type LabResult = {
  mode: LabMode; trials: number; fractionGood: number; autonomousFractionGood: number;
  meanReward: number; weightsChanged: boolean; updates: number; choices: number[];
  rewards: number[]; forcedTrials: number[]; rngBefore: number; rngAfter: number;
};
export type LabPhase = { phase: string; rewardedSite: number; results: LabResult[] };
export type LabReport = {
  protocol: string; seed: number; task: LabTask; rewardedSite: number; reversed: boolean;
  parameters: typeof MB_PARAMS; history: LabPhase[];
  retention: { mode: LabMode; stateIdentical: boolean; choicesIdentical: boolean }[] | null;
};
const features = [0.4, 0.25, 0, 0.6, 1, 0, 0, 0, 0, 0, 0, 1];
const weights = (lane: Lane) => JSON.stringify(lane.mode === "legacy" ? lane.creature.brain.w : [lane.creature.brain.mb.positive, lane.creature.brain.mb.negative]);
const currentRng = (lane: Lane) => lane.mode === "legacy" ? lane.world.rng.s : lane.creature.brain.mb.rng;
const mean = (a: number[]) => a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0;
// All mutable state used by this synthetic task; no Node-only terrain codec.
// Full on-disk world restore remains covered by the existing server tests.
const checkpoint = (lane: Lane) => JSON.parse(JSON.stringify({
  creature: lane.creature, tick: lane.world.tick, rng: lane.world.rng.s,
  environmentRng: lane.env.s, learning: lane.world.learning, brainMode: lane.world.brainMode,
  bushes: lane.world.bushes, fires: lane.world.fires, storms: lane.world.storms,
}));
const restore = (lane: Lane, state: ReturnType<typeof checkpoint>): Lane => {
  const s = JSON.parse(JSON.stringify(state));
  // Ecology never steps in the lab. Retain its immutable geometry and methods;
  // replace every mutable input to scoring, reinforcement and selection.
  const world = Object.assign(Object.create(Object.getPrototypeOf(lane.world)), lane.world, {
    tick: s.tick, learning: s.learning, brainMode: s.brainMode, bushes: s.bushes,
    fires: s.fires, storms: s.storms, creatures: [s.creature], rng: new Rng(1),
  });
  world.rng.s = s.rng;
  const env = new Rng(1); env.s = s.environmentRng;
  return { ...lane, world, creature: s.creature, env };
};

export class LearningLab {
  private lanes: Lane[];
  private initialGood: number;
  private reversed = false;
  private history: LabPhase[] = [];
  private retention: LabReport["retention"] = null;
  constructor(readonly seed: number, readonly task: LabTask) {
    if (!Number.isSafeInteger(seed) || seed < 1 || seed > 100000) throw new Error("Use an integer seed from 1 to 100000.");
    if (!["location", "cue", "threat"].includes(task)) throw new Error("Choose a supported scenario.");
    this.initialGood = new Rng(seed * 917 + 5).int(2);
    this.lanes = LAB_MODES.map(mode => {
      const config = deepMerge(DEFAULTS, { world: { seed, initialSeedCount: 1, brainMode: mode } });
      const world: any = World.create(config), creature = world.creatures[0];
      creature.x = 28; creature.y = 28;
      world.bushes = [{ id: 1, x: 24, y: 28, amount: 5 }, { id: 2, x: 32, y: 28, amount: 5 }];
      world.fires = []; world.storms = [];
      if (task === "cue") {
        world.bushes[0].x = 29; world.bushes[1].x = 34;
        world.fires = [{ id: 1, x: 29, y: 28, r: 1, intensity: 0.6, left: 10000 }];
      }
      const env = new Rng(seed * 917 + 5); env.int(2);
      return { mode, world, creature, env, config };
    });
  }
  private candidates(lane: Lane, heldout: boolean) {
    const f = features.slice(); if (heldout) f[0] = 0.45;
    return lane.world.bushes.map((b: any, site: number) => ({
      a: "EAT", site, ...scoreCandidate(lane.world, lane.creature, "EAT", f, { target: b }),
    }));
  }
  private phase(lane: Lane, n: number, learning: boolean, ablated: boolean): LabResult {
    const before = weights(lane), rngBefore = currentRng(lane);
    const choices: number[] = [], rewards: number[] = [], forcedTrials: number[] = [], good: number[] = [], autonomous: number[] = [];
    lane.world.learning = learning;
    // Retain trained weights; remove only their contribution to scoring.
    if (ablated && lane.mode !== "legacy") lane.world.brainMode = "mb-v1-ablated";
    try {
      for (let i = 0; i < n; i++) {
        lane.world.tick++;
        const candidates = this.candidates(lane, !learning);
        const forced = learning && i % 5 === 0;
        const pick = forced ? candidates[lane.env.int(2)] : selectCandidate(lane.world, lane.creature, candidates);
        const correct = pick.site === (this.reversed ? 1 - this.initialGood : this.initialGood);
        let reward = this.task === "threat" ? (correct ? 0 : -1.5) : (correct ? 1.25 : -0.75);
        if (learning && lane.env.next() < 0.1) reward = -reward;
        rewardAction(lane.world, lane.creature, { type: "EAT", brainMode: lane.mode, trace: pick.trace, f: features, u: pick.u, decisionSource: forced ? "rule" : "model" }, reward);
        choices.push(pick.site); rewards.push(reward); good.push(+correct);
        if (forced) forcedTrials.push(i); else autonomous.push(+correct);
      }
    } finally { lane.world.brainMode = lane.mode; lane.world.learning = true; }
    return { mode: lane.mode, trials: n, fractionGood: mean(good), autonomousFractionGood: mean(autonomous),
      meanReward: mean(rewards), weightsChanged: before !== weights(lane),
      updates: lane.mode === "legacy" ? lane.creature.brain.updates : lane.creature.brain.mb.updates,
      choices, rewards, forcedTrials, rngBefore, rngAfter: currentRng(lane) };
  }
  run(command: LabCommand): LabReport {
    if (!["acquire", "evaluate", "reverse", "ablate", "retention"].includes(command)) throw new Error("Unsupported experiment command.");
    if (command === "retention") {
      this.retention = this.lanes.map((lane, i) => {
        const saved = checkpoint(lane), copy = restore(lane, saved);
        const stateIdentical = JSON.stringify(checkpoint(copy)) === JSON.stringify(saved);
        const choicesA = this.phase(lane, 64, false, false).choices;
        const choicesB = this.phase(copy, 64, false, false).choices;
        this.lanes[i] = restore(lane, saved); // verification does not advance the lab
        return { mode: lane.mode, stateIdentical, choicesIdentical: JSON.stringify(choicesA) === JSON.stringify(choicesB) };
      });
    } else {
      if (command === "reverse") this.reversed = !this.reversed;
      const learning = command === "acquire" || command === "reverse";
      const n = command === "reverse" ? 400 : command === "acquire" ? 300 : 200;
      const phase = { acquire: "Acquisition", evaluate: "Held-out evaluation", reverse: "Reward reversal", ablate: "Learned output removed" }[command];
      this.history.push({ phase, rewardedSite: (this.reversed ? 1 - this.initialGood : this.initialGood) + 1, results: this.lanes.map(lane => this.phase(lane, n, learning, command === "ablate")) });
      this.history = this.history.slice(-12);
    }
    return this.report();
  }
  report(): LabReport {
    return { protocol: "stratoks-browser-lab-v1: synthetic equal-innate two-site task; training 20% forced exposure, 10% reward noise; evaluation hunger 0.45 vs training 0.4; no reflexes; last 12 phases retained", seed: this.seed, task: this.task,
      rewardedSite: (this.reversed ? 1 - this.initialGood : this.initialGood) + 1, reversed: this.reversed,
      parameters: MB_PARAMS, history: this.history, retention: this.retention };
  }
}
