import { z } from "zod";
import { STATUS_NEXT } from "./overview";

/**
 * The Hub's parts and how each stands (P63 O1, `GET /api/scheme`): the summary on Overview, one row per part, worst first, and
 * in patch B the source of the drawing. Built per request from local state the server already holds (the project doctor, the
 * project files, the Agent tools cache, the Connections rows, the health snapshot, the CLI detector, the core check); it never
 * runs a check of its own. Labels hold only fixed part words, account addresses, CLI names and versions: no client name,
 * address, subject, body, Message-ID or page id (the schemas are strict and have no field for one).
 */

/** `unknown`: nobody checked it here ("Not checked here"), never shown as working. */
export const SCHEME_STATES = ["ok", "warn", "fail", "unknown"] as const;
export type SchemeState = (typeof SCHEME_STATES)[number];

/** The parts. Instance parts: `core`, `cli`, `notion`, `telegram`. The rest belong to one project; `session` is every Agent tools row no other part covers (UX pass 2026-11-20). */
export const SCHEME_KINDS = ["core", "cli", "notion", "telegram", "mailbox", "mail-mcp", "hub-tools", "notion-db", "knowledge", "mail-filters", "setup", "guard", "session", "send-door"] as const;
export type SchemeKind = (typeof SCHEME_KINDS)[number];

export const schemeNode = z.strictObject({
  /** Stable key (`saas-support:mail-mcp:claude`); patch B's drawing generates its own ids from the index. */
  id: z.string(),
  kind: z.enum(SCHEME_KINDS),
  /** Null: a part of the instance. */
  project: z.string().nullable(),
  label: z.string().max(80),
  state: z.enum(SCHEME_STATES),
  /** What is wrong, in plain words; when ok "" or a reassurance (the project setup's "16 of 16 checks pass", P70). */
  detail: z.string(),
  /** The source's own fix line (an Agent tools row's, a Connections test's, the core update command), else null. Never invented here. */
  fix: z.string().nullable(),
  /** The page that fixes it (a nav target: the core's is Settings ▸ This Mac, P70), or null when no page does. */
  place: z.enum(STATUS_NEXT).nullable(),
});
export type SchemeNode = z.infer<typeof schemeNode>;

export const schemeEdge = z.strictObject({ from: z.string(), to: z.string(), kind: z.enum(["flow", "limits"]) });
export type SchemeEdge = z.infer<typeof schemeEdge>;

export const schemeDto = z.strictObject({ nodes: z.array(schemeNode), edges: z.array(schemeEdge) });
export type SchemeDto = z.infer<typeof schemeDto>;

const RANK: Record<SchemeState, number> = { fail: 0, warn: 1, unknown: 2, ok: 3 };

/** Worst first (broken, needs a look, not checked, works), then the instance's parts before a project's, then the server's order. */
export function worstFirst(nodes: readonly SchemeNode[]): SchemeNode[] {
  return nodes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => RANK[a.n.state] - RANK[b.n.state] || Number(a.n.project !== null) - Number(b.n.project !== null) || a.i - b.i)
    .map((x) => x.n);
}
