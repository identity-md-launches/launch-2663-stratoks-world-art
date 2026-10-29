import type { Delta, Snapshot, WorldEvent, WorldState, Mode } from "./types";
export const initialState = (): WorldState => ({
  mode: "disconnected",
  world: null,
  entities: new Map(),
  events: [],
  history: [],
  health: null,
  n: -1,
  seq: 0,
  tick: 0,
  lastUpdate: null,
  serverTime: null,
  demoMode: false,
  error: null,
});
const mergeEvents = (a: WorldEvent[], b: WorldEvent[]) =>
  [...new Map([...a, ...b].map((e) => [e.seq, e])).values()]
    .sort((x, y) => x.seq - y.seq)
    .slice(-500);
export class WorldStore {
  state = initialState();
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.state;
  patch(patch: Partial<WorldState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  reset(mode: Mode = "disconnected") {
    this.state = initialState();
    this.patch({ mode });
  }
  apply(message: Snapshot | Delta): "applied" | "resync" {
    if (message.type === "snapshot") {
      if (
        !message.world?.worldId ||
        !Array.isArray(message.entities) ||
        !Array.isArray(message.world.tiles) ||
        !Array.isArray(message.events)
      )
        throw new Error("The server sent an invalid world snapshot.");
      const sameWorld =
        this.state.world?.worldId === message.world.worldId &&
        this.state.serverEpoch === message.epoch &&
        message.tick >= this.state.tick && message.seq >= this.state.seq;
      this.patch({
        world: message.world,
        serverEpoch: message.epoch,
        entities: new Map(message.entities.map((e) => [e.k, e])),
        events: mergeEvents(sameWorld ? this.state.events : [], message.events),
        history: message.history,
        health: message.health,
        n: message.n,
        seq: message.seq,
        tick: message.tick,
        lastUpdate: Date.now(),
        serverTime: message.serverTime,
        demoMode: message.demoMode,
        error: null,
      });
      return "applied";
    }
    if (
      !this.state.world ||
      this.state.serverEpoch !== message.epoch ||
      message.n !== this.state.n + 1 ||
      message.meta.worldId !== this.state.world.worldId
    )
      return "resync";
    const entities = new Map(this.state.entities);
    for (const e of message.upsert) entities.set(e.k, e);
    for (const k of message.remove) entities.delete(k);
    this.patch({
      entities,
      world: { ...this.state.world, ...message.meta },
      events: mergeEvents(this.state.events, message.events),
      health: message.health,
      n: message.n,
      seq: Math.max(this.state.seq, message.seq),
      tick: message.tick,
      lastUpdate: Date.now(),
      serverTime: message.serverTime,
      error: null,
    });
    return "applied";
  }
}
export const worldStore = new WorldStore();
