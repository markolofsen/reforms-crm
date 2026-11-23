import { describe, expect, it } from "vitest";
import type { DraftMailDto } from "@hub/contract/mail";
import { differsFromShown, sendLoading, sendProblems, shownResults, type SendReviewInput } from "../src/features/mail/draft/send/send-review";

// P105: what the review dialog of one Mail Send lists, and when its Send may apply the dry run.
const read = (o: Partial<DraftMailDto> = {}): DraftMailDto => ({ configured: true, found: true, reason: null, note: null, from: "hello@x.example", to: ["anna@y.example"], cc: [], subject: "Re: Hi", body: "b", hash: "h", safetyResults: [], readAt: "2026-11-23T00:00:00.000Z", ...o });
const base = (o: Partial<SendReviewInput> = {}): SendReviewInput => ({ d: { safetyResults: [], safety: null, status: "ready", repliedElsewhere: null, teamSent: null } as unknown as SendReviewInput["d"], mail: read(), readError: null, changedUnder: false, refused: [], ...o });
const kinds = (i: SendReviewInput) => sendProblems(i).map((p) => [p.key, p.severity, p.fix]);

describe("the Send review's problems", () => {
  it("a clean draft read from Mail has none, and the dialog does not wait", () => {
    expect(sendProblems(base())).toEqual([]);
    expect(sendLoading(base())).toBeNull();
  });

  it("waits, in words, while the card reads Mail; a failed read is a blocker with Read it again", () => {
    expect(sendLoading(base({ mail: undefined }))).toBe("Reading the draft from Mail.");
    expect(kinds(base({ mail: undefined, readError: "Cannot reach the local server." }))).toEqual([["read-error", "blocker", "read"]]);
  });

  it("two drafts in Mail (saas draft 5, 2026-11-21) are a blocker whose fix is Tidy, never a toggle that will not move", () => {
    expect(kinds(base({ mail: read({ hash: null, note: "Mail holds 2 drafts that answer this message" }) }))).toEqual([["versions", "blocker", "tidy"]]);
  });

  it("an open check is a warning with its rule; a red one says so; a placeholder blocks whatever was read", () => {
    const mail = read({ safetyResults: [
      { kind: "already_sent_recently", level: "amber", text: "Written 3 days ago", acked: false },
      { kind: "risky_word", level: "red", text: "guarantee", acked: false },
      { kind: "unresolved_marker", level: "red", text: "[name] is left", acked: false },
      { kind: "cc_present", level: "amber", text: "Cc", acked: true },
    ] });
    const p = sendProblems(base({ mail }));
    expect(p.map((x) => [x.key, x.severity, x.rule])).toEqual([
      ["check-already_sent_recently", "warning", "Already written to recently"],
      ["check-risky_word", "warning", "Red check · Risky words"],
      ["check-unresolved_marker", "blocker", "Unresolved placeholder"],
    ]);
    // An acknowledged check is not listed again.
    expect(shownResults({ d: base().d, mail }).map((r) => r.kind)).not.toContain("cc_present");
  });

  it("a change by the agent and a refused confirm are blockers with Read it again", () => {
    expect(kinds(base({ changedUnder: true, refused: ["Stop all is on"] }))).toEqual([["changed", "blocker", "read"], ["refused-0", "blocker", "read"]]);
  });
});

describe("the apply sends what the dialog showed", () => {
  it("the same recipients and subject, in any case or order, pass; another one is refused in words", () => {
    const shown = { to: ["Anna@y.example", "b@y.example"], cc: [], subject: "Re: Hi" };
    expect(differsFromShown(shown, { to: ["b@y.example", "anna@y.example"], cc: [], subject: "Re: Hi" })).toBeNull();
    expect(differsFromShown(shown, { to: ["anna@y.example"], cc: [], subject: "Re: Hi" })).toMatch(/Mail changed while you read/);
    expect(differsFromShown(shown, { ...shown, subject: "Re: Hello" })).toMatch(/read it again/);
  });
});
