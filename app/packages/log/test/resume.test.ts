import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { NewLogEvent } from "../src/event";
import { chooseResume, CODEX_RULES_CHANGED, loggedSession, resumableSession, RESUME_MAX_AGE_MS, rolloutInstructions } from "../src/resume";
import { appendEvents, type LogStore } from "../src/store";

// P64: which session the dock resumes after a restart, read from the session log (P54).

const A = "16491158-36bc-42a5-8b8a-27b3af4d6d65";
const B = "fb420882-5cfc-4159-9857-5125871d550e";
const C = "8d31964d-2edc-490c-91a8-dfb10ffb47de";
const X = "01a1f270-05dd-7f62-8d75-8ef4610c88a7";
const NOW = new Date("2026-11-19T10:00:00.000Z");
const ago = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "hub-resume-"));
  mkdirSync(path.join(root, "secrets"));
  const store: LogStore = { dir: path.join(root, "log"), secrets: path.join(root, "secrets"), retentionDays: 90 };
  const transcript = (id: string, dir = "claude"): string => {
    const f = path.join(root, dir, `${id}.jsonl`);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, "{}\n");
    return f;
  };
  const session = (o: { id: string; project?: string | null; cli?: "claude" | "codex"; start: string; prompts?: string[]; last?: string; transcript?: string | null }): NewLogEvent[] => {
    const env = { project: o.project === undefined ? "acme" : o.project, session: o.id, cli: o.cli ?? ("claude" as const) };
    return [
      { ...env, ts: o.start, kind: "session", data: { phase: "start", ...(o.transcript !== null ? { transcript: o.transcript ?? transcript(o.id) } : {}) } },
      ...(o.prompts ?? []).map((ts): NewLogEvent => ({ ...env, ts, kind: "prompt", data: { text: "hi" } })),
      ...(o.last ? [{ ...env, ts: o.last, kind: "answer" as const, data: { text: "ok" } }] : []),
    ];
  };
  const write = (events: NewLogEvent[]) => { for (const e of events) appendEvents(store, [e], new Date(e.ts ?? NOW)); };
  return { root, store, transcript, session, write };
}

describe("resumableSession", () => {
  it("picks the newest session by its LAST event, not its start", () => {
    const t = setup();
    t.write(t.session({ id: A, start: ago(5), prompts: [ago(5)], last: ago(0.5) }));
    t.write(t.session({ id: B, start: ago(2), prompts: [ago(2)], last: ago(1.5) }));
    expect(resumableSession(t.store, { project: "acme", cli: "claude", now: NOW })?.session).toBe(A);
  });
  it("skips a session with no prompt (the idle one an automatic start left) and takes the one before it", () => {
    const t = setup();
    t.write(t.session({ id: A, start: ago(3), prompts: [ago(3)], last: ago(2) }));
    t.write(t.session({ id: B, start: ago(0.1) }));
    expect(resumableSession(t.store, { project: "acme", cli: "claude", now: NOW })?.session).toBe(A);
  });
  it("cut-off: nothing older than 24 h by its last event; Infinity lifts it", () => {
    const t = setup();
    t.write(t.session({ id: A, start: ago(30), prompts: [ago(30)], last: ago(25) }));
    expect(RESUME_MAX_AGE_MS).toBe(24 * 3_600_000);
    expect(resumableSession(t.store, { project: "acme", cli: "claude", now: NOW })).toBeNull();
    expect(resumableSession(t.store, { project: "acme", cli: "claude", now: NOW, maxAgeMs: Infinity })?.session).toBe(A);
  });
  it("a session that started before the window but was active inside it keeps its transcript and prompts", () => {
    const t = setup();
    t.write(t.session({ id: A, start: ago(40), prompts: [ago(40)], last: ago(1) }));
    expect(resumableSession(t.store, { project: "acme", cli: "claude", now: NOW })).toMatchObject({ session: A, lastAt: ago(1), prompts: 1 });
  });
  it("a transcript that is gone or never logged is not resumed; the next one is", () => {
    const t = setup();
    t.write(t.session({ id: A, start: ago(4), prompts: [ago(4)] }));
    t.write(t.session({ id: B, start: ago(3), prompts: [ago(3)], transcript: path.join(t.root, "gone.jsonl") }));
    t.write(t.session({ id: C, start: ago(2), prompts: [ago(2)], transcript: null }));
    expect(resumableSession(t.store, { project: "acme", cli: "claude", now: NOW })?.session).toBe(A);
  });
  it("isolation: another project's or CLI's session is never offered, even when newer", () => {
    const t = setup();
    t.write(t.session({ id: A, start: ago(5), prompts: [ago(5)] }));
    t.write(t.session({ id: B, project: "beta", start: ago(1), prompts: [ago(1)] }));
    t.write(t.session({ id: C, cli: "codex", start: ago(1), prompts: [ago(1)] }));
    expect(resumableSession(t.store, { project: "acme", cli: "claude", now: NOW })?.session).toBe(A);
    expect(resumableSession(t.store, { project: "beta", cli: "codex", now: NOW })).toBeNull();
    expect(loggedSession(t.store, "acme", "claude", B)).toBeNull();
  });
  it("Codex: the rollout must lie inside that project's CODEX_HOME", () => {
    const t = setup();
    const home = path.join(t.root, "codex", "acme");
    t.write(t.session({ id: X, cli: "codex", start: ago(1), prompts: [ago(1)], transcript: t.transcript(X, "codex/beta/sessions") }));
    expect(resumableSession(t.store, { project: "acme", cli: "codex", now: NOW, within: home })).toBeNull();
    t.write(t.session({ id: X, cli: "codex", start: ago(0.5), prompts: [ago(0.5)], transcript: t.transcript(X, "codex/acme/sessions") }));
    expect(resumableSession(t.store, { project: "acme", cli: "codex", now: NOW, within: home })?.session).toBe(X);
  });
});

