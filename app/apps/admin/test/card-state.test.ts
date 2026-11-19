import { describe, expect, it } from "vitest";
import { CARD_STATES, hasSwitch, primaryFor, secondaryFor, stateOf, type Context } from "../src/features/review/card/card-state";

import type { ReviewDraft } from "../src/features/review/source";
import { tickBlock, type MailRead } from "../src/features/review/mail/tick-guard";

const ctx: Context = { name: "Marta", hasMailLink: true, hasDraftLink: false, acknowledged: true };

describe("the review card state table", () => {
  it("covers the 16 states of research 16 section 7, plus follow_up (P47)", () => {
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

  it("the primary in the states that cannot send opens the draft in Mail (P58 R1), else the client's mail, or a plain Copy when there is no link", () => {
    for (const state of ["suspicious", "no_contact", "unreadable", "follow_up"] as const) {
      expect(primaryFor(state, { ...ctx, hasDraftLink: true })?.label).toBe("Open draft in Mail");
      expect(primaryFor(state, ctx)?.label).toBe("Open the client's mail");
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

describe("a follow-up step (P47) is sent from Mail, never by the hub", () => {
  const step = { status: "ready", checked: true, batchId: null, injectionSuspected: false, sendState: null, client: { marks: [] }, safetyResults: [], sequence: { enrollmentId: 4, sequence: "s", step: 2, steps: 3, state: "active" } } as unknown as ReviewDraft;

  it("is follow_up even when Checked, with Open in Mail as the one primary, Skip beside it and no switch", () => {
    expect(stateOf(step, "idle")).toBe("follow_up");
    expect(primaryFor("follow_up", ctx)?.action).toBe("open_mail");
    expect(secondaryFor("follow_up")).toEqual(["skip"]);
    expect(hasSwitch("follow_up")).toBe(false);
  });

  it("do not contact still wins over a step, and a finished step is just finished", () => {
    expect(stateOf({ ...step, client: { marks: ["do_not_contact"] } } as unknown as ReviewDraft, "idle")).toBe("no_contact");
    expect(stateOf({ ...step, status: "sent" } as unknown as ReviewDraft, "idle")).toBe("sent");
  });
});

describe("no batch_waiting state (P48: the batch builder is gone, nothing queues a batch)", () => {
  it("is not a card state", () => {
    expect(CARD_STATES).not.toContain("batch_waiting");
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
    expect(tickBlock(base, read({ found: false, hash: null, reason: '2 drafts in Mail match subject "Re: Hi" for a@b.c: keep the newest' }))).toMatch(/^Mail holds more than one version of this draft: 2 drafts in Mail match/);
  });

  it("refuses a draft with no text hash: found without a hash, not read yet, or a server with no Mailer", () => {
    expect(tickBlock(base, read({ hash: null }))).toMatch(/no hash/);
    // P53: Mail holds two versions; the card shows one, the tick names the note, never Checked.
    expect(tickBlock(base, read({ hash: null, note: "Mail holds 2 versions of this draft. Shown: the newest." }))).toBe("Mail holds 2 versions of this draft. Shown: the newest.");
    expect(tickBlock(base, undefined)).toMatch(/being read/);
    expect(tickBlock(base, read({ configured: false, found: false, hash: null }))).toMatch(/cannot read Mail/);
  });

  it("a failed read of Mail is named with its cause, never \"being read\" forever", () => {
    const text = tickBlock(base, undefined, "idle", "Cannot reach the local server.");
    expect(text).toMatch(/could not be read from Mail: Cannot reach the local server\./);
    expect(text).not.toMatch(/being read/);
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

describe("Open draft in Mail (P58 R1)", async () => {
  const { draftLinkOf } = await import("../src/features/review/mail/tick-guard");
  const read = { configured: true, found: true, reason: null, note: null, from: "hello@x.example", messageId: "A3F4@x.example", to: ["c@y.example"], cc: [], subject: "Re", body: "b", hash: "h", safetyResults: [], readAt: "2026-11-20T00:00:00.000Z" };
  it("links the draft's own Message-ID when the read found the one draft, else nothing (the client's mail instead)", () => {
    expect(draftLinkOf(read)).toBe("A3F4@x.example");
    expect(draftLinkOf({ ...read, note: "Mail holds 2 drafts" })).toBeNull();
    expect(draftLinkOf({ ...read, messageId: null })).toBeNull();
    expect(draftLinkOf({ ...read, found: false })).toBeNull();
    expect(draftLinkOf(undefined)).toBeNull();
  });
});
