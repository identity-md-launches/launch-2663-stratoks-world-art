import test from "node:test";
import assert from "node:assert/strict";
import { WorldStore } from "./store";
import { World } from "../../server/src/world.js";
import { DEFAULTS } from "../../server/src/config.js";
import { buildView, tileRows, worldMeta } from "../../server/src/view.js";
import type { Snapshot, Delta, WorldEvent } from "./types";
function fixture() {
  const w: any = World.create(structuredClone(DEFAULTS));
  for (let i = 0; i < 150; i++) w.step();
  const snapshot = {
    type: "snapshot",
    n: 0,
    tick: w.tick,
    seq: w.seq,
    serverTime: Date.now(),
    world: { ...worldMeta(w, DEFAULTS), tiles: tileRows(w) },
    entities: [...buildView(w).values()],
    events: w.events,
    history: w.history,
    health: {},
    demoMode: true,
  } as unknown as Snapshot;
  return { w, snapshot };
}
test("actual simulation snapshot is rendered as an entity map with its real population", () => {
  const { w, snapshot } = fixture();
  const store = new WorldStore();
  store.apply(snapshot);
  assert.equal(store.state.entities.size, buildView(w).size);
  assert.equal(store.state.world?.population, w.creatures.length);
  assert.equal(store.state.tick, 150);
  assert.equal(store.state.demoMode, true);
});
test("delta updates one creature, removes consumed resources, and deduplicates replayed events", () => {
  const { snapshot } = fixture();
  const store = new WorldStore();
  store.apply(snapshot);
  const creature = snapshot.entities.find((e) => e.k.startsWith("c:"))!;
  const resource = snapshot.entities.find((e) => e.kind === "bush")!;
  const birth: WorldEvent = {
    seq: snapshot.seq + 1,
    tick: 151,
    type: "birth",
    name: "Test birth",
  };
  const delta = {
    type: "delta",
    n: 1,
    tick: 151,
    seq: birth.seq,
    serverTime: Date.now(),
    upsert: [{ ...creature, health: 42 }],
    remove: [resource.k],
    events: [snapshot.events[0], birth, birth],
    meta: { ...snapshot.world, tick: 151 },
    health: snapshot.health,
  } as Delta;
  assert.equal(store.apply(delta), "applied");
  assert.equal(store.state.entities.get(creature.k)?.health, 42);
  assert.equal(store.state.entities.has(resource.k), false);
  assert.equal(store.state.events.filter((e) => e.seq === birth.seq).length, 1);
});
test("a sequence gap freezes existing state and asks for a full snapshot", () => {
  const { snapshot } = fixture();
  const store = new WorldStore();
  store.apply(snapshot);
  const before = store.state;
  const delta = {
    type: "delta",
    n: 3,
    tick: 999,
    seq: 999,
    serverTime: Date.now(),
    upsert: [],
    remove: [],
    events: [],
    health: snapshot.health,
    meta: snapshot.world,
  } as Delta;
  assert.equal(store.apply(delta), "resync");
  assert.equal(store.state, before);
});
test("reconnect snapshot replaces entities without duplicating past events", () => {
  const { snapshot } = fixture();
  const store = new WorldStore();
  store.apply(snapshot);
  store.apply({ ...snapshot, n: 20, tick: 170 });
  assert.equal(store.state.entities.size, snapshot.entities.length);
  assert.equal(
    store.state.events.length,
    new Set(snapshot.events.map((e) => e.seq)).size,
  );
  assert.equal(store.state.n, 20);
});
test("developer reset replaces world, history, events and sequence rather than merging old identities", () => {
  const { snapshot } = fixture();
  const store = new WorldStore();
  store.apply(snapshot);
  assert.equal(
    store.apply({
      type: "delta",
      n: 1,
      tick: 1,
      seq: 1,
      serverTime: Date.now(),
      upsert: [],
      remove: [],
      events: [],
      health: snapshot.health,
      meta: { ...snapshot.world, worldId: "new-world" },
    } as Delta),
    "resync",
  );
  store.apply({
    ...snapshot,
    world: { ...snapshot.world, worldId: "new-world" },
    seq: 1,
    tick: 1,
    entities: [],
    history: [],
    events: [{ seq: 1, tick: 1, type: "world_created" }],
  });
  assert.equal(store.state.entities.size, 0);
  assert.equal(store.state.events.length, 1);
  assert.equal(store.state.seq, 1);
  assert.equal(store.state.history.length, 0);
});
test("a snapshot from an earlier restored backup discards events from the abandoned timeline", () => {
  const { snapshot } = fixture();
  const store = new WorldStore();
  store.apply(snapshot);
  store.apply({
    ...snapshot,
    tick: 1,
    seq: 1,
    events: [{ seq: 1, tick: 1, type: "world_created" }],
  });
  assert.equal(store.state.events.length, 1);
});
test("malformed snapshot is refused without changing the current world", () => {
  const { snapshot } = fixture();
  const store = new WorldStore();
  store.apply(snapshot);
  const before = store.state;
  assert.throws(() =>
    store.apply({
      ...snapshot,
      world: { ...snapshot.world, tiles: undefined },
    } as unknown as Snapshot),
  );
  assert.equal(store.state, before);
});

test("same-tick snapshot recovery discards uncommitted events as well as lower-tick recovery", () => {
  const { snapshot } = fixture();
  const store = new WorldStore();
  store.apply(snapshot);
  const uncommitted = {seq:snapshot.seq+1,tick:snapshot.tick,type:"intervention"};
  store.apply({...snapshot,seq:uncommitted.seq,events:[...snapshot.events,uncommitted]});
  assert(store.state.events.some(e=>e.seq===uncommitted.seq));
  store.apply(snapshot);
  assert.equal(store.state.events.some(e=>e.seq===uncommitted.seq),false);
  assert.equal(store.state.seq,snapshot.seq);
});

test("restart epoch clears abandoned events even when the new sequence has already caught up", () => {
  const { snapshot } = fixture();
  const store = new WorldStore();
  store.apply({ ...snapshot, epoch: "old", events: [{ seq: 1, tick: 1, type: "abandoned" }] });
  store.apply({ ...snapshot, epoch: "new", tick: snapshot.tick + 1, seq: snapshot.seq + 1, events: [] });
  assert.equal(store.state.events.length, 0);
  assert.equal(store.state.serverEpoch, "new");
  assert.equal(store.apply({ type: "delta", epoch: "old", n: 1, meta: snapshot.world, tick: snapshot.tick, seq: snapshot.seq, serverTime: Date.now(), upsert: [], remove: [], events: [], health: snapshot.health } as Delta), "resync");
});
