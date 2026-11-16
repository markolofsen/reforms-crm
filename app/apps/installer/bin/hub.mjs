#!/usr/bin/env node
// `hub` entry point. Runs the TypeScript CLI through tsx, resolved from THIS package, so it works from any
// folder and through a symlink (the real path of this file is what Node resolves against).
// Started inside an instance without HUB_HOME, it first hands over to that instance's pinned core (src/reexec.ts).
import { spawnSync } from "node:child_process";
import { register } from "tsx/esm/api";

register();
const { handOver } = await import("../src/reexec.ts");
const next = handOver(process.cwd(), process.env);
if (next) {
  const r = spawnSync(process.execPath, [next.bin, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, HUB_HOME: next.home, HUB_REEXEC: "1" },
  });
  process.exit(r.status ?? (r.signal ? 130 : 1));
}
await import("../src/cli.ts");
