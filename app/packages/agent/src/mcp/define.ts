import type { McpServer } from "@modelcontextprotocol/server";
import type { z } from "zod";
import type { ToolCtx } from "./ports";
import type { RefusalCode } from "./refusals";
import { noteOwnerFix } from "./owner-fixes";
import { DB_BEHIND, run, ToolError } from "./result";
import { ACTION_ENV, isActionId, newActionId, toolActionOf } from "@hub/config/action-id";
import { errFields, ops, withAction } from "@hub/log/ops";

// P129 A2 (verdict 1): one tool is one `defineTool` entry. `effect` derives the MCP annotations and is what the capability
// matrix reads (approval-and-capabilities: the `draft` tools are the only writers of a draft, `send` is decision 0046's one
// send on the owner's word); `output` is registered as `outputSchema`, so `structuredContent` is validated; the handler
// takes the tool context and the parsed input and returns exactly the output's type, so `tsc` holds the schema to the code.

export type Effect = "read" | "pointer" | "draft" | "send";

/**
 * P147 verdict 10: the one time limit of every HTTP-backed tool (the loopback calls of `chats_unlinked`, `chats_propose_hide`,
 * `client_create`, `chat_link` and `messenger_send`): 10 s for a read or a proposal, 150 s for a write that creates (a link loads
 * a chat's history), 60 s for the one send. A slow server answers `unavailable` with `retry_after_s` in about the limit, never a
 * hang: the 2026-11-25 dock turn waited on `chats_unlinked` while the server logged 44 s requests under load.
 */
export const HTTP_TOOL_LIMIT_MS = { read: 10_000, create: 150_000, send: 60_000 } as const;
export const HTTP_RETRY_AFTER_S = 30;
/** The one text of a slow server (verdict 10). */
export const slowServerText = (ms: number): string => `The Hub server did not answer in ${Math.round(ms / 1000)} s (busy). Tell the owner in one line; try once more at most.`;
/** Whether a fetch failed by its time limit (AbortSignal.timeout), not by a refused connection. */
export const timedOut = (e: unknown): boolean => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
/** The one refusal of an HTTP-backed tool whose server did not answer (status 0). */
export const unavailableAnswer = (message: string): ToolError => new ToolError("unavailable", message, { retry_after_s: HTTP_RETRY_AFTER_S });

/** At most this many characters per description (P129 verdict 6): what the tool does and returns, no refusal handling. */
export const DESCRIPTION_MAX = 600;

export interface ToolDef<I extends z.ZodObject = z.ZodObject, O extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: I;
  output: O;
  effect: Effect;
  /** Every code the handler may refuse with, beyond the ones every tool has (`unbound`, `invalid`). */
  refusals: readonly RefusalCode[];
  /** A method, so a list of tools of different schemas is one array (`TOOLS`). */
  handler(ctx: ToolCtx, input: z.output<I>): Promise<z.input<O>>;
}

/** Identity with the types bound: the input and output schemas type the handler. */
export const defineTool = <I extends z.ZodObject, O extends z.ZodObject>(def: ToolDef<I, O>): ToolDef<I, O> => def;

const ANNOTATIONS: Record<Effect, { readOnlyHint: boolean; idempotentHint: boolean; destructiveHint: boolean; openWorldHint: boolean }> = {
  read: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  pointer: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  draft: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false },
  send: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: true },
};

export const annotationsOf = (effect: Effect) => ANNOTATIONS[effect];

/** Registers each tool on the server, its body run by `run` (refusals with their advice; an owner-fix refusal is recorded, P133). The SDK parses the arguments with
 *  `inputSchema` and hands over the parsed value (transforms applied); parsing it again would run each transform twice. */
export function registerTools(server: McpServer, tools: readonly ToolDef[], ctx: ToolCtx): void {
  for (const t of tools) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input, outputSchema: t.output, annotations: annotationsOf(t.effect) }, (input: unknown, extra?: { mcpReq?: { _meta?: Record<string, unknown> } }) =>
      withAction(toolActionOf(sessionAction(), callIdOf(extra?.mcpReq?._meta)), () => timed(t, () => run(async () => { if ((ctx.env.dbBehind?.() ?? 0) > 0) throw new ToolError("db_behind", DB_BEHIND); return t.handler(ctx, input as Parameters<typeof t.handler>[1]); }, (refused) => noteOwnerFix(ctx, t.name, refused)))),
    );
  }
}

/** This `hub mcp` process's action: the session's `HUB_ACTION`, else one of its own for the process's life. */
let own: string | undefined;
const sessionAction = (): string => {
  const env = process.env[ACTION_ENV];
  return isActionId(env) ? env : (own ??= newActionId("s"));
};

/** Claude Code names the tool call in the request's `_meta` (`claudecode/toolUseId`); the session log's hook pairs on the same id. */
function callIdOf(meta: Record<string, unknown> | undefined): string | undefined {
  const v = meta?.["claudecode/toolUseId"];
  return typeof v === "string" && v ? v : undefined;
}

/**
 * P137 L2: a tool that writes (`draft`, `send`, `pointer`) leaves one line at its outcome: info with its time, warn with the
 * refusal's code, error once with the cause (then thrown on). A read leaves none: the session log has every call.
 */
async function timed<R extends { isError?: boolean; content?: unknown }>(t: ToolDef, fn: () => Promise<R>): Promise<R> {
  const t0 = Date.now();
  try {
    const r = await fn();
    if (t.effect !== "read") {
      if (r.isError) ops("agent").warn(`tool ${t.name} refused`, { tool: t.name, refusal: refusalCodeOf(r.content), ms: Date.now() - t0 });
      else ops("agent").info(`tool ${t.name} done`, { tool: t.name, ms: Date.now() - t0 });
    }
    return r;
  } catch (e) {
    ops("agent").error(`tool ${t.name} failed`, { tool: t.name, ms: Date.now() - t0, ...errFields(e) });
    throw e;
  }
}

/** The refusal's stable code from its reply (`{"error":"unbound",...}`), never its message. */
function refusalCodeOf(content: unknown): string | null {
  const first: unknown = Array.isArray(content) ? content[0] : undefined;
  const text: unknown = first && typeof first === "object" ? Reflect.get(first, "text") : undefined;
  if (typeof text !== "string") return null;
  try {
    const v: unknown = JSON.parse(text);
    const code: unknown = v && typeof v === "object" ? Reflect.get(v, "error") : undefined;
    return typeof code === "string" ? code.slice(0, 60) : null;
  } catch {
    return null;
  }
}
