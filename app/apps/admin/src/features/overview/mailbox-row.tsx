import { FRESHNESS, asOfText, type Live } from "./labels";
import type { MailboxDto } from "@hub/contract/overview";

/** The state of one live number in words and an icon: "Stale, as of 11:02 (3 h ago)". Colour only reinforces. */
export function FreshnessNote<T>({ b, now }: { b: Live<T>; now: number }) {
  const { word, Icon, tone } = FRESHNESS[b.state];
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1 text-xs ${tone}`}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {word}
      {b.asOf && b.state !== "never" && <span className="text-muted-foreground">, {asOfText(b.asOf, now)}</span>}
    </span>
  );
}

/** What a failed read says: the cause and what to fix, never the provider's own text. Keeps the last good number visible beside it. */
export function ReadFailure<T>({ b }: { b: Live<T> }) {
  if (b.state !== "error") return null;
  return (
    <p className="break-words text-destructive-foreground text-xs">
      {b.message} {b.fix}
    </p>
  );
}

/**
 * One mailbox of a project: the account, how many messages are new since the last triage, and how fresh that is.
 * A mailbox with no login is `off` ("not set up", not a zero); the count of a mailbox with no filter rules is an upper bound.
 */
export function MailboxRow({ m, now, reading }: { m: MailboxDto; now: number; reading: boolean }) {
  const b = m.newSinceTriage;
  const value = "value" in b ? b.value : undefined;
  return (
    <li className="flex min-w-0 flex-col gap-1 py-2">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
        <span className="min-w-0 break-all font-medium text-sm">{m.account}</span>
        {value ? (
          <span className="text-sm tabular-nums">{value.count.toLocaleString("en-GB")} new since triage</span>
        ) : b.state === "off" ? (
          <span className="text-muted-foreground text-sm">{b.message}</span>
        ) : (
          <span className="text-muted-foreground text-sm">{b.state === "never" ? "Not read yet" : "No count yet"}</span>
        )}
      </div>
      {value?.mayOverstate && <p className="text-muted-foreground text-xs">May include messages that are not clients: no filter rules are set.</p>}
      {m.shared && <p className="text-muted-foreground text-xs">Also listed by another project; both show this read.</p>}
      <ReadFailure b={b} />
      <div className="flex flex-wrap items-center gap-x-3">
        {b.state !== "off" && (reading ? <span className="text-info-foreground text-xs">Reading mailbox...</span> : <FreshnessNote b={b} now={now} />)}
      </div>
    </li>
  );
}
