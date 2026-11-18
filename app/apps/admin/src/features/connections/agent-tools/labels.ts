import { CircleCheckIcon, CircleMinusIcon, CircleXIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import type { AgentToolRow, AgentToolState, AgentToolsDto } from "@hub/contract/agent-tools";
import { AGENT_TOOL_CLIS } from "@hub/contract/agent-tools";
import { plural } from "@/lib/format";

type Look = { word: string; Icon: LucideIcon; tone: string };

/** Total over the contract's states (a new one fails `tsc`). A state is an icon and a word, never a colour alone. */
export const STATE_LOOK: Record<AgentToolState, Look> = {
  pass: { word: "OK", Icon: CircleCheckIcon, tone: "text-success-foreground" },
  warn: { word: "Check", Icon: TriangleAlertIcon, tone: "text-warning-foreground" },
  fail: { word: "Needs a fix", Icon: CircleXIcon, tone: "text-destructive-foreground" },
  skip: { word: "Skipped", Icon: CircleMinusIcon, tone: "text-muted-foreground" },
};

export const CLI_TITLE: Record<(typeof AGENT_TOOL_CLIS)[number], string> = { claude: "Claude Code", codex: "Codex" };

/** The rows of one CLI, in the server's order. */
export const columns = (rows: readonly AgentToolRow[]) => AGENT_TOOL_CLIS.map((cli) => ({ cli, rows: rows.filter((r) => r.cli === cli) }));

/** The block's one status line: the worst fact in plain words, then the mode. Never a number the rows already show twice. */
export function toolsSentence(d: AgentToolsDto): string {
  const fails = d.rows.filter((r) => r.state === "fail").length;
  const warns = d.rows.filter((r) => r.state === "warn").length;
  const standing = fails > 0 ? `${plural(fails, "check")} to fix` : warns > 0 ? `Ready, ${plural(warns, "check")} to look at` : "Ready";
  const mode = d.unattended ? "unattended (no prompts, sandboxed)" : "asks before it acts";
  return `${standing} · ${mode} · default ${CLI_TITLE[d.defaultCli]}`;
}
