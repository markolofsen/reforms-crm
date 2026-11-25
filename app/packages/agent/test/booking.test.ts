import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, openDbReadOnly, type DbHandle, type Repos } from "@hub/db";
import { FakeDraftWriter } from "@hub/mail-app/writer/fake";
import type { Brand } from "@hub/projects/model";
import { mailBookingGuard } from "../src/drafts/booking";
import type { DraftScope } from "../src/drafts/sign";
import { createHubMcpServer } from "../src/mcp/server";
import { ToolError } from "../src/mcp/result";
import type { WithRepos } from "../src/mail/write-log";

// P155: the booking link as the messenger tools hand it over (verdict 7) and the narrow check at the agent's write (verdict 8),
// against a throwaway database; the mail write's check on the fake Mail. Made-up URLs only (public repository).

const A = "https://cal.example.test/alpha/30min";
const B = "https://cal.example.test/beta/30min";
const brand = (name: string, booking: string | null): Brand => ({ name, receivesAt: [`hi@${name.toLowerCase()}.example`], signature: [name], displayName: null, booking, answered: "2026-11-26", by: "owner" });
const BRANDS = [brand("Alpha", A), brand("Beta", B)];

let dir: string;
let db: string;
let rw: DbHandle;
let ro: DbHandle;
let w: Repos;
let repos: Repos;
let ann = 0;
const NOW = new Date("2026-11-26T12:00:00Z");
const msg = (remote: string, direction: "in" | "out", sentAt: string, text: string) => ({ project: "acme", channel: "telegram_user" as const, account: "1", chatId: "42", remoteMessageId: remote, direction, kind: "text", text, sentAt, retainUntil: "2027-02-18T00:00:00.000Z" });

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-booking-"));
  db = path.join(dir, "app.db");
  rw = openDb(db);
  w = createRepos(rw.db);
  ann = await w.clients.create({ project: "acme", email: "ann@example.com", name: "Ann" });
  await w.messengers.addIdentifier("acme", ann, "telegram", "42");
  await w.messengers.knowChat("acme", "telegram_user", "42", { title: "Ann" });
  await w.messengers.insertMessage(msg("1", "in", "2026-11-25T09:00:00.000Z", "Can we talk about pricing? My own calendar: https://calendly.com/example-client/15min"));
  ro = openDbReadOnly(db);
  repos = createRepos(ro.db);
});
afterEach(() => {
  ro.close();
  rw.close();
  rmSync(dir, { recursive: true, force: true });
});

const withRepos: WithRepos = async (fn) => {
  const h = openDb(db);
  try {
    return await fn(createRepos(h.db));
  } finally {
    h.close();
  }
};

