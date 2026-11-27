import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WatchReviewDto } from "@hub/contract/watch-review";
import { PublicReplyCard } from "../src/features/watch/review/card";
import { matchesReviewSource, replyDisplay } from "../src/features/watch/review/state";
import { ApiFailure } from "../src/lib/api/client";
import { watchReviewApi } from "../src/lib/api/project/watch-review";
import { keys } from "../src/lib/cache/keys";
import { applyLive } from "../src/lib/cache/live";
import { PublicDeliveryUnconfirmed, preparedMatches, sendReviewedReply, type PublicReplyResult } from "../src/lib/data/watch/send";
import { hash, preparedFixture, reviewFixture, reviewListFixture, reviewState } from "./fixtures/watch-review";

afterEach(() => vi.unstubAllGlobals());
const uncertain: PublicReplyResult = { status: "uncertain", proposalId: hash("a"), sendId: 17, messageId: null, reason: "No confirmed receipt" };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const render = (node: ReactNode) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);

describe("public reply identity and the single confirmed action", () => {
  it("requires exact target, caption, photo, and current policy identity after prepare", () => {
    expect(preparedMatches(reviewFixture, preparedFixture)).toBe(true);
    const variants: WatchReviewDto[] = [
      { ...reviewFixture, proposal: { ...reviewFixture.proposal, account: "another-account" } },
      { ...reviewFixture, proposal: { ...reviewFixture.proposal, chatId: -1009999 } },
      { ...reviewFixture, proposal: { ...reviewFixture.proposal, replyToMessageId: 43 } },
      { ...reviewFixture, proposal: { ...reviewFixture.proposal, threadId: 7 } },
      { ...reviewFixture, proposal: { ...reviewFixture.proposal, text: "Changed after the owner read it" } },
      { ...reviewFixture, proposal: { ...reviewFixture.proposal, payloadHash: hash("c") } },
      { ...reviewFixture, proposal: { ...reviewFixture.proposal, photo: { kind: "photo", blobRef: hash("c") + ".png", sha256: hash("c"), mime: "image/png", bytes: 68, width: 1, height: 1 } } },
    ];
    for (const review of variants) expect(preparedMatches(reviewFixture, { ...preparedFixture, review })).toBe(false);
    expect(preparedMatches(reviewFixture, { ...preparedFixture, policyGeneration: hash("c") })).toBe(false);
  });

  it("does not apply or remint when the final preparation differs from what was reviewed", async () => {
    const prepare = vi.fn(async () => ({ ...preparedFixture, payloadHash: hash("c") }));
    const send = vi.fn(async () => uncertain);
    await expect(sendReviewedReply(reviewFixture, { prepare, send, phase: () => undefined })).rejects.toThrow("changed");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps a refusal after prepare as a refusal and does not retry", async () => {
    const denied = new ApiFailure("Source rules changed", "wrong_state", 409, ["source_changed"]);
    const prepare = vi.fn(async () => preparedFixture);
    const send = vi.fn(async (): Promise<PublicReplyResult> => { throw denied; });
    await expect(sendReviewedReply(reviewFixture, { prepare, send, phase: () => undefined })).rejects.toBe(denied);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(replyDisplay(reviewFixture, undefined, denied).canReview).toBe(false);
  });

  it("treats a lost send response as unconfirmed, without a second send or ticket", async () => {
    const prepare = vi.fn(async () => preparedFixture);
    const send = vi.fn(async (): Promise<PublicReplyResult> => { throw new TypeError("connection closed"); });
    await expect(sendReviewedReply(reviewFixture, { prepare, send, phase: () => undefined })).rejects.toBeInstanceOf(PublicDeliveryUnconfirmed);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(replyDisplay(reviewFixture, undefined, new PublicDeliveryUnconfirmed("lost"))).toMatchObject({ state: "unresolved", canReview: false });
  });

  it("preserves explicit uncertain and failed outcomes instead of treating resolution as Sent", async () => {
    for (const result of [uncertain, { ...uncertain, status: "failed" } satisfies PublicReplyResult]) {
      const received = await sendReviewedReply(reviewFixture, { prepare: async () => preparedFixture, send: async () => result, phase: () => undefined });
      expect(received).toEqual(result);
      expect(replyDisplay(reviewFixture, received, null)).toMatchObject({ state: result.status === "uncertain" ? "unresolved" : "failed", canReview: false });
    }
  });

  it("treats a different proposal's delivery response as unconfirmed without another ticket or send", async () => {
    const prepare = vi.fn(async () => preparedFixture);
    const send = vi.fn(async (): Promise<PublicReplyResult> => ({ ...uncertain, status: "sent", proposalId: hash("c"), messageId: "58" }));
    await expect(sendReviewedReply(reviewFixture, { prepare, send, phase: () => undefined })).rejects.toBeInstanceOf(PublicDeliveryUnconfirmed);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not call a status-only response Sent without its receipt", () => {
    expect(replyDisplay(reviewFixture, { ...uncertain, status: "sent" }, null).state).toBe("unresolved");
    expect(replyDisplay(reviewFixture, { ...uncertain, status: "sent", messageId: "58" }, null).state).toBe("sent");
    expect(replyDisplay(reviewState("sent"), uncertain, new PublicDeliveryUnconfirmed("old failure")).state).toBe("sent");
    expect(replyDisplay(reviewState("failed"), uncertain, new PublicDeliveryUnconfirmed("old failure")).state).toBe("failed");
  });
});

