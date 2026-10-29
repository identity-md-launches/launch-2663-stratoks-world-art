import test from "node:test";
import assert from "node:assert/strict";
import { residentPose } from "./worldRenderer";
import type { WorldFrame, Resident } from "./types";
const r: Resident = {
  id: 42,
  name: "Test resident",
  x: 28,
  y: -1,
  health: 80,
  action: null,
};
const f = { inspector: null } as WorldFrame;
test("appearances require confirmed engine state; inventory is not inferred from action", () => {
  assert.equal(residentPose({ ...r, action: "move" }, f, false), "idle");
  assert.equal(residentPose({ ...r, action: "move" }, f, true), "walk");
  assert.equal(residentPose({ ...r, action: "carry" }, f, true), "idle");
  for (const [action, pose] of [
    ["rest", "rest"],
    ["build", "build"],
    ["gather", "gather"],
  ] as const)
    assert.equal(residentPose({ ...r, action }, f, false), pose);
  const inspector = {
    id: 42,
    inventory: { wood: 2 },
  } as unknown as WorldFrame["inspector"];
  assert.equal(
    residentPose({ ...r, action: "move" }, { ...f, inspector }, true),
    "carry",
  );
  assert.equal(
    residentPose(
      { ...r, action: "carry" },
      { ...f, inspector: { ...inspector!, id: 43 } },
      true,
    ),
    "idle",
  );
  assert.equal(
    residentPose(
      { ...r, action: "carry" },
      { ...f, inspector: { ...inspector!, inventory: { stone: 2 } } },
      true,
    ),
    "idle",
  );
});
