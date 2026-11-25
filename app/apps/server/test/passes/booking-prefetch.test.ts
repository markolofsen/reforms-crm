import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle, type NewLead, type Repos } from "@hub/db";
import { ProjectBase, type ProjectConfig } from "@hub/projects/model";
import { leadPrefetch } from "../../src/passes/prefetch";
import { prefetch } from "../../src/follow-ups/prefetch";

// P155 verdict 7: the lead pass and the sweep learn the thread's booking link from their data block, the channel that already
// gives them the brand. Made-up URLs only (public repository).

const A = "https://cal.example.test/acme/30min";
const B = "https://cal.example.test/other/30min";
let dir: string;
let h: DbHandle;
let repos: Repos;
const NOW = new Date("2026-11-26T12:00:00Z");
const brand = (name: string, booking: string | null) => ({ name, receivesAt: [], signature: [name], displayName: null, booking, answered: "2026-11-26", by: "owner" as const });
const cfg = (brands = [brand("Acme", A), brand("Other", B)]): ProjectConfig => ProjectBase.parse({ schema: 1, slug: "acme", kind: "generic", name: "Acme", status: "active", modules: ["mail"], brands, booking: { url: null } });
const lead = (o: Partial<NewLead> = {}): NewLead => ({ project: "acme", pageId: "1".repeat(32), name: "Lead", email: "l@x.test", accountEmail: null, brand: "Acme", receivedAt: NOW.toISOString(), preview: "We need a demo", notionStatus: "New", hasClient: false, ...o });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-booking-prefetch-"));
  h = openDb(path.join(dir, "app.db"));
  repos = createRepos(h.db);
});
afterEach(() => {
  h.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the booking line of a turn's data block (P155)", () => {
  it("a lead turn gets its brand's link, literally", async () => {
    await repos.leadRows.sync([lead()], NOW);
    const row = await repos.leadRows.get("acme", "1".repeat(32));
    if (!row) throw new Error("seed");
    const { context } = await leadPrefetch({ repos, project: () => cfg() }, "acme", row);
    expect(context).toContain(`Booking link: ${A} (`);
    expect(context).not.toContain(B);
  });

  it("a sweep turn: offered once in what we wrote, a nudge may repeat it; twice, none", async () => {
    const id = await repos.clients.create({ project: "acme", email: "ann@x.test", name: "Ann" });
    await repos.messengers.addIdentifier("acme", id, "telegram", "42");
    await repos.messengers.knowChat("acme", "telegram_user", "42", { title: "Ann" });
    h.db.$client.prepare("insert into drafts (project, client_id, subject, to_addr, body, brand, status) values ('acme', ?, 'Hi', 'ann@x.test', '', 'Acme', 'sent')").run(id);
    const say = (remote: string, text: string) => repos.messengers.insertMessage({ project: "acme", channel: "telegram_user", account: "1", chatId: "42", remoteMessageId: remote, direction: "out", kind: "text", text, sentAt: `2026-11-2${remote}T09:00:00.000Z`, retainUntil: "2027-02-18T00:00:00.000Z" });
    const due = { clientId: id, name: "Ann", email: null, ourLastAt: "2026-11-22T09:00:00.000Z", theirLastAt: null, lastChannel: "telegram_user" as const, chats: [{ id: 1, channel: "telegram_user" as const, chatId: "42", replyMode: "draft" as const, lastInAt: null, lastOutAt: null, openDraft: false }], onRequest: false, plan: null };
    await say("1", `Pick a time here: ${A}`);
    expect((await prefetch({ repos, project: () => cfg() }, "acme", due)).context).toContain(`Booking link: ${A} (`);
    await say("2", `Still here: ${A}`);
    expect((await prefetch({ repos, project: () => cfg() }, "acme", due)).context).toContain("Booking link: none for this message");
  });
});
