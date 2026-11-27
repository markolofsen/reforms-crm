import type { ComponentProps } from "react";
import type { ReviewDialog, ReviewItem } from "@hub/ui/product/conversation/review-dialog";

type ReviewCopy = Pick<ComponentProps<typeof ReviewDialog>, "title" | "confirmLabel" | "pendingLabel" | "items" | "error">;
type PreviewAction = { kind: "review" } | { kind: "refresh" } | { kind: "sending" } | { kind: "receipt" } | { kind: "none" };

export type ReplyReviewFixture =
  | { kind: "empty" | "error"; title: string; note: string }
  | {
      kind: "reply"; title: string; note: string; text: string; target: string; reviewedAt: string;
      strategy: string; action: PreviewAction; review: ReviewCopy; dialogOpen?: boolean;
      photo?: { src: string; alt: string; description: string };
    };

const review = {
  title: "Send this public reply?", confirmLabel: "Send reply", pendingLabel: "Sending",
  items: [],
} satisfies ReviewCopy;
const base = {
  kind: "reply", title: "Ready for review", note: "The saved reply stays bound to this source and reviewed strategy.",
  text: "Try running the command from the same account that starts the task, then check its exit code.",
  target: "@example_group · message #42", reviewedAt: "27 Nov, 10:05", strategy: "Reviewed strategy v2",
  action: { kind: "review" }, review,
} satisfies ReplyReviewFixture;

const rules = [
  { key: "rules", severity: "blocker", text: "The full source rules have not been reviewed.", rule: "A description and the latest pin are not complete rules." },
  { key: "write", severity: "blocker", text: "This group has a writing gate.", rule: "Joined does not mean permitted to write." },
] satisfies readonly ReviewItem[];

export const ready = base;
export const held = { ...base, title: "On hold", note: "Full source rules and the writing gate need review.", action: { kind: "refresh" }, review: { ...review, items: rules } } satisfies ReplyReviewFixture;
export const stale = { ...base, title: "Review expired", note: "A fresh review is needed before this exact reply can be sent.", action: { kind: "refresh" }, review: { ...review, items: [{ key: "expired", severity: "blocker", text: "The saved source review has expired." }] } } satisfies ReplyReviewFixture;
export const sending = { ...base, title: "Sending…", note: "Waiting for the current request. Do not send another copy.", action: { kind: "sending" } } satisfies ReplyReviewFixture;
export const uncertain = { ...base, title: "Delivery not confirmed", note: "The saved attempt has no confirmed delivery result. Refresh its status before taking another action.", action: { kind: "refresh" } } satisfies ReplyReviewFixture;
export const sent = { ...base, title: "Sent", note: "The saved receipt confirms delivery as message #58.", action: { kind: "receipt" } } satisfies ReplyReviewFixture;
export const empty = { kind: "empty", title: "No reviewed reply for this message", note: "Opening this source does not prepare or send a reply." } satisfies ReplyReviewFixture;
export const failure = { kind: "error", title: "Could not read the public reply", note: "The source remains selected. Retry the read when the Hub is available." } satisfies ReplyReviewFixture;

// Synthetic display-only illustration. It is not an API asset, a product screenshot or runtime evidence.
const illustration = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 180"><rect width="480" height="180" fill="lightgray"/><rect x="24" y="42" width="176" height="96" rx="12" fill="white"/><rect x="280" y="42" width="176" height="96" rx="12" fill="white"/><path d="M210 90h58m-14-12 14 12-14 12" fill="none" stroke="black" stroke-width="3"/><text x="112" y="96" text-anchor="middle" font-family="sans-serif" font-size="18">Input</text><text x="368" y="96" text-anchor="middle" font-family="sans-serif" font-size="18">Result</text></svg>');
export const withPhoto = { ...base, photo: { src: illustration, alt: "Synthetic illustration showing an input connected to a result.", description: "Illustration fixture · exact selected preview and caption are reviewed together" } } satisfies ReplyReviewFixture;

export const failed = { ...base, title: "Delivery failed", note: "The saved attempt failed. Refresh its status; this does not retry the send.", action: { kind: "refresh" } } satisfies ReplyReviewFixture;
export const prepareRefused = { ...base, title: "Review needed", action: { kind: "review" }, dialogOpen: true, review: { ...review, error: "The source changed during the final check.", items: [{ key: "changed", severity: "blocker", text: "Refresh the saved review before sending." }] } } satisfies ReplyReviewFixture;
