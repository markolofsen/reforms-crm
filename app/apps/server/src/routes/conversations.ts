import { clientKey, parseClientKey, type ClientKeyDto } from "@hub/contract/client-key";
import { Hono } from "hono";
import { bareRef, type ConversationItem, type Repos } from "@hub/db";
import type { NotionKind } from "@hub/config";
import { CONVERSATION_MAX, conversationDto, conversationMailDto, conversationsDto, conversationsListQuery, conversationTextDto, conversationTextQuery, type ConversationMessageDto, type ConversationThreadDto } from "@hub/contract/conversations";
import { notionIdentityDto, type NotionIdentityDto } from "@hub/contract/notion";
import { errFields, ops } from "@hub/log/ops";
import { displayNameFor, headersFromText, mailComposerContext, resolveBrand, visibleFrom } from "@hub/projects/brands";
import { toDraft } from "../dto";
import { notFound, v } from "../http";
import { ownText } from "@hub/mail-app/read";
import { threadsOf } from "../conversation";
import { LABEL_MAILBOXES } from "../inbound";
import type { ConversationServices } from "../composition/capabilities";
import { createMessengerIdentityResolver } from "../messenger-identity";

const id = (raw: string): number | null => (/^[1-9]\d*$/.test(raw) ? Number(raw) : null);

type Facts = NonNullable<Awaited<ReturnType<Repos["conversations"]["facts"]>>>;
type Msg = Omit<ConversationMessageDto, "draftId" | "preview"> & { inReplyTo: string | null; references: readonly string[] };
type NotionRef = { notionKind: NotionKind | null; notionPageId: string | null; notionUrl: string | null };

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

