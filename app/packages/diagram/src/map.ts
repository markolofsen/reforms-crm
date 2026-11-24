// P135 verdicts 5 and 6: the client map is Mermaid text the agent redraws after each draft. Mermaid's own parser does not run
// in Node (its flowchart database sanitises every label through DOMPurify, which needs a DOM: `mermaid.parse` throws
// "DOMPurify.addHook is not a function" on every valid flowchart), and `@mermaid-js/parser` 2.0.1 has no flowchart grammar. So the
// server checks a strict subset of Mermaid's flowchart here, pure and the same in Node and the browser: what passes is valid
// Mermaid, and the shape rules (one root, depth, node and label caps, known state classes) are checked in the same pass.

export const MAP_CLASSES = ["open", "waiting", "done", "blocked"] as const;
export type MapClass = (typeof MAP_CLASSES)[number];

/** The shape caps of verdict 5: nodes, depth below the root, the root's goals, words and characters per label, the whole text. */
export const MAP_LIMITS = { nodes: 30, depth: 4, goals: 6, words: 6, labelChars: 60, chars: 8000, lines: 200 } as const;

export interface MapNode { id: string; label: string; cls: MapClass | null; group: string | null }
export interface MapEdge { from: string; to: string; label: string | null }
/** P136 verdict 1: each node's sources (`%% src <id>: <ref>, <ref>`), by node id, in the order written. */
export type MapSources = Record<string, string[]>;
export interface MapGraph { root: string; nodes: MapNode[]; edges: MapEdge[]; depth: number; sources: MapSources }
export type MapCheck = ({ ok: true } & MapGraph) | { ok: false; line: number | null; error: string };

