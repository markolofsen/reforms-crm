import type { HealthDto } from "@hub/contract/health";
import type { OverviewDto } from "@hub/contract/overview";
import { ActionButton } from "@hub/ui/product/action-button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { AppLink } from "@/components/app-link";
import { hhmm, plural } from "@/lib/format";
import { paths, type Dest } from "@/routes/paths";
import { cn } from "@hub/ui/cn";

type Tone = "ok" | "warn" | "bad" | "off";
/** `to`: where the thing the row names is set up (a link, never the only way to know). */
type Row = { text: string; tone: Tone; to?: Dest };
/**
 * What the Overview says about everything, as the one line of the shell. `unknown` is never "all clear": before the first
 * answer it is "Checking", after a failed first answer "Status unknown". `old` is true when the server is not answering,
 * so the line says when it was true instead of looking current.
 */
export type Standing =
  | { kind: "unknown"; why: "loading" | "failed" }
  | { kind: "known"; level: OverviewDto["verdict"]["level"]; need: number; watch: number; asOf: string; old: boolean };
export type StatusInput = { health: HealthDto | null; stale: boolean; serverOlder: boolean; serverNewer: boolean };
export type FooterInput = StatusInput & { standing: Standing };

/** The Overview's verdict and attention list (one source, `GET /api/overview`) reduced to the line. `failed`: the last request failed. */
export function standingOf(data: OverviewDto | undefined, failed: boolean, serverStale: boolean): Standing {
  if (!data) return { kind: "unknown", why: failed ? "failed" : "loading" };
  const watch = data.attention.filter((i) => i.severity === "watch").length;
  return { kind: "known", level: data.verdict.level, need: data.attention.length - watch, watch, asOf: data.serverTime, old: failed || serverStale };
}

/** One short line, plain words: the state first, then how old it is when it may be old. */
export function standingText(s: Standing): string {
  if (s.kind === "unknown") return s.why === "loading" ? "Checking status" : "Status unknown";
  const age = s.old ? `, as of ${hhmm(s.asOf)}` : "";
  if (s.level === "clear") return `${s.watch > 0 ? `All clear, ${s.watch} to watch` : "All clear"}${age}`;
  return `${s.level === "blocked" ? "Blocked: " : ""}${plural(s.need, "thing")} ${s.need === 1 ? "needs" : "need"} you${age}`;
}

const standingTone = (s: Standing): Tone => (s.kind === "unknown" ? "off" : s.old ? "warn" : s.level === "blocked" ? "bad" : s.level === "attention" ? "warn" : "ok");

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
export function statusRows(input: StatusInput): Row[] {
  return [...shellRows(input), ...healthRows(input)];
}

/** What only the shell can know (the Overview cannot, it comes from the same server): not answering, a version mismatch. */
function shellRows({ stale, serverOlder, serverNewer }: StatusInput): Row[] {
  const rows: Row[] = [];
  if (stale) rows.push({ text: "Server not answering: data may be old", tone: "bad" });
  if (serverOlder) rows.push({ text: "Server older than this page: restart it with hub up", tone: "warn" });
  if (serverNewer) rows.push({ text: "Server newer than this page: reload", tone: "warn" });
  return rows;
}

/** The server's loops as plain rows. Their failures are also attention items of the Overview, so the line counts them once, there. */
function healthRows({ health }: StatusInput): Row[] {
  const rows: Row[] = [];
  if (health) {
    const m = health.mail;
    rows.push(m.state === "off" ? { text: "Mail not set up", tone: "off", to: paths.connections.page() } : m.problems.length > 0 ? { text: `Mail: ${plural(m.problems.length, "problem")}`, tone: "warn" } : { text: `Mail ready (${m.accounts})`, tone: "ok" });
    rows.push(live("Sent detection", health.sent.state), live("Messengers", health.messengers.state, paths.connections.page()));
  }
  return rows;
}

/**
 * The sidebar footer: ONE line, the Overview's verdict ("All clear", "3 things need you", with its age when the server is
 * not answering), which leads to the Overview. A shell-only problem (server not answering, version mismatch) is listed
 * under it; the server's loops are behind Details. A Test mode block shows while the Mailer is fake.
 */
export function StatusFooter(props: FooterInput) {
  const shell = shellRows(props);
  const loops = healthRows(props);
  const testMode = props.health?.mailer === "fake";
  const tones = [standingTone(props.standing), ...shell.map((r) => r.tone)];
  const worst = WORST.find((t) => tones.includes(t)) ?? "off";
  return (
    <div className="flex min-w-0 flex-col gap-2 px-2 py-1">
      {testMode && (
        <div className="rounded-md border border-info/32 bg-info/8 p-2 text-foreground text-xs group-data-[collapsible=icon]:sr-only" role="note">
          <p className="font-medium">Test mode</p>
          <p>Nothing is really sent.</p>
        </div>
      )}
      <Collapsible>
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className={cn("hidden size-2.5 shrink-0 rounded-full group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:block", DOT[worst])} />
          <p className="min-w-0 font-medium text-xs group-data-[collapsible=icon]:sr-only" role="status">
            <AppLink inProject={null} to={paths.overview()}>
              {standingText(props.standing)}
            </AppLink>
          </p>
          {loops.length > 0 && <CollapsibleTrigger render={<ActionButton className="ms-auto group-data-[collapsible=icon]:hidden" size="s" variant="quiet" />}>Details</CollapsibleTrigger>}
        </div>
        {shell.length > 0 && (
          <ul aria-label="Server" className="flex min-w-0 flex-col gap-1 pt-1 text-xs group-data-[collapsible=icon]:sr-only">
            {shell.map((r) => (
              <Item key={r.text} row={r} />
            ))}
          </ul>
        )}
        <CollapsiblePanel>
          <ul aria-label="Server status" className="flex min-w-0 flex-col gap-1 pt-1 text-xs group-data-[collapsible=icon]:sr-only">
            {loops.map((r) => (
              <Item key={r.text} row={r} />
            ))}
          </ul>
        </CollapsiblePanel>
      </Collapsible>
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
