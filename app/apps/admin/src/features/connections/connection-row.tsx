import { PlayIcon } from "lucide-react";
import type { ConnectionDto } from "@hub/contract/connections";
import { ActionButton } from "@/components/action-button";
import { ago, asOfText } from "@/features/overview/labels";
import { CHECK_ICON, CHECK_WORD, SECRET } from "./labels";

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

/** One connection: what it is, where the key stands, who uses it, the last test, and the Test button when a test is possible. */
export function ConnectionRow({ row, now, busy, locked, onTest }: { row: ConnectionDto; now: number; busy: boolean; locked: boolean; onTest: () => void }) {
  const { word, Icon, tone } = SECRET[row.secret.state];
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
        {row.can.includes("test") && (
          <ActionButton aria-busy={busy} aria-label={`Test ${row.label}`} disabled={locked} onClick={onTest} size="s" variant="secondary">
            <PlayIcon aria-hidden="true" />
            {busy ? "Testing..." : "Test"}
          </ActionButton>
        )}
      </div>
      {row.usedBy.length > 0 && <p className="text-muted-foreground text-xs">Used by {row.usedBy.join(", ")}</p>}
      {row.note && <p className="text-muted-foreground text-xs">{row.note}</p>}
      {row.can.includes("test") && <Check c={row.check} now={now} />}
    </li>
  );
}
