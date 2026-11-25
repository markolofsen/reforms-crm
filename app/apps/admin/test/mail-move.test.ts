import { describe, expect, it } from "vitest";
import { MAIL_ACTION_KEYS } from "../src/features/mail/list/keys";
import { chipsOf } from "../src/features/mail/list/row";
import type { ConversationRow } from "../src/features/mail/model";

// P147 3n: Spam and Delete of a person's newest mail. The list shows the pass's phishing judgement as a chip, and the keys `!`
// and `#` (Backspace too) are listed beside Mail's other action keys; J stays next conversation.

const row = (o: Partial<ConversationRow> = {}): ConversationRow =>
  ({ client: { id: 1, name: "Helpdesk", email: "helpdesk@phish.example" }, state: "wrote", at: "2026-11-25T10:00:00Z", subject: "Access Renewal", preview: "", brands: [], inboundId: 7, draft: null, theirLastAt: null, ourLastAt: null, agent: null, junk: null, ...o }) as ConversationRow;

describe("Spam and Delete in the list (P147 3n)", () => {
  it("N6: a message judged phishing or junk carries the Phishing? chip; an ordinary one does not", () => {
    expect(chipsOf(row({ junk: "impersonates IT to get a sign-in" })).map((c) => c.id)).toContain("phishing");
    expect(chipsOf(row({ junk: "" })).map((c) => c.text)).toContain("Phishing?");
    expect(chipsOf(row()).map((c) => c.id)).not.toContain("phishing");
  });

  it("N2: the keys are ! for Spam and # or Backspace for Delete, and none of them takes J", () => {
    const keys = MAIL_ACTION_KEYS.map(([k]) => k);
    expect(keys).toContain("!");
    expect(keys).toContain("#, Backspace");
    expect(keys.some((k) => /^J\b/.test(k))).toBe(false);
  });
});
