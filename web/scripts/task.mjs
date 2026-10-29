// Keeps all installed dependencies and build caches outside the submission tree.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../../", import.meta.url));
const id = createHash("sha256").update(root).digest("hex").slice(0, 12);
const temp = path.join(os.tmpdir(), `stratoks-build-${id}`);
const project = path.join(temp, "web");
const task = process.argv[2] ?? "build";
// Browser probes need only the dependency location. They must not delete/copy
// shared build sources while another probe or build is using the staging tree.
if (task === "path") {
  console.log(project);
  process.exit(0);
}
await fs.mkdir(project, { recursive: true });
for (const folder of ["src", "public"]) {
  await fs.rm(path.join(project, folder), { recursive: true, force: true });
  await fs.cp(path.join(root, "web", folder), path.join(project, folder), {
    recursive: true,
  });
}
for (const file of [
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "index.html",
])
  await fs.copyFile(path.join(root, "web", file), path.join(project, file));
await fs.cp(
  path.join(root, "server", "src"),
  path.join(temp, "server", "src"),
  { recursive: true },
);
await fs.copyFile(
  path.join(root, "server", "package.json"),
  path.join(temp, "server", "package.json"),
);
const run = (args) => {
  const r = spawnSync(
    "npm",
    ["--cache", path.join(os.tmpdir(), "stratoks-npm-cache"), ...args],
    { cwd: project, stdio: "inherit" },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const lock = path.join(root, "web", "package-lock.json");
let hasLock = true;
try {
  await fs.copyFile(lock, path.join(project, "package-lock.json"));
} catch {
  hasLock = false;
}
if (!hasLock) {
  run(["install", "--no-audit", "--no-fund"]);
  await fs.copyFile(path.join(project, "package-lock.json"), lock);
} else {
  const digest = createHash("sha256")
    .update(await fs.readFile(lock))
    .digest("hex");
  const stamp = path.join(temp, "lock-stamp");
  if ((await fs.readFile(stamp, "utf8").catch(() => "")) !== digest) {
    run(["ci", "--no-audit", "--no-fund"]);
    await fs.writeFile(stamp, digest);
  }
}
if (task === "install")
  console.log("Frontend dependencies installed outside the repository.");
else {
  if (!["build", "typecheck", "test", "preview"].includes(task))
    throw new Error("Use build, typecheck, test, preview, install or path.");
  if (task === "preview")
    await fs.cp(path.join(root, "dist"), path.join(temp, "dist"), {
      recursive: true,
    });
  run(["run", task]);
  if (task === "test") run(["exec", "--", "tsx", "--test", "src/expanse/transport.test.ts"]);
  if (task === "build") {
    await fs.rm(path.join(root, "dist"), { recursive: true, force: true });
    await fs.cp(path.join(temp, "dist"), path.join(root, "dist"), {
      recursive: true,
    });
    console.log("Static export copied to dist/.");
  }
}
