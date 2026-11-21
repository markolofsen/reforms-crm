import { Hono } from "hono";
import { bareRef, type ConversationItem, type Repos } from "@hub/db";
import { CONVERSATION_MAX, conversationDto, conversationMailDto, conversationsDto, conversationsListQuery, conversationTextDto, conversationTextQuery, type ConversationMessageDto, type ConversationThreadDto } from "@hub/contract/conversations";
import { errFields, ops } from "@hub/log/ops";
import { toDraft } from "../dto";
import { notFound, v } from "../http";
import { ownText } from "../apple-mail";
import { threadsOf, type HistoryMessage, type ReadInput } from "../conversation";
import { LABEL_MAILBOXES } from "../inbound";
import { configOf } from "../overview-facts";

/**
 * How the server reads one person's history and one body from Mail (P99 S1). `history` answers the messages, or a note when Mail
 * cannot be read (not running, not answering, demo mode); `text` answers one message's text by where the last history read found
 * it, else by the Mail reader's account and Message-ID.
 */
export interface ConversationMail {
  history(q: ReadInput): Promise<{ messages: HistoryMessage[]; ms: number } | { note: string }>;
  text(at: { account: string; mailbox: string; mailId: number } | { account: string; messageId: string }): Promise<{ text: string } | { note: string }>;
}

const id = (raw: string): number | null => (/^[1-9]\d*$/.test(raw) ? Number(raw) : null);

type Facts = NonNullable<Awaited<ReturnType<Repos["conversations"]["facts"]>>>;
type Msg = Omit<ConversationMessageDto, "draftId" | "preview"> & { inReplyTo: string | null; references: readonly string[] };

/** The Hub's own copy of the history when Mail cannot be read: their stored messages and our sends, headers only. */
function hubMessages(f: Facts): Msg[] {
  const theirs: Msg[] = f.inbound.map((r) => ({ messageId: r.messageId, ours: false, fromName: r.name, fromEmail: r.email, date: r.receivedAt, subject: r.subject, inReplyTo: r.threadRef, references: [] }));
  const ours: Msg[] = f.sends
    .filter((s) => s.status === "sent")
    .map((s) => ({ messageId: bareRef(s.sentMessageId) || `send-${s.id}`, ours: true, fromName: "", fromEmail: (/<([^>]+)>/.exec(s.sender ?? "")?.[1] ?? s.sender ?? "").toLowerCase(), date: s.doneAt ?? s.createdAt, subject: s.subject, inReplyTo: bareRef(s.mailRef) || null, references: [] }));
  return [...theirs, ...ours];
}

/** Which draft of this person a message is (ours: sent or written by the Hub) or answers (theirs: a draft's mailRef). */
function draftOf(m: Msg, f: Facts, versions: ReadonlyMap<string, number>): number | null {
  if (m.ours) return versions.get(m.messageId) ?? f.sends.find((s) => bareRef(s.sentMessageId) === m.messageId)?.draftId ?? f.drafts.find((d) => bareRef(d.sentMessageId) === m.messageId)?.id ?? null;
  return f.drafts.find((d) => bareRef(d.mailRef) === m.messageId)?.id ?? null;
}

