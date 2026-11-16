import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { doctor, exitCode, install } from "../src/runner.ts";
import { selectSteps } from "../src/steps/index.ts";
import { fake } from "./helpers.ts";

// Regression test for research 08, finding 1: on a clean machine the default doctor failed on the Notion token.
// Decision 0009: the token is optional. Empty HOME, empty secrets folder: setup steps and doctor are green.
describe("fresh home, no token", () => {
  it("the default steps install and the doctor has no failing row", async () => {
    const f = fake({
      run: (c) => {
        if (c.cmd === "node") return { code: 0, stdout: "v22.22.0\n", stderr: "" };
        if (c.cmd === "pnpm" && c.args[0] === "--version") return { code: 0, stdout: "12.18.0\n", stderr: "" };
        if (c.cmd === "claude") return { code: 0, stdout: "2.1.0 (Claude Code)\n", stderr: "" };
        return undefined;
      },
    });
    f.ctx.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch; // mail-mcp answers
    const steps = selectSteps(false).filter((s) => s.id !== "instance.core"); // the pin and the core clean-check have their own tests (instance-doctor)
    expect(steps.map((s) => s.id)).not.toContain("notion.token");

    const done = await install(f.ctx, steps);
    expect(done.filter((r) => r.outcome === "failed"), JSON.stringify(done.filter((r) => r.outcome === "failed").map((r) => [r.step.id, r.detail]))).toEqual([]);

    const reports = await doctor(f.ctx, steps);
    expect(reports.filter((r) => r.outcome === "failed" || r.outcome === "manual").map((r) => `${r.step.id}: ${r.detail}`)).toEqual([]);
    expect(exitCode(reports)).toBe(0);

    // nothing secret was asked for or written: the secrets folder exists, empty
    expect(existsSync(f.ctx.configDir)).toBe(true);
    expect(readdirSync(f.ctx.configDir)).toEqual([]);
    expect(path.relative(f.root, f.ctx.configDir)).toBe(path.join("state", "secrets"));
  });
});
