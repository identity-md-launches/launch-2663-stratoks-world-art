# Brain interface v1 — backend and inspector contract

No new dependencies or writable public endpoints. Existing snapshot, delta, creature detail and authorization routes remain compatible. Additive fields can be ignored by old clients.

## Configuration and stored modes

`world.brainMode` / `BRAIN_MODE`: `legacy` (production default), `mb-v1`, `mb-v1-frozen`, `mb-v1-ablated`. Unknown values fail startup. Explicit operator configuration applies on restart; an unset value keeps the stored mode. The explicit transition emits `brain_mode_changed` without resetting IDs, age, family, needs, memories or either brain's weights. Newborn circuit state initializes independently on its first decision. Browser clients cannot activate modes.

A creature brain has `version:1`, unchanged legacy `w`, `wallets`, `updates`, reward counters and optional `mb`. `mb.version=1` pins projection, positive/negative output arrays, initialization seed, current RNG, neural update count and the last 16 reward records. The pending action stores its decision mode and sensory eligibility trace. Older brain state is retained rather than translated to allegedly equivalent circuit knowledge. Unknown interface/circuit versions used by an active mode are rejected.

Server adapter (`server/src/controller.js`):

- `initializeBrains(world)` validates and initializes only the selected circuit, without consuming global RNG.
- `setBrainMode(world, mode, source)` changes the policy and emits the transition.
- `scoreCandidate(world, creature, action, features, {target?,wallet?})` returns `{u, trace?, sensed?, preference?, innate?}`. Spatial/food candidates refer to already feasible local or remembered targets; the adapter does not add executable game actions.
- `selectCandidate(world, creature, candidates)` keeps legacy softmax unchanged. Circuit modes use action/target hierarchy: softmax over the best target utility per action, then conditional softmax over that action's target scores. A single persisted random draw partitions both stages. Repeated targets cannot increase action mass; target associations still affect both stages.
- `rewardAction(world, creature, storedAction, reward)` updates only `legacy` or `mb-v1`, when learning is enabled, not catch-up, and the action's captured mode still matches the current mode. Frozen and ablated modes never change circuit matrices or their update counter. Ablation also suppresses their contribution to scores. In-flight actions complete normally across mode changes; they cannot teach a newly selected mode.
- `brainInspection(world, creature)` supplies bounded presentation data.

Actual `decide → startAct → stepAct → endAct` calls this adapter; neither rendering nor clients choose server actions.

## Read-only JSON

`GET /api/creatures/:id` adds `brainBehavior`:

```json
{
  "interfaceVersion": 1,
  "mode": "mb-v1",
  "circuitVersion": 1,
  "learningEnabled": true,
  "updates": 0,
  "decision": null,
  "rewardHistory": [],
  "note": "Reduced fly-inspired circuit. Game actions, spatial cues, personality and wallet memory are engineered abstractions."
}
```

The mode is the currently selected policy; the last decision may predate an operator restart/mode change, and an already pending action can still be completing in its captured mode. When a decision exists it includes `tick`, `source` (`reflex|rule|model`), `selectedAction`, optional food `selectedTarget`, `sensed {features,x,y,width,height,cues,visible}`, `activeKCs` (max 8), and bounded `candidates [{action,target,score,innate,preference}]`. Legacy candidates have null circuit values. Legacy/forced selections can expose only the existing features when they have no circuit trace; no fabricated neural activity is shown.

`learningEnabled` describes current policy plasticity: false in frozen/ablated modes, during catch-up or when `LEARNING=0`. It is independent of wallet-memory policy. New decisions add their captured `mode`; retained older decisions may lack it. An absent captured mode is unknown, never the current mode by inference: the client labels it **Decision mode unrecorded**, uses neutral candidate explanations, and exposes any retained active-unit trace independently of the current mode. Startup preserves that historical record without rewriting it or requiring a new decision.

`rewardHistory` entries: `{tick,action,reward,prediction,learned,source,mode?}`. New service outcomes include the captured action mode; old records remain intact. `prediction` is the pre-update circuit valence (null if no eligibility), or zero for an ablated action's suppressed contribution. `learned` means a weight update actually occurred, always false for new frozen/ablated outcomes. A retained outcome can truthfully record a previous mode's update. World metadata adds `brainMode`. WebSocket entity decisions remain authoritative; inspector details are polled separately on the existing rate-limited public read route. No per-tick weight matrices are broadcast.

Starvation (`hunger >= 80`, below the higher-priority fire escape) selects from the union of **all currently sensed food sites and retained remembered sites before the ten-site cap**. Current observations override stale remembered amounts; deleted sites, amount <0.5, blocked goals and sites without a path are excluded. The nearest feasible site by Euclidean distance wins, with numeric site id as deterministic tie break. It is explicitly a `reflex`, irrespective of target utility; if none is reachable, a `rule` searches for food. Non-emergency target choice and its ten-site cap remain unchanged and model-selected. This specified all-mode reflex correction can change legacy ecology; legacy's linear scoring and softmax remain unchanged. The separately documented wallet opinions retain the existing world `LEARNING` policy in both frozen and ablated modes. `learning.updates` remains the retained linear-policy count, `learning.meanReward` includes all completed rewarded actions, and recent decisions can span policies; the client groups these under **Learning history**.

## Bounds and isolation

128×6 fixed projection indices; 11×128×2 bounded output weights; one current eligibility (8 winners plus 36 PN values); 16 reward records; one last candidate inspection (up to 10 local food alternatives plus one emergency target and the fixed repertoire). The union of sensed and remembered sites is temporary, used only by the emergency selector; it does not enlarge persisted food memory or learned choices. Existing 10 food places, 32 wallet opinions, 24 relationships, memory/decision rings and ecology bounds stay in place. No unbounded neural arrays or new log stream.

`deploy/phase2a-demo/` is an optional static **companion inspector**, not a modification of the recovered client's layout. Its circuit module copies must match the server byte-for-byte (`tests/inspector.test.js`). A browser-only synthetic experiment uses the same core; controls never write to a connected server. The local demo starts a fresh temporary, isolated backend and serves the unchanged recovered client separately. Static publication and incorporating the panel into the main client's UI are integration work, not asserted by this backend component.
