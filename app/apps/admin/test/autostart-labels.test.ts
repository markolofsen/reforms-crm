import { describe, expect, it } from "vitest";
import type { AutostartDto } from "@hub/contract/autostart";
import { autostartSaid, mailMcpSaid } from "../src/features/settings/mac/autostart-labels";
import { hhmm } from "../src/lib/format";

// P67 verdict 12: the Connections row "Start the Hub after a restart" says exactly one of these lines.
const AT = "2026-11-19T09:12:00.000Z";
const base: AutostartDto = { supported: true, label: "com.reforms.hub.x", installed: true, enabled: true, loaded: true, running: true, startedBy: "launchd", lastStart: { at: AT, event: "start" }, guard: null, mailMcp: true, fix: null };
const said = (over: Partial<AutostartDto>) => autostartSaid({ ...base, ...over });

describe("the autostart status line", () => {
  it("on: by launchd at the start time, or by hand", () => {
    expect(said({})).toEqual({ text: `On: started by launchd at ${hhmm(AT)}.` });
    expect(said({ startedBy: "hand", running: false })?.text).toBe("On: this server was started by hand; launchd takes over at the next restart.");
  });
  it("off says the server keeps running", () => {
    expect(said({ enabled: false })?.text).toBe("Off: this server keeps running until you stop it; it will not start after the next restart.");
  });
  it("the guard and not set up carry their fix line", () => {
    expect(said({ guard: { at: AT, error: "next build: ENOSPC" } })).toEqual({ text: `Stopped after 5 failed starts at ${hhmm(AT)}: next build: ENOSPC. Fix, then`, fix: "./run.sh restart" });
    expect(said({ installed: false, enabled: false, fix: "./run.sh setup --only autostart.agent" })).toEqual({ text: "Not set up:", fix: "./run.sh setup --only autostart.agent" });
  });
  it("hidden off macOS; a dead mail-mcp is named only while autostart is on", () => {
    expect(said({ supported: false })).toBeNull();
    expect(mailMcpSaid({ ...base, mailMcp: false })?.fix).toBe("brew services start mail-mcp");
    expect(mailMcpSaid({ ...base, enabled: false, mailMcp: false })).toBeNull();
  });
});
