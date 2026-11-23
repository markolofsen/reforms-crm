import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pathsAt } from "@hub/config/paths";
import { createRepos, openDb } from "@hub/db";
import { runGuard, runGuardPost, writeSessionFiles } from "../src/safety";
import { sessionFile } from "../src/evidence-store";
import { appendEvents, logStoreOf } from "@hub/log/store";
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
    expect(w.every((x) => x.code === 0 && /: missing \(/.test(x.stderr))).toBe(true);
    // The first client's message was opened: the warning says so; the others' were not: read first.
    expect(w[0]!.stderr).toContain("was read; the rest of this client's thread and profile was not");
    expect(w.slice(1).every((x) => x.stderr.includes("read this client's thread and profile first"))).toBe(true);
    const block = mk("block");
    const b = replies(block.feed(lazySteps(cs)));
    expect(b.every((x) => x.code === 2)).toBe(true);
    expect(b[0]!.stderr).toContain("(d)");
  });

  it("P129 verdict 7: a draft on the owner's own words, found in this project's session log, is not asked for the thread first", () => {
    const g = mk("block");
    const draft = (owner_request?: string) => ({ name: "mcp__hub__draft_write", input: { account: "desk@fixture-pc.example", mailbox_path: ["INBOX"], message_id: 1, content: "Парус", ...(owner_request ? { owner_request } : {}) }, result: {} });
    // No words in the log yet: the evidence rule asks for the chain, and block mode refuses.
    expect(g.feed([draft("Подготовь какой-нибудь ответ в виде стишка")])[0]?.code).toBe(2);
    appendEvents(logStoreOf(pathsAt(g.root)), [{ project: "fixture-pc", session: "S1", cli: "claude", kind: "prompt", data: { text: "Подготовь какой-нибудь ответ в виде стишка" } }]);
    expect(g.feed([draft("Подготовь какой-нибудь ответ в виде стишка")])[0]).toMatchObject({ code: 0, stderr: "" });
    // His words, but not as he typed them (a translation): the chain is asked for again.
    expect(g.feed([draft("prepare a reply as a poem")])[0]?.code).toBe(2);
    expect(g.feed([draft()])[0]?.code).toBe(2);
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

  it("P60 finding 3: the saas 14:26 revision (a failed read, a read, draft_write {draft}) is warned for the history and profile, never for the read", async () => {
    const g = mk("warn");
    const client = "markolofsen@gmail.example";
    const h = openDb(pathsAt(g.root, {}).db);
    const { draftId } = await createRepos(h.db).drafts.record({ project: "fixture-pc", email: client, name: "Mark Effect", subject: "Re: Hello", mailRef: "<calat@mail.gmail.example>" });
    h.close();
    const env = { HUB_PROJECT: "fixture-pc", HUB_GUARD: "warn" } as NodeJS.ProcessEnv;
    const base = (tool_name: string, tool_input: unknown) => ({ session_id: "S1", tool_name, tool_input });
    // The refused call (unknown argument `mailbox_path`): PreToolUse ran, PostToolUse did not (a tool error).
    expect(runGuard(JSON.stringify(base("mcp__mail-mcp__get_message_content", { account: "hello@reforms.example", mailbox_path: "[\"INBOX\"]", message_id: 138994 })), { root: g.root, projectsDir: PROJECTS, env }).code).toBe(0);
    const read = base("mcp__mail-mcp__get_message_content", { account: "hello@reforms.example", mailboxPath: ["INBOX"], message_id: 138994 });
    runGuard(JSON.stringify(read), { root: g.root, projectsDir: PROJECTS, env });
    runGuardPost(JSON.stringify({ ...read, tool_response: [{ type: "text", text: JSON.stringify({ id: 138994, sender: `Mark Effect <${client}>`, dateReceived: "2026-11-14T06:27:03.000Z", content: "Hello, a new request" }) }] }), { root: g.root, env });
    const w = runGuard(JSON.stringify(base("mcp__hub__draft_write", { draft: draftId, content: "Короткий ответ стихами о новом запросе." })), { root: g.root, projectsDir: PROJECTS, env });
    expect(w.code).toBe(0);
    expect(w.stderr).toContain("the message being answered (138994) was read");
    expect(w.stderr).not.toContain("(a)");
    expect(w.stderr).toContain("(b)");
    expect(w.stderr).toContain("(c) 3 message(s) of this client opened (1 so far; 3 because no history search said how many there are)");
    expect(w.stderr).toContain("(d)");
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
