import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_AGENT_SETTINGS } from "@hub/config";
import { openDb, type DbHandle } from "./client";
import { readAgentSettings } from "./index";
import { createRepos, type Repos } from "./repos";

// P55: the agent's model and advisor per project, stored beside the safety rules.

let handle: DbHandle;
let repos: Repos;
beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => handle.close());

describe("agent settings", () => {
  it("a project with no row reads the default", async () => {
    expect(await repos.agentSettings.get("p")).toEqual(DEFAULT_AGENT_SETTINGS);
  });
  it("a change merges, per project, and the advisor model is kept while the advisor is off", async () => {
    await repos.agentSettings.set("p", { advisor: true, advisorModel: "opus" });
    await repos.agentSettings.set("p", { model: "opus" });
    expect(await repos.agentSettings.get("p")).toEqual({ model: "opus", advisor: true, advisorModel: "opus" });
    await repos.agentSettings.set("p", { advisor: false });
    expect(await repos.agentSettings.get("p")).toEqual({ model: "opus", advisor: false, advisorModel: "opus" });
    expect(await repos.agentSettings.get("other")).toEqual(DEFAULT_AGENT_SETTINGS);
  });
  it("refuses a model this core does not know", async () => {
    await expect(repos.agentSettings.set("p", { model: "haiku" as never })).rejects.toThrow(/Unknown model/);
  });
  it("readAgentSettings (hub agent): the stored row, else the default when the database is missing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hub-agent-settings-"));
    const file = path.join(dir, "hub.db");
    expect(readAgentSettings(file, "p")).toEqual(DEFAULT_AGENT_SETTINGS);
    const h = openDb(file);
    await createRepos(h.db).agentSettings.set("p", { advisor: true });
    h.close();
    expect(readAgentSettings(file, "p")).toEqual({ ...DEFAULT_AGENT_SETTINGS, advisor: true });
    expect(readAgentSettings(file, undefined)).toEqual(DEFAULT_AGENT_SETTINGS);
  });
});
