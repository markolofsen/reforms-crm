import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P144: `hub watch import` through the real entry point (bin/hub.mjs), with the lens where an instance keeps it: under
// <home>/packages, beside an instance package.json that has no "type" (a CommonJS scope). The ESM hooks alone failed here with
// "Cannot require() ES Module ... in a cycle" (saas, 2026-11-25); the server, run by `tsx`, loaded the same lens.

const bin = resolve(import.meta.dirname, "../bin/hub.mjs");
const fixture = resolve(import.meta.dirname, "../../../packages/watch/test/fixtures/packages/watch-acme");

describe("hub watch import from the bin", () => {
  it("loads a lens that sits in a CommonJS scope, then reads the corpus", () => {
    const home = mkdtempSync(join(tmpdir(), "hub-watch-bin-"));
    writeFileSync(join(home, "package.json"), JSON.stringify({ private: true }));
    cpSync(fixture, join(home, "packages", "watch-acme"), { recursive: true });
    mkdirSync(join(home, "projects", "acme"), { recursive: true });
    writeFileSync(join(home, "projects", "acme", "watch.md"), "# Watch\n\n| Setting | Value |\n|---|---|\n| lens | watch-acme |\n\n## Groups\n\n- @garden_talk\n");
    const r = spawnSync(process.execPath, [bin, "watch", "import", join(home, "missing.sqlite"), "--project", "acme"], { cwd: home, env: { ...process.env, HUB_HOME: home, HUB_REEXEC: "1" }, encoding: "utf8", timeout: 60_000 });
    const out = `${r.stdout}${r.stderr}`;
    expect(out).not.toMatch(/lens watch-acme|require\(\) ES Module/);
    expect(out).toMatch(/missing\.sqlite/);
    expect(r.status).not.toBe(0);
  }, 90_000);
});
