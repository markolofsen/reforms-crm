import { useState } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { Field } from "@hub/ui/product/field";
import { Input } from "@hub/ui/input";

/**
 * Write-only: the field never shows what is stored, and a stored key is replaced, not edited. The value lives in this component's state
 * only until the save returns; then the field is empty again. `type="password"` and `autocomplete="new-password"` keep the browser from
 * offering or remembering it.
 */
export function SecretForm({ id, what, busy, onSave, onClose }: { id: string; what: string; busy: boolean; onSave: (value: string) => Promise<boolean>; onClose: () => void }) {
  const [value, setValue] = useState("");
  const field = `secret-${id.replace(/[^a-z0-9-]/gi, "-")}`;
  return (
    <form
      className="flex min-w-0 flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(value.trim()).then((ok) => {
          setValue("");
          if (ok) onClose();
        });
      }}
    >
      <Field hint="It is saved on this computer and never shown again." htmlFor={field} label={what}>
        <Input autoCapitalize="off" autoComplete="new-password" className="control-m" id={field} onChange={(e) => setValue(e.target.value)} spellCheck={false} type="password" value={value} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton aria-busy={busy} disabled={busy || value.trim() === ""} size="s" type="submit" variant="primary">
          {busy ? "Saving..." : "Save key"}
        </ActionButton>
        <ActionButton disabled={busy} onClick={onClose} size="s" type="button" variant="quiet">
          Cancel
        </ActionButton>
      </div>
    </form>
  );
}
