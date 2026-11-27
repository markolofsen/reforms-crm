import { describe, expect, it } from "vitest";
import type { PublicReplyAssessment } from "@hub/messengers/door";
import { knownReceiptId, publicProposalDto, publicReviewDto } from "../../src/send/watch-review/projection";
import { AT, PAYLOAD, POLICY, sendAttempt, storedProposal } from "./fixtures";

const assessment = (): PublicReplyAssessment => ({ proposal: storedProposal(), policy: { refusal: null, generation: POLICY,
  revision: 2, requestRef: "owner-request", strategyHash: "f".repeat(64), repliesPerDay: 3 }, reasons: [], attempt: null, state: "ready" });

describe("public browser projection", () => {
  it("normalizes legacy text hashes and never exposes provider or dedup credentials", () => {
    const dto = publicProposalDto(storedProposal(), sendAttempt());
    expect(dto).toMatchObject({ payloadHash: PAYLOAD, photo: null, attempt: { status: "sending", messageId: null } });
    expect(JSON.stringify(dto)).not.toMatch(/private-peer-hash|private-random-id|private-target-key|accessHash|randomId|targetKey|fileReference/);
  });

  it("holds a stored-ready review when its canonical account queue is unavailable", () => {
    expect(publicReviewDto(assessment(), AT, "The account is parked.")).toMatchObject({ state: "held", canPrepare: false,
      canReconcile: false, reasons: ["The account is parked."], receiptLink: null });
  });

  it("never offers resend for a durable unknown attempt; only a known receipt enables reconciliation", () => {
    const a = { ...assessment(), state: "uncertain" as const, attempt: sendAttempt(), reasons: ["DELIVERY_UNKNOWN"] };
    expect(publicReviewDto(a, AT, null)).toMatchObject({ state: "unresolved", canPrepare: false, canReconcile: false, receiptLink: null });
    a.attempt.sentMessageId = "500";
    expect(publicReviewDto(a, AT, null)).toMatchObject({ state: "unresolved", canPrepare: false, canReconcile: true, receiptLink: null });
    expect(publicReviewDto(a, AT, "The queue is offline.")).toMatchObject({ canReconcile: false });
  });

  it("permits receipt inspection after grant revocation without enabling a new send", () => {
    const a: PublicReplyAssessment = { ...assessment(), state: "uncertain", attempt: { ...sendAttempt(), sentMessageId: "500" },
      policy: { ...assessment().policy, refusal: "the grant was revoked", generation: "unavailable" } };
    expect(publicReviewDto(a, AT, null)).toMatchObject({ currentPolicyGeneration: null, state: "unresolved", canPrepare: false, canReconcile: true });
  });

  it("exposes a receipt link only for a confirmed positive provider id", () => {
    const a: PublicReplyAssessment = { ...assessment(), state: "sent", attempt: { ...sendAttempt(), status: "sent", sentMessageId: "500" } };
    expect(publicReviewDto(a, AT, null)).toMatchObject({ state: "sent", canPrepare: false, canReconcile: false, receiptLink: "https://t.me/public_group/500" });
    expect(knownReceiptId(a.attempt)).toBeNull();
    for (const sentMessageId of [null, "0", "-1", "NaN", "1e3", " 500 ", "9007199254740992"]) {
      expect(knownReceiptId({ status: "sending", sentMessageId })).toBeNull();
      expect(publicReviewDto({ ...a, attempt: { ...sendAttempt(), status: "sent", sentMessageId } }, AT, null)).toMatchObject({
        state: "unresolved", canPrepare: false, canReconcile: false, receiptLink: null,
        reasons: [expect.stringContaining("no valid provider receipt id")],
      });
    }
  });
});
