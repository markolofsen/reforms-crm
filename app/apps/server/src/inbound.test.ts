import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import type { OsaRun } from "@hub/send";
import { appleScriptCompileError, canCompileAppleScript } from "../../../test-support/osacompile";
import { CONTENT_SCRIPT, INBOUND_SCRIPT, ownText, parseInbound, RUNNING_SCRIPT, SENT_SCRIPT } from "./apple-mail";
import { createApp } from "./app";
import { startInboundReader } from "./inbound";

// The Mail reader (P96) reads Apple Mail through a fake `OsaRun`: no test reaches Mail.
const FS = "\x1f";
const RS = "\x1e";
const LS = "\x1d";
let handle: DbHandle;
let repos: Repos;
let dir: string;

type Msg = { mailId: number; id: string; from: string; subject?: string; irt?: string; refs?: string; read?: boolean; bulk?: string; at?: Date; text?: string };

function inboundRecord(m: Msg): string {
  const at = m.at ?? new Date(Date.now() - 60_000);
  const stamp = `${at.getFullYear()},${at.getMonth() + 1},${at.getDate()},${at.getHours() * 3600 + at.getMinutes() * 60 + at.getSeconds()}`;
  return [m.mailId, m.id, m.irt ?? "", m.refs ?? "", m.from, stamp, m.subject ?? "Hello", m.read ? "true" : "false", m.bulk ?? ""].join(FS) + RS;
}

/** A fake Mail: its INBOX per account, no labels (`nobox`), the texts by Mail id, and a Sent mailbox. */
function fakeMail(o: { running?: boolean; inbox?: Msg[]; sent?: string[] } = {}) {
  const calls: string[] = [];
  const osa: OsaRun = async (script, args) => {
    if (script === RUNNING_SCRIPT) return o.running === false ? "false" : "true";
    if (script === INBOUND_SCRIPT) {
      calls.push(`inbound ${args[1]}`);
      return args[1] === "INBOX" ? `ok${RS}${(o.inbox ?? []).map(inboundRecord).join("")}` : "nobox";
    }
    if (script === CONTENT_SCRIPT) {
      calls.push(`content ${args[2]}`);
      const m = (o.inbox ?? []).find((x) => String(x.mailId) === args[2]);
      return m ? `ok${FS}${m.text ?? "Thanks!"}` : "none";
    }
    if (script === SENT_SCRIPT) return (o.sent ?? []).join("");
    return "";
  };
  return { osa, calls };
}

const register = () =>
  repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "h" }], addresses: [] });

function projectFolder(recipients: "test" | "any" = "any", filters = "") {
  mkdirSync(join(dir, "projects", "p"), { recursive: true });
  writeFileSync(
    join(dir, "projects", "p", "project.md"),
    ["# P", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", "| schema | 1 | 2026-11-14 | agent |", "| status | active | 2026-11-15 | agent |", "| mail.accounts | me@example.test | 2026-11-14 | agent |", "| mail.addresses | me@example.test | 2026-11-14 | owner |", "", "## Notion databases", "", "- clients: 00000000-0000-4000-8000-000000000001", ""].join("\n"),
  );
  mkdirSync(join(dir, "policy", "p"), { recursive: true });
  writeFileSync(join(dir, "policy", "p", "send-policy.json"), JSON.stringify({ schema: 1, recipients, mode: "draft", classes: [], dailyCap: 5, delayMinutes: 10, updatedAt: "2026-11-18T00:00:00.000Z", by: "test" }));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ allow_list: ["owner@example.test"] }));
  if (filters) writeFileSync(join(dir, "projects", "p", "mail-filters.md"), filters);
}

const reader = (osa: OsaRun, o: { knownClient?: (p: string, e: string) => boolean } = {}) =>
  startInboundReader({ repos, osa, env: {}, timer: false, projectsDir: join(dir, "projects"), policyDir: join(dir, "policy"), configFile: join(dir, "config.json"), ...o });

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  dir = mkdtempSync(join(tmpdir(), "hub-inbound-"));
  await register();
});
afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the Mail reader's scripts compile (osacompile, no Mail call)", () => {
  it.skipIf(!canCompileAppleScript).each([
    ["INBOUND_SCRIPT", INBOUND_SCRIPT],
    ["CONTENT_SCRIPT", CONTENT_SCRIPT],
  ])("%s", (_name, script) => {
    expect(appleScriptCompileError(script)).toBeNull();
  });
});

