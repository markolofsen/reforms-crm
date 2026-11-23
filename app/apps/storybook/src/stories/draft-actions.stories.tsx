import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionButton } from "@hub/ui/product/action-button";
import { DraftActionRow, DraftSendButton } from "@hub/ui/product/conversation/draft-action-row";
import { ReviewDialog, type ReviewItem } from "@hub/ui/product/conversation/review-dialog";

const items: ReviewItem[] = [
  { key: "price", severity: "blocker", text: "The reply names a price the knowledge does not hold.", rule: "Never invent a price" },
  { key: "recent", severity: "warning", text: "You wrote to Ana Teste 2 days ago.", rule: "Already written to recently" },
];
const clock = () => Date.parse("2026-11-24T09:00:00Z");

/**
 * The shared action row of an unsent message (P105, P127 C3) and the review dialog its Send opens: the reversible actions at the
 * start, the one primary at the end, an optional line above; the dialog lists blockers first and its own button sends.
 */
function DraftActions({ withBlocker }: { withBlocker: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex w-[480px] flex-col gap-4 border bg-background p-4">
      <DraftActionRow
        note={<p className="text-muted-foreground text-sm">Queued until 10:00, then it goes.</p>}
        primary={<DraftSendButton onClick={() => setOpen(true)} who="Ana Teste" />}
        start={
          <>
            <ActionButton size="m" variant="secondary">Edit</ActionButton>
            <ActionButton size="m" variant="quiet">Skip</ActionButton>
          </>
        }
      />
      <DraftActionRow ariaLabel="Busy" primary={<DraftSendButton busy onClick={() => undefined} who="Bruno Exemplo" />} />
      <ReviewDialog
        confirmLabel="Send"
        items={withBlocker ? items : items.slice(1)}
        now={clock}
        onConfirm={() => setOpen(false)}
        onOpenChange={setOpen}
        open={open}
        pendingLabel="Sending"
        summary={<p className="text-sm">To ana@example.test, from the shop's account: "Invoice for October".</p>}
        title="Send the reply to Ana Teste?"
      />
    </div>
  );
}

const meta = { title: "Product/Draft actions", component: DraftActions, args: { withBlocker: false } } satisfies Meta<typeof DraftActions>;
export default meta;
export const Warning: StoryObj<typeof meta> = {};
export const Blocker: StoryObj<typeof meta> = { args: { withBlocker: true } };
