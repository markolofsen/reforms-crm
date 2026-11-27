import type { WatchContextDto, WatchDto } from "@hub/contract/watch";
import type { WatchReviewDto, WatchReviewListDto, WatchReviewPreparedDto } from "@hub/contract/watch-review";

export const hash = (letter: string) => letter.repeat(64);
const sourceQuestion = "My scheduled check fails but running it manually works. Which account should I inspect?";
export const reviewFixture = {
  proposal: {
    id: hash("a"), project: "demo-shop", direction: "research", account: "example-account", groupUsername: "sample_group",
    chatId: -1001234, replyToMessageId: 42, threadId: null,
    text: "Run the check from the account that starts the task, then inspect its exit code.",
    textHash: hash("b"), payloadHash: hash("b"), photo: null, sourceHash: hash("c"),
    sourceAt: "2026-11-27T10:00:00Z", rulesHash: hash("d"), policyGeneration: hash("e"), policyRevision: 2,
    strategyHash: hash("f"), reviewRef: "reports/example-review.md", reviewedAt: "2026-11-27T10:05:00Z",
    createdAt: "2026-11-27T10:05:00Z", expiresAt: "2026-11-27T10:35:00Z", attempt: null,
  },
  state: "ready", reasons: [], observedAt: "2026-11-27T10:06:00Z", currentPolicyGeneration: hash("e"),
  canPrepare: true, canReconcile: false, sourceLink: "https://t.me/sample_group/42", receiptLink: null,
} satisfies WatchReviewDto;

export const reviewListFixture = {
  project: "demo-shop", direction: "research", group: "sample_group", messageId: 42,
  observedAt: "2026-11-27T10:06:00Z", items: [reviewFixture],
} satisfies WatchReviewListDto;
export const preparedFixture = {
  review: reviewFixture, ticket: "example-one-use-ticket", expiresAt: "2026-11-27T10:07:00Z",
  payloadHash: hash("b"), policyGeneration: hash("e"),
} satisfies WatchReviewPreparedDto;
export const reviewContextFixture = {
  slug: "demo-shop", direction: "research", group: "sample_group", messageId: 42,
  contextKind: "chronological", lastPolledAt: "2026-11-27T10:04:00Z", sourceLink: "https://t.me/sample_group/42",
  messages: [{ messageId: 42, text: sourceQuestion,
    sentAt: "2026-11-27T10:00:00Z", author: "sample_builder", replyToMessageId: null, threadId: null }],
} satisfies WatchContextDto;
export const reviewWatchFixture = {
  slug: "demo-shop", direction: "research", lens: { id: "research", title: "Developer research", version: 1 },
  standing: { state: "polling", reason: null, until: null }, notice: null, labels: { task: "Task failure" },
  days: 30, spend: { monthMicroUsd: 0, budgetMicroUsd: 1_000_000 }, nextAnalysis: null,
  triggers: [], topics: [], moods: [], people: [], groups: [], trend: { days: [], series: [] },
  moments: [{ group: "sample_group", messageId: 42, trigger: "task", triggerOther: "", intensity: 4,
    quote: sourceQuestion, author: "sample_builder", reactors: 0, context: "Scheduled local command",
    why: "A first-hand task is blocked", at: "2026-11-27T10:00:00Z", link: "https://t.me/sample_group/42" }],
} satisfies WatchDto;

export function reviewState(state: WatchReviewDto["state"]): WatchReviewDto {
  const reason: Record<WatchReviewDto["state"], string[]> = {
    ready: [], held: ["The full source rules have not been reviewed."], stale: ["The saved review has expired."],
    unresolved: ["The attempt is saved but delivery is not confirmed."], failed: ["Telegram refused delivery."], sent: [],
  };
  const attempt = state === "unresolved" || state === "failed" || state === "sent"
    ? { id: 17, status: state === "unresolved" ? "uncertain" : state, messageId: state === "sent" ? "58" : null, reason: null } : null;
  return {
    ...reviewFixture, state, reasons: reason[state], canPrepare: state === "ready",
    proposal: { ...reviewFixture.proposal, attempt }, receiptLink: state === "sent" ? "https://t.me/sample_group/58" : null,
  };
}
