# World rules (explicit)

Tick = 1 simulation step (default 1000 ms real time). Map 56×56 tiles (grass, lakes), static terrain from the seed.

**Ecology**: a bush regrows `amount += r·(amount+0.25)·(1−amount/5)` per tick (r = 0.004, ×1.5 within 4 tiles of water). Bushes at ≥80 % capacity seed a neighbouring tile with probability 0.0004/tick while fewer than 90 bushes exist. A bush empty for 4000 ticks dies (overgrazing). Trees hold 8 wood, +1 per 800 ticks; stone nodes 12 units, +1 per 1500 ticks.

**Needs**: hunger +0.05/tick (×0.6 for juveniles, ×0.6 while resting); eating a unit −25. Hunger ≥ 90 costs 0.02 health/tick, ≥ 100 costs 0.08/tick (starvation). Health regenerates (hunger < 60). Energy falls with moving/working; resting restores it (×2.5 inside a shelter). Old age: death probability rises after age 14000.

**Shelters**: 2 stone + 6 wood, 90 work ticks, 3 visible stages (foundation, walls, roof) each paid from the site's stock before work. Capacity 4; integrity damaged by fire/storms, repaired for 1 wood per +30. Demand: a new site starts when adults > (capacity−1)·shelters.

**Reproduction**: both adults (age ≥ 1500), bonded, sharing a complete shelter with room, hunger < 50, health > 60, energy > 40, no cooldown, colony food ≥ 4 units per creature. Costs: 2 food units removed from nearby bushes, mother +20 hunger/−25 energy, father +8/−20; 500-tick recovery for both; 80-tick gestation; newborn needs 1500 ticks to become fertile. Miscarriage if the mother is starving/ill. Sex ratio of births leans mildly toward the minority sex (simplification).

**Scarcity**: hunger and the food-per-creature gate suppress reproduction first; only then health damage and starvation deaths. Every birth/death is an event and a line in `lifecycle.jsonl` with cause.

**Extinction**: status `extinct`, births stop, history/graveyard preserved, only `POST /api/dev/reset` starts a new world (the old data is archived).

**Overload & downtime**: if a tick finishes late the world slows (no burst catch-up) and broadcasts are thinned; creatures are never removed. After a restart world time resumes where it stopped; at most `catchup.maxTicks` (600) non-lethal, birth-free catch-up ticks are simulated and a `downtime` event is recorded; the rest of the outage is not simulated.

**Disasters (developer interventions only)**: fire (radius ≤ 8, burns trees/bushes, damages shelters and creatures outdoors, ~120 ticks), storm (damages exposed creatures, shelters, bushes), heal area, add food. Limits and cooldowns are in the `interventions` config block.
