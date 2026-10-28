// Snapshot schema migrations. Each entry upgrades snapshot.state from version N to N+1 in place.
// v0 is a documented legacy layout used to exercise the framework (creatures had `hp`, no totals.interventions).
export const CURRENT_SCHEMA = 2;
export const MIGRATIONS = {
  0(state) {
    for (const c of state.creatures ?? []) { if (c.health === undefined && c.hp !== undefined) { c.health = c.hp; delete c.hp; } }
    state.totals ??= {}; state.totals.interventions ??= 0; state.totals.deathsByCause ??= {};
    state.interventions ??= {}; state.interventionOrder ??= []; state.interventionTimes ??= {};
    state.learning ??= true; state.vstate ??= {};
  },
  // v1 -> v2: intervention idempotency keys become `${actor}:${id}` (actor = lowercase wallet that applied it).
  // Every existing record already stores its actor, so each old ID is re-keyed to its original owner: a retry by
  // that developer is still a duplicate; another developer reusing the same ID now gets a separate intervention.
  // Records without an actor (none are produced by Phase 1 code) are kept under `legacy-unknown:${id}`.
  1(state) {
    const old = state.interventions ?? {}, order = state.interventionOrder ?? [], next = {}, nextOrder = [];
    for (const id of order.length ? order : Object.keys(old)) {
      const rec = old[id]; if (!rec) continue;
      const actor = typeof rec.actor === 'string' && rec.actor ? rec.actor.toLowerCase() : 'legacy-unknown';
      const key = `${actor}:${rec.id ?? id}`;
      next[key] = { ...rec, key, actor, migratedFromKey: id }; nextOrder.push(key);
    }
    state.interventions = next; state.interventionOrder = nextOrder;
    state.learningLog ??= [];
  },
};
export function migrate(snap) {
  let v = snap.schemaVersion ?? 0;
  if (v > CURRENT_SCHEMA) throw new Error(`snapshot schema ${v} is newer than this server (${CURRENT_SCHEMA}); refusing to load`);
  const from = v;
  while (v < CURRENT_SCHEMA) { MIGRATIONS[v](snap.state); v++; }
  snap.schemaVersion = v;
  return { snap, from, to: v };
}
