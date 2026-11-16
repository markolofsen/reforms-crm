import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { buildEml, FakeImapServer } from "@hub/mail/imap";
import { createApp } from "./app";
import { createMailService } from "./mail";

const ME = "me@example.test";
const ANNA = "anna@example.test";
let handle: DbHandle;
let repos: Repos;
let clientId: number;
let imap: FakeImapServer;
let dir: string;
const URL = (id: number, q = "project=p") => `http://127.0.0.1:4317/api/clients/${id}/history?${q}`;

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  dir = mkdtempSync(join(tmpdir(), "hub-hist-"));
  await repos.projects.replaceRegistry({
    projects: [{ slug: "p", name: "P", status: "active", settingsJson: JSON.stringify({ mail: { accounts: ["Google"], addresses: [ME] } }), hash: "h" }],
    addresses: [],
  });
  clientId = await repos.clients.create({ project: "p", email: ANNA, name: "Anna" });
  imap = new FakeImapServer({
    Google: {
      INBOX: { messages: [buildEml({ from: ANNA, to: ME, subject: "Hello", messageId: "<in1@x>", date: "2026-11-10T09:00:00Z" })] },
      Sent: { specialUse: "\\Sent", messages: [buildEml({ from: ME, to: ANNA, subject: "Re: Hello", messageId: "<out1@x>", date: "2026-11-11T09:00:00Z" })] },
    },
  });
  const f = join(dir, "mail-google.json");
  writeFileSync(f, JSON.stringify({ account: "Google", host: "imap.example.test", user: ME, pass: "pw-secret-123" }));
  chmodSync(f, 0o600);
});
afterEach(() => handle.close());

const app = () => createApp(repos, { mail: createMailService({ repos, env: {}, configDir: dir, connect: imap.connect }) });
const get = async (a: ReturnType<typeof app>, url: string) => {
  const r = await a.request(url);
  return { status: r.status, body: (await r.json()) as any };
};

describe("GET /api/clients/:id/history", () => {
  it("serves the client's mail (the client row's own address, no link needed) merged with messenger rows", async () => {
    await repos.messengers.addIdentifier("p", clientId, "telegram", "100");
    await repos.messengers.insertMessage({ project: "p", channel: "telegram_bot", account: "1", chatId: "100", remoteMessageId: "1", direction: "in", kind: "text", text: "tg hi", sentAt: "2026-11-12T10:00:00.000Z", retainUntil: "2027-12-31T00:00:00.000Z" });
    const { status, body } = await get(app(), URL(clientId));
    expect(status).toBe(200);
    expect(body.items.map((i: any) => (i.source === "mail" ? i.entry.id : i.text))).toEqual(["tg hi", "<out1@x>", "<in1@x>"]);
    expect(body.items.map((i: any) => i.direction)).toEqual(["in", "out", "in"]);
    expect(body.mailUnavailable).toEqual([]);
    expect(imap.ops.every((o) => /:(list|search|headers|close):/.test(o))).toBe(true);
  });

  it("pages with the cursor", async () => {
    const a = app();
    const p1 = (await get(a, URL(clientId, "project=p&limit=2"))).body;
    expect(p1.items.map((i: any) => i.entry.id)).toEqual(["<out1@x>", "<in1@x>"]);
    expect(p1.nextCursor).toBeUndefined();
    imap.add("Google", "INBOX", buildEml({ from: ANNA, to: ME, subject: "More", messageId: "<in2@x>", date: "2026-11-13T09:00:00Z" }));
    const fresh = app();
    const q1 = (await get(fresh, URL(clientId, "project=p&limit=2"))).body;
    expect(q1.items.map((i: any) => i.entry.id)).toEqual(["<in2@x>", "<out1@x>"]);
    const q2 = (await get(fresh, URL(clientId, `project=p&limit=2&cursor=${q1.nextCursor}`))).body;
    expect(q2.items.map((i: any) => i.entry.id)).toEqual(["<in1@x>"]);
  });

  it("without a mail login it serves messenger rows only, and with a failing one it says which address failed", async () => {
    const none = createApp(repos, { mail: createMailService({ repos, env: {}, configDir: join(dir, "nothing"), connect: imap.connect }) });
    expect((await get(none, URL(clientId))).body).toMatchObject({ items: [], mailUnavailable: [] });
    imap.refuse.set("Google", "AUTH pw-secret-123");
    const r = await get(app(), URL(clientId));
    expect(r.status).toBe(200);
    expect(r.body.mailUnavailable).toEqual([{ address: ANNA, code: "unavailable" }]);
    expect(JSON.stringify(r.body)).not.toContain("pw-secret");
  });

  it("is project-scoped: another project's client is 404, a bad cursor is 400, bad input is 400", async () => {
    const a = app();
    expect((await get(a, URL(clientId, "project=other"))).status).toBe(404);
    expect((await get(a, URL(99999))).status).toBe(404);
    expect((await get(a, URL(clientId, "project=p&cursor=junk"))).status).toBe(400);
    expect((await get(a, URL(clientId, "project=p&limit=0"))).status).toBe(400);
    expect((await get(a, URL(clientId, ""))).status).toBe(400);
  });

  it("a project that does not list the account never reads it", async () => {
    await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: JSON.stringify({ mail: { accounts: ["Elsewhere"] } }), hash: "h" }], addresses: [] });
    const r = await get(app(), URL(clientId));
    expect(r.body.items).toEqual([]);
    expect(imap.connects).toEqual([]);
  });

  it("is refused for a foreign host like every route", async () => {
    expect((await app().request(`http://evil.example/api/clients/${clientId}/history?project=p`)).status).toBe(403);
  });
});
