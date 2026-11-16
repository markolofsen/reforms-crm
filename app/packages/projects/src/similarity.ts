// Near-duplicate detection of reply bodies (P28 B2, research 15 section 3.3). Pure, no dependencies, deterministic.
// The guard, `hub record-draft`, `hub batch-check` and `hub audit-run` all call these functions, so one number means one thing.
// Only hashes of word shingles leave this module: a sketch cannot rebuild a body (decision 0011 point 5, 0013).

/** Size of a sketch: the 256 smallest shingle hashes. A body of up to 256 shingles (about 250 words) is held exactly. */
export const SKETCH_SIZE = 256;
/** Fewer words than this after normalisation: 2-word shingles instead of 3. */
export const SHORT_BODY_WORDS = 60;

/** Defaults of the verdict (research 15 3.3). The admin will carry them as safety-rule params (phase C); here they are constants. */
export const SIM_RED = 0.8;
export const SIM_AMBER = 0.6;
export const RESIDUE_RED = 0.1;
export const RESIDUE_AMBER = 0.25;
export const TEMPLATE_ECHO_RED = 0.9;

export interface NormalizeOptions {
  /** Names of the client (display name, address): their tokens and the address local-part are removed, so a swapped name changes nothing. */
  names?: readonly string[];
  /** The project's sign-off text: its lines are removed. */
  signoff?: string;
}

