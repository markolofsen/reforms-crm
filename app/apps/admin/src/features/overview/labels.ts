import { AlertTriangleIcon, CheckCircle2Icon, CircleDashedIcon, ClockIcon, MinusCircleIcon, OctagonAlertIcon, RefreshCwIcon, XCircleIcon, type LucideIcon } from "lucide-react";
import type { ATTENTION_FOCUS, AttentionItem, Freshness, Severity, VerdictDto } from "@hub/contract/overview";
import { ago, hhmm, plural } from "@/lib/format";
import { paths, type Dest } from "@/routes/paths";

type Look = { word: string; Icon: LucideIcon; tone: string };

/** Severity is an icon and a word, never a colour alone. Total over the contract's union (a new severity fails `tsc`). */
export const SEVERITY: Record<Severity, Look> = {
  blocker: { word: "Blocked", Icon: OctagonAlertIcon, tone: "text-destructive-foreground" },
  "needs-owner": { word: "Needs you", Icon: AlertTriangleIcon, tone: "text-warning-foreground" },
  watch: { word: "Watch", Icon: ClockIcon, tone: "text-muted-foreground" },
};

/** Freshness is text with an icon. `off` is "not set up", never a zero. */
export const FRESHNESS: Record<Freshness, Look> = {
  fresh: { word: "Fresh", Icon: CheckCircle2Icon, tone: "text-success-foreground" },
  stale: { word: "Stale", Icon: ClockIcon, tone: "text-warning-foreground" },
  never: { word: "Not read yet", Icon: CircleDashedIcon, tone: "text-muted-foreground" },
  refreshing: { word: "Reading", Icon: RefreshCwIcon, tone: "text-info-foreground" },
  error: { word: "Failed", Icon: XCircleIcon, tone: "text-destructive-foreground" },
  off: { word: "Not set up", Icon: MinusCircleIcon, tone: "text-muted-foreground" },
};

export const VERDICT: Record<VerdictDto["level"], Look> = {
  clear: { word: "All clear", Icon: CheckCircle2Icon, tone: "text-success-foreground" },
  attention: { word: "Needs you", Icon: AlertTriangleIcon, tone: "text-warning-foreground" },
  blocked: { word: "Blocked", Icon: OctagonAlertIcon, tone: "text-destructive-foreground" },
};

/** A live number as the page reads it: the contract's union flattened, so one component renders every block. */
export type Live<T> = { state: Freshness; asOf?: string | undefined; value?: T | undefined; message?: string | undefined; fix?: string | undefined };

/** "as of 14:02 (12 min ago)" */
export const asOfText = (iso: string, now: number) => `as of ${hhmm(iso)} (${ago(iso, now)})`;

/** `2 000+` at the page cap, so a capped count never reads as exact. */
export const countText = (count: number, capped: boolean) => `${count.toLocaleString("en-GB")}${capped ? "+" : ""}`;

const FOCUS_VERB: Record<(typeof ATTENTION_FOCUS)[number], string> = { drafts: "Open drafts", project: "Open project", overview: "Show on this page" };

/**
 * Where an item leads. The server sends (focus, filter, project) and never a URL; this maps them to `paths.*`.
 * `project` is the item's own project (null for a system-wide item: the link then keeps the open one).
 */
export function attentionTarget(item: AttentionItem): { to: Dest; project: string | null; verb: string } {
  const verb = `${FOCUS_VERB[item.focus]}${item.project ? ` for ${item.project}` : ""}`;
  if (item.focus === "drafts") return { to: paths.drafts.list({ filter: item.filter }), project: item.project, verb };
  if (item.focus === "overview") return { to: paths.overview({ focus: item.project ?? undefined }), project: null, verb };
  return { to: paths.project.page(), project: item.project, verb };
}

export const headline = (n: number) => (n === 0 ? "All clear" : `${plural(n, "thing")} ${n === 1 ? "needs" : "need"} you`);
