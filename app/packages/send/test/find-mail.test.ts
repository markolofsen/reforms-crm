import { describe, expect, it } from "vitest";
import { FakeMailer, type MailDraft } from "../src/mailer";
import { findMail, trashThread } from "../src/send";

// P53 and P56: the marker decides which Mail draft is the hub draft; other drafts of the subject are named, never picked.
const THREAD = "CALatTu3bWeg=2Q@mail.gmail.com";
const mail = (ref: string, body: string, account = "hello@x"): MailDraft => ({ ref, messageId: `${ref}@reforms.ai`, account, sender: "hello@x", to: ["mark@example.com"], cc: [], bcc: [], subject: "Re: Hello", body, attachments: 0 });
const draft = { mailRef: `<${THREAD}>`, subject: "Re: Hello", toAddr: "mark@example.com" };
// Mail's text of 139770 began with an empty line (2026-11-19): the marker is the first NON-EMPTY line.
const marked = mail("139712", `\n[hub-draft thread=${THREAD}]\nHi Mark,\n\nWarmer.`);
const old = mail("138996", "[Reforms draft, run 07a63131a4d4. Delete this line before sending.]\nHi Mark, old.");
const own = mail("139800", "Hi Mark, written by hand.");

describe("findMail: the marker decides (P56)", () => {
  it("one marked draft is the draft in both modes, the others are named in aside and never picked", async () => {
    for (const mode of ["strict", "show"] as const) {
      const f = await findMail({ mailer: new FakeMailer([old, marked, own]) }, draft, mode);
      expect(f.mail?.ref).toBe("139712");
      expect(f.note).toBeUndefined();
      expect(f.aside).toMatch(/2 other drafts .* \(Mail id 138996, 139800\): left alone/);
    }
  });

  it("a marker in the middle of a text, or of another thread, is not this thread's draft", async () => {
    const quoted = mail("139900", `Hi,\n[hub-draft thread=${THREAD}]\nquoted`);
    const other = mail("139901", "[hub-draft thread=other@x]\nHi");
    const f = await findMail({ mailer: new FakeMailer([quoted, other]) }, draft);
    expect(f.mail).toBeUndefined();
    expect(f.reason).toMatch(/2 drafts in Mail match .* none carries the Hub's marker/);
  });

  it("two marked versions: strict waits, show shows the newest without a hash", async () => {
    const newer = mail("139713", `[hub-draft thread=${THREAD}]\nHi Mark, newer.`);
    const strict = await findMail({ mailer: new FakeMailer([marked, newer]) }, draft);
    expect(strict.reason).toMatch(/Mail holds 2 versions the Hub wrote .*newest: Mail id 139713/);
    const show = await findMail({ mailer: new FakeMailer([marked, newer]) }, draft, "show");
    expect(show.mail?.ref).toBe("139713");
    expect(show.note).toMatch(/cannot be Checked or sent/);
  });

  it("none marked: one candidate is the draft (as before P56); several show the newest with a note", async () => {
    expect((await findMail({ mailer: new FakeMailer([own]) }, draft)).mail?.ref).toBe("139800");
    const f = await findMail({ mailer: new FakeMailer([old, own]) }, draft, "show");
    expect(f.mail?.ref).toBe("139800");
    expect(f.note).toMatch(/none was written by the Hub for this thread/);
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

describe("trashThread (P56)", () => {
  it("moves only this thread's marked drafts in the project's accounts, never the owner's or another account's", async () => {
    const elsewhere = mail("139714", `[hub-draft thread=${THREAD}]\nHi`, "someone@else");
    const m = new FakeMailer([marked, old, own, elsewhere]);
    const r = await trashThread({ mailer: m }, draft, ["HELLO@x"]);
    expect(r).toEqual({ moved: ["139712"], refused: [] });
    expect(m.drafts.map((d) => d.ref).sort()).toEqual(["138996", "139714", "139800"]);
    expect(m.trash.map((d) => d.ref)).toEqual(["139712"]);
  });

  it("keeps the id it is told to keep, and does nothing without a mailRef", async () => {
    const m = new FakeMailer([marked]);
    expect(await trashThread({ mailer: m }, draft, ["hello@x"], "139712")).toEqual({ moved: [], refused: [] });
    expect(await trashThread({ mailer: m }, { ...draft, mailRef: null }, ["hello@x"])).toEqual({ moved: [], refused: [] });
    expect(m.drafts).toHaveLength(1);
  });

  it("the fake refuses a draft whose text no longer starts with the line it was judged by", async () => {
    const m = new FakeMailer([marked]);
    expect(await m.trashDrafts([{ ref: "139712", line: "[hub-draft thread=other@x]" }])).toEqual({ moved: [], refused: ["139712"] });
  });
});
