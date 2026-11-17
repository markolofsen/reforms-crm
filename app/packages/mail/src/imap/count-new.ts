import type { ImapAccount, ImapSession } from "./session";
import { findSentMailbox, normSubject } from "./sent";
import { chunk, defaultMailboxes, normAddr, syntheticId } from "./util";

/** The longest look-back of the overview count: a first read of a mailbox with years of mail cannot scan all of it. */
export const NEW_WINDOW_DAYS = 14;
const FETCH_CHUNK = 100;

/** `max(lastTriageAt, now - NEW_WINDOW_DAYS)`: where the "new since the last triage" count starts. */
export function windowStart(now: Date, lastTriageAt?: Date | null): Date {
  const floor = new Date(now.getTime() - NEW_WINDOW_DAYS * 86_400_000);
  return lastTriageAt && lastTriageAt.getTime() > floor.getTime() ? lastTriageAt : floor;
}

export interface CountNewOptions {
  /** Messages dated before this are not counted (use `windowStart`). */
  since: Date;
  /** Own addresses beyond the account's `addresses`. */
  me?: string[];
  /** True for a sender that is known not to be a client (newsletter, receipt). Header fields only, never a body. */
  excluded?: (m: { from: string; subject: string }) => boolean;
}

export interface CountNewResult {
  /** Inbound messages since `since` that nobody answered later in the same thread. */
  count: number;
  /** Headers examined, after removing copies of one message. */
  scanned: number;
  /** False when no Sent folder could be read: answered mail is then counted too, so the number is an upper bound. */
  answersChecked: boolean;
}

interface Seen {
  id: string;
  at: number;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  inReplyTo: string | null;
  references: string[];
}

/**
 * How many messages came in since `since` that have no later outbound message in their thread. Read only and header
 * level: `search({since})` and `headers()`, never `source()`, so no body is ever fetched. A message is `out` when its
 * sender is one of the account's own addresses; a thread is matched by `In-Reply-To`/`References`, then by the same
 * normalised subject sent to the sender (the family of `matchSent`). The account's Sent folder is read too, because
 * an account limited to INBOX would otherwise never see its own answers.
 */
export async function countNewSince(a: ImapAccount, s: ImapSession, o: CountNewOptions): Promise<CountNewResult> {
  const mine = new Set([...(o.me ?? []), ...a.addresses].map(normAddr));
  const configured = a.mailboxes ?? defaultMailboxes(a.host, await s.list());
  let sent: string | null = null;
  try {
    sent = await findSentMailbox(a, s);
  } catch {
    sent = null;
  }
  const since = o.since.getTime();
  const byId = new Map<string, Seen>();
  for (const path of new Set([...configured, ...(sent ? [sent] : [])])) {
    for (const part of chunk(await s.search(path, { since: o.since }), FETCH_CHUNK)) {
      for (const h of await s.headers(path, part)) {
        const at = Date.parse(h.date);
        if (Number.isNaN(at) || at < since) continue;
        const id = h.messageId ?? syntheticId([h.date, h.from, h.subject, h.size]);
        if (!byId.has(id)) byId.set(id, { id, at, from: normAddr(h.from), to: h.to.map(normAddr), cc: h.cc.map(normAddr), subject: h.subject, inReplyTo: h.inReplyTo, references: h.references });
      }
    }
  }

  // Newest outbound answer per referenced Message-Id and per (subject, recipient): one pass, no pairwise search.
  const byRef = new Map<string, number>();
  const bySubject = new Map<string, number>();
  const latest = (m: Map<string, number>, k: string, at: number) => m.set(k, Math.max(m.get(k) ?? 0, at));
  const all = [...byId.values()];
  for (const m of all) {
    if (!mine.has(m.from)) continue;
    for (const r of [...(m.inReplyTo ? [m.inReplyTo] : []), ...m.references]) latest(byRef, r, m.at);
    const subject = normSubject(m.subject);
    if (subject) for (const to of new Set([...m.to, ...m.cc])) latest(bySubject, `${subject}\u0000${to}`, m.at);
  }

  let count = 0;
  for (const m of all) {
    if (mine.has(m.from) || m.from === "") continue;
    if (o.excluded?.({ from: m.from, subject: m.subject })) continue;
    const subject = normSubject(m.subject);
    const answered = Math.max(byRef.get(m.id) ?? 0, subject ? (bySubject.get(`${subject}\u0000${m.from}`) ?? 0) : 0);
    if (answered > m.at) continue;
    count++;
  }
  return { count, scanned: all.length, answersChecked: sent !== null };
}