const ID = /^[A-Za-z][A-Za-z0-9_]{0,39}/;
const RESERVED = new Set(["end", "subgraph", "class", "classdef", "style", "linkstyle", "click", "graph", "flowchart", "default", "direction", "call", "href"]);
const FORBIDDEN = /^(classDef|style|linkStyle|click|direction|%%\{|accTitle|accDescr)\b/;
/** Characters a label never holds: Mermaid syntax, markup, entities. A quoted label may hold brackets and parentheses. */
const BAD_QUOTED = /["<>`#\\]/;
const BAD_PLAIN = /["<>`#\\[\]{}()|;]/;
const SHAPES: ReadonlyArray<readonly [string, string]> = [["([", "])"], ["((", "))"], ["[[", "]]"], ["[", "]"], ["(", ")"], ["{", "}"]];
const ARROWS = ["-.->", "-->", "==>"] as const;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /\+?\d[\d\s().-]{6,}\d/;

class MapError extends Error {
  constructor(readonly line: number | null, message: string) {
    super(message);
  }
}

type Draft = { nodes: Map<string, { label: string | null; cls: MapClass | null; group: string | null; line: number }>; edges: MapEdge[]; groups: Set<string>; sources: Map<string, { refs: string[]; line: number }> };

/**
 * P136 verdict 1: where a node came from. A line of its own, `%% src <node-id>: <ref>[, <ref>]`, a Mermaid comment (Mermaid and
 * Notion draw nothing of it). A ref is a message id (Mail's Message-ID, as `message_show` gives it) or a day and a channel
 * (`2026-11-20 telegram`, the way a chat message, a call or a meeting is named).
 */
export type SourceRef = { kind: "message"; id: string } | { kind: "day"; day: string; channel: string };
const SRC = /^%%\s*src\s+([A-Za-z][A-Za-z0-9_]{0,39})\s*:\s*(.*)$/;
const DAY_REF = /^(\d{4}-\d{2}-\d{2})\s+([a-z]{2,20})$/i;
const MESSAGE_REF = /^[^\s,]{3,250}$/;

/** One source ref read, or null when it is neither a message id nor "YYYY-MM-DD channel". */
export function parseSourceRef(ref: string): SourceRef | null {
  const t = ref.trim();
  const day = DAY_REF.exec(t);
  if (day) return { kind: "day", day: day[1] ?? "", channel: (day[2] ?? "").toLowerCase() };
  const id = t.replace(/^<(.*)>$/, "$1");
  return MESSAGE_REF.test(id) && !/^\d{4}-\d{2}-\d{2}$/.test(id) ? { kind: "message", id } : null;
}

/** Whether a check asks every node below the client for its source (the agent's redraw), or only reads them (an old version). */
export type CheckOptions = { sources?: "required" | "optional" };

const isClass = (v: string): v is MapClass => (MAP_CLASSES as readonly string[]).includes(v);

function checkLabel(text: string, line: number, what: string): string {
  const t = text.trim();
  if (!t) throw new MapError(line, `${what} has an empty label`);
  if (t.length > MAP_LIMITS.labelChars) throw new MapError(line, `${what}: the label has ${t.length} characters, at most ${MAP_LIMITS.labelChars}`);
  const words = t.split(/\s+/).length;
  if (words > MAP_LIMITS.words) throw new MapError(line, `${what}: the label has ${words} words, at most ${MAP_LIMITS.words}`);
  // An ISO date ("Sign by 2026-11-30", P136 verdict 5's next step) is not a phone number.
  if (EMAIL.test(t) || PHONE.test(t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " "))) throw new MapError(line, `${what}: no address or phone number in a label`);
  return t;
}

/** Reads one label between `open` and `close` at `i`: quoted ("...") or plain. Returns the text and the index after `close`. */
function readLabel(s: string, i: number, open: string, close: string, line: number, what: string): { text: string; next: number } {
  let j = i + open.length;
  if (s[j] === '"') {
    const end = s.indexOf('"', j + 1);
    if (end < 0) throw new MapError(line, `${what}: a quoted label is not closed`);
    const text = s.slice(j + 1, end);
    if (BAD_QUOTED.test(text)) throw new MapError(line, `${what}: a label holds no " < > \` # or \\`);
    j = end + 1;
    if (!s.startsWith(close, j)) throw new MapError(line, `${what}: expected ${close} after the quoted label`);
    return { text: checkLabel(text, line, what), next: j + close.length };
  }
  const end = s.indexOf(close, j);
  if (end < 0) throw new MapError(line, `${what}: ${open} is not closed with ${close}`);
  const text = s.slice(j, end);
  if (BAD_PLAIN.test(text)) throw new MapError(line, `${what}: put a label with brackets, | or ; in quotes ("..."); no " < > \` # \\ at all`);
  return { text: checkLabel(text, line, what), next: end + close.length };
}

function readId(s: string, i: number, line: number): { id: string; next: number } {
  const m = ID.exec(s.slice(i));
  if (!m) throw new MapError(line, `expected a node id (a letter, then letters, digits or _) at "${s.slice(i, i + 20)}"`);
  if (RESERVED.has(m[0].toLowerCase())) throw new MapError(line, `"${m[0]}" is a Mermaid keyword, not a node id`);
  return { id: m[0], next: i + m[0].length };
}

function addNode(d: Draft, id: string, label: string | null, cls: MapClass | null, group: string | null, line: number): void {
  if (d.groups.has(id)) throw new MapError(line, `${id} is a subgraph's id and a node's`);
  const known = d.nodes.get(id);
  if (!known) {
    d.nodes.set(id, { label, cls, group, line });
    return;
  }
  if (label !== null && known.label !== null && known.label !== label) throw new MapError(line, `node ${id} has two labels ("${known.label}", "${label}"): give it one`);
  if (label !== null) known.label = label;
  if (cls !== null) known.cls = cls;
  if (group !== null) known.group ??= group;
}

/** One node reference with its optional shape and `:::class`. */
function readNode(s: string, i: number, line: number, d: Draft, group: string | null): number {
  const { id, next } = readId(s, i, line);
  let j = next;
  let label: string | null = null;
  const shape = SHAPES.find(([open]) => s.startsWith(open, j));
  if (shape) {
    const r = readLabel(s, j, shape[0], shape[1], line, `node ${id}`);
    label = r.text;
    j = r.next;
  }
  let cls: MapClass | null = null;
  if (s.startsWith(":::", j)) {
    const m = /^[A-Za-z]+/.exec(s.slice(j + 3));
    if (!m || !isClass(m[0])) throw new MapError(line, `node ${id}: the state class is one of ${MAP_CLASSES.join(", ")}`);
    cls = m[0];
    j += 3 + m[0].length;
  }
  addNode(d, id, label, cls, group, line);
  return j;
}

/** A node, or a chain `a --> b -->|label| c`; arrows `-->`, `-.->`, `==>`. */
function readChain(s: string, line: number, d: Draft, group: string | null): void {
  let i = readNode(s, 0, line, d, group);
  let from = ID.exec(s)?.[0] ?? "";
  for (;;) {
    while (s[i] === " ") i += 1;
    if (i >= s.length || (s[i] === ";" && s.slice(i + 1).trim() === "")) return;
    const arrow = ARROWS.find((a) => s.startsWith(a, i));
    if (!arrow) throw new MapError(line, `unexpected "${s.slice(i, i + 20)}": an edge is a --> b, or a -->|label| b`);
    i += arrow.length;
    let label: string | null = null;
    if (s[i] === "|") {
      const end = s.indexOf("|", i + 1);
      if (end < 0) throw new MapError(line, "an edge label |...| is not closed");
      const text = s.slice(i + 1, end);
      if (BAD_PLAIN.test(text)) throw new MapError(line, "an edge label holds no brackets, quotes, | ; < > ` # or \\");
      label = checkLabel(text, line, `the edge from ${from}`);
      i = end + 1;
    }
    while (s[i] === " ") i += 1;
    const to = ID.exec(s.slice(i))?.[0] ?? "";
    i = readNode(s, i, line, d, group);
    if (to === from) throw new MapError(line, `node ${from} points at itself`);
    d.edges.push({ from, to, label });
    from = to;
  }
}

function readLines(source: string): Draft {
  if (source.length > MAP_LIMITS.chars) throw new MapError(null, `the map has ${source.length} characters, at most ${MAP_LIMITS.chars}: redraw it smaller`);
  const lines = source.split(/\r?\n/);
  if (lines.length > MAP_LIMITS.lines) throw new MapError(null, `the map has ${lines.length} lines, at most ${MAP_LIMITS.lines}`);
  const d: Draft = { nodes: new Map(), edges: [], groups: new Set(), sources: new Map() };
  let header = false;
  let group: string | null = null;
  const classes: Array<{ ids: string[]; cls: string; line: number }> = [];
  lines.forEach((raw, k) => {
    const n = k + 1;
    const s = raw.trim();
    const src = SRC.exec(s);
    if (src) {
      const id = src[1] ?? "";
      const refs = (src[2] ?? "").split(",").map((r) => r.trim()).filter(Boolean);
      if (!refs.length) throw new MapError(n, `src ${id}: name the message id or "YYYY-MM-DD channel" after the colon`);
      const bad = refs.find((r) => !parseSourceRef(r));
      if (bad !== undefined) throw new MapError(n, `src ${id}: "${bad.slice(0, 40)}" is neither a message id nor "YYYY-MM-DD channel"`);
      const known = d.sources.get(id);
      if (known) known.refs.push(...refs);
      else d.sources.set(id, { refs, line: n });
      return;
    }
    if (!s || (s.startsWith("%%") && !s.startsWith("%%{"))) return;
    if (!header) {
      if (!/^flowchart\s+TD;?$/.test(s)) throw new MapError(n, 'the map starts with "flowchart TD"');
      header = true;
      return;
    }
    if (FORBIDDEN.test(s)) throw new MapError(n, `"${s.split(/\s/)[0]}" is not allowed: the Hub colours the map by its state classes (${MAP_CLASSES.join(", ")})`);
    const sub = /^subgraph\s+(.*)$/.exec(s);
    if (sub) {
      if (group !== null) throw new MapError(n, "subgraphs do not nest: close the open one with end");
      const body = sub[1] ?? "";
      const { id, next } = readId(body, 0, n);
      const shape = body.startsWith("[", next) ? readLabel(body, next, "[", "]", n, `subgraph ${id}`) : null;
      if (body.slice(shape?.next ?? next).trim()) throw new MapError(n, `subgraph ${id}: write subgraph ${id}[Label]`);
      if (d.nodes.has(id) || d.groups.has(id)) throw new MapError(n, `${id} is used twice`);
      d.groups.add(id);
      group = id;
      return;
    }
    if (s === "end") {
      if (group === null) throw new MapError(n, "end without a subgraph");
      group = null;
      return;
    }
    const cls = /^class\s+([A-Za-z0-9_,\s]+?)\s+([A-Za-z]+);?$/.exec(s);
    if (cls) {
      classes.push({ ids: (cls[1] ?? "").split(",").map((v) => v.trim()), cls: cls[2] ?? "", line: n });
      return;
    }
    readChain(s, n, d, group);
  });
  if (!header) throw new MapError(null, 'the map is empty: it starts with "flowchart TD"');
  if (group !== null) throw new MapError(null, `subgraph ${group} is not closed with end`);
  for (const c of classes) {
    if (!isClass(c.cls)) throw new MapError(c.line, `unknown state class "${c.cls}": one of ${MAP_CLASSES.join(", ")}`);
    for (const id of c.ids) {
      const node = d.nodes.get(id);
      if (!node) throw new MapError(c.line, `class names ${id}, which is no node`);
      node.cls = c.cls;
    }
  }
  return d;
}

/** The shape rules over the parsed text: labels, one root, everything under it, depth, goals, a state on every leaf, sources. */
function shapeOf(d: Draft, o: CheckOptions): MapGraph {
  const nodes: MapNode[] = [...d.nodes].map(([id, v]) => {
    if (v.label === null) throw new MapError(v.line, `node ${id} has no label: write ${id}[...] once`);
    return { id, label: v.label, cls: v.cls, group: v.group };
  });
  if (nodes.length < 2) throw new MapError(null, "the map needs the client and at least one goal under it");
  if (nodes.length > MAP_LIMITS.nodes) throw new MapError(null, `the map has ${nodes.length} nodes, at most ${MAP_LIMITS.nodes}: merge or drop resolved branches`);
  const incoming = new Set(d.edges.map((e) => e.to));
  const roots = nodes.filter((n) => !incoming.has(n.id));
  if (roots.length !== 1) throw new MapError(null, roots.length ? `the map has ${roots.length} roots (${roots.slice(0, 4).map((r) => r.id).join(", ")}): one root, the client; hang the rest under it` : "the map has no root: the client is the one node nothing points at");
  const root = roots[0]!.id;
  const out = new Map<string, string[]>();
  for (const e of d.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const depth = new Map([[root, 0]]);
  const queue = [root];
  for (let q = queue.shift(); q !== undefined; q = queue.shift()) {
    for (const to of out.get(q) ?? []) if (!depth.has(to)) { depth.set(to, (depth.get(q) ?? 0) + 1); queue.push(to); }
  }
  const lost = nodes.filter((n) => !depth.has(n.id));
  if (lost.length) throw new MapError(null, `${lost.map((n) => n.id).slice(0, 4).join(", ")} cannot be reached from the client ${root}`);
  const deepest = Math.max(...depth.values());
  if (deepest > MAP_LIMITS.depth) throw new MapError(null, `the map is ${deepest} levels deep, at most ${MAP_LIMITS.depth} below the client`);
  const goals = (out.get(root) ?? []).filter((id) => d.nodes.get(id)?.cls !== "done");
  if (goals.length > MAP_LIMITS.goals) throw new MapError(null, `the client has ${goals.length} open goals, at most ${MAP_LIMITS.goals}: merge them`);
  const bare = nodes.filter((n) => n.id !== root && !out.has(n.id) && n.cls === null);
  if (bare.length) throw new MapError(null, `leaf ${bare.slice(0, 4).map((n) => n.id).join(", ")} has no state: add class <id> ${MAP_CLASSES.join("|")}`);
  for (const [id, s] of d.sources) if (!d.nodes.has(id)) throw new MapError(s.line, `src names ${id}, which is no node`);
  if ((o.sources ?? "required") === "required") {
    const unsourced = nodes.filter((n) => n.id !== root && !d.sources.has(n.id));
    if (unsourced.length) {
      const ids = unsourced.slice(0, 4).map((n) => n.id).join(", ");
      throw new MapError(d.nodes.get(unsourced[0]!.id)?.line ?? null, `${ids} ${unsourced.length === 1 ? "has" : "have"} no source: add a line %% src <id>: <message id or YYYY-MM-DD channel> for each`);
    }
  }
  const sources: MapSources = {};
  for (const [id, s] of d.sources) sources[id] = s.refs;
  return { root, nodes, edges: d.edges, depth: deepest, sources };
}

/**
 * Checks a client map: valid Mermaid of the subset above and the shape of verdict 5; every node below the client names its source
 * (P136 verdict 1) unless `sources: "optional"` (reading a version drawn before P136). Never throws.
 */
export function checkClientMap(source: string, o: CheckOptions = {}): MapCheck {
  try {
    return { ok: true, ...shapeOf(readLines(source), o) };
  } catch (e) {
    if (e instanceof MapError) return { ok: false, line: e.line, error: e.message };
    return { ok: false, line: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface OutlineLine { id: string; depth: number; label: string; state: MapClass | null; via: string | null }

/** The map as an indented outline from the client down (first path wins), for a reader, the text fallback and `hub client map`. */
export function mapOutline(g: MapGraph): OutlineLine[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const lines: OutlineLine[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number, via: string | null) => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = byId.get(id);
    if (!n) return;
    lines.push({ id, depth, label: n.label, state: n.cls, via });
    for (const e of g.edges) if (e.from === id) walk(e.to, depth + 1, e.label);
  };
  walk(g.root, 0, null);
  return lines;
}

/** The state classes as Notion draws them (Notion renders the code block with its own theme; the Hub's admin uses its tokens). */
const NOTION_CLASSES: Record<MapClass, string> = {
  open: "fill:#e8f1fd,stroke:#2f6fdb,color:#0b2a5b",
  waiting: "fill:#fff4d6,stroke:#c98a00,color:#4a3300",
  done: "fill:#e4f5e9,stroke:#2e8b57,color:#0f3d24",
  blocked: "fill:#fde8e8,stroke:#c0392b,color:#5c1111",
};

/**
 * The Notion copy of a checked map: its text without the `%% src` lines (a message id is the Hub's evidence, not the profile's),
 * plus one `classDef` per state, so a Notion page shows the states in colour.
 */
export function notionMapSource(source: string): string {
  const text = source.split(/\r?\n/).filter((l) => !SRC.test(l.trim())).join("\n").trimEnd();
  return `${text}\n${MAP_CLASSES.map((c) => `classDef ${c} ${NOTION_CLASSES[c]}`).join("\n")}\n`;
}

/**
 * P136 verdict 4: what a redraw changed against the version before it, by node id (ids stay stable across redraws): nodes added,
 * removed, renamed (same id, another label) and state changes. A removed or renamed node needs a reason (`whyNeeded`).
 */
export interface MapDiff {
  added: Array<{ id: string; label: string; state: MapClass | null }>;
  removed: Array<{ id: string; label: string }>;
  renamed: Array<{ id: string; from: string; to: string }>;
  states: Array<{ id: string; label: string; from: MapClass | null; to: MapClass | null }>;
}

export function diffMaps(prev: Pick<MapGraph, "nodes"> | null, next: Pick<MapGraph, "nodes">): MapDiff {
  const old = new Map((prev?.nodes ?? []).map((n) => [n.id, n]));
  const now = new Map(next.nodes.map((n) => [n.id, n]));
  const d: MapDiff = { added: [], removed: [], renamed: [], states: [] };
  for (const n of next.nodes) {
    const o = old.get(n.id);
    if (!o) d.added.push({ id: n.id, label: n.label, state: n.cls });
    else {
      if (o.label !== n.label) d.renamed.push({ id: n.id, from: o.label, to: n.label });
      if (o.cls !== n.cls) d.states.push({ id: n.id, label: n.label, from: o.cls, to: n.cls });
    }
  }
  for (const o of prev?.nodes ?? []) if (!now.has(o.id)) d.removed.push({ id: o.id, label: o.label });
  return d;
}

/** The ids a redraw must explain: every removed or renamed node. */
export const whyNeeded = (d: MapDiff): string[] => [...d.removed.map((r) => r.id), ...d.renamed.map((r) => r.id)];

export const isEmptyDiff = (d: MapDiff): boolean => !d.added.length && !d.removed.length && !d.renamed.length && !d.states.length;
