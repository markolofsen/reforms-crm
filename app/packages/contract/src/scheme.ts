import { z } from "zod";
import { STATUS_NEXT } from "./overview";
import { BLOCKS, blockStates, blockWhat, CUTS, LANE_LINKS, LANES, LINKS, type Block, type BlockId, type CutId, type LaneId, type Link } from "./scheme-model";

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
 * O5), one part each with its account. `llm` (P78) is the instance's model access through `@hub/llm`: shown only once a caller has
 * used it this month, broken when the monthly cap or a missing key refused a call.
 */
export const SCHEME_KINDS = ["core", "cli", "notion", "telegram", "llm", "mailbox", "mail-mcp", "hub-tools", "notion-db", "knowledge", "mail-filters", "setup", "guard", "session", "send-door", "calendar", "drive"] as const;
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

export const schemeDto = z.strictObject({ nodes: z.array(schemeNode) });
export type SchemeDto = z.infer<typeof schemeDto>;

/** A part's standing in words (P63 plan 4c): the one copy, used by the parts table and by each dot's title in the drawing (never a colour alone). */
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
 * Two forms of every drawing (P81, decision 0042); Help shows the first that fits its card with no label under 12 px, else the
 * drawing's list. `wide`: the general view's lanes are rows stacked top to bottom (each lane left to right), a cut runs left to
 * right. `narrow`: everything top to bottom, one lane under the other, a lane's blocks under each other.
 */
export const SCHEME_FORMS = ["wide", "narrow"] as const;
export type SchemeForm = (typeof SCHEME_FORMS)[number];

const ARROW: Record<Link["kind"], string> = { flow: "-->", limits: "-.->", "two-way": "<-->" };

const ids = (blocks: readonly Block[]) => {
  const m = new Map<BlockId, string>(blocks.map((b, i) => [b.id, `b${i + 1}`]));
  return (b: BlockId) => m.get(b) ?? "";
};
const box = (b: Block, id: string, nodes: readonly SchemeNode[]) => `${id}["${schemeText(b.label)}<br/>${schemeText(blockWhat(b, nodes))}"]`;
const line = (from: string, l: Link, to: string) => `${from} ${ARROW[l.kind]}|"${schemeText(l.label)}"| ${to}`;

/** A block's standing is a class (`ok`, `warn`, `fail`) that `scheme-svg.tsx` turns into a dot; an unchecked block has none. */
const classes = (blocks: readonly Block[], id: (b: BlockId) => string, nodes: readonly SchemeNode[]): string[] => {
  const states = blockStates(nodes);
  return (["ok", "warn", "fail"] as const).flatMap((state) => {
    const of = blocks.filter((b) => states[b.id]?.state === state).map((b) => id(b.id));
    return of.length > 0 ? [`  class ${of.join(",")} ${state}`] : [];
  });
};

const laneOf = (b: BlockId): LaneId | undefined => BLOCKS.find((x) => x.id === b)?.lane;

/**
 * The general view as Mermaid text (P81, decision 0042): one subgraph per lane (`l1..l5`) holding its blocks (`b1..bN` by
 * position, two fixed lines each) and the links inside it; the lanes are joined by `LANE_LINKS`, never a block to a block of
 * another lane, so Mermaid lays out each lane by itself and the lanes stay lanes. `narrow` chains a lane's blocks with invisible
 * links (`~~~`) so they stack, and chains two neighbouring lanes no link joins, so the lanes make one column.
 */
export function buildScheme(nodes: readonly SchemeNode[], form: SchemeForm): string {
  const id = ids(BLOCKS);
  const lane = (l: LaneId) => `l${LANES.findIndex((x) => x.id === l) + 1}`;
  const out = ["flowchart TB"];
  for (const l of LANES) {
    const of = BLOCKS.filter((b) => b.lane === l.id);
    out.push(`  subgraph ${lane(l.id)}["${schemeText(l.label)}"]`, `    direction ${form === "wide" ? "LR" : "TB"}`);
    for (const b of of) out.push(`    ${box(b, id(b.id), nodes)}`);
    for (const k of LINKS.filter((k) => laneOf(k.from) === l.id && laneOf(k.to) === l.id)) out.push(`    ${line(id(k.from), k, id(k.to))}`);
    if (form === "narrow" && of.length > 1) out.push(`    ${of.map((b) => id(b.id)).join(" ~~~ ")}`);
    out.push("  end");
  }
  for (const k of LANE_LINKS) out.push(`  ${lane(k.from)} -->|"${schemeText(k.label)}"| ${lane(k.to)}`);
  if (form === "narrow") {
    LANES.slice(1).forEach((l, i) => {
      const prev = LANES[i]?.id;
      if (prev && !LANE_LINKS.some((k) => k.from === prev && k.to === l.id)) out.push(`  ${lane(prev)} ~~~ ${lane(l.id)}`);
    });
  }
  out.push(...classes(BLOCKS, id, nodes));
  return out.join("\n");
}

/** One cut (P81): only its blocks, in the order its links first name them, no lanes; `wide` left to right, `narrow` top to bottom. */
export function buildCut(cut: CutId, nodes: readonly SchemeNode[], form: SchemeForm): string {
  const links = CUTS.find((c) => c.id === cut)?.links ?? [];
  const order = [...new Set(links.flatMap((l) => [l.from, l.to]))];
  const blocks = order.flatMap((i) => BLOCKS.filter((b) => b.id === i));
  const id = ids(blocks);
  return [`flowchart ${form === "wide" ? "LR" : "TB"}`, ...blocks.map((b) => `  ${box(b, id(b.id), nodes)}`), ...links.map((l) => `  ${line(id(l.from), l, id(l.to))}`), ...classes(blocks, id, nodes)].join("\n");
}
