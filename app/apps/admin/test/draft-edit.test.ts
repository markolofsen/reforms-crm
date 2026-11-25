import { describe, expect, it } from "vitest";
import type { DraftMailDto } from "@hub/contract/mail";
import { editStartOf } from "../src/features/mail/draft/body";
import type { ReviewDraft } from "../src/features/mail/model";

// P147 3m item 2: one rule for the footer's Edit and a click on the draft text: an open draft whose text Mail holds exactly once.

const d = (status: string) => ({ id: 1, status, body: "stored preview" }) as unknown as ReviewDraft;
const live = (o: Partial<DraftMailDto>) => ({ configured: true, found: true, body: "As Mail holds it", hash: "h1", ...o }) as unknown as DraftMailDto;

describe("where editing starts", () => {
  it("starts on the text Mail holds, with its hash, for an open ready draft", () => {
    expect(editStartOf(d("ready"), live({}))).toEqual({ text: "As Mail holds it", hash: "h1" });
  });
  it("never on a closed or held draft, without Mail's one text, or before Mail was read", () => {
    expect(editStartOf(d("sent"), live({}))).toBeNull();
    expect(editStartOf(d("hold"), live({}))).toBeNull();
    expect(editStartOf(d("ready"), live({ hash: null }))).toBeNull();
    expect(editStartOf(d("ready"), live({ found: false }))).toBeNull();
    expect(editStartOf(d("ready"), undefined)).toBeNull();
  });
});
