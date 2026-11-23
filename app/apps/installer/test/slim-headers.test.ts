import { describe, expect, it } from "vitest";
import { slimHeaders, slimMessageContent } from "../src/slim-headers";

const RAW = ["Received: from a", "Received: from b", "DKIM-Signature: v=1; " + "x".repeat(900), "Delivered-To: hello@reforms.ai", "Reply-To: c@d.com",
  "Authentication-Results: mx; spf=pass", "Authentication-Results: mx2; dkim=pass", "Subject: hi", "X-Mailer: foo", "List-Unsubscribe: <mailto:u@x>"].join("\r\n");
const body = () => JSON.stringify({ message: { id: 1, subject: "hi", allHeaders: RAW, content: "hello" } });

describe("slimHeaders", () => {
  it("keeps the triage lines, once each, and drops the rest", () => {
    const s = slimHeaders(RAW);
    expect(s).toContain("Delivered-To: hello@reforms.ai");
    expect(s).toContain("Reply-To: c@d.com");
    expect(s).toContain("List-Unsubscribe");
    expect(s.match(/Authentication-Results/g)?.length).toBe(1);
    expect(s).not.toMatch(/Received|DKIM|X-Mailer|Subject/);
  });
  it("keeps To, Cc and X-Gm-Original-To: the brand order reads them (P60; message_show and draft_write)", () => {
    const s = slimHeaders("X-Gm-Original-To: a@brand.example\r\nTo: b@brand.example\r\nCc: c@brand.example\r\nX-Forwarded-For: a@brand.example desk@x.example");
    for (const h of ["X-Gm-Original-To: a@brand.example", "To: b@brand.example", "Cc: c@brand.example", "X-Forwarded-For: a@brand.example desk@x.example"]) expect(s).toContain(h);
  });
  it("joins folded lines and caps a long one", () => {
    expect(slimHeaders("References: <a>\r\n <b>")).toBe("References: <a> <b>");
    expect(slimHeaders("Reply-To: " + "y".repeat(500)).length).toBeLessThan(320);
  });
});

describe("slimMessageContent", () => {
  const check = (t: string) => { const m = JSON.parse(t).message; expect(m.content).toBe("hello"); expect(m.allHeaders.length).toBeLessThan(RAW.length / 2); };
  it("handles a string, a block array and {content}", () => {
    check(slimMessageContent(body()) as string);
    check((slimMessageContent([{ type: "text", text: body() }]) as { text: string }[])[0]!.text);
    check(((slimMessageContent({ content: [{ type: "text", text: body() }], isError: false }) as { content: { text: string }[] }).content[0]!.text));
  });
  it("returns null for anything unrecognised", () => {
    expect(slimMessageContent("not json")).toBeNull();
    expect(slimMessageContent(JSON.stringify({ message: { id: 1 } }))).toBeNull();
    expect(slimMessageContent(undefined)).toBeNull();
  });
});

import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runGuardPost } from "../src/safety";
import { sessionFile } from "@hub/projects/evidence-store";

describe("hub guard --post on get_message_content", () => {
  it("prints a slim reply and still records the ledger from the original", () => {
    const root = mkdtempSync(path.join(tmpdir(), "slim-"));
    const env = { HUB_PROJECT: "p" } as NodeJS.ProcessEnv;
    const r = runGuardPost(JSON.stringify({ session_id: "S", tool_name: "mcp__mail-mcp__get_message_content", tool_input: { message_id: 7, account: "a" }, tool_response: body() }), { root, env });
    const out = JSON.parse(r.stdout!).hookSpecificOutput;
    expect(out.hookEventName).toBe("PostToolUse");
    expect(JSON.parse(out.updatedMCPToolOutput).message.allHeaders.length).toBeLessThan(RAW.length / 2);
    const f = sessionFile(root, "p", "S");
    expect(existsSync(f)).toBe(true);
    expect(readFileSync(f, "utf8")).toContain(`"bytes":${body().length}`);
  });
  it("prints nothing for other tools", () => {
    const root = mkdtempSync(path.join(tmpdir(), "slim-"));
    expect(runGuardPost(JSON.stringify({ session_id: "S", tool_name: "mcp__mail-mcp__find_messages", tool_input: {}, tool_response: "[]" }), { root, env: { HUB_PROJECT: "p" } as NodeJS.ProcessEnv }).stdout).toBeUndefined();
  });
});
