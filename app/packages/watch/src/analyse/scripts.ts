import type { LensScripts } from "@hub/contract/lens";

/**
 * Cross-author script detection (P144 W5, ported from the experiment's `shill.py`). A paid campaign reads as organic message by
 * message, so the model's own promoter flag misses it; the template gives it away: different accounts in one group share a long
 * word sequence, which real people rarely do. The rule is the lens's (`facets.scripts`): for each `{ words, authors }`, a
 * sequence of `words` words used by at least `authors` different authors marks every one of them. Links are cut out first (a
 * shared link is not a script), digits and punctuation are not words, and a sequence needs at least `distinct` words outside the
 * lens's `common` list to count. A marked author's moments are dropped like a failed keep condition.
 */

const WORD = /[\p{L}\p{M}]+/gu;
const URL = /\S*(?:https?:\/\/|www\.|t\.me\/)\S*/giu;
/** Words outside `common` a sequence needs when the lens names no number (the experiment's 3). */
export const DEFAULT_DISTINCT = 3;

export interface ScriptMessage {
  senderId: string | null;
  senderHandle: string | null;
  text: string;
}

/** The stable key of an author: the id, else the handle; null for a message with neither (never marked). */
export const authorKey = (m: Pick<ScriptMessage, "senderId" | "senderHandle">): string | null => m.senderId ?? m.senderHandle ?? null;

function sequences(text: string, words: number, common: ReadonlySet<string>, distinct: number): Set<string> {
  const w = (text.replace(URL, " ").match(WORD) ?? []).map((x) => x.toLowerCase());
  const out = new Set<string>();
  for (let i = 0; i + words <= w.length; i++) {
    const g = w.slice(i, i + words);
    if (g.filter((t) => !common.has(t)).length >= distinct) out.add(g.join(" "));
  }
  return out;
}

/** The authors (by {@link authorKey}) of one group's messages who share a script with others; empty without a rule. */
export function scriptAuthors(messages: readonly ScriptMessage[], rule: LensScripts | undefined): Set<string> {
  const marked = new Set<string>();
  if (!rule) return marked;
  const common = new Set(rule.common.map((c) => c.toLowerCase()));
  const distinct = rule.distinct ?? DEFAULT_DISTINCT;
  for (const r of rule.rules) {
    const by = new Map<string, Set<string>>();
    for (const m of messages) {
      const who = authorKey(m);
      if (!who) continue;
      for (const g of sequences(m.text, r.words, common, distinct)) {
        const s = by.get(g) ?? new Set<string>();
        s.add(who);
        by.set(g, s);
      }
    }
    for (const who of by.values()) if (who.size >= r.authors) for (const a of who) marked.add(a);
  }
  return marked;
}
