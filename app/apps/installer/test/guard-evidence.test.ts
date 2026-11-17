import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runGuard, runGuardPost, writeSessionFiles } from "../src/safety";
import { sessionFile } from "../src/evidence-store";
import { CLIENTS } from "../eval/per-client/fixture";
import { carefulSteps, lazySteps, replyFor } from "../eval/per-client/scenario";

// B3: the evidence ledger by hook, and the pre-draft rule of `hub guard`, driven by scripted call lists (what the hooks
// receive: tool_name, tool_input, tool_response, session_id, agent_id). No Claude session, no mail.
const PROJECTS = path.join(import.meta.dirname, "..", "eval", "per-client", "fixture", "projects");
const mk = (mode: "warn" | "block") => {
  const root = mkdtempSync(path.join(tmpdir(), "pc-guard-"));
  const env = { HUB_PROJECT: "fixture-pc", HUB_GUARD: mode } as NodeJS.ProcessEnv;
  const feed = (steps: Array<{ name: string; input: unknown; result: unknown }>, aid?: string) => {
    const out: Array<{ code: number; stderr: string; tool: string }> = [];
    for (const s of steps) {
      const base = { session_id: "S1", ...(aid ? { agent_id: aid } : {}), tool_name: s.name, tool_input: s.input };
      const pre = runGuard(JSON.stringify(base), { root, projectsDir: PROJECTS, env });
      out.push({ code: pre.code, stderr: pre.stderr, tool: s.name });
      if (pre.code === 0) runGuardPost(JSON.stringify({ ...base, tool_response: s.result }), { root, env });
    }
    return out;
  };
  return { root, feed };
};
const replies = (r: ReturnType<ReturnType<typeof mk>["feed"]>) => r.filter((x) => x.tool.endsWith("create_reply"));

describe("hub guard evidence ledger and pre-draft check (B3)", () => {
  it("the session file registers a PostToolUse hook for `hub guard --post`", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pc-files-"));
    const f = writeSessionFiles(root, PROJECTS, "fixture-pc");
    const s = JSON.parse(readFileSync(f.settings, "utf8"));
    expect(s.hooks.PostToolUse[0].hooks[0].command).toContain("guard --post");
    expect(s.hooks.PreToolUse[0].hooks[0].command).toMatch(/guard"?$/);
  });

  it("12 create_reply with 1 read: warn mode lets them through but logs, block mode refuses each", () => {
    const cs = CLIENTS.filter((c) => c.drafted).slice(0, 12);
    const warn = mk("warn");
    const w = replies(warn.feed(lazySteps(cs)));
    expect(w).toHaveLength(12);
    expect(w.every((x) => x.code === 0 && x.stderr.includes("read this client's thread and profile first"))).toBe(true);
    const block = mk("block");
    const b = replies(block.feed(lazySteps(cs)));
    expect(b.every((x) => x.code === 2)).toBe(true);
    expect(b[0]!.stderr).toContain("(d)");
  });

  it("the careful sequence passes in block mode, for three clients one after the other", () => {
    const g = mk("block");
    const r = g.feed(CLIENTS.slice(0, 3).flatMap((c) => carefulSteps(c).filter((s) => s.name !== "Bash")));
    expect(r.every((x) => x.code === 0), JSON.stringify(r.filter((x) => x.code))).toBe(true);
  });

  it("a first-contact sequence passes (empty search, message opened, profile, facts)", () => {
    const g = mk("block");
    const c = CLIENTS[4]!;
    expect(c.found).toBe(0);
    expect(g.feed(carefulSteps(c).filter((s) => s.name !== "Bash")).every((x) => x.code === 0)).toBe(true);
  });

  it("subagents are keyed by agent_id: reads of one do not license another's reply", () => {
    const g = mk("block");
    const [a, b] = [CLIENTS[0]!, CLIENTS[1]!];
    expect(g.feed(carefulSteps(a).filter((s) => s.name !== "Bash"), "A1").every((x) => x.code === 0)).toBe(true);
    expect(replies(g.feed([replyFor(b)], "A2"))[0]!.code).toBe(2);
    expect(g.feed(carefulSteps(b).filter((s) => s.name !== "Bash"), "A3").every((x) => x.code === 0)).toBe(true);
  });

  it("a name-swapped copy of an earlier reply is caught at the moment it would be created", () => {
    const g = mk("block");
    const [a, b] = [CLIENTS[0]!, CLIENTS[1]!];
    const body = (n: string) => `Hi ${n},\n\nThank you for your message and for your patience. We have received your question and our team is reviewing the details of your property now. We will come back to you in the next few days with the information you need, and please contact us if anything changes in the meantime.\n\nKind regards, the desk`;
    g.feed(carefulSteps(a).filter((s) => s.name !== "Bash").map((s) => (s.name.endsWith("create_reply") ? replyFor(a, body("Anna")) : s)));
    const r = g.feed(carefulSteps(b).filter((s) => s.name !== "Bash").map((s) => (s.name.endsWith("create_reply") ? replyFor(b, body("Boris")) : s)));
    expect(replies(r)[0]!.code).toBe(2);
    expect(replies(r)[0]!.stderr).toContain("near-copy");
  });

  it("the ledger holds no body text", () => {
    const g = mk("warn");
    const c = CLIENTS[0]!;
    g.feed(carefulSteps(c).filter((s) => s.name !== "Bash"));
    const text = readFileSync(sessionFile(g.root, "fixture-pc", "S1"), "utf8");
    expect(text).not.toContain("Thank you for writing");
    expect(text).not.toContain("thread text about");
    expect(text).toContain("create_reply");
  });

  it("an unbound or malformed call never throws", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pc-x-"));
    expect(runGuardPost("not json", { root, env: {} }).code).toBe(0);
    expect(runGuardPost(JSON.stringify({ tool_name: "x" }), { root, env: { HUB_PROJECT: "p" } as NodeJS.ProcessEnv }).code).toBe(0);
  });
});