describe("parseInbound and ownText", () => {
  it("reads the sender, the ids and the bulk headers; a missing mailbox is null", () => {
    const out = `ok${RS}${inboundRecord({ mailId: 7, id: "<A@x>", from: "Anna Lee <Anna@Example.test>", refs: "<r1@x> <r2@x>", bulk: "list <https://u>" })}`;
    const [m] = parseInbound(out, "acc", "INBOX") ?? [];
    expect(m).toMatchObject({ mailId: 7, messageId: "a@x", email: "anna@example.test", name: "Anna Lee", references: ["r1@x", "r2@x"], bulk: true, read: false });
    expect(parseInbound("nobox", "acc", "hub/client")).toBeNull();
  });
  it("keeps the client's own words above the quote", () => {
    expect(ownText("Great, thanks!\n\nOn Fri, 20 Nov 2026 at 23:50, <me@example.test> wrote:\n\nour text")).toEqual({ text: "Great, thanks!", quoted: true });
    expect(ownText("Yes.\n\n20 Nov 2026, 23:50, Team <me@example.test>:\n> quoted")).toEqual({ text: "Yes.", quoted: true });
    expect(ownText("Just a line")).toEqual({ text: "Just a line", quoted: false });
  });
});

describe("which messages are a client's (verdict 3)", () => {
  it("a reply in our thread, a known client and the test address are stored; own, filtered, machine and unknown are not", async () => {
    projectFolder("test", ["# Mail filters: p", "", "## Rules", "", "| Match | Category | Label | Action | Why | Date | By |", "|---|---|---|---|---|---|---|", "| from:billing@vendor.test | service | hub/service | label | invoices | 2026-11-14 | owner |", ""].join("\n"));
    const d = await repos.drafts.record({ project: "p", email: "anna@example.test", name: "Anna", subject: "Re: Wow", mailRef: "<their1@x>" });
    await repos.clients.upsert({ project: "p", email: "bob@example.test", name: "Bob" });
    const { osa } = fakeMail({
      inbox: [
        // Her reply comes after our draft (a draft made after a message closes it: the open rule).
        { mailId: 1, id: "<r1@x>", from: "Anna <anna@example.test>", subject: "Re: Wow", irt: "<sent1@me>", refs: "<their1@x> <sent1@me>", text: "Wow, thanks!\n\nOn Fri, someone wrote:\nold", at: new Date(Date.now() + 120_000) },
        { mailId: 2, id: "<b1@x>", from: "Bob <bob@example.test>", subject: "Question" },
        { mailId: 3, id: "<o1@x>", from: "Owner <owner@example.test>", subject: "Test" },
        { mailId: 4, id: "<me1@x>", from: "me@example.test", subject: "Ours" },
        { mailId: 5, id: "<v1@x>", from: "billing@vendor.test", subject: "Invoice" },
        { mailId: 6, id: "<n1@x>", from: "Cloud <noreply@notify.cloud.test>", subject: "Notice" },
        { mailId: 7, id: "<l1@x>", from: "News <news@shop.test>", subject: "Sale", bulk: "list <u>" },
        { mailId: 8, id: "<u1@x>", from: "Stranger <stranger@example.test>", subject: "Hi" },
      ],
    });
    const r = reader(osa);
    await r.tick();
    const rows = await repos.inboundMail.open("p");
    expect(rows.map((x) => [x.email, x.why]).sort()).toEqual([["anna@example.test", "thread"], ["bob@example.test", "client"], ["owner@example.test", "test"]]);
    expect(rows.find((x) => x.email === "anna@example.test")).toMatchObject({ preview: "Wow, thanks!", threadRef: "their1@x", threadDraftId: d.draftId });
    expect(r.status().projects[0]).toMatchObject({ slug: "p", unknown: 1 });
    expect(r.status().state).toBe("running");
  });

  it("a Notion client the directory knows is a client; the text is read once", async () => {
    projectFolder();
    const fake = fakeMail({ inbox: [{ mailId: 9, id: "<c1@x>", from: "carol@example.test", subject: "Hello" }] });
    const r = reader(fake.osa, { knownClient: (p, e) => p === "p" && e === "carol@example.test" });
    await r.tick();
    await r.tick();
    expect((await repos.inboundMail.open("p")).map((x) => x.email)).toEqual(["carol@example.test"]);
    expect(fake.calls.filter((c) => c.startsWith("content"))).toEqual(["content 9"]);
  });

  it("never reads with Mail closed: the line says so", async () => {
    projectFolder();
    const fake = fakeMail({ running: false, inbox: [{ mailId: 1, id: "<a@x>", from: "a@example.test" }] });
    const r = reader(fake.osa);
    await r.tick();
    expect(r.status()).toMatchObject({ state: "off", reason: "Mail is not running" });
    expect(fake.calls).toEqual([]);
  });
});

