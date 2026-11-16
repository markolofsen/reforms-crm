// Vitest setup file shared by every package whose code can reach hubPaths(): each test file starts with HUB_HOME
// pointing at its own empty temporary instance folder, and never sees the developer's real environment.
// A test that needs another home sets process.env.HUB_HOME itself; one that tests a missing HUB_HOME deletes it.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const KEYS = ["HUB_HOME", "HUB_PROJECTS", "HUB_DB", "HUB_CONFIG_DIR", "HUB_CONFIG_FILE", "HUB_LEDGER_ROOT", "HUB_PROJECT"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
for (const k of KEYS) delete process.env[k];

const home = mkdtempSync(path.join(tmpdir(), "hub-test-home-"));
for (const d of ["projects", "data", "state", "config"]) mkdirSync(path.join(home, d));
process.env.HUB_HOME = home;

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
