import { pathsAt, type HubPaths } from "@hub/config/paths";
import { guidanceInError, guidanceNote, replyGuidance, serverLabel, vendorTool } from "@hub/agent/connector-guard";
import { recordCleanedReplyAt } from "@hub/db";

// P154: what the post hooks print. One `hookSpecificOutput` per call (verdict 9): the replacement reply, if any, and every note
// joined in `additionalContext`; nothing at all when the reply is unchanged and no note applies. And the vendor-guidance step of
// both hooks: `hub guard --post` (PostToolUse) replaces the reply, `hub guard --post-failure` (PostToolUseFailure: an error
// result, which Claude Code lets a hook annotate but not replace; observed on 2.1.220, P154 verdict 5) adds the note only.

export type PostEvent = "PostToolUse" | "PostToolUseFailure";

/** The hook's stdout, or undefined when there is nothing to say. */
export function postHookOutput(event: PostEvent, o: { updated?: unknown; notes?: readonly (string | null | undefined)[] }): string | undefined {
  const notes = (o.notes ?? []).filter((n): n is string => typeof n === "string" && n.trim() !== "");
  if (o.updated === undefined && !notes.length) return undefined;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, ...(o.updated !== undefined ? { updatedMCPToolOutput: o.updated } : {}), ...(notes.length ? { additionalContext: notes.join("\n") } : {}) } });
}

interface Who { slug: string | undefined; session: string; paths: HubPaths }

/** One Activity line per session and tool (verdict 7); never throws, never blocks the hook. */
function noteForOwner(w: Who, server: string, tool: string): void {
  if (!w.slug) return;
  recordCleanedReplyAt(w.paths.db, { project: w.slug, session: w.session, server, tool, label: serverLabel(server), at: new Date().toISOString() });
}

/**
 * PostToolUse: the reply without the vendor's guidance (absent when none could be removed) and the note, or null when the tool is
 * exempt or nothing was found. A key left in the text (escaped inside a `body` string) turns the note into "ignore them".
 */
export function cleanVendorReply(toolName: string, reply: unknown, w: Who): { reply?: unknown; note: string } | null {
  const v = vendorTool(toolName);
  if (!v) return null;
  const g = replyGuidance(reply);
  if (!g) return null;
  noteForOwner(w, v.server, v.tool);
  return { ...(g.reply !== undefined ? { reply: g.reply } : {}), note: guidanceNote(v.tool, g.removedAll) };
}

interface FailurePayload { tool_name?: unknown; error?: unknown; session_id?: unknown }
export interface PostFailureEnv { root: string; env?: NodeJS.ProcessEnv; paths?: HubPaths }

/** `hub guard --post-failure`: an error reply that carries vendor guidance gets the note (it cannot be replaced). Always exit 0. */
export function runGuardPostFailure(stdin: string, g: PostFailureEnv): { code: 0; stdout?: string } {
  try {
    const p = JSON.parse(stdin) as FailurePayload;
    const v = vendorTool(String(p.tool_name ?? ""));
    if (!v || !guidanceInError(p.error)) return { code: 0 };
    const env = g.env ?? process.env;
    noteForOwner({ slug: env.HUB_PROJECT?.trim() || undefined, session: typeof p.session_id === "string" ? p.session_id : "", paths: g.paths ?? pathsAt(g.root, env) }, v.server, v.tool);
    const stdout = postHookOutput("PostToolUseFailure", { notes: [guidanceNote(v.tool, false)] });
    return { code: 0, ...(stdout ? { stdout } : {}) };
  } catch {
    return { code: 0 };
  }
}
