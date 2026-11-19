import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_SETTINGS } from "@hub/config";
import { hubPaths } from "@hub/config/paths";
import { ADVISOR_OFF_ENV, claudeModelSettings, claudeSettings } from "../src/claude";

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
