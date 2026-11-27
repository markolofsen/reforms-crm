import { describe, expect, it } from "vitest";
import { watchReviewPrepareBody, watchReviewReconcileBody, watchReviewSendBody, watchReviewState } from "../src/watch/review";

const payloadHash = "a".repeat(64);
const policyGeneration = "b".repeat(64);

describe("browser public review contract", () => {
  it("accepts only a reviewed payload identity, never browser-authored review authority or an edited body", () => {
    expect(watchReviewPrepareBody.safeParse({ payloadHash }).success).toBe(true);
    for (const extra of [{ text: "changed" }, { rulesAccepted: true }, { authority: "owner" }, { reviewRef: "invented" }, { chatId: -1 }, { path: "/asset" }]) {
      expect(watchReviewPrepareBody.safeParse({ payloadHash, ...extra }).success).toBe(false);
    }
  });

  it("requires the exact payload, combined policy and one-use ticket at Send", () => {
    const body = { ticket: "one-use", payloadHash, policyGeneration };
    expect(watchReviewSendBody.safeParse(body).success).toBe(true);
    expect(watchReviewSendBody.safeParse({ ...body, textHash: payloadHash }).success).toBe(false);
    expect(watchReviewSendBody.safeParse({ ...body, ticket: "" }).success).toBe(false);
    expect(watchReviewSendBody.safeParse({ ticket: "one-use", payloadHash }).success).toBe(false);
  });

  it("has no browser-provided receipt id and no terminal success inferred from a pending status", () => {
    expect(watchReviewReconcileBody.safeParse({}).success).toBe(true);
    expect(watchReviewReconcileBody.safeParse({ messageId: 500 }).success).toBe(false);
    expect(watchReviewState.safeParse("unresolved").success).toBe(true);
    expect(watchReviewState.safeParse("sending").success).toBe(false);
    expect(watchReviewState.safeParse("unknown-new-state").success).toBe(false);
  });
});
