import { describe, expect, it } from "vitest";
import { fakeMode, modesLine, offMode, runtimeModes } from "../src/modes";

// P126 K1: one reader of every environment switch, with the one rule (a fake only with a throwaway HUB_DB).
const DB = { HUB_DB: "/tmp/x.db" };
const FAKE_VARS = { mailer: "HUB_MAILER", probe: "HUB_CONNECTIONS_PROBE", shell: "HUB_TERMINAL_SHELL", agentTools: "HUB_AGENT_TOOLS", launchctl: "HUB_LAUNCHCTL", opener: "HUB_OPENER" } as const;

describe("runtimeModes", () => {
  it("is every switch real and on with nothing set, and says nothing", () => {
    const m = runtimeModes({});
    expect(m).toEqual({ mailer: "mail-app", llm: "real", probe: "real", shell: "login", agentTools: "real", launchctl: "launchctl", opener: "open", messengers: "on", inbound: "on", sent: "on" });
    expect(modesLine(m)).toBeNull();
  });

  for (const [key, variable] of Object.entries(FAKE_VARS) as [keyof typeof FAKE_VARS, string][]) {
    it(`${variable}: fake only with a throwaway HUB_DB, and no other spelling`, () => {
      expect(fakeMode({ [variable]: "", ...DB }, key)).not.toBe("fake");
      expect(fakeMode({ [variable]: "fake", ...DB }, key)).toBe("fake");
      expect(() => fakeMode({ [variable]: "fake" }, key)).toThrow(/HUB_DB/);
      expect(() => fakeMode({ [variable]: "fake", HUB_DB: ":memory:" }, key)).toThrow(/HUB_DB/);
      for (const bad of ["1", "true", "FAKE", "Fake", "real", "fake ", " fake", "yes"]) expect(() => fakeMode({ [variable]: bad, ...DB }, key), bad).toThrow(new RegExp(variable));
    });
  }

  it("HUB_LLM=fake needs no database (the model fake touches no instance data), and any other value throws", () => {
    expect(fakeMode({ HUB_LLM: "fake" }, "llm")).toBe("fake");
    expect(fakeMode({}, "llm")).toBe("real");
    for (const bad of ["real", "openrouter", "FAKE"]) expect(() => fakeMode({ HUB_LLM: bad }, "llm"), bad).toThrow(/HUB_LLM/);
  });

  it("an off switch is off only when it is exactly off", () => {
    expect(offMode({ HUB_MESSENGERS: "off" }, "messengers")).toBe("off");
    expect(offMode({ HUB_INBOUND: "off" }, "inbound")).toBe("off");
    expect(offMode({ HUB_SENT: "off" }, "sent")).toBe("off");
    for (const other of ["", "OFF", "0", "false", "on"]) expect(offMode({ HUB_SENT: other }, "sent"), other).toBe("on");
  });

  it("the one line names every fake and every off switch by its variable", () => {
    const line = modesLine(runtimeModes({ HUB_MAILER: "fake", HUB_OPENER: "fake", HUB_SENT: "off", ...DB }));
    expect(line).toMatch(/^FAKE: /);
    expect(line).toContain("HUB_MAILER=fake");
    expect(line).toContain("HUB_OPENER=fake");
    expect(line).toContain("OFF: Sent detection (HUB_SENT=off)");
    expect(line).not.toContain("HUB_LAUNCHCTL");
  });

  it("the first bad value stops the read", () => {
    expect(() => runtimeModes({ HUB_TERMINAL_SHELL: "/bin/bash", ...DB })).toThrow(/HUB_TERMINAL_SHELL/);
  });
});
