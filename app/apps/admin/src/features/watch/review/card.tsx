import { useState } from "react";
import type { WatchReviewDto } from "@hub/contract/watch-review";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationContext, ConversationContextItem, ConversationContextRow } from "@hub/ui/product/conversation/context";
import { DraftActionRow, DraftSendButton } from "@hub/ui/product/conversation/draft-action-row";
import { ReviewDialog, type ReviewItem } from "@hub/ui/product/conversation/review-dialog";
import { OpenLinkButton } from "@/components/links/open-link";
import { useWatchReplyActions } from "@/lib/data/watch/review";
import { formatTime } from "@/lib/format";
import { ReplyPayload } from "./payload";
import { replyDisplay } from "./state";

function ReplyFacts({ review }: { review: WatchReviewDto }) {
  const p = review.proposal;
  return (
    <ConversationContext ariaLabel="Public reply target and review">
      <ConversationContextRow>
        <ConversationContextItem label="Target">@{p.groupUsername} · message #{p.replyToMessageId}</ConversationContextItem>
        <ConversationContextItem label="Account">{p.account}</ConversationContextItem>
        {p.threadId !== null && <ConversationContextItem label="Thread marker">#{p.threadId}</ConversationContextItem>}
      </ConversationContextRow>
      <ConversationContextRow>
        <ConversationContextItem label="Policy">revision {p.policyRevision}</ConversationContextItem>
        <ConversationContextItem label="Reviewed">{formatTime(p.reviewedAt)}</ConversationContextItem>
        <ConversationContextItem label="Expires">{formatTime(p.expiresAt)}</ConversationContextItem>
      </ConversationContextRow>
      <ConversationContextItem label="Review">{p.reviewRef}</ConversationContextItem>
    </ConversationContext>
  );
}

function ReplyConfirmation({ review, items, pending, pendingLabel, onClose, onConfirm }: {
  review: WatchReviewDto; items: readonly ReviewItem[]; pending: boolean; pendingLabel: string;
  onClose: () => void; onConfirm: () => void;
}) {
  const [photoReady, setPhotoReady] = useState(review.proposal.photo === null);
  const blockers: ReviewItem[] = [...items];
  if (!photoReady) blockers.push({ key: "photo", severity: "blocker", text: "Wait for the verified photo preview before confirming the complete reply." });
  return (
    <ReviewDialog
      confirmLabel={review.proposal.photo ? "Send photo and reply" : "Send reply"}
      items={blockers}
      onConfirm={onConfirm}
      onOpenChange={(open) => { if (!open) onClose(); }}
      open
      pending={pending}
      pendingLabel={pendingLabel}
      summary={<div className="flex min-w-0 flex-col gap-3"><ReplyFacts review={review} /><ReplyPayload onPhotoReady={setPhotoReady} review={review} /></div>}
      title="Send this public reply?"
    />
  );
}

export function PublicReplyCard({ review, readStale, refreshing, refresh }: {
  review: WatchReviewDto; readStale: boolean; refreshing: boolean; refresh: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [photoReady, setPhotoReady] = useState(review.proposal.photo === null);
  const actions = useWatchReplyActions(review.proposal.project, review);
  const display = replyDisplay(review, actions.result, actions.error, readStale);
  const pendingLabel = actions.phase === "sending" ? "Sending" : actions.phase === "preparing" ? "Checking the reply" : "Refreshing status";
  const items: ReviewItem[] = display.reasons.map((text, i) => ({ key: String(i), severity: "blocker", text }));
  if (!display.canReview && items.length === 0) items.push({ key: "state", severity: "blocker", text: display.label });
  const refreshStatus = async () => { if (await refresh()) actions.reset(); };
  const send = async () => {
    try {
      const result = await actions.send();
      if (!("refused" in result)) setOpen(false);
    } catch {
      // The command retains the error inline and rereads the durable attempt. No new ticket or retry.
    }
  };
  const reconcile = async () => {
    try { await actions.reconcile(); } catch { /* The saved attempt and error remain visible. */ }
  };
  const primary = display.canReview
    ? <DraftSendButton busy={actions.pending} disabled={!photoReady || actions.pending} onClick={() => setOpen(true)} who={`@${review.proposal.groupUsername}, message #${review.proposal.replyToMessageId}`} />
    : review.canReconcile && (display.state === "unresolved" || display.state === "failed")
      ? <ActionButton disabled={actions.pending} onClick={() => void reconcile()} size="m" variant="secondary">{actions.pending ? "Checking delivery…" : "Check delivery"}</ActionButton> : null;
  return (
    <article aria-label={`Public reply to @${review.proposal.groupUsername} message #${review.proposal.replyToMessageId}`} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" data-testid="public-reply" data-proposal-id={review.proposal.id}>
      <p className="font-medium text-sm" data-state={display.state} data-testid="public-reply-state" role="status">{actions.pending ? `${pendingLabel}…` : display.label}</p>
      <ReplyFacts review={review} />
      <ReplyPayload onPhotoReady={setPhotoReady} review={review} />
      {display.reasons.length > 0 && <ul aria-label="Reply status reasons" className="flex flex-col gap-1 text-muted-foreground text-sm">{display.reasons.map((reason) => <li className="break-words" key={reason}>{reason}</li>)}</ul>}
      {display.state === "unresolved" && <p className="text-muted-foreground text-sm">The saved attempt needs a confirmed receipt. Refresh its status or inspect the source; do not send another copy.</p>}
      {display.state === "failed" && <p className="text-muted-foreground text-sm">The saved delivery attempt failed. Refresh its status before any further decision; this does not retry it.</p>}
      <DraftActionRow
        ariaLabel="Public reply actions"
        primary={primary}
        start={<>
          <OpenLinkButton ariaLabel={() => "Open source discussion"} to={review.sourceLink}>{() => "Open source"}</OpenLinkButton>
          {display.state === "sent" && review.receiptLink
            ? <OpenLinkButton ariaLabel={() => "Open delivered public reply"} to={review.receiptLink}>{() => "Open reply"}</OpenLinkButton>
            : <ActionButton disabled={actions.pending || refreshing} onClick={() => void refreshStatus()} size="s" variant="quiet">Refresh status</ActionButton>}
        </>}
      />
      {open && <ReplyConfirmation items={items} onClose={() => setOpen(false)} onConfirm={() => void send()} pending={actions.pending} pendingLabel={pendingLabel} review={review} />}
    </article>
  );
}
