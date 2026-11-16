import { execa } from "execa";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultRoot } from "../src/context.ts";

const script = path.join(defaultRoot(), "hub.sh");

/** hub.sh copied next to a stub CLI that prints its arguments, so nothing real starts. */
function stubbed(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hubsh-"));
  mkdirSync(path.join(dir, "app", "apps", "installer", "bin"), { recursive: true });
  copyFileSync(script, path.join(dir, "hub.sh"));
  chmodSync(path.join(dir, "hub.sh"), 0o755);
  writeFileSync(path.join(dir, "app", "apps", "installer", "bin", "hub.mjs"), "console.log(`ARGS:${process.argv.slice(2).join(' ')}`);\n");
  return path.join(dir, "hub.sh");
}

describe("hub.sh", () => {
  it("no arguments = the same as `hub`: no sync, no subcommand of its own", async () => {
    const r = await execa("bash", [stubbed()], { reject: false });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("ARGS:");
    expect(readFileSync(script, "utf8")).not.toContain("--sync");
  });
  it("passes every argument through", async () => {
    const r = await execa("bash", [stubbed(), "agent", "acme", "--", "--model", "opus"], { reject: false });
    expect(r.stdout.trim()).toBe("ARGS:agent acme -- --model opus");
  });
});
