import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, versionHashOf, type DbHandle } from "@hub/db";
import { FakeMailer, type MailDraft } from "../src/mailer";
import { settleThread } from "../src/settle";
import { runSweep } from "../src/sweep";

// P65 S5 (decision 0031 addendum points 2 and 3), shaped like saas draft 1 on 2026-11-19: the Hub's recorded version
// 139868, its second save 139858 (same text, unrecorded), a late save of an earlier write, Mail's empty reply shell, and
// a draft the owner wrote. The card's read adopts the Hub's and keeps the newest; the owner's is never touched.
let dir: string;
let h: DbHandle;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-settle-"));
  h = openDb(path.join(dir, "app.db"));
});
afterEach(() => {
  h.close();
  rmSync(dir, { recursive: true, force: true });
});

const d = (ref: string, body: string, o: Partial<MailDraft> = {}): MailDraft => ({ ref, messageId: `M${ref}@reforms.ai`, account: "hello@reforms.ai", inReplyTo: "t1@mail.gmail.com", sender: "hello@reforms.ai", to: ["mark@x.example"], cc: [], bcc: [], subject: "Re: Hello", body, attachments: 0, ...o });

describe("settleThread (P65 S5)", () => {
  it("adopts the Hub's late and second saves, keeps Mail's newest, moves the others; the owner's draft and a lone draft stay", async () => {
    const repos = createRepos(h.db);
    const rec = await repos.drafts.record({ project: "saas", email: "mark@x.example", name: "Mark", subject: "Re: Hello", mailRef: "<t1@mail.gmail.com>", reason: "asked", skill: "triage-mail" });
    const sarcasm = "\nСарказм, мой друг.\n\nOn 14 Nov, Mark wrote:\n> q";
    await repos.mailVersions.add({ project: "saas", mailRef: "t1@mail.gmail.com", draftId: rec.draftId, account: "hello@reforms.ai", mailId: 139868, messageId: "M139868@reforms.ai", hash: versionHashOf(sarcasm), source: "agent" });
    const w = await repos.mailWrites.start({ project: "saas", mailRef: "t1@mail.gmail.com", draftId: rec.draftId, text: "Пушкин, мой друг." });
    await repos.mailWrites.shell(w, "\n\nOn 14 Nov, Mark wrote:\nq");
    const mailer = new FakeMailer([
      d("139868", sarcasm),
      d("139858", sarcasm),
      d("139838", "\nПушкин, мой друг.\n\nOn 14 Nov, Mark wrote:\n> q"),
      d("139835", "\n\nOn 14 Nov, Mark wrote:\nq\n"),
      d("139900", "My own reply, typed in Mail."),
      d("139901", "Another thread", { inReplyTo: "other@x" }),
    ]);
    const r = await settleThread({ mailer, repos }, rec_(rec.draftId), ["hello@reforms.ai"]);
    expect(r.adopted.sort()).toEqual(["139835", "139838", "139858"]);
    expect(r.moved.sort()).toEqual(["M139835@reforms.ai", "M139838@reforms.ai", "M139858@reforms.ai"]);
    expect(mailer.drafts.map((x) => x.ref).sort()).toEqual(["139868", "139900", "139901"]);
    const live = (await repos.mailVersions.ofDraft(rec.draftId)).filter((v) => !v.trashedAt);
    expect(live.map((v) => v.mailId)).toEqual([139868]);
    expect((await repos.mailWrites.ofThread("saas", "t1@mail.gmail.com"))[0]?.settledAt).not.toBeNull();
    // Nothing more to do: a second read changes nothing.
    expect(await settleThread({ mailer, repos }, rec_(rec.draftId), ["hello@reforms.ai"])).toEqual({ adopted: [], moved: [], refused: [] });
  });

  it("Mail's empty reply with no write row (saas 139835) goes to Trash with the Hub's older versions, known from the answered message", async () => {
    const repos = createRepos(h.db);
    const rec = await repos.drafts.record({ project: "saas", email: "mark@x.example", name: "Mark", subject: "Re: Hello", mailRef: "<t1@mail.gmail.com>", reason: "asked", skill: "triage-mail" });
    await repos.mailVersions.add({ project: "saas", mailRef: "t1@mail.gmail.com", draftId: rec.draftId, account: "hello@reforms.ai", mailId: 139868, messageId: "M139868@reforms.ai", hash: versionHashOf("Hi"), source: "agent" });
    const mailer = new FakeMailer([d("139868", "Hi"), d("139835", "\n\nOn 14 Nov 2026, Mark wrote:\nHow are you?\n\n"), d("139900", "My own reply.")]);
    const r = await settleThread({ mailer, repos, original: async () => "How are you?\n" }, rec_(rec.draftId), ["hello@reforms.ai"]);
    expect(r).toMatchObject({ adopted: ["139835"], moved: ["M139835@reforms.ai"] });
    expect(mailer.drafts.map((x) => x.ref).sort()).toEqual(["139868", "139900"]);
  });

  it("P83: a thread of shells only (saas 2026-11-20: refused writes left empty drafts and Mail's empty replies) is emptied; the owner's draft stays", async () => {
    const repos = createRepos(h.db);
    const rec = await repos.drafts.record({ project: "saas", email: "mark@x.example", name: "Mark", subject: "Re: Hello", mailRef: "<t1@mail.gmail.com>", reason: "asked", skill: "triage-mail" });
    await repos.mailWrites.start({ project: "saas", mailRef: "t1@mail.gmail.com", draftId: rec.draftId, text: "Отговорила роща золотая" });
    const mailer = new FakeMailer([d("140019", "\n\n"), d("140026", "\n\n"), d("140037", "\n\nOn 14 Nov 2026, Mark wrote:\nHow are you?\n\n"), d("139900", "My own reply.")]);
    const r = await settleThread({ mailer, repos, original: async () => "How are you?\n" }, rec_(rec.draftId), ["hello@reforms.ai"]);
    expect(r.adopted.sort()).toEqual(["140019", "140026", "140037"]);
    expect(r.moved.sort()).toEqual(["M140019@reforms.ai", "M140026@reforms.ai", "M140037@reforms.ai"]);
    expect(mailer.drafts.map((x) => x.ref)).toEqual(["139900"]);
  });

  it("never moves anything when the Hub has no second version in the thread", async () => {
    const repos = createRepos(h.db);
    const rec = await repos.drafts.record({ project: "saas", email: "mark@x.example", name: "Mark", subject: "Re: Hello", mailRef: "<t1@mail.gmail.com>", reason: "asked", skill: "triage-mail" });
    await repos.mailVersions.add({ project: "saas", mailRef: "t1@mail.gmail.com", draftId: rec.draftId, account: "hello@reforms.ai", mailId: 139868, messageId: "M139868@reforms.ai", hash: versionHashOf("Hi"), source: "agent" });
    const mailer = new FakeMailer([d("139868", "Hi"), d("139900", "My own reply.")]);
    expect(await settleThread({ mailer, repos }, rec_(rec.draftId), ["hello@reforms.ai"])).toEqual({ adopted: [], moved: [], refused: [] });
    expect(mailer.drafts).toHaveLength(2);
  });
});

