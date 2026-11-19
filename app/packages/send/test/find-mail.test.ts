import { describe, expect, it } from "vitest";
import { FakeMailer, type MailDraft } from "../src/mailer";
import { findMail } from "../src/send";

// P53: the card shows one version of a draft Mail holds twice; Send, the dry run and Checked still never pick one.
const THREAD = "CALatTu3bWeg=2Q@mail.gmail.com";
const mail = (ref: string, body: string): MailDraft => ({ ref, messageId: `${ref}@reforms.ai`, account: "hello@x", sender: "hello@x", to: ["mark@example.com"], cc: [], bcc: [], subject: "Re: Hello", body, attachments: 0 });
const draft = { mailRef: `<${THREAD}>`, subject: "Re: Hello", toAddr: "mark@example.com" };
const marked = mail("139712", `[hub-draft thread=${THREAD}]\nHi Mark,\n\nWarmer.`);
const old = mail("138996", "[Reforms draft, run 3]\nHi Mark, old.");
const newerUnmarked = mail("139800", "Hi Mark, edited by hand.");

describe("findMail", () => {
  it("strict refuses two versions, whatever they carry", async () => {
    const f = await findMail({ mailer: new FakeMailer([old, marked]) }, draft);
    expect(f.mail).toBeUndefined();
    expect(f.reason).toMatch(/2 drafts in Mail match/);
  });

  it("show picks the one with this thread's marker (case kept by Mail, ignored here) and says what to delete", async () => {
    const f = await findMail({ mailer: new FakeMailer([marked, old, newerUnmarked]) }, draft, "show");
    expect(f.mail?.ref).toBe("139712");
    expect(f.note).toMatch(/^Mail holds 3 versions of this draft\. Shown: the agent's version .*Mail id 139712\. Delete the others in Mail \(Mail id 138996, 139800\); until then it cannot be Checked or sent\.$/);
  });

  it("show falls back to the newest when no version, or several, carry the marker", async () => {
    const f = await findMail({ mailer: new FakeMailer([old, newerUnmarked]) }, draft, "show");
    expect(f.mail?.ref).toBe("139800");
    expect(f.note).toMatch(/Shown: the newest, Mail id 139800\. Delete the other in Mail \(Mail id 138996\)/);
  });

  it("one version: no note, in either mode", async () => {
    for (const mode of ["strict", "show"] as const) {
      const f = await findMail({ mailer: new FakeMailer([marked]) }, draft, mode);
      expect(f.mail?.ref).toBe("139712");
      expect(f.note).toBeUndefined();
    }
  });
});
