import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FOLLOW_UP_HUB_TOOLS } from "@hub/config/follow-ups";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { FOLLOW_UP_ALLOWED, followUpDisallowed, sweepStream } from "../src/follow-up";
import { createHubMcpServer } from "../src/mcp/server";
import type { HubMcpEnv } from "../src/mcp/ports";

// P142 (decision 0050): the sweep turn's tools, its own model process and its stream.

let dir: string;
let h: DbHandle;
let repos: Repos;
let ann: number;
let bob: number;
beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-follow-up-"));
  h = openDb(path.join(dir, "app.db"));
  repos = createRepos(h.db);
  ann = await repos.clients.create({ project: "acme", email: "ann@example.test", name: "Ann" });
  bob = await repos.clients.create({ project: "acme", email: "bob@example.test", name: "Bob" });
});
afterEach(() => {
  h.close();
  rmSync(dir, { recursive: true, force: true });
});

async function connect(env: Partial<HubMcpEnv> = {}) {
  const server = createHubMcpServer(repos, { hubProject: "acme", focusFile: path.join(dir, "focus.json"), withRepos: (fn) => fn(repos), ...env });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: r.isError === true, json: JSON.parse((r.content as Array<{ text: string }>)[0]!.text) as Record<string, unknown> };
  };
  return { client, call };
}

describe("a sweep turn's hub mcp (verdict 5)", () => {
  it("registers exactly its eight client-bound tools, none that sends", async () => {
    const { client } = await connect({ followUpClient: 1 });
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([...FOLLOW_UP_HUB_TOOLS].sort());
  });

  it("its model process allows the eight and denies messenger_send and every other hub tool by name", () => {
    expect(FOLLOW_UP_ALLOWED).toHaveLength(8);
    const denied = followUpDisallowed();
    expect(denied).toContain("mcp__hub__messenger_send");
    expect(denied).toContain("mcp__hub__client_create");
    for (const t of FOLLOW_UP_ALLOWED) expect(denied).not.toContain(t);
  });
});

describe("follow_up_plan (verdict 9)", () => {
  it("records a wait with its date, replaces it the same day, and never refuses a judgement", async () => {
    const { call } = await connect({ followUpClient: ann });
    const first = await call("follow_up_plan", { client: ann, decision: "wait", next_check: "2026-12-01", reason: "they said after the holidays", line: "25 Nov · mail · wait · 1 Dec · after the holidays" });
    expect(first.isError).toBe(false);
    expect(first.json).toMatchObject({ client: ann, decision: "wait", state: "waiting", next_at: expect.stringMatching(/^2026-12-01/), same_day: false, next: expect.stringMatching(/Stop here/) });
    const again = await call("follow_up_plan", { client: ann, decision: "stop", stop_reason: "no_answer", reason: "three nudges, no answer" });
    expect(again.json).toMatchObject({ state: "stopped", same_day: true });
    expect((await repos.followUps.get("acme", ann))).toMatchObject({ state: "stopped" });
  });

  it("a nudge without a draft is answered with a hint, not refused; a missing date is invalid", async () => {
    const { call } = await connect({ followUpClient: ann });
    const nudge = await call("follow_up_plan", { client: ann, decision: "nudge", next_check: "2026-11-28", reason: "a short check-in" });
    expect(nudge.isError).toBe(false);
    expect(String(nudge.json.hint)).toMatch(/No follow-up draft/);
    expect((await call("follow_up_plan", { client: ann, decision: "wait", reason: "later" })).json).toMatchObject({ error: "invalid" });
  });

  it("a sweep turn bound to one client refuses another", async () => {
    const { call } = await connect({ followUpClient: ann });
    expect((await call("follow_up_plan", { client: bob, decision: "stop", reason: "not this one" })).json).toMatchObject({ error: "followup_other_client" });
    expect(await repos.followUps.get("acme", bob)).toBeNull();
  });
});

describe("sweepStream (F4)", () => {
  const line = (o: unknown) => JSON.stringify(o);
  it("takes the decision and the nudge only from calls the hub answered, and the result", () => {
    const s = sweepStream();
    expect(s.push(line({ type: "system", subtype: "init", mcp_servers: [{ name: "hub", status: "connected" }], tools: FOLLOW_UP_ALLOWED }))).toMatchObject({ hub: "connected" });
    s.push(line({ type: "assistant", message: { content: [
      { type: "tool_use", id: "d1", name: "mcp__hub__messenger_draft_write", input: { chat: 3, text: " Any news? ", follow_up: { n: 1 }, send_after: "2026-11-25T10:00:00Z", autopilot: { verdict: "send" } } },
      { type: "tool_use", id: "p0", name: "mcp__hub__follow_up_plan", input: { client: 1, decision: "stop" } },
      { type: "tool_use", id: "p1", name: "mcp__hub__follow_up_plan", input: { client: 1, decision: "nudge" } },
    ] } }));
    s.push(line({ type: "user", message: { content: [
      { type: "tool_result", tool_use_id: "d1", content: [{ type: "text", text: JSON.stringify({ draft: 42 }) }] },
      { type: "tool_result", tool_use_id: "p0", is_error: true, content: [{ type: "text", text: JSON.stringify({ error: "invalid" }) }] },
      { type: "tool_result", tool_use_id: "p1", content: [{ type: "text", text: JSON.stringify({ state: "waiting" }) }] },
    ] } }));
    s.push("not json");
    s.push(line({ type: "result", is_error: false, total_cost_usd: 0.01, permission_denials: [], result: "done", subtype: "success" }));
    expect(s.done()).toMatchObject({ decision: "nudge", nudge: { draftId: 42, text: "Any news?", chat: 3, send: true, sendAfter: "2026-11-25T10:00:00Z" }, final: { isError: false, costUsd: 0.01, denials: 0 } });
  });
});
