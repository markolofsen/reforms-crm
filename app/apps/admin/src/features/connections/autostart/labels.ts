import type { AutostartDto } from "@hub/contract/autostart";
import { hhmm } from "@/lib/format";

/** One part of the status line: words, then the command that fixes it (shown as code, with Copy), when there is one. */
export type Said = { text: string; fix?: string };

/** The fix line when the agent is not set up (the server sends it; this is the same words for a server that sent none). */
const SET_UP = "./run.sh setup --only autostart.agent";

/**
 * The row's one status line (P67 verdict 12): exactly one of set up, stopped by the guard, off, on (by launchd or by hand).
 * Null off macOS: the row is not drawn.
 */
export function autostartSaid(d: AutostartDto): Said | null {
  if (!d.supported) return null;
  if (!d.installed) return { text: "Not set up:", fix: d.fix ?? SET_UP };
  if (d.guard) return { text: `Stopped after 5 failed starts at ${hhmm(d.guard.at)}: ${d.guard.error}. Fix, then`, fix: "./run.sh restart" };
  if (!d.enabled) return { text: "Off: this server keeps running until you stop it; it will not start after the next restart." };
  if (!d.loaded) return { text: "On, but launchd has not loaded it:", fix: d.fix ?? SET_UP };
  if (d.startedBy === "launchd") return { text: `On: started by launchd${d.lastStart ? ` at ${hhmm(d.lastStart.at)}` : ""}.` };
  return { text: "On: this server was started by hand; launchd takes over at the next restart." };
}

/** The second line when autostart is on and the agent session's Mail (mail-mcp) does not answer: an autostarted Hub never hides it. */
export const mailMcpSaid = (d: AutostartDto): Said | null => (d.enabled && d.mailMcp === false ? { text: "mail-mcp is not running:", fix: "brew services start mail-mcp" } : null);
