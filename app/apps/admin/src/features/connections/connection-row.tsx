import { KeyRoundIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import type { ConnectionDto } from "@hub/contract/connections";
import type { SetSecretBody } from "@hub/contract/requests";
import { ActionButton } from "@/components/action-button";
import { ago, asOfText } from "@/features/overview/labels";
import { CHECK_ICON, CHECK_WORD, SECRET } from "./labels";
import { MailLoginForm } from "./mail-login-form";
import { SecretForm } from "./secret-form";

/** The test result as one line: the state, when, and what it learned or why it failed (the server's sentence, never the provider's). */
function Check({ c, now }: { c: ConnectionDto["check"]; now: number }) {
  const Icon = CHECK_ICON[c.state];
  const tone = c.state === "error" ? "text-destructive-foreground" : "text-muted-foreground";
  const when = "asOf" in c && c.asOf ? `, ${asOfText(c.asOf, now)}` : "";
  const detail = "value" in c && c.value ? c.value.detail : c.state === "error" ? `${c.message} ${c.fix}` : "";
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 text-xs ${tone}`}>
      <span className="inline-flex flex-wrap items-center gap-x-1">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        {CHECK_WORD[c.state]}
        {when}
      </span>
      {detail && <span className="break-words text-foreground">{detail}</span>}
    </div>
  );
}

export type RowActions = { test: () => void; save: (body: SetSecretBody) => Promise<boolean>; remove: () => Promise<boolean> };

/** Remove asks inline: what goes, that it cannot be undone, and one button. A key is gone from the disk, not archived. */
function RemoveAsk({ row, busy, onRemove, onClose }: { row: ConnectionDto; busy: boolean; onRemove: () => Promise<boolean>; onClose: () => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border p-3 text-sm" role="group" aria-label={`Remove the key of ${row.label}`}>
      <p>Remove the key of {row.label}? The file is deleted and cannot be brought back; you would have to enter it again.</p>
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton aria-busy={busy} disabled={busy} onClick={() => void onRemove().then((ok) => ok && onClose())} size="s" variant="danger">
          {busy ? "Removing..." : "Remove key"}
        </ActionButton>
        <ActionButton disabled={busy} onClick={onClose} size="s" variant="quiet">
          Cancel
        </ActionButton>
      </div>
    </div>
  );
}

const TOKEN_WHAT = { notion: "Integration token", telegram: "Bot token" } as const;

/** One connection: what it is, where the key stands, who uses it, the last test, and the actions the server offers for it. */
export function ConnectionRow({ row, now, busy, locked, actions }: { row: ConnectionDto; now: number; busy: boolean; locked: boolean; actions: RowActions }) {
  const { word, Icon, tone } = SECRET[row.secret.state];
  const [panel, setPanel] = useState<"set" | "remove" | null>(null);
  const setButton = useRef<HTMLButtonElement>(null);
  const close = () => {
    setPanel(null);
    queueMicrotask(() => setButton.current?.focus());
  };
  const stored = row.secret.state !== "missing";
  return (
    <li className="flex min-w-0 flex-col gap-2 py-3" id={`connection-${row.id.replace(/[^a-z0-9-]/gi, "-")}`}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="min-w-0 break-all font-medium text-sm">{row.label}</span>
          {row.identity && <span className="min-w-0 break-all text-muted-foreground text-xs">{row.identity}</span>}
          <span className={`inline-flex flex-wrap items-center gap-x-1 text-xs ${tone}`}>
            <Icon aria-hidden="true" className="size-3.5 shrink-0" />
            {word}
            {row.secret.changedAt && <span className="text-muted-foreground">, changed {ago(row.secret.changedAt, now)}</span>}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {row.can.includes("test") && (
            <ActionButton aria-busy={busy} aria-label={`Test ${row.label}`} disabled={locked} onClick={actions.test} size="s" variant="secondary">
              <PlayIcon aria-hidden="true" />
              {busy ? "Testing..." : "Test"}
            </ActionButton>
          )}
          {row.can.includes("set") && (
            <ActionButton aria-expanded={panel === "set"} aria-label={`${stored ? "Replace" : "Set"} the key of ${row.label}`} disabled={locked} onClick={() => setPanel(panel === "set" ? null : "set")} ref={setButton} size="s" variant="secondary">
              <KeyRoundIcon aria-hidden="true" />
              {stored ? "Replace key" : "Set key"}
            </ActionButton>
          )}
          {row.can.includes("remove") && (
            <ActionButton aria-expanded={panel === "remove"} aria-label={`Remove the key of ${row.label}`} disabled={locked} onClick={() => setPanel(panel === "remove" ? null : "remove")} size="s" variant="quiet">
              <Trash2Icon aria-hidden="true" />
              Remove
            </ActionButton>
          )}
        </div>
      </div>
      {row.usedBy.length > 0 && <p className="text-muted-foreground text-xs">Used by {row.usedBy.join(", ")}</p>}
      {row.note && <p className="text-muted-foreground text-xs">{row.note}</p>}
      {row.can.includes("test") && <Check c={row.check} now={now} />}
      {panel === "set" && row.kind === "mail" && <MailLoginForm account={row.label} busy={busy} id={row.id} identity={row.identity} onClose={close} onSave={(b) => actions.save(b)} />}
      {panel === "set" && (row.kind === "notion" || row.kind === "telegram") && <SecretForm busy={busy} id={row.id} onClose={close} onSave={(value) => actions.save({ value })} what={TOKEN_WHAT[row.kind]} />}
      {panel === "remove" && <RemoveAsk busy={busy} onClose={close} onRemove={actions.remove} row={row} />}
    </li>
  );
}
