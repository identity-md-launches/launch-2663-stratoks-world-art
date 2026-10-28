// Runs the inherited measurement tools unchanged except for output location and CPU accounting.
// Reports local hardware, never target-VPS capacity. Run after other heavy checks finish.
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
const root = fileURLToPath(new URL("../../", import.meta.url));
const out = path.join(root, "artifacts/measurements");
const scratch = path.join(root, "test/scratch");
await fs.mkdir(out, { recursive: true });
await fs.mkdir(scratch, { recursive: true });
await fs.writeFile(
  path.join(out, "hardware.json"),
  JSON.stringify(
    {
      date: new Date().toISOString(),
      scope:
        "Local machine only. No ARM64, Docker or real VPS capacity measurement.",
      node: process.version,
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpuModel: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      reportedMemoryGiB: +(os.totalmem() / 1024 ** 3).toFixed(2),
      allocationNote:
        "Logical CPUs and RAM are OS-reported. Shared scheduling, quota and target-VPS availability are not inferred.",
    },
    null,
    2,
  ) + "\n",
);
async function run(source, name, args = []) {
  let script = await fs.readFile(path.join(root, source), "utf8");
  script = script.replaceAll("../results/", "../../artifacts/measurements/");
  if (name === "long-sim") {
    script = script.replace(
      "const t00 = performance.now();",
      "const t00 = performance.now(); const cpuStart = process.cpuUsage();",
    );
    script = script.replace(
      "const out = { ticksRun:",
      "const cpuUsed = process.cpuUsage(cpuStart);\nconst out = { cpuSeconds: +( (cpuUsed.user + cpuUsed.system) / 1e6 ).toFixed(3), ticksRun:",
    );
  }
  const dest = path.join(scratch, `measure-${name}.mjs`);
  await fs.writeFile(dest, script);
  const child = spawn("node", [dest, ...args], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (c) => {
    log += c;
    process.stdout.write(c);
  });
  child.stderr.on("data", (c) => {
    log += c;
    process.stderr.write(c);
  });
  const code = await new Promise((r, j) => {
    child.on("exit", r);
    child.on("error", j);
  });
  await fs.writeFile(path.join(out, `${name}-output.txt`), log);
  if (code !== 0) throw new Error(`${name} exited ${code}`);
}
await run("tests/load/long-sim.mjs", "long-sim", ["500000"]);
await run("tests/load/population.mjs", "population");
await run("tests/experiments/compare-learning.mjs", "learning", ["8000", "8"]);
await run("tests/load/ws-clients.mjs", "clients-100", [
  "100",
  "30",
  "250",
  "24",
]);
await run("tests/load/ws-clients.mjs", "clients-200", [
  "200",
  "30",
  "250",
  "250",
]);
console.log("Local measurements complete: artifacts/measurements/.");
