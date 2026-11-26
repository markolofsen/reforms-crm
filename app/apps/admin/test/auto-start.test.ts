import { describe, expect, it, vi } from "vitest";
import type { TerminalSessionDto } from "@hub/contract/terminal";
import { startVisibleSession, terminalProjectOf } from "../src/features/terminal/use-auto-start";

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


const session = (id: string, project = "acme", state: "running" | "exited" = "running"): TerminalSessionDto => ({
  id, project, state, preset: "codex", title: "Codex", exitCode: state === "exited" ? 1 : null, createdAt: "2026-11-26T06:00:00Z",
});
const options = () => ({
  open: true, ready: true, project: "acme", remembered: "old-pty", recovery: null as string | null,
  fresh: vi.fn<() => Promise<readonly TerminalSessionDto[]>>().mockResolvedValue([]), ensure: vi.fn(), show: vi.fn(),
});

describe("P165: the open dock survives backend PTY loss", () => {
  it("recovers after its first automatic start, once per lost terminal", async () => {
    const o = options(), attempts = new Map<string | null, string | null>();
    await startVisibleSession(o, attempts, () => true);
    await startVisibleSession(o, attempts, () => true);
    expect(o.ensure).toHaveBeenCalledTimes(1);
    // The API restarted: the remembered PTY is gone, but the page and project stayed open.
    o.recovery = "old-pty";
    await startVisibleSession(o, attempts, () => true);
    await startVisibleSession(o, attempts, () => true);
    expect(o.ensure).toHaveBeenCalledTimes(2);
    o.recovery = "second-pty";
    await startVisibleSession(o, attempts, () => true);
    expect(o.ensure).toHaveBeenCalledTimes(3);
  });
  it("reuses a project terminal and leaves a failed CLI visible rather than restarting it", async () => {
    const o = options(), attempts = new Map<string | null, string | null>();
    const running = session("replacement");
    o.fresh.mockResolvedValue([session("old-pty", "other"), running]);
    await startVisibleSession(o, attempts, () => true);
    expect(o.show).toHaveBeenLastCalledWith(running);
    const failed = session("replacement", "acme", "exited");
    o.fresh.mockResolvedValue([failed]);
    await startVisibleSession(o, attempts, () => true);
    expect(o.show).toHaveBeenLastCalledWith(failed);
    expect(o.ensure).not.toHaveBeenCalled();
  });
  it("a remembered project tab wins and another project's remembered tab cannot steal it", async () => {
    const o = options(), attempts = new Map<string | null, string | null>();
    const kept = session("old-pty");
    o.fresh.mockResolvedValue([session("first"), kept]);
    await startVisibleSession(o, attempts, () => true);
    expect(o.show).toHaveBeenLastCalledWith(kept);
    o.fresh.mockResolvedValue([session("old-pty", "other")]);
    await startVisibleSession(o, attempts, () => true);
    expect(o.ensure).toHaveBeenCalledTimes(1);
  });
  it("hidden, closed and not-ready docks start nothing; becoming visible permits recovery", async () => {
    const o = options(), attempts = new Map<string | null, string | null>();
    await startVisibleSession(o, attempts, () => false);
    await startVisibleSession({ ...o, open: false }, attempts, () => true);
    await startVisibleSession({ ...o, ready: false }, attempts, () => true);
    expect(o.fresh).not.toHaveBeenCalled();
    expect(o.ensure).not.toHaveBeenCalled();
    await startVisibleSession(o, attempts, () => true);
    expect(o.ensure).toHaveBeenCalledTimes(1);
  });
  it("ignores a read completed after hiding, closing or changing project, without consuming the next attempt", async () => {
    const o = options(), attempts = new Map<string | null, string | null>();
    let finish: (value: readonly TerminalSessionDto[]) => void = () => {};
    o.fresh.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let allowed = true;
    const read = startVisibleSession(o, attempts, () => allowed);
    allowed = false;
    finish([]);
    await read;
    expect(o.ensure).not.toHaveBeenCalled();
    expect(o.show).not.toHaveBeenCalled();
    await startVisibleSession({ ...o, project: "other" }, attempts, () => true);
    await startVisibleSession(o, attempts, () => true);
    expect(o.ensure).toHaveBeenCalledTimes(2);
  });
  it("overlapping list reads do not duplicate ensure", async () => {
    const o = options(), attempts = new Map<string | null, string | null>();
    await Promise.all([startVisibleSession(o, attempts, () => true), startVisibleSession(o, attempts, () => true)]);
    expect(o.ensure).toHaveBeenCalledTimes(1);
  });
});
