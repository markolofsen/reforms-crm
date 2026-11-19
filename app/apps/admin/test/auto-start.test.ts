import { describe, expect, it } from "vitest";
import { terminalProjectOf } from "../src/features/terminal/use-auto-start";

// v0.12.9 live bug (saas, 2026-11-19): a column restored open after a restart called `ensure` before the projects were read,
// with no project, and the server started Shell although Claude Code was ready. The automatic start waits for the project.
describe("the terminal's project", () => {
  const base = { loaded: true, pending: false, project: "saas-support", multi: false, scoped: "saas-support" };
  it("is not known while the projects load or the address moves: nothing starts by itself", () => {
    expect(terminalProjectOf({ ...base, loaded: false, project: null, scoped: null })).toBeUndefined();
    expect(terminalProjectOf({ ...base, pending: true })).toBeUndefined();
  });
  it("one project: that project on every screen; two or more: the screen's (none on Overview and Connections)", () => {
    expect(terminalProjectOf(base)).toBe("saas-support");
    expect(terminalProjectOf({ ...base, scoped: null })).toBe("saas-support");
    expect(terminalProjectOf({ ...base, multi: true, scoped: null })).toBeNull();
    expect(terminalProjectOf({ ...base, multi: true, scoped: "b" })).toBe("b");
    expect(terminalProjectOf({ ...base, project: null, scoped: null })).toBeNull();
  });
});
