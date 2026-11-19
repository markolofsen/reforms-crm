import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, versionHashOf, type DbHandle } from "@hub/db";
import { FakeMailer, type MailDraft } from "../src/mailer";
import { settleThread } from "../src/settle";

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

  it("never moves anything when the Hub has no second version in the thread", async () => {
    const repos = createRepos(h.db);
    const rec = await repos.drafts.record({ project: "saas", email: "mark@x.example", name: "Mark", subject: "Re: Hello", mailRef: "<t1@mail.gmail.com>", reason: "asked", skill: "triage-mail" });
    await repos.mailVersions.add({ project: "saas", mailRef: "t1@mail.gmail.com", draftId: rec.draftId, account: "hello@reforms.ai", mailId: 139868, messageId: "M139868@reforms.ai", hash: versionHashOf("Hi"), source: "agent" });
    const mailer = new FakeMailer([d("139868", "Hi"), d("139900", "My own reply.")]);
    expect(await settleThread({ mailer, repos }, rec_(rec.draftId), ["hello@reforms.ai"])).toEqual({ adopted: [], moved: [], refused: [] });
    expect(mailer.drafts).toHaveLength(2);
  });
});

function rec_(id: number) {
  return { id, project: "saas", mailRef: "t1@mail.gmail.com", subject: "Re: Hello", toAddr: "mark@x.example" };
}
