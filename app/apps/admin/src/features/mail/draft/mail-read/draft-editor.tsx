import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationEditorSurface } from "@hub/ui/product/composer-editor";

type EditorProps = {
  value: string;
  disabled: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

/**
 * The owner edits the draft's words (P56 S1) in the shared plain-text editor (P123 U0, until P93). The saved value is plain text,
 * so Mail receives exactly the owner's words. Save is explicit: Meta or Ctrl + Enter, Esc cancels. A live read never replaces
 * what is typed here; it says the text changed in Mail, and the Save is refused until read again.
 */
export function DraftEditor({ value, disabled, onCancel, onChange, onSubmit }: EditorProps) {
  return <ConversationEditorSurface ariaLabel="Edit the Mail draft" autoFocus description="Editing the text Mail holds. Save writes it to Mail and turns Checked off." disabled={disabled} maxLength={20_000} onCancel={onCancel} onChange={onChange} onSubmit={onSubmit} title="Edit draft" value={value} />;
}

type FooterProps = {
  dirty: boolean;
  changedUnder: boolean;
  pending: boolean;
  error: string | null;
  value: string;
  onCancel: () => void;
  onSubmit: () => void;
};

export function DraftEditorFooter({ dirty, changedUnder, pending, error, value, onCancel, onSubmit }: FooterProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {changedUnder && (
        <p className="basis-full text-sm text-warning-foreground" role="status">
          Changed in Mail since you started editing. Your text is still here: copy it, cancel, and edit the new version.
        </p>
      )}
      {error !== null && <p className="basis-full text-destructive-foreground text-sm" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton disabled={!dirty || pending || !value.trim() || changedUnder} onClick={onSubmit} size="s" variant="secondary">
          {pending ? "Saving to Mail" : "Save"}
        </ActionButton>
        <ActionButton disabled={pending} onClick={onCancel} size="s" variant="quiet">
          Cancel
        </ActionButton>
      </div>
    </div>
  );
}
