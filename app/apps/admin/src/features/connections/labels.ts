import { CheckCircle2Icon, CircleDashedIcon, ClockIcon, OctagonAlertIcon, XCircleIcon, type LucideIcon } from "lucide-react";
import type { ConnectionDto, ConnectionKind, SecretState } from "@hub/contract/connections";

type Look = { word: string; Icon: LucideIcon; tone: string };

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

export const KIND_TITLE: Record<ConnectionKind, string> = { mail: "Mail", notion: "Notion", telegram: "Telegram" };
/** The order on the page. */
export const KIND_ORDER: readonly ConnectionKind[] = ["mail", "notion", "telegram"];

export function groupByKind(rows: readonly ConnectionDto[]): { kind: ConnectionKind; rows: ConnectionDto[] }[] {
  return KIND_ORDER.map((kind) => ({ kind, rows: rows.filter((r) => r.kind === kind) })).filter((g) => g.rows.length > 0);
}