// P90 (brief item 5): two people, one shared mailbox in Apple Mail, each with their own Hub. Each Hub moves or adopts only the
// versions it recorded: my settle and my sweep never touch my teammate's draft in the same thread, though its account,
// thread, recipient and subject are the same as mine.
describe("P90 two Hubs, one Mail", () => {
  it("my settle and my sweep leave my teammate's draft in the shared mailbox alone", async () => {
    const mine = createRepos(h.db);
    const other = openDb(path.join(dir, "teammate.db"));
    try {
      const theirs = createRepos(other.db);
      const a = await mine.drafts.record({ project: "saas", email: "mark@x.example", name: "Mark", subject: "Re: Hello", mailRef: "<t1@mail.gmail.com>", skill: "triage-mail" });
      const b = await theirs.drafts.record({ project: "saas", email: "mark@x.example", name: "Mark", subject: "Re: Hello", mailRef: "<t1@mail.gmail.com>", skill: "triage-mail" });
      await mine.mailVersions.add({ project: "saas", mailRef: "t1@mail.gmail.com", draftId: a.draftId, account: "hello@reforms.ai", mailId: 200, messageId: "M200@reforms.ai", hash: versionHashOf("Mine."), source: "agent" });
      await theirs.mailVersions.add({ project: "saas", mailRef: "t1@mail.gmail.com", draftId: b.draftId, account: "hello@reforms.ai", mailId: 201, messageId: "M201@reforms.ai", hash: versionHashOf("Theirs."), source: "agent" });
      const mailer = new FakeMailer([d("200", "Mine."), d("201", "Theirs.")]);
      expect(await settleThread({ mailer, repos: mine }, rec_(a.draftId), ["hello@reforms.ai"])).toEqual({ adopted: [], moved: [], refused: [] });
      // I close mine: my sweep moves my version only.
      await mine.drafts.setStatus(a.draftId, "skipped");
      const r = await runSweep({ mailer, repos: mine }, { project: "saas", accounts: ["hello@reforms.ai"], apply: true });
      expect(r.rows.map((x) => x.ref)).toEqual(["200"]);
      expect(mailer.drafts.map((x) => x.ref)).toEqual(["201"]);
      // My teammate's sweep sees nothing of theirs to move (their draft is open).
      expect((await runSweep({ mailer, repos: theirs }, { project: "saas", accounts: ["hello@reforms.ai"], apply: false })).rows).toEqual([]);
    } finally {
      other.close();
    }
  });
});

function rec_(id: number) {
  return { id, project: "saas", mailRef: "t1@mail.gmail.com", subject: "Re: Hello", toAddr: "mark@x.example" };
}
