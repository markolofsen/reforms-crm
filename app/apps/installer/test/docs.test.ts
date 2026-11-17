import { renderNotionFields } from "../src/notion-docs.ts";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultRoot } from "../src/context.ts";
import { renderChecklist, UPDATE_LINE } from "../src/docs.ts";
import { selectSteps, STEPS } from "../src/steps/index.ts";

const CHECK_ONLY = ["messengers.poller", "instance.core", "skills.legacy", "dev.kanban"];

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
    for (const id of ["messengers.poller", "mail.account", "notion.token", "files.settings"]) expect(ids).not.toContain(id);
    for (const gone of ["claude.", "gate.", "launchd.", "sounds.", "prefs.", "power.", "tools.macos", "projects.active"]) expect(ids.some((i) => i.startsWith(gone)), gone).toBe(false);
    for (const id of ["tools.node", "tools.pnpm", "tools.claude", "files.mcp-json", "files.app-db", "skills.runtime", "skills.legacy", "projects.registry", "dev.kanban", "mail.daemon", "notion.connector"]) expect(ids).toContain(id);
    expect(selectSteps(true).map((s) => s.id)).toEqual(expect.arrayContaining(["notion.token", "mail.account", "messengers.poller", "files.settings"]));
    expect(ids.some((i) => i.startsWith("backup."))).toBe(false); // a fresh instance has no backup yet: setup and install must not go red for it
    expect(selectSteps(false, true).map((s) => s.id)).toEqual(expect.arrayContaining(["backup.git", "backup.db", "backup.snapshot", "backup.notion", "backup.secrets", "server.health", "mcp.knowledge"]));
    expect(STEPS.map((s) => s.id).filter((i) => /^(claude|gate|launchd|sounds|prefs|power)[.]/.test(i)), "archived steps (P25)").toEqual([]);
  });
  it("@docs/notion/fields.md equals the text generated from the pack's schema files (run `pnpm hub docs`)", () => {
    const f = path.join(defaultRoot(), "@docs", "notion", "fields.md");
    expect(readFileSync(f, "utf8")).toBe(renderNotionFields(defaultRoot()));
  });
  it("@docs/setup/checklist.md equals the generated text, lists every step id once and ends with the update line (run `pnpm hub docs`)", () => {
    const text = readFileSync(path.join(defaultRoot(), "@docs", "setup", "checklist.md"), "utf8");
    expect(text).toBe(renderChecklist(STEPS));
    for (const s of STEPS) expect(text.split(`**${s.title}** (\`${s.id}\``).length - 1, s.id).toBe(1);
    expect(text.trimEnd().split("\n").at(-1)).toBe(UPDATE_LINE);
    expect(UPDATE_LINE).toBe("Update this page when the architecture changes.");
  });
});

/** The architecture-change rule (CLAUDE.md): a page that lists checks, accesses or the architecture ends with this line. */
const PAGES_WITH_UPDATE_LINE = [
  "README.md",
  "@docs/00-README.md",
  "@docs/LAYERS.md",
  "@docs/setup/access.md",
  "@docs/setup/checklist.md",
  "@docs/notion/README.md",
  "@docs/core/08-local-app-stack.md",
  "@docs/core/21-leads.md",
];

describe("the architecture-change rule", () => {
  it("every page that lists checks, accesses or the architecture ends with the update line", () => {
    const bad = PAGES_WITH_UPDATE_LINE.filter((rel) => readFileSync(path.join(defaultRoot(), rel), "utf8").trimEnd().split("\n").at(-1) !== UPDATE_LINE);
    expect(bad).toEqual([]);
  });
  it("CLAUDE.md states the rule and AGENTS.md is its symlink", () => {
    const root = defaultRoot();
    expect(readFileSync(path.join(root, "CLAUDE.md"), "utf8")).toContain(`"${UPDATE_LINE}"`);
    expect(lstatSync(path.join(root, "AGENTS.md")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(path.join(root, "AGENTS.md"))).toBe("CLAUDE.md");
  });
});
