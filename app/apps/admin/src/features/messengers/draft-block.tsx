import { useState } from "react";
import { MESSENGER_TEXT_MAX } from "@hub/config/chat-rules";
import { composerStateOf, type ComposerState } from "@hub/contract/composer";
import type { MessengerDraftDto } from "@hub/contract/messenger-panel";
import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationText } from "@hub/ui/product/conversation";
import { ConversationEditorSurface } from "@hub/ui/product/composer-editor";
import { ConversationComposer, ConversationComposerFooter } from "@hub/ui/product/conversation-frame";
import { agentRef } from "@/lib/focus";
import { SendBar } from "./send-bar";
import type { useChatActions } from "./use-chat-actions";
import { useMessengerSend } from "./use-messenger-send";

type Actions = ReturnType<typeof useChatActions>;

/**
 * The agent's open draft of one chat (P71 M3): its text in full, what admitted it (a follow-up, the owner's request), and the
 * three decisions. Send goes through the send door (P71 M4): a dry run, the confirm in place with the exact text, the apply; Edit
 * opens the text in place (an action's own form, `admin-principles.md` rule 9); Skip sets it aside with Undo. Its ref is
 * `mdraft:<id>` (P72), so a press on it tells the agent which draft he means; it is not a tab stop of its own (the buttons are).
 */
export function DraftBlock({ d, name, project, chatId, actions, embedded = false }: { d: MessengerDraftDto; name: string; project: string; chatId: number; actions: Actions; embedded?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(d.text);
  const [editSaved, setEditSaved] = useState(false);
  const door = useMessengerSend(project, d, chatId);
  const shown = door.flow.step === "confirm" || door.flow.step === "sending" ? door.flow.mail.text : d.text;
  const author = d.createdBy === "hub_llm" ? "Hub LLM" : d.createdBy === "runtime_agent" ? "runtime agent" : "agent";
  const editOk = editValue.trim().length > 0 && editValue.length <= MESSENGER_TEXT_MAX && editValue !== d.text;
  const composerState: ComposerState = composerStateOf({ body: editing ? editValue : shown, draftId: editing ? undefined : d.id, editing, error: actions.error });
  const closeEditor = () => {
    setEditValue(d.text);
    setEditing(false);
  };
  const startEditing = () => {
    actions.clearError();
    actions.edit.reset();
    setEditSaved(false);
    setEditValue(d.text);
    setEditing(true);
  };
  const submitEdit = () => {
    if (editOk && !actions.pending) actions.edit.mutate({ id: d.id, text: editValue }, { onSuccess: () => { closeEditor(); setEditSaved(true); } });
  };
  const actionError = actions.error && <p className="text-destructive-foreground text-sm" role="alert">{actions.error}</p>;
  const content = (
    <div className="flex min-w-0 flex-col gap-2" data-testid="messenger-draft" {...agentRef(`mdraft:${d.id}`)}>
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
        <span>Drafted by {author}</span>
        {d.nudge && <Badge variant="outline">Follow-up</Badge>}
        {d.ownerRequest && <span className="min-w-0 break-words">You asked: {d.ownerRequest}</span>}
      </div>
      {editing ? (
        <ConversationEditorSurface ariaLabel="Edit the messenger draft" autoFocus description="Your words for this reply. Save keeps them on the draft." disabled={actions.pending} maxLength={MESSENGER_TEXT_MAX} onCancel={closeEditor} onChange={setEditValue} onSubmit={submitEdit} title="Edit draft" value={editValue} />
      ) : (
        <>
          <div className="measure min-w-0 break-words text-sm" data-agent-label="">
            <ConversationText format="markdown" text={shown} />
          </div>
        </>
      )}
    </div>
  );
  const actionsBar = editing ? (
    <ConversationComposerFooter feedback={actions.error ? <p className="text-destructive-foreground text-sm" role="alert">{actions.error}</p> : undefined}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <ActionButton disabled={!editOk || actions.pending} onClick={submitEdit} size="s" variant="secondary">
          {actions.edit.isPending ? "Saving" : "Save"}
        </ActionButton>
        <ActionButton disabled={actions.pending} onClick={closeEditor} size="s" variant="quiet">
          Cancel
        </ActionButton>
      </div>
    </ConversationComposerFooter>
  ) : (
    <ConversationComposerFooter feedback={actionError ?? (editSaved ? <p className="text-muted-foreground text-sm" role="status">Draft updated. It remains unsent.</p> : undefined)}>
      <div className="min-w-0 flex-1">
        <SendBar
          busy={actions.pending}
          door={door}
          name={name}
          rest={
            <>
              <ActionButton disabled={actions.pending} onClick={startEditing} size="s" variant="secondary">
                Edit<span className="sr-only"> the draft for {name}</span>
              </ActionButton>
              <ActionButton disabled={actions.pending} onClick={() => actions.skip.mutate({ id: d.id, name })} size="s" variant="quiet">
                Skip<span className="sr-only"> the draft for {name}</span>
              </ActionButton>
            </>
          }
        />
      </div>
    </ConversationComposerFooter>
  );
  if (embedded) {
    return (
      <ConversationComposer ariaLabel="Messenger draft and actions" footer={actionsBar} state={composerState.state}>
        {content}
      </ConversationComposer>
    );
  }
  return <>{content}{actionsBar}</>;
}
