import { baseSubject } from "@hub/mail-app/history";

// P99 S1: one person's history is read from Apple Mail by `@hub/mail-app/history` (P126 M1); this module keeps what the server
// does with it: the threads of a list of messages and the short-lived cache of one message's opening lines (never stored, 0013).

/**
 * Threads by References and In-Reply-To (a message joins every message it names), then joined by the base subject, oldest first.
 * Returns the groups oldest thread first (by its first message), each oldest message first.
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
  const bySubject = new Map<string, string>();
  for (const m of msgs) {
    if (!parent.has(m.messageId)) parent.set(m.messageId, m.messageId);
    for (const r of [m.inReplyTo, ...m.references]) if (r) join(m.messageId, r);
  }
  for (const m of msgs) {
    const s = baseSubject(m.subject);
    if (!s) continue;
    const first = bySubject.get(s);
    if (first === undefined) bySubject.set(s, m.messageId);
    else join(first, m.messageId);
  }
  const groups = new Map<string, M[]>();
  for (const m of [...msgs].sort((a, b) => a.date.localeCompare(b.date))) {
    const k = find(m.messageId);
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return [...groups.values()].sort((a, b) => a[0]!.date.localeCompare(b[0]!.date));
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
  };
}

