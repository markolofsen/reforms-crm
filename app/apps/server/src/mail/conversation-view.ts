import { bareRef, type Repos } from "@hub/db";
import type { NotionKind } from "@hub/config";
import { CONVERSATION_MAX, type ConversationMessageDto, type ConversationThreadDto } from "@hub/contract/conversations";
import { displayNameFor, visibleFrom } from "@hub/projects/brands";
import { threadsOf } from "./conversation";

// P120 W4: the conversation's threads and rows built from the repos' facts and Mail's read (route files import no @hub/db).
/** A Message-ID as the record keys it (no angle brackets, lower case). */
export const messageKey = (raw: string | null | undefined): string => bareRef(raw);
/** One row of the people list, as the repos read it. */
export type ConversationItem = Awaited<ReturnType<Repos["conversations"]["list"]>>["rows"][number];
type Facts = NonNullable<Awaited<ReturnType<Repos["conversations"]["facts"]>>>;
type Msg = Omit<ConversationMessageDto, "draftId" | "preview"> & { inReplyTo: string | null; references: readonly string[] };
export type NotionRef = { notionKind: NotionKind | null; notionPageId: string | null; notionUrl: string | null };

/** The Hub's own copy of the history when Mail cannot be read: their stored messages and our sends, headers only. */
export function hubMessages(f: Facts): Msg[] {
  const theirs: Msg[] = f.inbound.map((r) => ({ messageId: r.messageId, ours: false, fromName: r.name, fromEmail: r.email, date: r.receivedAt, subject: r.subject, inReplyTo: r.threadRef, references: [] }));
  const ours: Msg[] = f.sends
    .filter((s) => s.status === "sent")
    .map((s) => ({ messageId: bareRef(s.sentMessageId) || `send-${s.id}`, ours: true, fromName: "", fromEmail: (/<([^>]+)>/.exec(s.sender ?? "")?.[1] ?? s.sender ?? "").toLowerCase(), date: s.doneAt ?? s.createdAt, subject: s.subject, inReplyTo: bareRef(s.mailRef) || null, references: [] }));
  return [...theirs, ...ours];
}

/** Which draft of this person a message is (ours: sent or written by the Hub) or answers (theirs: a draft's mailRef). */
export function draftOf(m: Msg, f: Facts, versions: ReadonlyMap<string, number>): number | null {
  if (m.ours) return versions.get(m.messageId) ?? f.sends.find((s) => bareRef(s.sentMessageId) === m.messageId)?.draftId ?? f.drafts.find((d) => bareRef(d.sentMessageId) === m.messageId)?.id ?? null;
  return f.drafts.find((d) => bareRef(d.mailRef) === m.messageId)?.id ?? null;
}

export function threadsDto(msgs: Msg[], f: Facts, versions: ReadonlyMap<string, number>, brands: Parameters<typeof displayNameFor>[0]["brands"]): { threads: ConversationThreadDto[]; earlier: number } {
  const preview = new Map(f.inbound.map((r) => [r.messageId, r.preview]));
  const all = threadsOf(msgs).map((t) => t.map((m) => ({ ...m, draftId: draftOf(m, f, versions) })));
  const total = all.reduce((n, t) => n + t.length, 0);
  // The last CONVERSATION_MAX messages show; whole older threads are cut first, then the oldest messages of the oldest thread kept.
  let skip = Math.max(0, total - CONVERSATION_MAX);
  const earlier = skip;
  const kept = all.flatMap((t) => {
    if (skip >= t.length) {
      skip -= t.length;
      return [];
    }
    const rest = t.slice(skip);
    skip = 0;
    return [rest];
  });
  const threads = kept.map((t) => {
    const ids = new Set(t.map((m) => m.draftId).filter((x): x is number => x !== null));
    const own = f.drafts.filter((d) => ids.has(d.id) || t.some((m) => m.messageId === bareRef(d.mailRef))).sort((a, b) => b.id - a.id)[0];
    const technicalFrom = [...t].reverse().find((m) => m.ours)?.fromEmail || own?.wroteTo || null;
    const ourFrom = visibleFrom(technicalFrom, displayNameFor({ brands }, own?.brand));
    return {
      key: t[0]!.messageId,
      subject: t.at(-1)!.subject || t[0]!.subject,
      brand: own?.brand ?? null,
      ourFrom,
      messages: t.map((m) => ({ messageId: m.messageId, ours: m.ours, fromName: m.fromName, fromEmail: m.fromEmail, date: m.date, subject: m.subject, draftId: m.draftId, preview: preview.get(m.messageId) ?? "" })),
    };
  });
  return { threads, earlier };
}