async function connect(brands: Brand[], booking: string | null = null) {
  const server = createHubMcpServer(repos, { hubProject: "acme", focusFile: path.join(dir, "focus.json"), now: () => NOW, withRepos, projectMail: () => ({ accounts: [], sender: null, identity: { addresses: [], domains: [], signoff: "", brands, languages: ["en"] }, booking }) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(a);
  return async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    return JSON.parse((res.content as Array<{ text: string }>)[0]?.text ?? "{}") as Record<string, unknown> & { error?: string; chats?: Array<{ booking: unknown }> };
  };
}

const chat = { channel: "telegram_user", chat_id: "42" };

describe("messenger_history and messenger_draft_write (P155)", () => {
  it("an unresolved brand with differing links gets none, and any of our links is refused at the write", async () => {
    const call = await connect(BRANDS);
    expect((await call("messenger_history", chat)).chats?.[0]?.booking).toMatchObject({ url: null });
    expect((await call("messenger_draft_write", { ...chat, text: `Pick a time: ${A}` })).error).toBe("booking_link_mismatch");
  });

  it("the client's brand (from their newest mail draft) gives its link; the right link passes, another brand's is refused", async () => {
    rw.db.$client.prepare("insert into drafts (project, client_id, subject, to_addr, body, brand, status) values ('acme', ?, 'Hi', 'ann@example.com', '', 'Beta', 'sent')").run(ann);
    const call = await connect(BRANDS);
    expect((await call("messenger_history", chat)).chats?.[0]?.booking).toMatchObject({ url: B, alreadyOffered: false });
    expect((await call("messenger_draft_write", { ...chat, text: `If it is easier to talk it through, pick a time here: ${A}` })).error).toBe("booking_link_mismatch");
    const ok = await call("messenger_draft_write", { ...chat, text: `If it is easier to talk it through, pick a time here: ${B}` });
    expect(ok.error).toBeUndefined();
  });

  it("offered once already in the chat: none, and a second offer is refused; the client's own scheduler link and a Zoom link pass", async () => {
    await w.messengers.insertMessage(msg("2", "out", "2026-11-25T10:00:00.000Z", `Pick a time here: ${A}`));
    await w.messengers.insertMessage(msg("3", "in", "2026-11-25T11:00:00.000Z", "Thanks, later"));
    const call = await connect([brand("Alpha", A)]);
    expect((await call("messenger_history", chat)).chats?.[0]?.booking).toMatchObject({ url: null, alreadyOffered: true });
    expect((await call("messenger_draft_write", { ...chat, text: `Again: ${A}` })).error).toBe("booking_link_mismatch");
    const ok = await call("messenger_draft_write", { ...chat, text: "I booked your slot at https://calendly.com/example-client/15min; the call is on https://zoom.example.test/j/1" });
    expect(ok.error).toBeUndefined();
  });

  it("a follow-up may repeat it once", async () => {
    await w.messengers.insertMessage(msg("2", "out", "2026-11-25T10:00:00.000Z", `Pick a time here: ${A}`));
    await w.messengers.insertMessage(msg("3", "in", "2026-11-25T11:00:00.000Z", "Thanks"));
    const call = await connect([brand("Alpha", A)]);
    expect((await call("messenger_draft_write", { ...chat, text: `Still keen? ${A}`, follow_up: { n: 1 } })).error).toBeUndefined();
  });
});

describe("mailBookingGuard (draft_write, P155)", () => {
  const scope = (writer: FakeDraftWriter, booking: string | null = null): DraftScope => ({ cfg: { mail: { accounts: ["desk"], addresses: [], domains: [] }, signoff: "", brands: BRANDS, languages: ["en"], booking: { url: booking } }, writer }) as unknown as DraftScope;
  const inbound = { account: "desk", mailboxPath: ["INBOX"], messageId: 7 };

  it("a text with no booking-like URL never reads Mail; the brand's link passes; another brand's is refused", async () => {
    const writer = new FakeDraftWriter();
    await expect(mailBookingGuard(scope(writer), "See https://docs.example.test/start", "Alpha", () => Promise.reject(new Error("not read")))).resolves.toBeUndefined();
    writer.contents.set(7, "Hello, what does it cost?");
    await expect(mailBookingGuard(scope(writer), `Pick a time here: ${A}`, "Alpha", inbound)).resolves.toBeUndefined();
    await expect(mailBookingGuard(scope(writer), `Pick a time here: ${B}`, "Alpha", inbound)).rejects.toMatchObject({ code: "booking_link_mismatch" });
  });

  it("the thread quoting our earlier offer counts it: the reply may not offer again, a follow-up may once", async () => {
    const writer = new FakeDraftWriter();
    writer.contents.set(7, `Thanks!\n\n> Pick a time here: ${A}`);
    const e = await mailBookingGuard(scope(writer), `Here again: ${A}`, "Alpha", inbound).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ToolError);
    expect((e as ToolError).message).toMatch(/may carry no booking link now/);
    await expect(mailBookingGuard(scope(writer), `Here again: ${A}`, "Alpha", inbound, { followUp: true })).resolves.toBeUndefined();
  });
});
