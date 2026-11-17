import type { HealthDto } from "@hub/contract/health";
import { ActionButton } from "@hub/ui/product/action-button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { AppLink } from "@/components/app-link";
import { plural } from "@/lib/format";
import { paths, type Dest } from "@/routes/paths";
import { cn } from "@hub/ui/cn";

type Tone = "ok" | "warn" | "bad" | "off";
/** `to`: where the thing the row names is set up (a link, never the only way to know). */
type Row = { text: string; tone: Tone; to?: Dest };
export type StatusInput = { health: HealthDto | null; stale: boolean; serverOlder: boolean; serverNewer: boolean };

const DOT: Record<Tone, string> = { ok: "bg-success", warn: "bg-warning", bad: "bg-destructive", off: "bg-muted-foreground/40" };
const WORST: Tone[] = ["bad", "warn", "ok", "off"];

function live(label: string, state: HealthDto["sent"]["state"], to?: Dest): Row {
  const at = to ? { to } : {};
  if (state === "running") return { text: `${label} on`, tone: "ok", ...at };
  if (state === "error") return { text: `${label} failing`, tone: "bad", ...at };
  if (state === "starting") return { text: `${label} starting`, tone: "warn", ...at };
  return { text: `${label} off`, tone: "off", ...at };
}

/**
 * What the server can do now, as plain rows. Deviations (old data, version mismatch, a failing service, mail problems)
 * are the attention rows; "off" is a choice not yet made ("Not set up"), so it is shown but never counted. The fake
 * Mailer is not a deviation either: it is a mode, and has its own block.
 */
export function statusRows({ health, stale, serverOlder, serverNewer }: StatusInput): Row[] {
  const rows: Row[] = [];
  if (stale) rows.push({ text: "Server not answering: data may be old", tone: "bad" });
  if (serverOlder) rows.push({ text: "Server older than this page: restart it with hub up", tone: "warn" });
  if (serverNewer) rows.push({ text: "Server newer than this page: reload", tone: "warn" });
  if (health) {
    const m = health.mail;
    rows.push(m.state === "off" ? { text: "Mail not set up", tone: "off", to: paths.connections.page() } : m.problems.length > 0 ? { text: `Mail: ${plural(m.problems.length, "problem")}`, tone: "warn" } : { text: `Mail ready (${m.accounts})`, tone: "ok" });
    rows.push(live("Sent detection", health.sent.state), live("Messengers", health.messengers.state, paths.connections.page()));
  }
  return rows;
}

const needsAttention = (r: Row) => r.tone === "bad" || r.tone === "warn";

/** The sidebar footer: "All good" or "N need attention" with only the deviations, the rest behind Details; a Test mode block while the Mailer is fake. */
export function StatusFooter(props: StatusInput) {
  const rows = statusRows(props);
  const attention = rows.filter(needsAttention);
  const testMode = props.health?.mailer === "fake";
  if (rows.length === 0 && !testMode) return null;
  const worst = WORST.find((t) => rows.some((r) => r.tone === t)) ?? "off";
  const head = attention.length === 0 ? "All good" : `${attention.length} need${attention.length === 1 ? "s" : ""} attention`;
  return (
    <div className="flex min-w-0 flex-col gap-2 px-2 py-1">
      {testMode && (
        <div className="rounded-md border border-info/32 bg-info/8 p-2 text-foreground text-xs group-data-[collapsible=icon]:sr-only" role="note">
          <p className="font-medium">Test mode</p>
          <p>Nothing is really sent.</p>
        </div>
      )}
      {rows.length > 0 && (
        <Collapsible>
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className={cn("hidden size-2.5 shrink-0 rounded-full group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:block", DOT[worst])} />
            <p className="min-w-0 font-medium text-xs group-data-[collapsible=icon]:sr-only" role="status">
              {head}
            </p>
            <CollapsibleTrigger render={<ActionButton className="ms-auto group-data-[collapsible=icon]:hidden" size="s" variant="quiet" />}>Details</CollapsibleTrigger>
          </div>
          {attention.length > 0 && (
            <ul aria-label="Attention" className="flex min-w-0 flex-col gap-1 pt-1 text-xs group-data-[collapsible=icon]:sr-only">
              {attention.map((r) => (
                <Item key={r.text} row={r} />
              ))}
            </ul>
          )}
          <CollapsiblePanel>
            <ul aria-label="Server status" className="flex min-w-0 flex-col gap-1 pt-1 text-xs group-data-[collapsible=icon]:sr-only">
              {rows.filter((r) => !needsAttention(r)).map((r) => (
                <Item key={r.text} row={r} />
              ))}
            </ul>
          </CollapsiblePanel>
        </Collapsible>
      )}
    </div>
  );
}

function Item({ row }: { row: Row }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden="true" className={cn("mt-1 size-2 shrink-0 rounded-full", DOT[row.tone])} />
      {row.to ? (
        <AppLink className="min-w-0 break-words" to={row.to}>
          {row.text}
        </AppLink>
      ) : (
        <span className="min-w-0 break-words">{row.text}</span>
      )}
    </li>
  );
}
