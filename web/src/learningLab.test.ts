import test from "node:test";
import assert from "node:assert/strict";
import { LearningLab, LAB_MODES, type LabTask } from "./learningLab";

test("three real policies acquire, reverse and lose preference with output ablation across ten seeds", () => {
  for (const task of ["location", "cue", "threat"] as LabTask[]) {
    const acquired: number[] = [], reversed: number[] = [], lesioned: number[] = [], frozen: number[] = [], legacy: number[] = [];
    const rewarded = new Set<number>();
    for (let seed = 1; seed <= 10; seed++) {
      const lab = new LearningLab(seed, task);
      rewarded.add(lab.report().rewardedSite);
      assert(lab.run("evaluate").history.at(-1)!.results.every(r => !r.weightsChanged));
      const training = lab.run("acquire").history.at(-1)!.results;
      assert(training.find(r => r.mode === "mb-v1")!.weightsChanged);
      assert.equal(training.find(r => r.mode === "mb-v1-frozen")!.updates, 0);
      const evaluation = lab.run("evaluate").history.at(-1)!.results;
      assert(evaluation.every(r => !r.weightsChanged && r.forcedTrials.length === 0));
      acquired.push(evaluation[1].autonomousFractionGood);
      frozen.push(evaluation[2].autonomousFractionGood);
      legacy.push(evaluation[0].autonomousFractionGood);
      assert(lab.run("retention").retention!.every(r => r.stateIdentical && r.choicesIdentical));
      lab.run("reverse");
      const reversal = lab.run("evaluate").history.at(-1)!.results;
      reversed.push(reversal[1].autonomousFractionGood);
      const ablated = lab.run("ablate").history.at(-1)!.results;
      assert(ablated.every(r => !r.weightsChanged));
      lesioned.push(ablated[1].autonomousFractionGood);
    }
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    assert.equal(rewarded.size, 2, "counterbalanced reward identity");
    assert(mean(acquired) > 0.75, `${task} acquisition`);
    assert(mean(reversed) > 0.75, `${task} reversal`);
    for (const xs of [lesioned, frozen, legacy]) assert(mean(xs) > 0.35 && mean(xs) < 0.65, `${task} causal control`);
  }
});

test("lab reproducibility, validation and bounded retained evidence", () => {
  const a = new LearningLab(7, "cue"), b = new LearningLab(7, "cue");
  for (const command of ["evaluate", "acquire", "evaluate", "reverse", "evaluate", "ablate", "retention"] as const) {
    assert.deepEqual(a.run(command), b.run(command));
  }
  const before = JSON.stringify(a.report());
  assert.throws(() => a.run("unknown" as never));
  assert.equal(JSON.stringify(a.report()), before);
  for (let i = 0; i < 15; i++) a.run("evaluate");
  assert.equal(a.report().history.length, 12);
  assert.equal(a.report().history.at(-1)!.results.length, LAB_MODES.length);
  for (const seed of [0, -1, 1.5, NaN, 100001]) assert.throws(() => new LearningLab(seed, "location"));
  assert.throws(() => new LearningLab(1, "unknown" as never));
});
