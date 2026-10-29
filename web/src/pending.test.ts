import assert from "node:assert/strict";
import test from "node:test";
import { legacyPendingKey, parsePending, pendingKey } from "./pending";
const body = { id: "retry-request-123", type: "add_food", x: 28, y: 28, radius: 4, intensity: 0.5 };

test("uncertain interventions stay owned by the actor, world and service across reloads", () => {
  const a = pendingKey("https://world.test", "existing-world", "0xABCD");
  const b = pendingKey("https://world.test", "existing-world", "0xEF01");
  const storage = new Map([[a, JSON.stringify(body)]]);
  assert.equal(a, pendingKey("https://world.test", "existing-world", "0xabcd"));
  assert.deepEqual(parsePending(storage.get(a)!), body);
  assert.equal(parsePending(storage.get(b) ?? null), null);
  assert.notEqual(a, pendingKey("https://other.test", "existing-world", "0xabcd"));
  assert.notEqual(a, pendingKey("https://world.test", "different-world", "0xabcd"));
  assert.notEqual(a, legacyPendingKey("https://world.test", "existing-world"));
});

test("legacy payloads remain readable but cannot be mistaken for actor-owned storage", () => {
  const legacy = legacyPendingKey("https://world.test", "world");
  const storage = new Map([[legacy, JSON.stringify(body)]]);
  assert.deepEqual(parsePending(storage.get(legacy)!), body);
  for (const actor of ["0xabc", "0xdef"])
    assert.equal(parsePending(storage.get(pendingKey("https://world.test", "world", actor)) ?? null), null);
});

test("invalid stored requests cannot be retried", () => {
  for (const raw of ["{", "null", "{}", JSON.stringify({...body, x:"28"}), JSON.stringify({...body,id:"invalid!"}), JSON.stringify({...body,type:"reset"})])
    assert.equal(parsePending(raw), null);
});