function threadsDto(msgs: Msg[], f: Facts, versions: ReadonlyMap<string, number>, brands: Parameters<typeof displayNameFor>[0]["brands"]): { threads: ConversationThreadDto[]; earlier: number } {
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

/**
 * P99: Mail lists people. `GET /api/projects/:slug/conversations` (one row per client, the state word, the views), `GET
 * .../clients/:id/conversation` (the pane's header and unsent message, SQLite only), `.../conversation/mail` (the history, read
 * from Mail now and never stored, decision 0013) and `.../conversation/text?m=` (one body, fetched as its bubble renders and kept in the server's
 * memory). Read only toward Mail: no route here writes Mail, Notion or the database except the idempotent clients rows of verdict 1.
 */
export function conversationRoutes({ repos, projects, mail, directory }: ConversationServices) {
  const identity = createMessengerIdentityResolver(directory);
  /** Where the last history read found each message, by project and Message-ID (for its body). Memory only. */
  const where = new Map<string, { account: string; mailbox: string; mailId: number }>();
  const notionFor = (email: string, refs: readonly NotionRef[], inboxRefs: ReadonlyMap<string, NotionRef | null>): NotionIdentityDto => {
    const inbox = inboxRefs.get(email.trim().toLowerCase()) ?? null;
    const resolved = [...refs, inbox].find((ref) => ref?.notionPageId || ref?.notionUrl) ?? null;
    const explicitNoPage = [...refs, inbox].find((ref) => ref?.notionKind === "none") ?? null;
    const ref = resolved ?? explicitNoPage;
    return notionIdentityDto.parse({
      state: ref?.notionPageId || ref?.notionUrl ? "resolved" : ref?.notionKind === "none" ? "unresolved" : "unavailable",
      pageId: ref?.notionPageId ?? null,
      url: ref?.notionUrl ?? null,
    });
  };
  const rowDto = async (slug: string, r: ConversationItem, inboxRefs: ReadonlyMap<string, NotionRef | null>, refs: readonly NotionRef[] = r.draft ? [r.draft] : []) => {
    const notion = notionFor(r.client.email, refs, inboxRefs);
    return {
    ...r,
    notion,
    // P131 O5: the client's Telegram and WhatsApp from the Notion card in memory (the directory), never a Notion read here.
    contact: identity.contact(slug, { email: r.client.email, pageId: notion.pageId }),
    draft: r.draft ? toDraft(r.draft, await repos.sends.forDraft(r.draft.id)) : null,
    };
  };
  return new Hono()
    .get("/api/projects/:slug/conversations", v("query", conversationsListQuery), async (c) => {
      const slug = c.req.param("slug");
      if (!(await repos.projects.get(slug))) return notFound(c, "project");
      const q = c.req.valid("query");
      const r = await repos.conversations.list(slug, q.view, { batch: q.batch ?? null, search: q.search, limit: q.limit, offset: q.offset });
      const inboxRefs = await repos.inbox.notionByEmails(slug, r.rows.map((item) => item.client.email));
      const next = q.offset + r.rows.length < r.total ? q.offset + r.rows.length : null;
      return c.json(conversationsDto.parse({ rows: await Promise.all(r.rows.map((item) => rowDto(slug, item, inboxRefs))), total: r.total, nextOffset: next, counts: r.counts }));
    })
    // P103: the client a key names (his email, or `id-<n>`), with the canonical key the admin's address replaces to. Verdict 4:
    // his primary address first, then any other address of his in P100's identity table (`client_identifiers`, kind `email`),
    // so a secondary email answers with the primary key and the admin replaces the address (one history entry).
    .get("/api/projects/:slug/clients/key/:key", async (c) => {
      const slug = c.req.param("slug");
      const ref = parseClientKey(c.req.param("key"));
      if (ref === null || (await repos.projects.get(slug)) === null) return notFound(c, "client");
      const n = "id" in ref ? ref.id : ((await repos.clients.idByEmail(slug, ref.email)) ?? (await repos.messengers.clientByIdentifier(slug, "email", ref.email.toLowerCase())) ?? undefined);
      const row = n === undefined ? null : await repos.clients.get(slug, n);
      if (!row) return notFound(c, "client");
      const dto: ClientKeyDto = { id: row.id, email: row.email, key: clientKey(row) };
      return c.json(dto);
    })
    .get("/api/projects/:slug/clients/:id/conversation", async (c) => {
      const slug = c.req.param("slug");
      const n = id(c.req.param("id"));
      const project = await repos.projects.get(slug);
      const row = n === null ? null : await repos.conversations.one(slug, n);
      if (!row || !project) return notFound(c, "client");
      const inboxRefs = await repos.inbox.notionByEmails(slug, [row.client.email]);
      const f = await repos.conversations.facts(slug, row.client.id);
      const cfg = projects.find(slug);
      if (!cfg) return notFound(c, "project");
      const contextDraft = [...(f?.drafts ?? [])].sort((a, b) => b.id - a.id).find((d) => d.brand || d.wroteTo) ?? null;
      const inbound = row.inboundId === null ? null : f?.inbound.find((message) => message.id === row.inboundId) ?? null;
      let composerAccount = inbound?.account ?? cfg.mail.accounts[0] ?? "";
      let composerAccountAddresses: readonly string[] = cfg.mail.accounts;
      let resolution: ReturnType<typeof resolveBrand> | null = null;
      let liveResolution = false;
      if (inbound && mail?.headers) {
        const live = await mail.headers({ account: inbound.account, messageId: inbound.messageId }).catch(() => null);
        if (live && "headers" in live) {
          composerAccount = inbound.account;
          composerAccountAddresses = live.accountAddresses ?? [inbound.account];
          resolution = resolveBrand(headersFromText(live.headers), { mail: cfg.mail, brands: cfg.brands });
          liveResolution = true;
        }
      }
      if (!liveResolution) {
        const ambiguousNewThread = row.inboundId === null && row.brands.length > 1;
        const brand = ambiguousNewThread ? null : contextDraft?.brand ?? (row.brands.length === 1 ? row.brands[0] : null);
        resolution = brand ? { brand, wroteTo: contextDraft?.brand === brand ? contextDraft.wroteTo ?? null : null, via: "address" as const, reason: "the conversation's recorded Mail context" } : null;
      }
      const composer = mailComposerContext({ mail: cfg.mail, brands: cfg.brands, signoff: cfg.signoff, languages: cfg.languages }, { account: composerAccount, accountAddresses: composerAccountAddresses, resolution }, contextDraft?.body ?? "");
      return c.json(conversationDto.parse({ row: await rowDto(slug, row, inboxRefs, f?.drafts ?? []), composer }));
    })
    .get("/api/projects/:slug/clients/:id/conversation/mail", async (c) => {
      const slug = c.req.param("slug");
      const n = id(c.req.param("id"));
      const project = await repos.projects.get(slug);
      const f = n === null || !project ? null : await repos.conversations.facts(slug, n);
      if (!f || !project) return notFound(c, "client");
      const versions = new Map<string, number>();
      for (const d of f.drafts) for (const ver of await repos.mailVersions.ofDraft(d.id)) versions.set(bareRef(ver.messageId), d.id);
      const projectConfig = projects.find(slug);
      if (!projectConfig) return notFound(c, "project");
      const cfg = projectConfig.mail;
      const read = mail ? await mail.history({ accounts: cfg.accounts, inboundBoxes: [...cfg.mailboxes, ...LABEL_MAILBOXES], sentMailbox: cfg.sentMailbox, address: f.client.email, subjects: f.drafts.map((d) => d.subject) }).catch((e: unknown) => {
        ops("mail").warn("a conversation's history was not read from Mail", { project: slug, ...errFields(e) });
        return { note: e instanceof Error && e.name === "MailNotAnswering" ? e.message : "Mail could not be read." };
      }) : { note: "Mail is not read here." };
      if ("note" in read) return c.json(conversationMailDto.parse({ source: "hub", note: read.note, ms: null, ...threadsDto(hubMessages(f), f, versions, projectConfig.brands) }));
      for (const m of read.messages) where.set(`${slug}|${m.messageId}`, { account: m.account, mailbox: m.mailbox, mailId: m.mailId });
      return c.json(conversationMailDto.parse({ source: "mail", note: null, ms: read.ms, ...threadsDto(read.messages, f, versions, projectConfig.brands) }));
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
