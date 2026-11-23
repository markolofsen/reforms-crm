import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// P126 M1: the AppleScript `send` verb exists only in `packages/send`. One loop over every exported script of this package
// replaces the per-script assertions; a new script file is covered by being in `src/scripts/`.

const dir = join(import.meta.dirname, "../src/scripts");

describe("@hub/mail-app scripts", () => {
  it("no exported script sends", async () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const mod = (await import(join(dir, f))) as Record<string, unknown>;
      const scripts = Object.entries(mod).filter(([k, v]) => k.endsWith("_SCRIPT") && typeof v === "string");
      expect(scripts.length, f).toBeGreaterThan(0);
      for (const [name, text] of scripts) expect(text as string, `${f} ${name}`).not.toMatch(/\bsend\b/);
    }
  });
});
