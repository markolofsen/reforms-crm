import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { autostartFiles, type LaunchctlRun } from "@hub/config/autostart";
import { hubPaths, type HubPaths } from "@hub/config/paths";
import type { Repos } from "@hub/db";
import { testApp } from "../support/runtime";
import { createAutostart, launchctlFor } from "../../src/instance/autostart";

// `/api/instance/autostart` (P67): the switch runs exactly `launchctl enable|disable`, never bootout/kill/kickstart; the label is the server's.

const ADMIN_PORT = 5180;
const API = "http://127.0.0.1:4380";
const ADMIN = { "content-type": "application/json", host: "127.0.0.1:4380", origin: `http://127.0.0.1:${ADMIN_PORT}`, "sec-fetch-site": "same-origin" };
const repos = {} as unknown as Repos;

let base: string;
let paths: HubPaths;
let calls: string[][];
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "hub-autostart-route-"));
  mkdirSync(join(base, "reforms-crm-saas"));
  paths = hubPaths({ home: join(base, "reforms-crm-saas"), env: {} });
  calls = [];
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

function setup(o: { installed?: boolean; loaded?: boolean; supported?: boolean; startedBy?: "launchd" | "hand" } = {}) {
  const agents = join(base, "LaunchAgents");
  const files = autostartFiles(paths, agents);
  if (o.installed ?? true) {
    mkdirSync(agents, { recursive: true });
    writeFileSync(files.plist, "<plist/>");
  }
  let disabled = false;
  const run: LaunchctlRun = async (args) => {
    calls.push(args);
    if (args[0] === "print") return (o.loaded ?? true) ? { code: 0, stdout: "\tstate = running\n\tpid = 9\n", stderr: "" } : { code: 113, stdout: "", stderr: "" };
    if (args[0] === "print-disabled") return { code: 0, stdout: disabled ? `"${files.label}" => disabled` : "", stderr: "" };
    if (args[0] === "disable") disabled = true;
    if (args[0] === "enable") disabled = false;
    return { code: 0, stdout: "", stderr: "" };
  };
  const autostart = createAutostart({ paths, run, agentsDir: agents, uid: 501, startedBy: o.startedBy ?? "hand", supported: o.supported ?? true, bootAt: async () => undefined, mailMcp: async () => false });
  const app = testApp(repos, { adminPort: ADMIN_PORT, autostart });
  const post = (body: unknown, headers: Record<string, string> = ADMIN) => app.request(`${API}/api/instance/autostart`, { method: "POST", headers, body: JSON.stringify(body) });
  const get = async () => (await app.request(`${API}/api/instance/autostart`, { headers: { host: ADMIN.host } })).json();
  return { files, post, get, autostart };
}
const verbs = () => calls.filter((c) => !c[0]?.startsWith("print"));

describe("/api/instance/autostart", () => {
  it("reads the state; the label is the instance's", async () => {
    const { get } = setup();
    expect(await get()).toMatchObject({ supported: true, label: "com.reforms.hub.reforms-crm-saas", installed: true, enabled: true, running: true, startedBy: "hand", guard: null, mailMcp: false, fix: null });
  });
  it("off runs exactly launchctl disable gui/<uid>/<label> and writes the off file; never bootout, kill or kickstart", async () => {
    const { post, files } = setup();
    const r = await post({ enabled: false });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ enabled: false, running: true });
    expect(verbs()).toEqual([["disable", "gui/501/com.reforms.hub.reforms-crm-saas"]]);
    expect(existsSync(files.off)).toBe(true);
  });
  it("on runs enable, and bootstrap only when the agent is not loaded", async () => {
    await setup().post({ enabled: true });
    expect(verbs()).toEqual([["enable", "gui/501/com.reforms.hub.reforms-crm-saas"]]);
    calls = [];
    const { post, files } = setup({ loaded: false });
    await post({ enabled: true });
    expect(verbs()).toEqual([["enable", "gui/501/com.reforms.hub.reforms-crm-saas"], ["bootstrap", "gui/501", files.plist]]);
  });
  it("refuses a label in the body (strict), a foreign origin, and a missing plist with the fix line", async () => {
    const { post, files } = setup();
    expect((await post({ enabled: false, label: "com.apple.evil" })).status).toBe(400);
    expect((await post({ enabled: false }, { ...ADMIN, origin: "http://127.0.0.1:3000" })).status).toBe(403);
    expect(verbs()).toEqual([]);
    rmSync(files.plist);
    const missing = setup({ installed: false });
    expect(await missing.get()).toMatchObject({ installed: false, fix: "./run.sh install --only autostart.agent" });
    const r = await missing.post({ enabled: true });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("./run.sh install --only autostart.agent");
  });
  it("off macOS: supported false, and a switch is refused", async () => {
    const { get, post } = setup({ supported: false });
    expect(await get()).toMatchObject({ supported: false });
    expect((await post({ enabled: true })).status).toBe(409);
    expect(calls).toEqual([]);
  });
  it("the signature moves on a switch, so the live topic fires", async () => {
    const { post, autostart } = setup();
    const before = autostart.signature();
    await post({ enabled: false });
    expect(autostart.signature()).not.toBe(before);
  });
});

describe("HUB_LAUNCHCTL", () => {
  it("the real kind is /bin/launchctl on the user's LaunchAgents (the switch is read by @hub/config/modes)", () => {
    expect(launchctlFor("launchctl", { HOME: "/Users/x" }, paths).agentsDir).toBe("/Users/x/Library/LaunchAgents");
  });
  it("the fake records each argv in the instance and keeps its agents folder there", async () => {
    const f = launchctlFor("fake", {}, paths);
    expect(f.agentsDir.startsWith(paths.autostart)).toBe(true);
    await f.run(["disable", "gui/501/x"]);
    expect(existsSync(join(paths.autostart, "launchctl.jsonl"))).toBe(true);
  });
});
