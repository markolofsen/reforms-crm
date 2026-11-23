import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle } from "@hub/db";
import { FakeMailer, MailNotAnswering, mailAppMailer, type MailDraft } from "../src/mailer";
import { findMail, trashThread } from "../src/find";

// P65 (decision 0031): the thread decides which Mail draft is the hub draft (In-Reply-To = mailRef, To holds the
// client, one of the project's accounts), and the Hub's record (`mail_versions`) decides which ones it may move to Trash.
const THREAD = "CALatTu3bWeg=2Q@mail.gmail.com";
const mail = (ref: string, body: string, o: { account?: string; inReplyTo?: string | null; to?: string } = {}): MailDraft => ({
  ref,
  messageId: `${ref.toUpperCase()}-ID@reforms.ai`,
  account: o.account ?? "hello@x",
  inReplyTo: o.inReplyTo === undefined ? THREAD.toLowerCase() : o.inReplyTo,
  sender: "hello@x",
  to: [o.to ?? "mark@example.com"],
  cc: [],
  bcc: [],
  subject: "Re: Hello",
  body,
  attachments: 0,
});
const draft = { mailRef: `<${THREAD}>`, subject: "Re: Hello", toAddr: "mark@example.com" };
const hubs = mail("139712", "Hi Mark,\n\nWarmer.");
const owners = mail("139800", "Hi Mark, written by hand.");
const loose = mail("138996", "Hi Mark, an old one without headers.", { inReplyTo: null });
const scope = { accounts: ["hello@x"], versions: [{ account: "hello@x", messageId: hubs.messageId ?? "", trashedAt: null }] };

describe("findMail: the thread decides (P65 verdict 2)", () => {
  it("a Mail that does not answer is a reason with the fix line, from the read runner; the send runner is not used to read", async () => {
    const used: string[] = [];
    const slow = async () => { used.push("send"); return ""; };
    const read = async () => { used.push("read"); throw new MailNotAnswering(20_000); };
    const f = await findMail({ mailer: mailAppMailer(slow, read) }, draft, "show");
    expect(f.mail).toBeUndefined();
    expect(f.reason).toBe("Mail is not answering (no reply in 20 s). Quit Mail (Force Quit if it does not close), open it again, then reload this page.");
    expect(used).toEqual(["read"]);
  });
  it("one draft of the thread is the draft in both modes, whoever wrote it; other drafts of the subject are named in aside", async () => {
    for (const mode of ["strict", "show"] as const) {
      const f = await findMail({ mailer: new FakeMailer([loose, hubs]) }, draft, mode, scope);
      expect(f.mail?.ref).toBe("139712");
      expect(f.note).toBeUndefined();
      expect(f.aside).toMatch(/1 other draft .* do not answer this message \(Mail id 138996\): left alone/);
    }
    expect((await findMail({ mailer: new FakeMailer([owners]) }, draft, "strict", scope)).mail?.ref).toBe("139800");
  });

  it("two drafts of the thread: strict refuses and names both, saying which one the Hub wrote; show shows the Hub's without a hash", async () => {
    const strict = await findMail({ mailer: new FakeMailer([hubs, owners]) }, draft, "strict", scope);
    expect(strict.mail).toBeUndefined();
    expect(strict.reason).toMatch(/Mail holds 2 drafts that answer this message \(Mail id 139800 is not the Hub's; Mail id 139712 is the Hub's version\): keep one/);
    const show = await findMail({ mailer: new FakeMailer([owners, hubs]) }, draft, "show", scope);
    expect(show.mail?.ref).toBe("139712");
    expect(show.note).toMatch(/cannot be Checked or sent/);
  });

  it("a thread draft in another account, or to another recipient, is not this draft's; a body line never decides", async () => {
    const elsewhere = mail("139901", "[hub-draft thread=x]\nHi", { account: "someone@else" });
    const otherTo = mail("139902", "Hi", { to: "bob@example.com" });
    const f = await findMail({ mailer: new FakeMailer([elsewhere, otherTo]) }, draft, "strict", scope);
    expect(f.mail).toBeUndefined();
    expect(f.gone).toBe(true);
  });

  it("none by thread: the old rule for drafts without In-Reply-To (one candidate; several show the newest with a note)", async () => {
    expect((await findMail({ mailer: new FakeMailer([loose]) }, draft, "strict", scope)).mail?.ref).toBe("138996");
    const loose2 = mail("139001", "Another", { inReplyTo: null });
    const f = await findMail({ mailer: new FakeMailer([loose, loose2]) }, draft, "show", scope);
    expect(f.mail?.ref).toBe("139001");
    expect(f.note).toMatch(/none answers this message by its headers/);
  });

  it("no candidate at all is gone; a Mail failure is not", async () => {
    expect(await findMail({ mailer: new FakeMailer([]) }, draft)).toMatchObject({ gone: true });
    const broken = new FakeMailer([]);
    broken.findDrafts = async () => {
      throw new Error("Mail is not running");
    };
    const f = await findMail({ mailer: broken }, draft);
    expect(f.gone).toBeUndefined();
    expect(f.reason).toMatch(/could not be read/);
  });
});

let dir: string;
let db: DbHandle;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-trash-thread-"));
  db = openDb(path.join(dir, "app.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("trashThread (P65 verdict 3)", () => {
  async function recorded() {
    const repos = createRepos(db.db);
    const r = await repos.drafts.record({ project: "acme", email: "mark@example.com", name: "Mark", subject: "Re: Hello", mailRef: draft.mailRef, reason: "asked", skill: "triage-mail" });
    const add = (m: MailDraft) => repos.mailVersions.add({ project: "acme", mailRef: draft.mailRef, draftId: r.draftId, account: m.account ?? "", mailId: Number(m.ref), messageId: m.messageId ?? "", hash: "h", source: "agent" });
    return { repos, draftId: r.draftId, add };
  }

  it("moves only the versions the Hub recorded, re-checked by account and Message-ID; never the owner's draft of the thread", async () => {
    const { repos, draftId, add } = await recorded();
    const older = mail("139700", "older");
    await add(older);
    await add(hubs);
    const m = new FakeMailer([older, hubs, owners]);
    const r = await trashThread({ mailer: m, repos }, draftId);
    expect(r.moved.sort()).toEqual([hubs.messageId, older.messageId].sort());
    expect(m.drafts.map((d) => d.ref)).toEqual(["139800"]);
    expect((await repos.mailVersions.ofDraft(draftId)).every((v) => v.trashedAt !== null)).toBe(true);
    // Already trashed: a second Skip moves nothing.
    expect(await trashThread({ mailer: m, repos }, draftId)).toEqual({ moved: [], refused: [] });
  });

  it("keeps the Message-ID it is told to keep, and a recorded version in another account is refused there", async () => {
    const { repos, draftId, add } = await recorded();
    await add(hubs);
    const moved = mail("139712", "same id, but now in another account", { account: "other@x" });
    const m = new FakeMailer([moved]);
    expect(await trashThread({ mailer: m, repos }, draftId, hubs.messageId)).toEqual({ moved: [], refused: [] });
    expect(await trashThread({ mailer: m, repos }, draftId)).toEqual({ moved: [], refused: [hubs.messageId] });
    expect(m.drafts).toHaveLength(1);
    expect((await repos.mailVersions.ofDraft(draftId))[0]?.trashedAt).toBeNull();
  });
});