/** A rollout head as Codex 0.153 writes it (measured 2026-11-19): session_meta, then the developer message with the instructions. */
const rollout = (instructions: string): string =>
  [
    JSON.stringify({ type: "session_meta", payload: { id: X } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "env" }] } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: instructions }, { type: "input_text", text: "<skills_instructions>" }] } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "<permissions instructions>" }] } }),
    "",
  ].join("\n");

describe("chooseResume", () => {
  it("Codex is resumed only when its first developer message equals today's instructions (Codex never replaces it)", () => {
    const t = setup();
    const home = path.join(t.root, "codex", "acme");
    const file = t.transcript(X, "codex/acme/sessions");
    writeFileSync(file, rollout("RULES v1"));
    expect(rolloutInstructions(file)).toBe("RULES v1");
    t.write(t.session({ id: X, cli: "codex", start: ago(1), prompts: [ago(1)], transcript: file }));
    const q = { project: "acme", cli: "codex" as const, now: NOW, within: home };
    expect(chooseResume(t.store, { ...q, instructions: "RULES v1" }).session?.session).toBe(X);
    expect(chooseResume(t.store, { ...q, instructions: "RULES v2" })).toEqual({ session: null, why: CODEX_RULES_CHANGED });
    expect(chooseResume(t.store, q)).toEqual({ session: null, why: CODEX_RULES_CHANGED });
  });
  it("with an id: that session of this project and CLI, else why not", () => {
    const t = setup();
    t.write(t.session({ id: A, start: ago(1), prompts: [ago(1)] }));
    t.write(t.session({ id: B, start: ago(2) }));
    expect(chooseResume(t.store, { project: "acme", cli: "claude", id: A }).session?.session).toBe(A);
    expect(chooseResume(t.store, { project: "acme", cli: "claude", id: B })).toEqual({ session: null, why: "it has no prompt" });
    expect(chooseResume(t.store, { project: "beta", cli: "claude", id: A })).toEqual({ session: null, why: "the log has no claude session 16491158 of beta" });
    expect(chooseResume(t.store, { project: "acme", cli: "claude", id: "not-a-uuid" }).session).toBeNull();
  });
  it("nothing to resume says nothing (a fresh start is the normal case)", () => {
    const t = setup();
    expect(chooseResume(t.store, { project: "acme", cli: "claude", now: NOW })).toEqual({ session: null, why: null });
  });
});
