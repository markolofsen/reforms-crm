import { CheckCircle2Icon, CircleDashedIcon, CircleHelpIcon, ClockIcon, OctagonAlertIcon, XCircleIcon, type LucideIcon } from "lucide-react";
import type { ConnectionDto, ConnectionKind, MailAccountDto, MailReadDto, SecretState } from "@hub/contract/connections";
import { ago, hhmm } from "@/lib/format";

type Look = { word: string; Icon: LucideIcon; tone: string };
type MailReadState = MailReadDto["state"];

/** Total over the contract's union (a new state fails `tsc`). A state is an icon and a word, never a colour alone. */
export const SECRET: Record<SecretState, Look> = {
  stored: { word: "Key stored", Icon: CheckCircle2Icon, tone: "text-success-foreground" },
  missing: { word: "Not set", Icon: CircleDashedIcon, tone: "text-muted-foreground" },
  "unsafe-mode": { word: "File readable by others", Icon: OctagonAlertIcon, tone: "text-destructive-foreground" },
  malformed: { word: "Key file is damaged", Icon: XCircleIcon, tone: "text-destructive-foreground" },
  "from-env": { word: "Set by the environment", Icon: CheckCircle2Icon, tone: "text-success-foreground" },
};

/** The test result in words. `fresh` means the last test passed or failed within the hour: the verdict is in the detail, not the state. */
export const CHECK_WORD = { fresh: "Tested", stale: "Tested earlier", never: "Not tested yet", refreshing: "Testing", error: "Test failed" } as const satisfies Record<ConnectionDto["check"]["state"], string>;
export const CHECK_ICON: Record<ConnectionDto["check"]["state"], LucideIcon> = { fresh: CheckCircle2Icon, stale: ClockIcon, never: CircleDashedIcon, refreshing: ClockIcon, error: XCircleIcon };

/**
 * Whether Apple Mail has the account. `null`: Mail could not be asked, never a guess; `read` says why (closed, or running
 * but not answering: then the word is a warning, and the section shows the fix line).
 */
export function foundLook(found: MailAccountDto["foundInMail"], read: MailReadState = "answered"): Look {
  if (found === null && read === "not-answering") return { word: "Mail is not answering", Icon: ClockIcon, tone: "text-warning-foreground" };
  if (found === null) return { word: "Mail is not running", Icon: CircleHelpIcon, tone: "text-muted-foreground" };
  return found ? { word: "Found in Apple Mail", Icon: CheckCircle2Icon, tone: "text-success-foreground" } : { word: "Not found in Apple Mail", Icon: XCircleIcon, tone: "text-warning-foreground" };
}

export const KIND_TITLE: Record<ConnectionKind, string> = { notion: "Notion", telegram: "Telegram" };
/** The order on Settings ▸ Connections. */
export const KIND_ORDER: readonly ConnectionKind[] = ["notion", "telegram"];

export function groupByKind(rows: readonly ConnectionDto[]): { kind: ConnectionKind; rows: ConnectionDto[] }[] {
  return KIND_ORDER.map((kind) => ({ kind, rows: rows.filter((r) => r.kind === kind) })).filter((g) => g.rows.length > 0);
}

/** "as of 14:02 (12 min ago)" */
export const asOfText = (iso: string, now: number) => `as of ${hhmm(iso)} (${ago(iso, now)})`;
