import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { Textarea } from "@hub/ui/textarea";
import { sentence } from "@/lib/api/client";
import { useMailWrite } from "./use-mail-write";

type Props = {
  project: string;
  draftId: number;
  /** The text exactly as the read showed it (decision 0031: the Hub adds nothing to it). */
  text: string;
  /** The hash of that read: the Save is refused when Mail no longer holds exactly it. */
  hash: string;
  /** The hash of the newest read: when it moves while editing, the text changed under the editor. */
  liveHash: string | null;
  onClose: () => void;
};

/**
 * The owner edits the draft's words (P56 S1). Plain text, like the mail that goes out (the send door sends Mail's plain
 * text; a toolbar would add what Mail flattens), so the editor is the coss Textarea: native spelling, undo and input
 * methods, sized to its content. Save is explicit (each save is a new Mail draft): Cmd or Ctrl+Enter, Esc cancels. A
 * live read never replaces what is typed here; it says the text changed in Mail, and the Save is refused until read again.
 */
export function DraftEditor({ project, draftId, text, hash, liveHash, onClose }: Props) {
  const [value, setValue] = useState(text);
  const { save } = useMailWrite(project, draftId);
  const label = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  // Opening the editor is an inline disclosure: focus goes into the text (accessibility rule 3).
  useEffect(() => box.current?.focus(), []);
  const changedUnder = liveHash !== null && liveHash !== hash;
  const dirty = value !== text;
  const submit = () => {
    if (!dirty || save.isPending || !value.trim()) return;
    save.mutate({ text: value, hash }, { onSuccess: onClose });
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
      <p className="text-muted-foreground text-xs" id={label}>
        Editing the text Mail holds. Save writes it to Mail and turns I read the checks off.
      </p>
      <Textarea aria-labelledby={label} className="measure font-sans" disabled={save.isPending} onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} ref={box} spellCheck value={value} />
      {changedUnder && (
        <p className="text-sm text-warning-foreground" role="status">
          Changed in Mail since you started editing. Your text is still here: copy it, cancel, and edit the new version.
        </p>
      )}
      {save.isError && (
        <p className="text-destructive-foreground text-sm" role="alert">
          {sentence(save.error)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton disabled={!dirty || save.isPending || !value.trim() || changedUnder} onClick={submit} size="s" variant="secondary">
          {save.isPending ? "Saving to Mail" : "Save"}
        </ActionButton>
        <ActionButton disabled={save.isPending} onClick={onClose} size="s" variant="quiet">
          Cancel
        </ActionButton>
        <span className="text-muted-foreground text-xs">⌘ Enter saves, Esc cancels</span>
      </div>
    </div>
  );
}
