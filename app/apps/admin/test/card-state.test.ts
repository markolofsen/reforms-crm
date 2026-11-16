import { describe, expect, it } from "vitest";
import { CARD_STATES, hasSwitch, primaryFor, secondaryFor, stateOf, type Context } from "../src/features/review/card/card-state";

import type { ReviewDraft } from "../src/features/review/source";
import { tickBlock, type MailRead } from "../src/features/review/mail/tick-guard";

const ctx: Context = { name: "Marta", hasMailLink: true, acknowledged: true };

describe("the review card state table", () => {
  it("covers the 16 states of research 16 section 7", () => {
    expect(CARD_STATES).toHaveLength(16);
    expect(new Set(CARD_STATES).size).toBe(16);
  });

  it.each(CARD_STATES)("%s has at most one primary and at most two visible secondaries", (state) => {
    const primary = primaryFor(state, ctx);
    expect(primary === null || typeof primary.label === "string").toBe(true);
    expect(secondaryFor(state).length).toBeLessThanOrEqual(2);
  });

  it.each(CARD_STATES)("%s never repeats an action between primary and secondary", (state) => {
    const primary = primaryFor(state, ctx);
    if (primary?.action === "open_mail") expect(secondaryFor(state)).not.toContain("open_mail");
  });

  it("a disabled primary always says why (a screen reader reads the reason)", () => {
    for (const state of CARD_STATES) {
      for (const acknowledged of [true, false]) {
        const primary = primaryFor(state, { ...ctx, acknowledged });
        if (primary && !primary.enabled && !primary.busy) expect(primary.reason).toBeTruthy();
      }
    }
  });

  it("the primary in the states that cannot send is Open in Mail, or a plain Copy when there is no link", () => {
    for (const state of ["suspicious", "no_contact", "unreadable"] as const) {
      expect(primaryFor(state, ctx)?.label).toBe("Open in Mail");
      expect(primaryFor(state, { ...ctx, hasMailLink: false })?.label).toBe("Copy subject to find in Mail");
    }
  });

  it("the switch is only where a send can follow", () => {
    expect(CARD_STATES.filter(hasSwitch)).toEqual(["checks_open", "unread", "acknowledged", "batch", "failed"]);
  });
});

describe("a draft Mail cannot show (P27 M3.1)", () => {
  const draft = { status: "ready", checked: true, batchId: null, injectionSuspected: false, sendState: null, client: { marks: [] }, safetyResults: [] } as unknown as ReviewDraft;

  it("is unreadable, with no switch and Open in Mail as the way on, even when it was Checked before", () => {
    expect(stateOf(draft, "idle", false)).toBe("unreadable");
    expect(stateOf(draft, "idle", true)).toBe("acknowledged");
    expect(hasSwitch("unreadable")).toBe(false);
  });

  it("a mail the server was never asked to read (Mail-only mode) is not unreadable", () => {
    expect(stateOf({ ...draft, checked: false }, "idle")).toBe("unread");
  });
});

describe("Checked fails closed (decision 0013): the switch and the C key hold one guard", () => {
  const base = { status: "ready", checked: false, batchId: null, injectionSuspected: false, sendState: null, client: { marks: [] }, safetyResults: [] } as unknown as ReviewDraft;
  const read = (o: Partial<MailRead> = {}): MailRead => ({ configured: true, found: true, hash: "a".repeat(64), reason: null, ...o });

  it("allows a draft whose text was read and hashed", () => {
    expect(tickBlock(base, read())).toBeNull();
  });

  it("refuses an unreadable draft, with Mail's reason", () => {
    expect(tickBlock(base, read({ found: false, hash: null, reason: "Mail has no such draft" }))).toMatch(/Mail could not be read: Mail has no such draft/);
  });

  it("refuses a draft with no text hash: found without a hash, not read yet, or a server with no Mailer", () => {
    expect(tickBlock(base, read({ hash: null }))).toMatch(/no hash/);
    expect(tickBlock(base, undefined)).toMatch(/being read/);
    expect(tickBlock(base, read({ configured: false, found: false, hash: null }))).toMatch(/cannot read Mail/);
  });

  it("switching OFF is always allowed, even when Mail can no longer be read", () => {
    expect(tickBlock({ ...base, checked: true }, read({ found: false, hash: null }))).toBeNull();
  });

  it("a batch draft has no Mail draft to hash and stays checkable; a draft on hold or suspicious is not", () => {
    expect(tickBlock({ ...base, batchId: 3 }, undefined)).toBeNull();
    expect(tickBlock({ ...base, status: "hold" }, read())).toMatch(/nothing to check/);
    expect(tickBlock({ ...base, injectionSuspected: true }, read())).toMatch(/nothing to check/);
  });
});
