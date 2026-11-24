import { baseSubject } from "@hub/mail-app/history";

// P99 S1: one person's history is read from Apple Mail by `@hub/mail-app/history` (P126 M1); this module keeps what the server
// does with it: the threads of a list of messages and the short-lived cache of one message's opening lines (never stored, 0013).

/**
 * Threads by the mail headers (P140 verdicts 1, 2): a message joins every message its In-Reply-To and References name. A message
 * with neither is a thread root and never joins another thread by subject. Only a message whose headers name nothing in the set
 * read (its parent was not read) joins by subject: the newest thread of its base subject. Returns the groups ordered by their
 * last message (newest activity last), each oldest message first.
 */
export function threadsOf<M extends { messageId: string; inReplyTo: string | null; references: readonly string[]; subject: string; date: string }>(msgs: readonly M[]): M[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const join = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const read = new Set(msgs.map((m) => m.messageId));
  const named = (m: M): string[] => [m.inReplyTo, ...m.references].filter((r): r is string => !!r);
  for (const m of msgs) {
    if (!parent.has(m.messageId)) parent.set(m.messageId, m.messageId);
    for (const r of named(m)) join(m.messageId, r);
  }
  const byDate = [...msgs].sort((a, b) => a.date.localeCompare(b.date));
  const groupsOf = () => {
    const g = new Map<string, M[]>();
    for (const m of byDate) {
      const k = find(m.messageId);
      g.set(k, [...(g.get(k) ?? []), m]);
    }
    return g;
  };
  for (const m of byDate) {
    const refs = named(m);
    const s = baseSubject(m.subject);
    if (!refs.length || refs.some((r) => read.has(r)) || !s) continue;
    const own = find(m.messageId);
    const target = [...groupsOf().entries()]
      .filter(([k, t]) => k !== own && t.some((x) => baseSubject(x.subject) === s))
      .sort(([, a], [, b]) => b.at(-1)!.date.localeCompare(a.at(-1)!.date))[0];
    if (target) join(target[0], m.messageId);
  }
  return [...groupsOf().values()].sort((a, b) => a.at(-1)!.date.localeCompare(b.at(-1)!.date));
}

/** The bodies read in this run of the server, by project and Message-ID (decision 0013: memory only, gone at a restart). */
const BODY_MAX = 300;
const BODY_TTL_MS = 15 * 60_000;
export function bodyCache(now: () => number = Date.now) {
  const m = new Map<string, { text: string; at: number }>();
  return {
    get(key: string): string | null {
      const hit = m.get(key);
      if (!hit || now() - hit.at > BODY_TTL_MS) return null;
      return hit.text;
    },
    set(key: string, text: string): void {
      m.delete(key);
      m.set(key, { text, at: now() });
      while (m.size > BODY_MAX) m.delete(m.keys().next().value!);
    },
    /** P140 R5: Refresh drops one person's bodies, so the next read asks Mail. */
    delete(key: string): void {
      m.delete(key);
    },
  };
}

