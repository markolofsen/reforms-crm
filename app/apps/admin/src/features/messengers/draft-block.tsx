import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MESSENGER_TEXT_MAX } from "@hub/config/chat-rules";
import type { MessengerDraftDto } from "@hub/contract/messenger-panel";
import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { Textarea } from "@hub/ui/textarea";
import { agentRef } from "@/lib/focus";
import { SEND_LATER } from "./labels";
import type { useChatActions } from "./use-chat-actions";

type Actions = ReturnType<typeof useChatActions>;

/** The owner's own words for the draft (P56's editor, without Mail): plain text, ⌘ Enter saves, Esc cancels. */
function Editor({ d, actions, onClose }: { d: MessengerDraftDto; actions: Actions; onClose: () => void }) {
  const [value, setValue] = useState(d.text);
  const label = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => box.current?.focus(), []);
  const ok = value.trim().length > 0 && value.length <= MESSENGER_TEXT_MAX && value !== d.text;
  const submit = () => {
    if (ok && !actions.pending) actions.edit.mutate({ id: d.id, text: value }, { onSuccess: onClose });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <label className="text-muted-foreground text-xs" htmlFor={label}>
        Your words for this reply. Save keeps them on the draft; nothing is sent.
      </label>
      <Textarea className="measure font-sans" disabled={actions.pending} id={label} onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} ref={box} spellCheck value={value} />
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton disabled={!ok || actions.pending} onClick={submit} size="s" variant="secondary">
          {actions.edit.isPending ? "Saving" : "Save"}
        </ActionButton>
        <ActionButton disabled={actions.pending} onClick={onClose} size="s" variant="quiet">
          Cancel
        </ActionButton>
        <span className="text-muted-foreground text-xs">⌘ Enter saves, Esc cancels</span>
      </div>
    </div>
  );
}

/**
 * The agent's open draft of one chat (P71 M3): its text in full, what admitted it (a follow-up, the owner's request), and the
 * three decisions. Send is shown disabled with its reason until the send door takes messenger drafts (P71 M4); Edit opens the
 * text in place (an action's own form, `admin-principles.md` rule 9); Skip sets it aside with Undo. Its ref is `mdraft:<id>`
 * (P72), so a press on it tells the agent which draft he means; it is not a tab stop of its own (the buttons are).
 */
export function DraftBlock({ d, name, actions }: { d: MessengerDraftDto; name: string; actions: Actions }) {
  const [editing, setEditing] = useState(false);
  const reason = useId();
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="messenger-draft" {...agentRef(`mdraft:${d.id}`)}>
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
        <span>Drafted by the agent</span>
        {d.nudge && <Badge variant="outline">Follow-up</Badge>}
        {d.ownerRequest && <span className="min-w-0 break-words">You asked: {d.ownerRequest}</span>}
      </div>
      {editing ? (
        <Editor actions={actions} d={d} onClose={() => setEditing(false)} />
      ) : (
        <>
          <p className="measure whitespace-pre-wrap break-words text-sm" data-agent-label="">
            {d.text}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton aria-describedby={reason} disabled size="s" variant="primary">
              Send
            </ActionButton>
            <ActionButton disabled={actions.pending} onClick={() => setEditing(true)} size="s" variant="secondary">
              Edit<span className="sr-only"> the draft for {name}</span>
            </ActionButton>
            <ActionButton disabled={actions.pending} onClick={() => actions.skip.mutate({ id: d.id, name })} size="s" variant="quiet">
              Skip<span className="sr-only"> the draft for {name}</span>
            </ActionButton>
            <span className="text-muted-foreground text-xs" id={reason}>
              {SEND_LATER}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