function threadsDto(msgs: Msg[], f: Facts, versions: ReadonlyMap<string, number>): { threads: ConversationThreadDto[]; earlier: number } {
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
    const ourFrom = [...t].reverse().find((m) => m.ours)?.fromEmail || own?.wroteTo || null;
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

/**
 * P99: Mail lists people. `GET /api/projects/:slug/conversations` (one row per client, the state word, the views), `GET
 * .../clients/:id/conversation` (the pane's header and unsent message, SQLite only), `.../conversation/mail` (the history, read
 * from Mail now and never stored, decision 0013) and `.../conversation/text?m=` (one body, read on demand and kept in the server's
 * memory). Read only toward Mail: no route here writes Mail, Notion or the database except the idempotent clients rows of verdict 1.
 */
export function conversationRoutes(repos: Repos, mail: ConversationMail | undefined) {
  /** Where the last history read found each message, by project and Message-ID (for its body). Memory only. */
  const where = new Map<string, { account: string; mailbox: string; mailId: number }>();
  const rowDto = async (r: ConversationItem) => ({ ...r, draft: r.draft ? toDraft(r.draft, await repos.sends.forDraft(r.draft.id)) : null });
  return new Hono()
    .get("/api/projects/:slug/conversations", v("query", conversationsListQuery), async (c) => {
      const slug = c.req.param("slug");
      if (!(await repos.projects.get(slug))) return notFound(c, "project");
      const q = c.req.valid("query");
      const r = await repos.conversations.list(slug, q.view, { batch: q.batch ?? null, search: q.search, limit: q.limit, offset: q.offset });
      const next = q.offset + r.rows.length < r.total ? q.offset + r.rows.length : null;
      return c.json(conversationsDto.parse({ rows: await Promise.all(r.rows.map(rowDto)), total: r.total, nextOffset: next, counts: r.counts }));
    })
    .get("/api/projects/:slug/clients/:id/conversation", async (c) => {
      const slug = c.req.param("slug");
      const n = id(c.req.param("id"));
      const row = n === null ? null : await repos.conversations.one(slug, n);
      if (!row) return notFound(c, "client");
      const f = await repos.conversations.facts(slug, row.client.id);
      const notionUrl = f?.drafts.find((d) => d.notionUrl)?.notionUrl ?? (await repos.inbox.list(slug, "all")).find((r) => r.email === row.client.email)?.notionUrl ?? null;
      return c.json(conversationDto.parse({ row: await rowDto(row), notionUrl }));
    })
    .get("/api/projects/:slug/clients/:id/conversation/mail", async (c) => {
      const slug = c.req.param("slug");
      const n = id(c.req.param("id"));
      const project = await repos.projects.get(slug);
      const f = n === null || !project ? null : await repos.conversations.facts(slug, n);
      if (!f || !project) return notFound(c, "client");
      const versions = new Map<string, number>();
      for (const d of f.drafts) for (const ver of await repos.mailVersions.ofDraft(d.id)) versions.set(bareRef(ver.messageId), d.id);
      const cfg = configOf(project).mail;
      const read = mail ? await mail.history({ accounts: cfg.accounts, inboundBoxes: [...cfg.mailboxes, ...LABEL_MAILBOXES], sentMailbox: cfg.sentMailbox, address: f.client.email, subjects: f.drafts.map((d) => d.subject) }).catch((e: unknown) => {
        ops("mail").warn("a conversation's history was not read from Mail", { project: slug, ...errFields(e) });
        return { note: e instanceof Error && e.name === "MailNotAnswering" ? e.message : "Mail could not be read." };
      }) : { note: "Mail is not read here." };
      if ("note" in read) return c.json(conversationMailDto.parse({ source: "hub", note: read.note, ms: null, ...threadsDto(hubMessages(f), f, versions) }));
      for (const m of read.messages) where.set(`${slug}|${m.messageId}`, { account: m.account, mailbox: m.mailbox, mailId: m.mailId });
      return c.json(conversationMailDto.parse({ source: "mail", note: null, ms: read.ms, ...threadsDto(read.messages, f, versions) }));
    })
    .get("/api/projects/:slug/clients/:id/conversation/text", v("query", conversationTextQuery), async (c) => {
      const slug = c.req.param("slug");
      const n = id(c.req.param("id"));
      const f = n === null ? null : await repos.conversations.facts(slug, n);
      if (!f) return notFound(c, "client");
      const m = bareRef(c.req.valid("query").m);
      const at = where.get(`${slug}|${m}`) ?? (() => {
        const r = f.inbound.find((x) => x.messageId === m);
        return r ? { account: r.account, messageId: r.messageId } : null;
      })();
      if (!at) return c.json(conversationTextDto.parse({ text: null, quoted: false, note: "Open the conversation again to read this message from Mail." }));
      const read = mail ? await mail.text(at).catch(() => ({ note: "Mail could not show this message." })) : { note: "Mail is not read here." };
      const own = "text" in read ? ownText(read.text) : null;
      return c.json(conversationTextDto.parse({ text: own ? own.text : null, quoted: own?.quoted ?? false, note: "note" in read ? read.note : null }));
    });
}