describe("source isolation and durable presentation", () => {
  const target = { project: "demo-shop", direction: "research", group: "sample_group", messageId: 42 };
  it("requires every source coordinate and every returned proposal to match", () => {
    expect(matchesReviewSource(reviewListFixture, target)).toBe(true);
    for (const patch of [{ project: "other" }, { direction: "other" }, { group: "another_group" }, { messageId: 43 }]) {
      expect(matchesReviewSource(reviewListFixture, { ...target, ...patch })).toBe(false);
    }
    expect(matchesReviewSource({ ...reviewListFixture, items: [{ ...reviewFixture, proposal: { ...reviewFixture.proposal, replyToMessageId: 43 } }] }, target)).toBe(false);
  });

  it("restores unresolved after a reload without offering Send again", () => {
    const markup = render(<PublicReplyCard readStale={false} refresh={async () => true} refreshing={false} review={reviewState("unresolved")} />);
    expect(markup).toContain("Delivery not confirmed");
    expect(markup).not.toContain('data-testid="draft-send"');
    expect(markup).not.toContain("Send again");
    expect(markup).toContain("Refresh status");
  });

  it("keeps stale reads and a server refusal closed even when the old state was ready", () => {
    expect(replyDisplay(reviewFixture, undefined, null, true).canReview).toBe(false);
    expect(replyDisplay({ ...reviewFixture, canPrepare: false }, undefined, null)).toMatchObject({ state: "held", canReview: false });
    const markup = render(<PublicReplyCard readStale={false} refresh={async () => true} refreshing={false} review={reviewState("held")} />);
    expect(markup).toContain("full source rules");
    expect(markup).not.toContain('data-testid="draft-send"');
  });

  it("external sends invalidate this project's public read without invalidating another source family", () => {
    const qc = new QueryClient();
    const own = keys.watchPublicSource("demo-shop", "research", "sample_group", 42);
    const other = keys.watchPublicSource("another-project", "research", "sample_group", 42);
    const analysis = keys.watch("demo-shop", "research", 30, null, null);
    for (const key of [own, other, analysis]) qc.setQueryData(key, reviewListFixture);
    applyLive(qc, { type: "change", seq: 7, changes: [{ topic: "sends", project: "demo-shop" }] }, false);
    expect(qc.getQueryState(own)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(other)?.isInvalidated).toBe(false);
    expect(qc.getQueryState(analysis)?.isInvalidated).toBe(false);
    expect(keys.watchPublicSource("demo-shop", "research", "sample_group", 43)).not.toEqual(own);
    expect(keys.watchPublicSource("demo-shop", "different", "sample_group", 42)).not.toEqual(own);
  });
});

describe("specialized public reply facade", () => {
  it("parses 202 as a typed uncertain result, never a generic success", async () => {
    const fetch = vi.fn(async () => reply(202, uncertain));
    vi.stubGlobal("fetch", fetch);
    expect(await watchReviewApi.send("demo-shop", hash("a"), { ticket: "one-use", payloadHash: hash("b"), policyGeneration: hash("e") })).toEqual(uncertain);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not replay the send POST on 503", async () => {
    const fetch = vi.fn(async () => reply(503, { error: "unavailable", code: "unavailable" }));
    vi.stubGlobal("fetch", fetch);
    await expect(watchReviewApi.send("demo-shop", hash("a"), { ticket: "one-use", payloadHash: hash("b"), policyGeneration: hash("e") })).rejects.toBeInstanceOf(ApiFailure);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
