import { describe, expect, it } from "vitest";
import { filterOf, runLogCommand, sinceOf } from "../src/log-command";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { logHook, logPrompt, skillHashes } from "../src/log-hook";
import { makeInstance } from "./instance-fixture";

// P54: the hook entries write into the instance's state/log; `hub log` reads them back.
describe("hub log", () => {
  it("a prompt with its focus line, the answer, then a summary that flags the question", async () => {
    const { home } = makeInstance();
    const env = { HUB_HOME: home, HUB_PROJECT: "acme-travel" };
    expect(logHook(JSON.stringify({ hook_event_name: "SessionStart", session_id: "sess-abc", source: "startup", transcript_path: "/t/sess-abc.jsonl" }), "claude", env)).toBe(true);
    expect(logPrompt(JSON.stringify({ session_id: "sess-abc", prompt_id: "p1", prompt: "ответь этому клиенту" }), "claude", "[Hub focus, data] draft 1", env)).toBe(true);
    expect(logHook(JSON.stringify({ hook_event_name: "Stop", session_id: "sess-abc", prompt_id: "p1", last_assistant_message: "Which client do you mean?" }), "claude", env)).toBe(true);
    expect(logHook("not json", "claude", env)).toBe(false);
    const lines: string[] = [];
    expect(await runLogCommand("events", {}, (l) => lines.push(l), { ...env, NO_COLOR: "1" })).toBe(0);
    expect(lines.map((l) => l.split(/\s+/)[4])).toEqual(["session", "prompt", "focus", "answer"]);
    const sum: string[] = [];
    await runLogCommand("summary", { session: "sess-a" }, (l) => sum.push(l), env);
    expect(sum.join("\n")).toMatch(/asked instead of acting 1/);
    expect(sum.join("\n")).toMatch(/Q: ответь этому клиенту/);
    // P133: the friction counters, per session and over the sessions shown.
    expect(sum.join("\n")).toMatch(/friction: shell writers 0, evidence warnings on the owner's words 0, ToolSearch turns 0, AskUserQuestion turns 0, asked instead of acting 1, median turn \d+ s/);
    expect(sum.at(-1)).toMatch(/^1 session, friction: /);
    const json: string[] = [];
    await runLogCommand("sessions", { json: true }, (l) => json.push(l), env);
    expect(JSON.parse(json[0] ?? "[]")).toMatchObject([{ session: "sess-abc", prompts: 1, answers: 1, transcript: "/t/sess-abc.jsonl" }]);
  });
  it("P129 A6: a session start records the core version and an 8-hex hash per linked SKILL.md", async () => {
    const { home } = makeInstance();
    const env = { HUB_HOME: home, HUB_PROJECT: "acme-travel" };
    expect(logHook(JSON.stringify({ hook_event_name: "SessionStart", session_id: "sess-v", source: "startup" }), "claude", env)).toBe(true);
    const json: string[] = [];
    await runLogCommand("events", { json: true }, (l) => json.push(l), env);
    const start = json.map((l) => JSON.parse(l) as { kind: string; data: Record<string, unknown> }).find((e) => e.kind === "session");
    expect(start?.data.core).toEqual(expect.any(String));
    expect(start?.data.skills).toEqual(expect.any(Object));
    const dir = mkdtempSync(path.join(tmpdir(), "hub-skill-hash-"));
    mkdirSync(path.join(dir, "triage-mail"));
    writeFileSync(path.join(dir, "triage-mail", "SKILL.md"), "---\nname: triage-mail\n---\n");
    mkdirSync(path.join(dir, "empty"));
    expect(skillHashes(dir)).toEqual({ "triage-mail": expect.stringMatching(/^[0-9a-f]{8}$/) });
  });
  it("filters: kinds and times are checked", () => {
    const now = new Date("2026-11-19T10:00:00.000Z");
    expect(sinceOf("6h", now)).toBe("2026-11-19T04:00:00.000Z");
    expect(filterOf({ kind: "prompt,answer" }, {}, now)).toMatchObject({ kinds: ["prompt", "answer"], since: "2026-11-12T10:00:00.000Z" });
    expect(() => filterOf({ kind: "nope" }, {}, now)).toThrow(/--kind takes/);
    expect(() => sinceOf("soon", now)).toThrow(/--since takes/);
  });
});