const MARKER_LINE = /^\s*\[hub-draft[^\]]*\]\s*$/i;
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+|\bwww\.[^\s<>"')]+/gi;
const ADDRESS_RE = /[^\s,;<>"'()]+@[^\s,;<>"'()]+/g;

/** The words of a body as they are compared: lower-case, no marker, greeting, sign-off, quoted history, URLs, addresses or client names. */
export function normalizeBody(body: string, o: NormalizeOptions = {}): string[] {
  let lines = body.normalize("NFKC").replace(/\r\n?/g, "\n").split("\n");
  // quoted history: "> ..." lines, and everything after an "On ... wrote:" line
  const cut = lines.findIndex((l) => /^\s*(on|am|le|el)\b.{5,200}\b(wrote|schrieb|a écrit|escribió):\s*$/i.test(l));
  if (cut >= 0) lines = lines.slice(0, cut);
  lines = lines.filter((l) => !MARKER_LINE.test(l) && !/^\s*>/.test(l));
  // greeting: the first non-empty line, short, ending in a comma ("Hi Anna,")
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first >= 0 && /,\s*$/.test(lines[first]!) && lines[first]!.trim().split(/\s+/).length <= 8) lines.splice(first, 1);
  const sign = new Set((o.signoff ?? "").normalize("NFKC").split(/\n|\\n/).map((l) => l.trim().toLowerCase()).filter(Boolean));
  if (sign.size) lines = lines.filter((l) => !sign.has(l.trim().toLowerCase()));

  const drop = new Set<string>();
  for (const n of o.names ?? []) {
    const s = n.normalize("NFKC").toLowerCase();
    for (const t of s.split(/[^\p{L}\p{N}]+/u)) if (t.length >= 2) drop.add(t);
    const local = s.match(/^([^@\s]+)@/)?.[1];
    if (local) for (const t of local.split(/[^\p{L}\p{N}]+/u)) if (t.length >= 2) drop.add(t);
  }
  const text = lines.join("\n").toLowerCase().replace(URL_RE, " urltoken ").replace(ADDRESS_RE, " addrtoken ");
  return text.split(/[^\p{L}\p{N}]+/u).filter((w) => w && !drop.has(w));
}

/** 32-bit FNV-1a over UTF-16 code units. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The bottom-k sketch of a body: its smallest distinct shingle hashes, ascending. Empty body: `[]`. */
export function fingerprint(body: string, o: NormalizeOptions = {}): number[] {
  const words = normalizeBody(body, o);
  const n = words.length < SHORT_BODY_WORDS ? 2 : 3;
  const hashes = new Set<number>();
  if (words.length < n) {
    if (words.length) hashes.add(hash32(words.join(" ")));
  } else for (let i = 0; i + n <= words.length; i++) hashes.add(hash32(words.slice(i, i + n).join(" ")));
  return [...hashes].sort((a, b) => a - b).slice(0, SKETCH_SIZE);
}

/** Jaccard similarity of two sketches (the bottom-k estimator; exact while both hold fewer than SKETCH_SIZE hashes). 0 to 1. */
export function sim(a: readonly number[], b: readonly number[]): number {
  if (!a.length || !b.length) return 0;
  const inB = new Set(b);
  const inA = new Set(a);
  const union = [...new Set([...a, ...b])].sort((x, y) => x - y).slice(0, SKETCH_SIZE);
  let both = 0;
  for (const h of union) if (inA.has(h) && inB.has(h)) both++;
  return union.length ? both / union.length : 0;
}

/** Share of this sketch's hashes found in no other sketch of the set. 1 when there is nothing to compare with. */
export function residue(a: readonly number[], others: ReadonlyArray<readonly number[]>): number {
  if (!a.length) return 0;
  const seen = new Set<number>();
  for (const o of others) for (const h of o) seen.add(h);
  let own = 0;
  for (const h of a) if (!seen.has(h)) own++;
  return own / a.length;
}

/** `sim` against the template's own sketch: >= TEMPLATE_ECHO_RED means "this is the template". */
export const templateEcho = (draft: readonly number[], template: readonly number[]): number => sim(draft, template);

export type Level = "ok" | "amber" | "red";

export interface Verdict { level: Level; reasons: string[] }

/** Judges one draft from its highest similarity to another draft, its residue and (when a template is known) its echo of it. */
export function judgeSimilarity(m: { maxSim: number; residue?: number; templateEcho?: number }): Verdict {
  const reasons: string[] = [];
  let level: Level = "ok";
  const up = (l: Level, why: string) => { reasons.push(why); if (l === "red" || level === "ok") level = l; };
  if (m.maxSim >= SIM_RED) up("red", `near-duplicate (similarity ${m.maxSim.toFixed(2)})`);
  else if (m.maxSim >= SIM_AMBER) up("amber", `close to another draft (similarity ${m.maxSim.toFixed(2)})`);
  if (m.residue !== undefined) {
    if (m.residue < RESIDUE_RED) up("red", `almost all shared wording (own share ${m.residue.toFixed(2)})`);
    else if (m.residue < RESIDUE_AMBER) up("amber", `mostly shared wording (own share ${m.residue.toFixed(2)})`);
  }
  if (m.templateEcho !== undefined && m.templateEcho >= TEMPLATE_ECHO_RED) up("red", `is the template (echo ${m.templateEcho.toFixed(2)})`);
  return { level, reasons };
}

export interface Pair { a: string; b: string; sim: number }

/** Every pair of the set with its similarity, highest first. */
export function pairwise(items: ReadonlyArray<{ id: string; fp: readonly number[] }>): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) out.push({ a: items[i]!.id, b: items[j]!.id, sim: sim(items[i]!.fp, items[j]!.fp) });
  return out.sort((x, y) => y.sim - x.sim);
}

/** For one item: the highest similarity to any other, and who it is. Residue is left out for a set of fewer than 3 (only `sim` counts there). */
export function measureAgainstSet(id: string, items: ReadonlyArray<{ id: string; fp: readonly number[] }>): { maxSim: number; similarTo: string | null; residue?: number } {
  const me = items.find((x) => x.id === id);
  const others = items.filter((x) => x.id !== id);
  let maxSim = 0;
  let similarTo: string | null = null;
  for (const o of others) {
    const s = me ? sim(me.fp, o.fp) : 0;
    if (s > maxSim) { maxSim = s; similarTo = o.id; }
  }
  return { maxSim, similarTo, ...(me && items.length >= 3 ? { residue: residue(me.fp, others.map((o) => o.fp)) } : {}) };
}
