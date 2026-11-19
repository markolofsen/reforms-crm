import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ResolveDeps } from "@hub/projects/local-open";
import { runOpenCommand, type OpenCommandDeps } from "../src/open-command";

// `hub open` (P61): the registry's actions from the owner's terminal. The runner is a recorder: no Finder window opens.

function setup(available = true) {
  const root = mkdtempSync(join(tmpdir(), "hub-open-cmd-"));
  mkdirSync(join(root, "projects", "acme-travel", "knowledge"), { recursive: true });
  writeFileSync(join(root, "projects", "acme-travel", "project.md"), "# P\n");
  const lines: string[] = [];
  const calls: string[][] = [];
  const resolver = (): ResolveDeps => ({ projectsRoot: join(root, "projects"), logRoot: join(root, "state", "log"), isProject: async (s) => s === "acme-travel", knowledgeHas: async () => false });
  const d: OpenCommandDeps = { out: (l) => lines.push(l), resolver, run: async (bin, args) => void calls.push([bin, ...args]), available };
  return { root, lines, calls, d };
}

describe("hub open", () => {
  it("lists the actions with no argument", async () => {
    const { lines, calls, d } = setup();
    expect(await runOpenCommand(undefined, {}, d)).toBe(0);
    expect(lines.join("\n")).toMatch(/finder\.open\s+server\s+Open folder/);
    expect(lines.join("\n")).toMatch(/agent\.openInDesktop .*Not offered/);
    expect(calls).toEqual([]);
  });
  it("opens a key and prints the path", async () => {
    const { root, lines, calls, d } = setup();
    expect(await runOpenCommand("finder.open", { project: "acme-travel", key: "knowledge" }, d)).toBe(0);
    expect(calls).toEqual([["/usr/bin/open", join(root, "projects", "acme-travel", "knowledge")]]);
    expect(lines.at(-1)).toBe(`opened: Open folder  ${join(root, "projects", "acme-travel", "knowledge")}`);
  });
  it("refuses a path for a key with exit 2", async () => {
    const { lines, calls, d } = setup();
    expect(await runOpenCommand("file.open", { project: "acme-travel", key: "../../config/config.json" }, d)).toBe(2);
    expect(lines.at(-1)).toMatch(/^refused: /);
    expect(calls).toEqual([]);
  });
  it("refuses off macOS with exit 2, an unknown action, and the desktop handoff", async () => {
    const off = setup(false);
    expect(await runOpenCommand("finder.open", { project: "acme-travel", key: "knowledge" }, off.d)).toBe(2);
    expect(off.lines.at(-1)).toMatch(/^hub open needs macOS \(open\(1\)\)/);
    const { lines, calls, d } = setup();
    expect(await runOpenCommand("shell.run", {}, d)).toBe(2);
    expect(await runOpenCommand("agent.openInDesktop", { project: "acme-travel", tab: "t1" }, d)).toBe(2);
    expect(lines.at(-1)).toMatch(/^refused: Not offered/);
    expect(calls).toEqual([]);
  });
  it("runs an href action through the same opener", async () => {
    const { calls, d } = setup();
    expect(await runOpenCommand("mail.openMessage", { args: JSON.stringify({ messageId: "a@b.example" }) }, d)).toBe(0);
    expect(calls).toEqual([["/usr/bin/open", "message://%3Ca%40b.example%3E"]]);
  });
});
