import { useState } from "react";
import type { HideProposalDto } from "@hub/contract/messengers";
import { ActionButton } from "@hub/ui/product/action-button";
import { ReviewDialog } from "@hub/ui/product/conversation/review-dialog";
import { toastManager } from "@hub/ui/toast";
import { sentence } from "@/lib/api/client";
import { useHideCommands, useProposalDrop } from "@/lib/data/messengers";

const CHANNEL_WORD = { telegram_user: "Telegram", whatsapp: "WhatsApp" } as const;
const plural = (n: number) => (n === 1 ? "1 chat" : `${n} chats`);

/**
 * P128 X5 ("sort the chats"): the agent's proposed hides, said once above the unlinked chats, and ONE review dialog that names every
 * chat with the agent's reason (`ReviewDialog`, P105; ui-specifications 5f). Keep on a line drops that chat's proposal; Hide hides
 * every chat left, and one toast's Undo unhides them all (rule 5d). Hiding keeps a keyed hash of the chat and deletes nothing.
 */
export function ProposedHides({ project, proposals }: { project: string; proposals: readonly HideProposalDto[] }) {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const drop = useProposalDrop(project);
  const c = useHideCommands(project, { onError: (e) => setFailure(sentence(e)), onHidden: () => undefined, onUnhidden: () => undefined });
  if (proposals.length === 0) return null;
  const keep = (p: HideProposalDto) => drop.mutate([{ channel: p.channel, chatId: p.chatId }]);
  const hideAll = async () => {
    setFailure(null);
    const done: HideProposalDto[] = [];
    for (const p of proposals) {
      try {
        await c.hide.mutateAsync({ channel: p.channel, chatId: p.chatId, title: p.title });
        done.push(p);
      } catch {
        break; // the failure's sentence is in the dialog; the rest stay proposed
      }
    }
    if (done.length === 0) return;
    if (done.length === proposals.length) setOpen(false);
    toastManager.add({
      title: `Hid ${plural(done.length)}: not clients`,
      type: "success",
      actionProps: { children: "Undo", onClick: () => void Promise.all(done.map((p) => c.unhide.mutateAsync({ channel: p.channel, chatId: p.chatId, title: p.title }))) },
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" data-testid="proposed-hides">
      <p className="me-auto min-w-0 text-sm">
        The agent proposes hiding {plural(proposals.length)} as not clients.
      </p>
      <ActionButton onClick={() => setOpen(true)} size="s" variant="secondary">
        Review<span className="sr-only"> the {plural(proposals.length)} the agent proposes to hide</span>
      </ActionButton>
      <ReviewDialog
        cancelLabel="Not now"
        confirmLabel={`Hide ${plural(proposals.length)}`}
        error={failure ? <p className="text-destructive-foreground text-sm" role="alert">{failure}</p> : undefined}
        items={proposals.map((p) => ({ key: `${p.channel}:${p.chatId}`, severity: "warning" as const, text: `${p.title} (${CHANNEL_WORD[p.channel]}): ${p.reason}`, rule: "Proposed by the agent", action: { label: `Keep ${p.title}`, onClick: () => keep(p), pending: drop.isPending } }))}
        lead="Each chat leaves Not linked and the autolink never links it; Hidden lists it and Undo brings it back. Nothing is deleted or sent. Keep a chat to leave it unlinked."
        onConfirm={() => void hideAll()}
        onOpenChange={setOpen}
        open={open}
        pending={c.hide.isPending}
        pendingLabel="Hiding"
        title={`Hide ${plural(proposals.length)}: not clients?`}
        tone="danger"
      />
    </div>
  );
}
