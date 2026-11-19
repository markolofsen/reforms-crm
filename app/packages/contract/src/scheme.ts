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

/**
 * The parts. Instance parts: `core`, `cli`, `notion`, `telegram`. The rest belong to one project; `session` is every Agent tools
 * row no other part covers (UX pass 2026-11-20); `calendar` and `drive` are the Google connectors a project attaches (P62, P63
 * O5), one part each with its account.
 */
export const SCHEME_KINDS = ["core", "cli", "notion", "telegram", "mailbox", "mail-mcp", "hub-tools", "notion-db", "knowledge", "mail-filters", "setup", "guard", "session", "send-door", "calendar", "drive"] as const;
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

/** A part's standing in words (P63 plan 4c): the one copy, used by the parts table and in every label of the drawing (never a colour alone). */
export const SCHEME_WORDS: Record<SchemeState, string> = { fail: "Broken", warn: "Needs a look", unknown: "Not checked here", ok: "Works" };

const RANK: Record<SchemeState, number> = { fail: 0, warn: 1, unknown: 2, ok: 3 };

/** Worst first (broken, needs a look, not checked, works), then the instance's parts before a project's, then the server's order. */
export function worstFirst(nodes: readonly SchemeNode[]): SchemeNode[] {
  return nodes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => RANK[a.n.state] - RANK[b.n.state] || Number(a.n.project !== null) - Number(b.n.project !== null) || a.i - b.i)
    .map((x) => x.n);
}

/**
 * Mermaid's entity codes for every character that could end a label or start syntax (P63 O2, decision 0035): a label is text,
 * whatever it holds. `#` itself is coded, so a code in the input stays text too.
 */
const CODE: Record<string, string> = { '"': "#quot;", "#": "#35;", "&": "#38;", "<": "#lt;", ">": "#gt;", "`": "#96;", ";": "#59;", "[": "#91;", "]": "#93;", "{": "#123;", "}": "#125;", "(": "#40;", ")": "#41;", "|": "#124;", "\\": "#92;" };
export const schemeText = (s: string): string => s.replace(/\s+/g, " ").trim().replace(/["#&<>`;[\]{}()|\\]/g, (c) => CODE[c] ?? "");

/**
 * The scheme as Mermaid text (P63 O2): `flowchart LR`, the instance's parts on top, one `subgraph` per project, a node per part
 * labelled "name<br/>status word", the fixed edges, then one `class` line per state (styled by `scheme-graph` in `@hub/ui`, so the
 * theme needs no re-render). Node ids are generated (`n1..nN`, clusters `p1..pN`), never derived from a name; an edge whose end is
 * not a node is dropped. Two fixed nodes are the outside world, with no state: "Client mail" starts the chain at every mailbox,
 * and "Reply to the client" ends it after every send door.
 */
export function buildScheme(dto: SchemeDto): string {
  const id = new Map(dto.nodes.map((n, i) => [n.id, `n${i + 1}`]));
  const line = (n: SchemeNode) => `${id.get(n.id)}["${schemeText(n.label)}<br/>${SCHEME_WORDS[n.state]}"]`;
  const out = ["flowchart LR"];
  const boxes = dto.nodes.filter((n) => n.kind === "mailbox");
  const doors = dto.nodes.filter((n) => n.kind === "send-door");
  if (boxes.length > 0) out.push('  mail(["Client mail"])');
  if (doors.length > 0) out.push('  reply(["Reply to the client"])');
  for (const n of dto.nodes.filter((x) => x.project === null)) out.push(`  ${line(n)}`);
  const projects = [...new Set(dto.nodes.flatMap((n) => (n.project === null ? [] : [n.project])))];
  projects.forEach((p, i) => {
    out.push(`  subgraph p${i + 1}["${schemeText(p)}"]`);
    for (const n of dto.nodes.filter((x) => x.project === p)) out.push(`    ${line(n)}`);
    out.push("  end");
  });
  for (const b of boxes) out.push(`  mail --> ${id.get(b.id)}`);
  for (const d of doors) out.push(`  ${id.get(d.id)} --> reply`);
  for (const e of dto.edges) {
    const from = id.get(e.from);
    const to = id.get(e.to);
    if (from && to) out.push(e.kind === "limits" ? `  ${from} -.-> ${to}` : `  ${from} --> ${to}`);
  }
  for (const state of SCHEME_STATES) {
    const of = dto.nodes.filter((n) => n.state === state).map((n) => id.get(n.id));
    if (of.length > 0) out.push(`  class ${of.join(",")} ${state}`);
  }
  const outside = [boxes.length > 0 ? "mail" : null, doors.length > 0 ? "reply" : null].filter(Boolean);
  if (outside.length > 0) out.push(`  class ${outside.join(",")} outside`);
  return out.join("\n");
}
