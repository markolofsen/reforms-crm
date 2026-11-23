import { ActionButton } from "@hub/ui/product/action-button";
import { sentence } from "@/lib/api/client";
import { useMailWrite } from "@/lib/data/drafts";

type Props = { project: string; draftId: number; /** The Hub's last copy in Mail's Trash, or null. */ trashRef: string | null };

/**
 * Mail holds no draft for this any more (P56: deleted in Mail, or moved to Trash by a Skip that was undone). Never a dead
 * end: with the Hub's own copy in Trash, Restore writes it again (one click, Checked off); without one, Skip closes it, or
 * the agent writes it again on a phrase in the terminal.
 */
export function MailGone({ project, draftId, trashRef }: Props) {
  const { restore } = useMailWrite(project, draftId);
  return (
    <div className="flex flex-col gap-1" data-testid="mail-gone">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm text-warning-foreground">
          {trashRef !== null ? `The Mail draft was deleted. The Hub's last version is in Mail's Trash (Mail id ${trashRef}).` : "The Mail draft was deleted and no copy the Hub wrote is in Mail's Trash."}
        </p>
        {trashRef !== null && (
          <ActionButton disabled={restore.isPending} onClick={() => restore.mutate()} size="s" variant="secondary">
            {restore.isPending ? "Restoring" : "Restore"}
          </ActionButton>
        )}
      </div>
      {trashRef === null && <p className="text-muted-foreground text-sm">Skip it, or say in the terminal: write draft {draftId} again.</p>}
      {restore.isError && (
        <p className="text-destructive-foreground text-sm" role="alert">
          {sentence(restore.error)}
        </p>
      )}
    </div>
  );
}
