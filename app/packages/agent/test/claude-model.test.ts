import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_SETTINGS } from "@hub/config";
import { hubPaths } from "@hub/config/paths";
import { ADVISOR_OFF_ENV, CLAUDE_CHROME_SERVER, claudeBaseArgs, claudeDisallowed, claudeModelSettings, claudeSettings } from "../src/claude";
import { DENIED_TOOLS, denyRules } from "../src/deny";

// P55: the model keys of a Claude session's settings.json, pinned per project so the owner's personal ones never leak in.

const input = () => {
  const home = mkdtempSync(path.join(tmpdir(), "hub-claude-model-"));
  return { paths: hubPaths({ home, env: {} }), projectsDir: path.join(home, "projects"), slug: "acme", nodeBin: "/n/node", unattended: false };
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
    expect(claudeBaseArgs(false)).toContain("--chrome");
    expect(claudeBaseArgs(true)).toContain("--chrome");
  });
  it("no deny rule, disallowed tool or settings rule names the Chrome tools, in either mode", () => {
    const i = input();
    const all = [...DENIED_TOOLS, ...denyRules(i.projectsDir, i.paths.home, "acme", i.paths), ...claudeDisallowed()];
    for (const unattended of [false, true]) all.push(...((claudeSettings({ ...i, unattended }).permissions as { deny: string[] }).deny));
    expect(all.filter((r) => r.includes(CLAUDE_CHROME_SERVER) || /chrome/i.test(r))).toEqual([]);
  });
});
