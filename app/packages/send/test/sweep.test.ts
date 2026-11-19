import { describe, expect, it } from "vitest";
import type { MailVersionRow } from "@hub/db";
import type { DraftHead } from "../src/mailer";
import { planSweep } from "../src/sweep";

// P65 verdict 10: the sweep lists only drafts the Hub's record (`mail_versions`) says it wrote, by account and
// Message-ID, from Mail's headers alone. The shape follows the census of 2026-11-19: hub drafts beside the owner's own
// drafts with the same subjects and recipients, and a text that still quotes a hub line.
const h = (ref: string, account: string, messageId: string | null, subject = "Re: Hello"): DraftHead => ({ ref, messageId, account, subject, inReplyTo: "t1@mail.gmail.com" });
let id = 0;
const v = (draftId: number | null, account: string, messageId: string): MailVersionRow => ({ id: ++id, project: "saas", mailRef: "t1@mail.gmail.com", draftId, account, mailId: 0, messageId, hash: "h", source: "agent", signatureFallback: null, writtenAt: "2026-11-19T00:00:00.000Z", trashedAt: null });

const versions: MailVersionRow[] = [
  v(1, "hello@reforms.ai", "V1@reforms.ai"),
  v(1, "hello@reforms.ai", "V2@reforms.ai"),
  v(2, "hello@reforms.ai", "C1@reforms.ai"),
  v(null, "hello@reforms.ai", "U1@reforms.ai"),
  v(3, "dan@realty.example", "R1@realty.example"),
];
const drafts: DraftHead[] = [
  h("100", "hello@reforms.ai", "v1@reforms.ai"),
  h("105", "hello@reforms.ai", "V2@reforms.ai"),
  h("106", "hello@reforms.ai", "OWN@reforms.ai"),
  h("107", "hello@reforms.ai", null),
  h("110", "hello@reforms.ai", "C1@reforms.ai", "Re: Closed"),
  h("111", "hello@reforms.ai", "U1@reforms.ai"),
  h("120", "dan@realty.example", "R1@realty.example", "Re: Punta Cana"),
  h("130", "other@reforms.ai", "V1@reforms.ai"),
];

describe("planSweep (P65)", () => {
  const rows = planSweep(drafts, { accounts: ["hello@reforms.ai"], versions, closed: new Set([2]) });
  const by = Object.fromEntries(rows.map((r) => [r.ref, r.kind]));

  it("lists an older recorded version and the versions of a closed draft, and keeps the newest version", () => {
    expect(by).toEqual({ "100": "superseded", "110": "closed" });
  });

  it("never lists a draft the Hub did not record, a version not yet linked to a draft, or the same Message-ID in another account", () => {
    for (const ref of ["105", "106", "107", "111", "130"]) expect(by[ref]).toBeUndefined();
  });

  it("judges only the project's accounts; each row carries the Message-ID the move re-checks and the version it matched", () => {
    expect(by["120"]).toBeUndefined();
    expect(planSweep(drafts, { accounts: ["dan@realty.example"], versions, closed: new Set([3]) }).map((r) => r.ref)).toEqual(["120"]);
    expect(rows.find((r) => r.ref === "100")).toMatchObject({ messageId: "v1@reforms.ai", versionId: versions[0]?.id });
  });
});

describe("planSweep: the newest is Mail's newest (P65 S5)", () => {
  it("an adopted late save recorded after a newer version is the older one, by Mail's id", () => {
    const newer = v(9, "hello@reforms.ai", "A76C@reforms.ai");
    const late = v(9, "hello@reforms.ai", "0DD9@reforms.ai");
    const rows = planSweep([h("139868", "hello@reforms.ai", "A76C@reforms.ai"), h("139858", "hello@reforms.ai", "0DD9@reforms.ai")], { accounts: ["hello@reforms.ai"], versions: [newer, late], closed: new Set() });
    expect(rows.map((r) => [r.ref, r.kind])).toEqual([["139858", "superseded"]]);
  });
});
