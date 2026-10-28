/// <reference lib="webworker" />
import { LearningLab } from "./learningLab";
let lab: LearningLab | undefined;
self.onmessage = ({ data }) => {
  try {
    if (data.command === "reset") lab = new LearningLab(data.seed, data.task);
    if (!lab) throw new Error("Initialize a scenario first.");
    postMessage({ command: data.command, report: data.command === "reset" ? lab.report() : lab.run(data.command) });
  } catch (error) { postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
