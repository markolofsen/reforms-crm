import { AlertTriangleIcon, CheckCircle2Icon, CircleHelpIcon, CircleXIcon, OctagonAlertIcon, type LucideIcon } from "lucide-react";
import type { ProjectRowDto, StatusDto, StatusLevel, StatusNext } from "@hub/contract/overview";
import { SCHEME_WORDS, type SchemeState } from "@hub/contract/scheme";
import { ago } from "@/lib/format";
import { routeDest, type Dest } from "@/routes/paths";
import { NEXT_ROUTE } from "@/routes/sections";

type Look = { word: string; Icon: LucideIcon; tone: string };

/** A level is an icon and a word, never a colour alone. Total over the contract's union (a new level fails `tsc`). */
export const LEVEL: Record<StatusLevel, Look> = {
  clear: { word: "All clear", Icon: CheckCircle2Icon, tone: "text-success-foreground" },
  attention: { word: "Needs you", Icon: AlertTriangleIcon, tone: "text-warning-foreground" },
  blocked: { word: "Blocked", Icon: OctagonAlertIcon, tone: "text-destructive-foreground" },
};

/** The Needs you cell: the project's worst fact, or a dash when it is all clear (the sentence is said once, by the page). */
export const needsYou = (s: StatusDto): string => (s.level === "clear" ? "-" : s.sentence);

/** "2 h ago", or "Never" for a project the agent has not triaged yet. `now` comes from the clock. */
export const triageText = (iso: string | null, now: number): string => (iso ? ago(iso, now) : "Never");

/** The project's own status word; an archived project says so whatever its file says. */
export const statusWord = (p: ProjectRowDto): string => (p.archived ? "archived" : p.projectStatus);

/** The page a place names (`statusDto.next`, a part's `place`): total over the contract's places through `NEXT_ROUTE`. */
export const placeDest = (place: StatusNext): Dest => routeDest(NEXT_ROUTE[place]);

/** Where the worst fact is fixed (the server names the place, never a URL), or null when the project is clear or the fix is the list itself. */
export function nextDest(s: StatusDto): Dest | null {
  if (s.level === "clear" || s.next === null) return null;
  return placeDest(s.next);
}

/** A part's standing as a word and an icon (P63 plan 4c), never a colour alone. Total over the contract's states; the words are the contract's (the drawing's labels say the same). */
export const SCHEME_LOOK: Record<SchemeState, Look> = {
  fail: { word: SCHEME_WORDS.fail, Icon: CircleXIcon, tone: "text-destructive-foreground" },
  warn: { word: SCHEME_WORDS.warn, Icon: AlertTriangleIcon, tone: "text-warning-foreground" },
  unknown: { word: SCHEME_WORDS.unknown, Icon: CircleHelpIcon, tone: "text-muted-foreground" },
  ok: { word: SCHEME_WORDS.ok, Icon: CheckCircle2Icon, tone: "text-success-foreground" },
};

/** The rows in the server's order, archived projects last. */
export const ordered = (rows: readonly ProjectRowDto[]): ProjectRowDto[] => [...rows.filter((p) => !p.archived), ...rows.filter((p) => p.archived)];
