// Regression checks discovered while integrating the browser's durable retry flow.
import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../server/src/world.js";
import { DEFAULTS, deepMerge } from "../server/src/config.js";
import { startApp, api, login, DEV_KEY } from "./helpers.js";

test("intervention IDs remain idempotent beyond the former 20,000-record window", () => {
  const cfg = deepMerge(DEFAULTS, {
    interventions: {
      cooldownTicks: { heal_area: 0 },
      maxPerTypePerWindow: 25000,
    },
  });
  const w = World.create(cfg);
  const req = {
    id: "retained-first-id",
    type: "heal_area",
    x: 0,
    y: 0,
    radius: 1,
    intensity: 0.1,
  };
  assert.equal(w.intervene(req, "integration-test").duplicate, false);
  for (let i = 0; i < 20001; i++)
    assert.equal(
      w.intervene({ ...req, id: `subsequent-${i}` }, "integration-test").ok,
      true,
    );
  const count = w.totals.interventions;
  assert.equal(w.intervene(req, "integration-test").duplicate, true);
  assert.equal(w.totals.interventions, count);
  assert(w.interventions["integration-test:retained-first-id"]);
});

test("a failed snapshot is never acknowledged as a durable intervention or backup", async () => {
  const app = await startApp({}, { manualTicks: true });
  try {
    const auth = await login(app.base, DEV_KEY);
    assert.equal(auth.status, 200);
    const save = app.svc.store.save.bind(app.svc.store);
    app.svc.store.save = () => {
      throw new Error("simulated unavailable storage");
    };
    const body = {
      id: "save-failure-retry",
      type: "add_food",
      x: 28,
      y: 28,
      radius: 4,
      intensity: 0.5,
    };
    const first = await api(app.base, "POST", "/api/dev/interventions", {
      body,
      token: auth.json.token,
    });
    assert.equal(first.status, 503);
    assert.equal(app.svc.world.totals.interventions, 1);
    const uncertain = await api(app.base, "POST", "/api/dev/interventions", {
      body,
      token: auth.json.token,
    });
    assert.equal(uncertain.status, 503);
    const backup = await api(app.base, "POST", "/api/dev/backup", {
      body: {},
      token: auth.json.token,
    });
    assert.equal(backup.status, 503);
    app.svc.store.save = save;
    const retry = await api(app.base, "POST", "/api/dev/interventions", {
      body,
      token: auth.json.token,
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.json.duplicate, true);
    assert.equal(app.svc.world.totals.interventions, 1);
    const persisted = app.svc.store.load();
    assert(persisted.state.interventions[`${auth.json.address}:${body.id}`]);
  } finally {
    await app.stop();
  }
});
