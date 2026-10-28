/// <reference lib="webworker" />
import { World } from "../../server/src/world.js";
import {
  buildView,
  creatureDetail,
  tileRows,
  worldMeta,
} from "../../server/src/view.js";
declare const __DEMO_CONFIG__: any;
const cfg = structuredClone(__DEMO_CONFIG__);
// Explicit opt-in for this private browser world only. Server defaults stay legacy.
cfg.world.brainMode = "mb-v1";
// The existing JavaScript engine initializes dynamic fields in World.create.
let world: any;
let n = 0;
let timer: ReturnType<typeof setInterval>;
let speed = 4;
let latency = 0;
let peak = 0;
function send() {
  postMessage({
    type: "snapshot",
    n: n++,
    tick: world.tick,
    seq: world.seq,
    serverTime: Date.now(),
    world: { ...worldMeta(world, cfg), tiles: tileRows(world) },
    entities: [...buildView(world).values()],
    events: world.events.slice(-200),
    history: world.history.slice(-300),
    demoMode: true,
    health: {
      overloaded: latency > 200,
      cpuPercent: null,
      rssMB: null,
      clients: 1,
      lagMs: 0,
      tickLatencyMs: {
        p50: latency,
        p95: latency,
        p99: latency,
        max: peak,
        budget: 1000 / speed,
      },
    },
  });
}
function startTimer() {
  clearInterval(timer);
  if (!speed) return;
  timer = setInterval(() => {
    const t = performance.now();
    world.step();
    latency = performance.now() - t;
    peak = Math.max(peak, latency);
    send();
  }, 1000 / speed);
}
self.onmessage = (e) => {
  const { type, body, id } = e.data;
  try {
    if (type === "start") {
      world = World.create(cfg);
      // Honest, reproducible pre-roll: the default engine starts with 24, then earns every shelter/birth.
      for (let i = 0; i < 900; i++) world.step();
      send();
      startTimer();
    } else if (type === "speed") {
      speed = [0, 1, 4, 12].includes(body) ? body : 4;
      startTimer();
    } else if (type === "detail") {
      const creature = world.getCreature(body);
      const result = creature
        ? creatureDetail(world, creature)
        : { dead: true, ...world.graveyard.find((c: any) => c.id === body) };
      postMessage({ type: "response", id, result });
    } else if (type === "intervene") {
      const result = world.intervene(body, "local-demo");
      if (!result.ok)
        throw new Error(
          result.error === "cooldown"
            ? `Let the demo recover. Retry in ${result.retryAfterTicks} ticks.`
            : result.error,
        );
      send();
      postMessage({ type: "response", id, result });
    }
  } catch (error) {
    postMessage({
      type: "response",
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
