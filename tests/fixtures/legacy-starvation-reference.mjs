// Differential reference: the recovered engine with ONLY the newly specified
// starvation rule. Its original files stay immutable. Independent implementation;
// no production controller/actions code is imported into this reference.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

export async function starvationCorrectedLegacy() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const source = path.join(root, 'tests/fixtures/legacy09af84d');
  const target = path.join(root, 'test/scratch/legacy-starvation-reference');
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  const file = path.join(target, 'src/actions.js');
  let text = fs.readFileSync(file, 'utf8');
  function replace(before, after) { assert.equal(text.split(before).length, 2); text = text.replace(before, after); }
  replace('  perceive(w, c);', '  const priorFood = c.places.food.slice();\n  perceive(w, c);');
  replace('  let pick;', `  // Reference union uses arrays rather than the final engine's Map.
  const seen = w.bushes.filter(b => dist(c, b) <= cfg.perceptionRadius);
  const remembered = priorFood.filter(m => w.bushes.some(b => b.id === m.id) && !seen.some(b => b.id === m.id));
  const feasible = c.hunger >= 80 && haz.danger <= 0.8
    ? [...remembered, ...seen].filter(m => m.amount >= 0.5 && w.walkable(m.x, m.y) && w.findPath(c.x, c.y, m.x, m.y, false) !== null)
      .sort((a, b) => dist(c, a) - dist(c, b) || a.id - b.id) : [];
  const emergency = feasible[0];
  let pick;`);
  replace('c.hunger >= 55 && !food && !haz.danger', 'c.hunger >= 55 && !food && !emergency && !haz.danger');
  replace("  else if (c.hunger >= 80 && food) pick = cand.find((x) => x.a === 'EAT'); // survival reflex: learning cannot talk a creature out of eating when starving",
    `  else if (c.hunger >= 80 && (food || emergency)) pick = emergency
    ? { a: 'EAT', food: { m: emergency, d: dist(c, emergency) }, u: utility(c.brain, 'EAT', f) }
    : { ...cand.find(x => x.a === 'WANDER'), far: true };`);
  fs.writeFileSync(file, text);
  return (await import(pathToFileURL(path.join(target, 'src/world.js')).href)).World;
}
