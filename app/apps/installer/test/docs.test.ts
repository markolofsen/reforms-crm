import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultRoot } from "../src/context.ts";
import { renderClientSetup } from "../src/docs.ts";
import { selectSteps, STEPS } from "../src/steps/index.ts";

const CHECK_ONLY = ["messengers.poller", "instance.core"];

describe("step list", () => {
  it("ids are unique and every step explains itself", () => {
    expect(new Set(STEPS.map((s) => s.id)).size).toBe(STEPS.length);
    for (const s of STEPS) {
      expect(s.why.length, s.id).toBeGreaterThan(10);
      expect(s.verifies.length, s.id).toBeGreaterThan(10);
      expect(Boolean(s.apply) !== Boolean(s.manual) || CHECK_ONLY.includes(s.id), s.id).toBe(true);
    }
  });
  it("covers the owner's manual steps", () => {
    const manual = STEPS.filter((s) => s.manual).map((s) => s.id);
    for (const id of ["notion.token", "mail.account"]) expect(manual).toContain(id);
  });
  it("the default selection holds no automation step, so doctor cannot fail on its absence", () => {
    const ids = selectSteps(false).map((s) => s.id);
    for (const id of ["messengers.poller", "mail.account", "notion.token", "files.settings", "skills.dev"]) expect(ids).not.toContain(id);
    for (const gone of ["claude.", "gate.", "launchd.", "sounds.", "prefs.", "power.", "tools.macos", "projects.active"]) expect(ids.some((i) => i.startsWith(gone)), gone).toBe(false);
    for (const id of ["tools.node", "tools.pnpm", "tools.claude", "files.mcp-json", "files.app-db", "skills.runtime", "projects.registry", "mail.daemon", "notion.connector"]) expect(ids).toContain(id);
    expect(selectSteps(true).map((s) => s.id)).toEqual(expect.arrayContaining(["notion.token", "mail.account", "messengers.poller", "files.settings"]));
    expect(STEPS.map((s) => s.id).filter((i) => /^(claude|gate|launchd|sounds|prefs|power)[.]/.test(i)), "archived steps (P25)").toEqual([]);
  });
  it("@docs/core/client-setup.md equals the generated text (run `pnpm hub docs` after changing a step)", () => {
    const f = path.join(defaultRoot(), "@docs", "core", "client-setup.md");
    expect(readFileSync(f, "utf8")).toBe(renderClientSetup(STEPS));
  });
});