describe("a row leaves Inbox by work (verdict 4) and owed counts one client once (verdict 5)", () => {
  it("No reply needed and its Undo; a draft recorded after the message closes it", async () => {
    projectFolder();
    await repos.clients.upsert({ project: "p", email: "bob@example.test", name: "Bob" });
    const { osa } = fakeMail({ inbox: [{ mailId: 2, id: "<b1@x>", from: "Bob <bob@example.test>", subject: "Question", at: new Date(Date.now() - 3_600_000) }] });
    await reader(osa).tick();
    const [row] = await repos.inboundMail.open("p");
    expect((await repos.inbox.counts("p")).owed).toBe(1);
    const ids = await repos.inboundMail.dismiss("p", row!.id);
    expect(await repos.inboundMail.open("p")).toEqual([]);
    await repos.inboundMail.undismiss("p", ids);
    expect((await repos.inboundMail.open("p")).length).toBe(1);
    await repos.drafts.record({ project: "p", email: "bob@example.test", name: "Bob", subject: "Re: Question", mailRef: "<b1@x>" });
    expect(await repos.inboundMail.open("p")).toEqual([]);
    expect((await repos.inbox.counts("p")).owed).toBe(0);
  });
});

describe("the door's sent Message-ID is read back from Sent (verdict 13)", () => {
  it("fills send_log and the draft where none is recorded", async () => {
    projectFolder();
    const d = await repos.drafts.record({ project: "p", email: "anna@example.test", name: "Anna", subject: "Re: Wow", mailRef: "<their1@x>" });
    const row = await repos.sends.begin({ project: "p", draftId: d.draftId, mode: "manual", status: "sending", actor: "admin", at: new Date().toISOString(), sender: "me@example.test", to: "anna@example.test", cc: null, bcc: null, subject: "Re: Wow", body: "Hi", mailRef: "<their1@x>" });
    await repos.sends.markSent(row.id, null);
    const at = new Date(Date.now() + 5_000);
    const stamp = `${at.getFullYear()},${at.getMonth() + 1},${at.getDate()},${at.getHours() * 3600 + at.getMinutes() * 60 + at.getSeconds()}`;
    const sent = [["<NEW1@me>", "<their1@x>", stamp, `anna@example.test${LS}`, "", "Re: Wow", "<their1@x>", "me@example.test"].join(FS) + RS];
    await reader(fakeMail({ sent }).osa).tick();
    expect((await repos.drafts.get(d.draftId))?.sentMessageId).toBe("new1@me");
  });
});

describe("the Inbox routes", () => {
  it("lists the clients who wrote, with the reader's line; Check now runs a pass", async () => {
    projectFolder();
    await repos.clients.upsert({ project: "p", email: "bob@example.test", name: "Bob" });
    const r = reader(fakeMail({ inbox: [{ mailId: 2, id: "<b1@x>", from: "Bob <bob@example.test>", subject: "Question", text: "When can we talk?" }] }).osa);
    const app = createApp(repos, { inbound: r, inboundText: async () => ({ text: "When can we talk?\n\nOn Mon, x wrote:\nold" }) });
    const checked = await (await app.request("http://127.0.0.1/api/projects/p/inbound/check", { method: "POST" })).json();
    expect(checked.read.at).not.toBeNull();
    const list = await (await app.request("http://127.0.0.1/api/projects/p/inbound")).json();
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ email: "bob@example.test", preview: "When can we talk?", subject: "Question" });
    const one = await (await app.request(`http://127.0.0.1/api/projects/p/inbound/${list.rows[0].id}`)).json();
    expect(one).toMatchObject({ text: "When can we talk?", quoted: true, note: null });
  });
});
