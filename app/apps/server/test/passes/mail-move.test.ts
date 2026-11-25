import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_SEND_HEADER } from "@hub/agent/send-token";
import { createRepos, openDb, type DbHandle, type NewInbound, type Repos } from "@hub/db";
import { FakeMailer } from "@hub/send/mailer";
import type { SendDeps } from "@hub/send/assess";
import { mailMoveRoutes } from "../../src/passes/mail-move-routes";

// P147 3n: Spam (Mail's Junk) and Delete (Mail's Trash) of one inbound message. The owner's door takes the admin's exact Origin
// and is never refused for who sent it; the agent's (`mail_junk`, the agent token) is refused for a sender we know. FakeMailer
// throughout: nothing reaches Mail, and nothing is ever sent.

const TOKEN = "t".repeat(64);
const BASE = "http://127.0.0.1:4317/api/projects/acme/mail/inbound";
const ADMIN = { "content-type": "application/json", origin: "http://127.0.0.1:5173", "sec-fetch-site": "same-origin" };
const AGENT = { "content-type": "application/json", [AGENT_SEND_HEADER]: TOKEN };
const NOW = new Date("2026-11-25T10:00:00Z");

let dir: string;
let handle: DbHandle;
let repos: Repos;
let mailer: FakeMailer;

const inbound = (n: number, email: string): NewInbound => ({ project: "acme", account: "owner@acme.example", mailbox: "INBOX", messageId: `m${n}@x.test`, email, name: `Person ${n}`, subject: `Subject ${n}`, receivedAt: NOW.toISOString(), read: false, why: "client", preview: "Hello" });
const app = () => mailMoveRoutes({ repos, deps: { repos, mailer, projectsDir: dir, policyDir: dir, allowList: [], now: () => NOW } as SendDeps, adminPort: 5173, agentToken: TOKEN });
const post = (id: number, path: "move" | "agent-junk", headers: Record<string, string>, body: unknown = {}) => app().request(`${BASE}/${id}/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
const idOf = async (email: string) => (await repos.inboundMail.open("acme")).find((r) => r.email === email)?.id as number;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "hub-mail-move-"));
  handle = openDb(join(dir, "app.db"));
  repos = createRepos(handle.db);
  mailer = new FakeMailer();
  await repos.inboundMail.store([inbound(1, "helpdesk@phish.example"), inbound(2, "buyer@client.example")], NOW);
  await repos.clients.create({ project: "acme", email: "buyer@client.example", name: "Buyer", notionPageId: "page-fictional-1" });
});
afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the inbound move (P147 3n)", () => {
  it("the owner's Spam moves to Junk and Delete moves to Trash, a known sender included, and closes the message", async () => {
    const spam = await post(await idOf("helpdesk@phish.example"), "move", ADMIN, { to: "junk" });
    expect(spam.status).toBe(200);
    expect(await spam.json()).toMatchObject({ ok: true, to: "junk", closed: 1 });
    const del = await post(await idOf("buyer@client.example"), "move", ADMIN, { to: "trash" });
    expect(del.status).toBe(200);
    expect(mailer.junked).toEqual([{ account: "owner@acme.example", mailbox: "INBOX", messageId: "m1@x.test" }]);
    expect(mailer.binned).toEqual([{ account: "owner@acme.example", mailbox: "INBOX", messageId: "m2@x.test" }]);
    expect(await repos.inboundMail.open("acme")).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });

  it("the owner's door refuses a request without the admin's Origin", async () => {
    const id = await idOf("helpdesk@phish.example");
    expect((await post(id, "move", { "content-type": "application/json" }, { to: "trash" })).status).toBe(403);
    expect((await post(id, "move", { ...ADMIN, origin: "http://evil.example" }, { to: "trash" })).status).toBe(403);
    expect(mailer.binned).toEqual([]);
  });

  it("the agent moves an unknown sender to Junk or Trash with its token, and is refused a known one", async () => {
    expect((await post(await idOf("helpdesk@phish.example"), "agent-junk", AGENT, { to: "trash" })).status).toBe(200);
    expect(mailer.binned).toHaveLength(1);
    const known = await post(await idOf("buyer@client.example"), "agent-junk", AGENT);
    expect(known.status).toBe(403);
    expect(((await known.json()) as { error: string }).error).toMatch(/Clients card.*Only the owner/);
    expect(mailer.junked).toEqual([]);
    expect((await repos.inboundMail.open("acme")).map((r) => r.email)).toEqual(["buyer@client.example"]);
  });

  it("the agent's door takes the agent token only", async () => {
    const id = await idOf("helpdesk@phish.example");
    expect((await post(id, "agent-junk", ADMIN)).status).toBe(403);
    expect((await post(id, "agent-junk", { ...AGENT, [AGENT_SEND_HEADER]: "x".repeat(64) })).status).toBe(403);
    expect((await post(id, "agent-junk", AGENT, { to: "delete" })).status).toBe(400);
    expect(mailer.junked).toEqual([]);
  });
});
