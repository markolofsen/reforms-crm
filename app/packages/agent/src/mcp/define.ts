import type { McpServer } from "@modelcontextprotocol/server";
import type { z } from "zod";
import type { ToolCtx } from "./ports";
import type { RefusalCode } from "./refusals";
import { run } from "./result";

// P129 A2 (verdict 1): one tool is one `defineTool` entry. `effect` derives the MCP annotations and is what the capability
// matrix reads (approval-and-capabilities: the `draft` tools are the only writers of a draft, `send` is decision 0046's one
// send on the owner's word); `output` is registered as `outputSchema`, so `structuredContent` is validated; the handler
// takes the tool context and the parsed input and returns exactly the output's type, so `tsc` holds the schema to the code.

export type Effect = "read" | "pointer" | "draft" | "send";

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

/** Registers each tool on the server, its body run by `run` (refusals with their advice). */
export function registerTools(server: McpServer, tools: readonly ToolDef[], ctx: ToolCtx): void {
  for (const t of tools) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input, outputSchema: t.output, annotations: annotationsOf(t.effect) }, (input: unknown) => run(async () => t.handler(ctx, t.input.parse(input))));
  }
}
