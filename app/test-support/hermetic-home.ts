// Vitest setup file shared by every package whose code can reach hubPaths(): each test file starts with HUB_HOME
// pointing at its own empty temporary instance folder, and never sees the developer's real environment.
// A test that needs another home sets process.env.HUB_HOME itself; one that tests a missing HUB_HOME deletes it.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// P71 M-P: the developer's OPENROUTER_API_KEY and HUB_LLM too, so no test reads a real key or a mode set in his shell.
// P144 W1: HUB_MACHINE_DIR points inside the temp home, so no test reads the machine's own key file (~/.config/reforms-hub).
const KEYS = ["HUB_HOME", "HUB_PROJECTS", "HUB_DB", "HUB_CONFIG_DIR", "HUB_CONFIG_FILE", "HUB_LEDGER_ROOT", "HUB_PROJECT", "OPENROUTER_API_KEY", "HUB_LLM", "HUB_MACHINE_DIR"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
for (const k of KEYS) delete process.env[k];

const home = mkdtempSync(path.join(tmpdir(), "hub-test-home-"));
for (const d of ["projects", "data", "state", "config"]) mkdirSync(path.join(home, d));
process.env.HUB_HOME = home;
process.env.HUB_MACHINE_DIR = path.join(home, "machine");

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
