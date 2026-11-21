import { parseRef, type FocusItem, type RefKind } from "@hub/contract/focus";
import { chat, mdraft } from "./chat";
import { client } from "./client";
import { draft } from "./draft";
import { inbound } from "./inbound";
import { knowledge } from "./knowledge";
import { project } from "./project";
import { run } from "./run";
import type { ResolveCtx, Resolver } from "./types";

export type { ResolveCtx, Resolver } from "./types";

/** One resolver per ref kind (P72): a kind added to `REF_KINDS` without one fails `tsc` here and the package's test. */
export const RESOLVERS: Record<RefKind, Resolver> = { draft, client, run, knowledge, project, chat, mdraft, inbound };

/** A ref resolved inside the bound project, or null (malformed, another project's, deleted). Never throws on a bad id. */
export async function resolveRef(ctx: ResolveCtx, ref: string): Promise<FocusItem | null> {
  const p = parseRef(ref);
  if (!p) return null;
  try {
    const r = await RESOLVERS[p.kind](ctx, p.id);
    return r ? { ref, kind: p.kind, ...r } : null;
  } catch {
    return null;
  }
}
