import { describe, expect, it } from "vitest";
import { clampSize, createSessionBody, parseClientFrame, terminalSessionDto } from "./terminal";

describe("terminal contract (P49)", () => {
  it("a session is created from a preset and a slug only: no command, no path, no unknown field", () => {
    expect(createSessionBody.safeParse({ preset: "claude", project: "acme" }).success).toBe(true);
    expect(createSessionBody.safeParse({ preset: "shell" }).success).toBe(true);
    expect(createSessionBody.safeParse({ preset: "claude", project: "acme", command: "rm -rf ~" }).success).toBe(false);
    expect(createSessionBody.safeParse({ preset: "bash" }).success).toBe(false);
    expect(createSessionBody.safeParse({ preset: "shell", project: "../etc" }).success).toBe(false);
  });
  it("control frames are strict; anything else is null", () => {
    expect(parseClientFrame(JSON.stringify({ op: "resize", cols: 80, rows: 24 }))).toEqual({ op: "resize", cols: 80, rows: 24 });
    expect(parseClientFrame(JSON.stringify({ op: "auth", ticket: "t" }))).toEqual({ op: "auth", ticket: "t" });
    expect(parseClientFrame(JSON.stringify({ op: "resize", cols: 80, rows: 24, x: 1 }))).toBeNull();
    expect(parseClientFrame(JSON.stringify({ op: "exec", cmd: "ls" }))).toBeNull();
    expect(parseClientFrame("not json")).toBeNull();
  });
  it("sizes are clamped to 2..500", () => {
    expect([clampSize(0), clampSize(1), clampSize(80), clampSize(9999), clampSize(Number.NaN), clampSize(80.6)]).toEqual([2, 2, 80, 500, 2, 81]);
  });
  it("a session row is strict", () => {
    const row = { id: "s1", title: "acme · Claude Code", preset: "claude", project: "acme", state: "running", exitCode: null, createdAt: "2026-11-18T00:00:00Z" };
    expect(terminalSessionDto.safeParse(row).success).toBe(true);
    expect(terminalSessionDto.safeParse({ ...row, pid: 1 }).success).toBe(false);
  });
});
