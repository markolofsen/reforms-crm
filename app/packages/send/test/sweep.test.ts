import { describe, expect, it } from "vitest";
import type { MailDraft } from "../src/mailer";
import { planSweep } from "../src/sweep";

// P56 S0: the sweep lists only drafts the hub's own text proves it wrote. The shape is the census of 2026-11-19: hub
// drafts beside the owner's own drafts with the same subjects and recipients.
const d = (ref: string, account: string, subject: string, body: string): MailDraft => ({ ref, messageId: null, account, sender: account, to: ["c@x.example"], cc: [], bcc: [], subject, body, attachments: 0 });
const T = "t1@mail.gmail.com";

const drafts: MailDraft[] = [
  d("100", "hello@reforms.ai", "Re: Hello", `[hub-draft thread=${T}]\nv1`),
  d("105", "hello@reforms.ai", "Re: Hello", `\n[hub-draft thread=${T}]\nv2`),
  d("106", "hello@reforms.ai", "Re: Hello", "Hi, my own reply with the same subject"),
  d("107", "hello@reforms.ai", "Re: Hello", `Hi,\n[hub-draft thread=${T}]\nquoted in the middle`),
  d("110", "hello@reforms.ai", "Re: Closed", "[hub-draft thread=closed@x]\nskipped one"),
  d("120", "dan@realty.example", "Re: Punta Cana", "[hub-draft thread=r1@x]\nrealty's own"),
  d("121", "dan@realty.example", "Re: Punta Cana", "[hub-draft thread=r1@x]\nrealty's newer"),
  d("138902", "markolofsen@gmail.com", "Re: lead", "[Reforms draft, run 07a63131a4d4. Sources: none. Delete this line before sending.]\nHi"),
  d("138903", "markolofsen@gmail.com", "Re: lead", "Hi,\n[Reforms draft, run 07a63131a4d4.] mentioned in the middle"),
];

describe("planSweep", () => {
  const rows = planSweep(drafts, { accounts: ["hello@reforms.ai"], closed: new Set(["closed@x"]) });
  const by = Object.fromEntries(rows.map((r) => [r.ref, r.kind]));

  it("lists an older version, a closed thread and a pre-marker draft, and keeps the newest version", () => {
    expect(by).toEqual({ "100": "superseded", "110": "closed", "138902": "legacy" });
  });

  it("never lists a draft without a hub first line, whatever its subject or recipient", () => {
    for (const ref of ["106", "107", "138903"]) expect(by[ref]).toBeUndefined();
  });

  it("judges marked drafts only in the project's accounts; the legacy line in every account", () => {
    expect(by["120"]).toBeUndefined();
    expect(planSweep(drafts, { accounts: ["dan@realty.example"], closed: new Set() }).map((r) => r.ref).sort()).toEqual(["120", "138902"]);
  });

  it("each row carries the first line the move re-checks", () => {
    expect(rows.find((r) => r.ref === "100")?.line).toBe(`[hub-draft thread=${T}]`);
    expect(rows.find((r) => r.ref === "138902")?.line).toMatch(/^\[Reforms draft, run 07a63131a4d4\./);
  });
});
