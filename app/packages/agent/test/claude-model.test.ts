import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_SETTINGS } from "@hub/config";
import { hubPaths } from "@hub/config/paths";
import { ADVISOR_OFF_ENV, CLAUDE_CHROME_SERVER, ancestorMemoryExcludes, claudeBaseArgs, claudeDisallowed, claudeModelSettings, claudeSettings } from "../src/claude";
import { DENIED_TOOLS, deniedTools, denyRules } from "../src/deny";

// P55: the model keys of a Claude session's settings.json, pinned per project so the owner's personal ones never leak in.

const input = () => {
  const home = mkdtempSync(path.join(tmpdir(), "hub-claude-model-"));
  return { paths: hubPaths({ home, env: {} }), projectsDir: path.join(home, "projects"), slug: "acme", nodeBin: "/n/node" };
};

describe("P55: claudeSettings pins the model and the advisor", () => {
  it("default: Sonnet, no advisorModel, and the advisor switched off through the CLI's own variable", () => {
    const s = claudeSettings(input());
    expect(s.model).toBe("sonnet");
    expect(s).not.toHaveProperty("advisorModel");
    expect(s.env).toEqual({ [ADVISOR_OFF_ENV]: "1" });
    expect(claudeModelSettings()).toEqual(claudeModelSettings(DEFAULT_AGENT_SETTINGS));
  });
  it("advisor on: model and advisorModel, no disable variable", () => {
    const s = claudeSettings({ ...input(), agent: { model: "opus", advisor: true, advisorModel: "opus" } });
    expect(s).toMatchObject({ model: "opus", advisorModel: "opus" });
    expect(s).not.toHaveProperty("env");
  });
  it("advisor off keeps no advisorModel even when one is remembered", () => {
    const s = claudeSettings({ ...input(), agent: { model: "opus", advisor: false, advisorModel: "fable" } });
    expect(s.model).toBe("opus");
    expect(s).not.toHaveProperty("advisorModel");
    expect(s.env).toEqual({ [ADVISOR_OFF_ENV]: "1" });
  });
  it("keeps the deny rules and hooks beside the model keys", () => {
    const s = claudeSettings(input());
    expect(Object.keys(s)).toEqual(expect.arrayContaining(["model", "permissions", "hooks"]));
  });
});

// Decision 0040 as amended: the Hub adds no browser, and cuts off none of the owner's: `--chrome` stays, nothing denies its tools.
describe("the owner's Claude in Chrome is never cut off", () => {
  it("every session starts with --chrome, in both modes", () => {
    expect(claudeBaseArgs()).toContain("--chrome");
  });
  it("no deny rule, disallowed tool or settings rule names the Chrome tools", () => {
    const i = input();
    const all = [...DENIED_TOOLS, ...denyRules(i.projectsDir, i.paths.home, "acme", i.paths), ...claudeDisallowed()];
    all.push(...((claudeSettings(i).permissions as { deny: string[] }).deny), ...deniedTools("background"));
    expect(all.filter((r) => r.includes(CLAUDE_CHROME_SERVER) || /chrome/i.test(r))).toEqual([]);
  });
});

describe("P129 verdict 13: a hub session skips the memory files of the folders above the instance", () => {
  it("excludes every ancestor CLAUDE.md and CLAUDE.local.md, never the instance's own or the owner's ~/.claude/CLAUDE.md", () => {
    const ex = ancestorMemoryExcludes("/Users/o/workspace/@projects/crm/hub-saas");
    expect(ex).toContain("/Users/o/workspace/@projects/CLAUDE.md");
    expect(ex).toContain("/Users/o/workspace/@projects/crm/CLAUDE.md");
    expect(ex).toContain("/Users/o/workspace/@projects/crm/CLAUDE.local.md");
    expect(ex).not.toContain("/Users/o/workspace/@projects/crm/hub-saas/CLAUDE.md");
    expect(ex).not.toContain("/Users/o/.claude/CLAUDE.md");
    expect(ex.at(-2)).toBe("/CLAUDE.md");
  });
  it("is written into the session's settings.json", () => {
    const i = input();
    expect(claudeSettings(i).claudeMdExcludes).toEqual(ancestorMemoryExcludes(i.paths.home));
  });
});
