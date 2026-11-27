import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationText } from "@hub/ui/product/conversation";
import { ConversationContext, ConversationContextItem, ConversationContextRow } from "@hub/ui/product/conversation/context";
import { DraftActionRow, DraftSendButton } from "@hub/ui/product/conversation/draft-action-row";
import { ReviewDialog } from "@hub/ui/product/conversation/review-dialog";
import { empty, failed, failure, held, prepareRefused, ready, sending, sent, stale, uncertain, withPhoto, type ReplyReviewFixture } from "../fixtures/public-reply-review";

function PublicReplyReview({ fixture }: { fixture: ReplyReviewFixture }) {
  const [open, setOpen] = useState(fixture.kind === "reply" && fixture.dialogOpen === true);
  const [feedback, setFeedback] = useState("");
  const note = () => setFeedback("Fixture interaction only. No service is called.");
  if (fixture.kind !== "reply") {
    return (
      <section aria-label="Public reply" className="flex min-w-0 flex-col gap-3 border bg-background p-4">
        <h2 className="font-medium">{fixture.title}</h2>
        <p className="text-muted-foreground text-sm" role={fixture.kind === "error" ? "alert" : "status"}>{fixture.note}</p>
        {fixture.kind === "error" && <ActionButton onClick={note} size="m" variant="secondary">Retry</ActionButton>}
        {feedback && <p role="status">{feedback}</p>}
      </section>
    );
  }
  const preview = (
    <div className="flex min-w-0 flex-col gap-3">
      <ConversationText text={fixture.text} />
      {fixture.photo && (
        <figure className="flex min-w-0 flex-col gap-2">
          <img alt={fixture.photo.alt} className="max-h-56 w-full rounded-md object-contain" height={180} src={fixture.photo.src} width={480} />
          <figcaption className="text-muted-foreground text-xs">{fixture.photo.description}</figcaption>
        </figure>
      )}
    </div>
  );
  const primary = fixture.action.kind === "review" ? <DraftSendButton onClick={() => setOpen(true)} who={fixture.target} />
    : fixture.action.kind === "sending" ? <DraftSendButton busy disabled onClick={() => undefined} who={fixture.target} />
    : fixture.action.kind === "refresh" ? <ActionButton onClick={note} size="m" variant="secondary">Refresh status</ActionButton>
    : fixture.action.kind === "receipt" ? <ActionButton onClick={note} size="m" variant="secondary">Open reply</ActionButton> : null;
  return (
    <section aria-label="Public reply" className="flex min-w-0 flex-col gap-4 border bg-background p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="font-medium">{fixture.title}</h2>
        <p className="break-words text-muted-foreground text-sm" role="status">{fixture.note}</p>
      </div>
      <ConversationContext ariaLabel="Public reply target and review">
        <ConversationContextRow><ConversationContextItem label="Target">{fixture.target}</ConversationContextItem><ConversationContextItem label="Account">Example account</ConversationContextItem></ConversationContextRow>
        <ConversationContextRow><ConversationContextItem label="Strategy">{fixture.strategy}</ConversationContextItem><ConversationContextItem label="Reviewed">{fixture.reviewedAt}</ConversationContextItem></ConversationContextRow>
      </ConversationContext>
      {preview}
      {fixture.review.items.length > 0 && (
        <ul aria-label="Reply blockers" className="flex min-w-0 flex-col gap-2">
          {fixture.review.items.map((item) => <li className="break-words text-destructive-foreground text-sm" key={item.key}>{item.text} {item.rule}</li>)}
        </ul>
      )}
      <DraftActionRow ariaLabel="Public reply actions" primary={primary} />
      {feedback && <p className="text-muted-foreground text-sm" role="status">{feedback}</p>}
      <ReviewDialog
        {...fixture.review}
        onConfirm={() => { setOpen(false); setFeedback("Fixture confirmation only. Nothing was sent."); }}
        onOpenChange={setOpen}
        open={open}
        summary={<><p className="mb-3">Example account → {fixture.target}</p>{preview}</>}
      />
    </section>
  );
}

const meta = {
  title: "Product/Public reply review",
  component: PublicReplyReview,
  args: { fixture: ready },
  parameters: { layout: "padded" },
} satisfies Meta<typeof PublicReplyReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const RulesHeld: Story = { args: { fixture: held } };
export const Stale: Story = { args: { fixture: stale } };
export const Sending: Story = { args: { fixture: sending } };
export const Uncertain: Story = { args: { fixture: uncertain } };
export const Sent: Story = { args: { fixture: sent } };
export const Empty: Story = { args: { fixture: empty } };
export const ReadFailure: Story = { args: { fixture: failure } };
export const Photo: Story = { args: { fixture: withPhoto } };

export const Failed: Story = { args: { fixture: failed } };
export const PrepareRefused: Story = { args: { fixture: prepareRefused } };
