import { AUTOPILOT_DRAFT_AUTHOR } from "@hub/config/autopilot";
import { Hono, type Context } from "hono";
import { chatRulesProblem, isHiddenLabel } from "@hub/config/chat-rules";
import { sentenceOf } from "@hub/contract/errors";
import { chatRulesBody, inChannel, messengerChatsQuery, messengerConversationDto, messengerChatDoneDto, messengerChatsDto, messengerDraftTextBody, messengerPrepareBody, messengerSkippedDto, type MessengerChatDto } from "@hub/contract/messenger-panel";
import { z, type ZodType } from "zod";
import { gateRefusal } from "../http/admin-gate";
import { notFound, v } from "../http/http";
import { preanalysisStanding } from "./preanalysis";
import { prepareMessengerReply } from "./reply";
import { createMessengerIdentityResolver } from "./identity";
import type { MessengersContext } from "./context";
import { draftOf, projectedChatOf, projectedChatRow, waits, waitsForThem, type ChatSuggestions } from "./chat-view";

/** Waiting first (a draft, then a reply owed), then by the newest message, newest first. */
const order = (a: MessengerChatDto, b: MessengerChatDto): number =>
  Number(b.draft !== null) - Number(a.draft !== null) || Number(b.owed) - Number(a.owed) || (b.last?.at ?? "").localeCompare(a.last?.at ?? "") || a.id - b.id;

/**
 * The Messengers section (P71 M3, decision 0036 point 6, 0049). Reads: the known chats of a project (P141 U2: every chat that wrote,
 * linked or not) with what is owed and the agent's open draft (`GET .../messengers/chats?filter=needs_you|waiting|all&link=any|linked|unlinked|hidden&channel=all|telegram|whatsapp`;
 * `hidden` lists nothing here: a hidden chat has no row, the admin reads the autolink's memory), and one chat's conversation, which
 * reads through to the messenger first (WhatsApp from the Mac's app, Telegram from the account). Writes, each behind the admin gate (the exact admin Origin,
 * a loopback Host, `Sec-Fetch-Site: same-origin`), since a chat's instruction steers the agent and a draft's text is what Send
 * will carry: the owner's Edit of a draft that still waits, Skip and its Undo, and one chat's rules (`setChatRules`). Nothing
 * here sends: Send is the door of P71 M4. The owner may also create an unsent manual draft without an inbound message. P71 M-P: each chat carries its pre-analysis counts by reason, the reply says whether a
 * pass can run (`preanalysis`), and turning a chat's switch on starts one pass.
 */
export function messengerRoutes({ repos, adminPort, preanalysis, reply, directory, wa, tg, autolink }: MessengersContext) {
  const standing = () => preanalysis?.standing() ?? preanalysisStanding();
  const identity = createMessengerIdentityResolver(directory);
  // P141 U3: the autolink's suggestions for a chat that is not linked (memory only; a bot chat has none).
  const suggest: ChatSuggestions = (channel, chatId) => (autolink && channel !== "telegram_bot" ? autolink.autolink.suggestionsOf(channel, chatId) : []);
  const gated = async <T>(c: Context, schema: ZodType<T>, then: (body: T, slug: string) => Promise<Response>): Promise<Response> => {
    const why = gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, adminPort, { sameSite: true });
    if (why) return c.json({ error: `Refused: ${why}.`, code: "forbidden" as const }, 403);
    const slug = c.req.param("slug") ?? "";
    if ((await repos.projects.get(slug)) === null) return notFound(c, "project");
    const parsed = schema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: sentenceOf(parsed.error), code: "invalid" as const }, 400);
    return then(parsed.data, slug);
  };
  const idOf = (c: Context, name: string): number | null => {
    const v = c.req.param(name) ?? "";
    return /^[1-9]\d{0,9}$/.test(v) ? Number(v) : null;
  };
  /** Skip and its Undo take no fields. */
  const noBody = z.unknown();

  return new Hono()
    .get("/api/projects/:slug/messengers/chats", v("query", messengerChatsQuery), async (c) => {
      const slug = c.req.param("slug");
      if ((await repos.projects.get(slug)) === null) return notFound(c, "project");
      const { channel, filter: view, link, q } = c.req.valid("query");
      const rows = (await repos.messengers.list(slug)).filter((projection) => inChannel(projection.row.channel, channel)).map((projection) => projectedChatRow(projection, identity, slug, suggest));
      // Decision 0049 (P141 U2): every known chat is stored; the link filter splits them by a client identifier. The views' counts
      // stay over the linked chats (what needs the owner and what waits for the client); the unlinked ones are counted beside them.
      const sorted = rows.sort(order);
      const all = sorted.filter((r) => r.client !== null);
      const unlinked = sorted.filter((r) => r.client === null);
      const search = q.toLocaleLowerCase();
      const pool = link === "linked" ? all : link === "unlinked" ? unlinked : link === "hidden" ? [] : sorted;
      const matching = search
        ? pool.filter((r) => [r.title, r.chatId, r.client?.name, r.client?.email, r.last?.text, r.identity.profileName, r.identity.username, r.identity.phone].some((value) => value?.toLocaleLowerCase().includes(search)))
        : pool;
      // An unlinked chat shows under every view of `unlinked`; under `any` it follows the view like a linked one. Hidden chats have no row: the autolink's memory names them.
      const shown = view === "all" || link === "unlinked" ? matching : matching.filter(view === "waiting" ? waitsForThem : waits);
      return c.json(messengerChatsDto.parse({ chats: shown, counts: { needs_you: all.filter(waits).length, waiting: all.filter(waitsForThem).length, all: all.length, unlinked: unlinked.length }, preanalysis: standing() }));
    })
    .get("/api/projects/:slug/messengers/chats/:id/conversation", async (c) => {
      const slug = c.req.param("slug");
      if ((await repos.projects.get(slug)) === null) return notFound(c, "project");
      const id = idOf(c, "id");
      const row = id === null ? null : await repos.messengers.chatById(slug, id);
      if (!row) return notFound(c, "chat");
      // P141 W3 (decision 0049 point 3): a WhatsApp chat is refilled from the Mac's WhatsApp app (read only, local) before it is read,
      // so a message that arrived while the Hub was off, or that the cache let go, shows. A failed refill answers from the cache.
      if (row.channel === "whatsapp" && wa) await wa.refill(slug, { chatId: row.chatId, jid: row.jid }).catch(() => 0);
      // P141 U1 (decision 0049 point 2): a Telegram user chat reads through from Telegram, 5 s at most, else the saved copy.
      const copy = row.channel === "telegram_user" && tg ? await tg.readThrough(slug, row.chatId).catch(() => "saved" as const) : null;
      const [chat, messages] = await Promise.all([
        projectedChatOf(repos, slug, row, identity, suggest),
        repos.messengers.messagesOf(slug, [{ channel: row.channel, chatId: row.chatId }], { limit: 101 }),
      ]);
      if (!chat) return notFound(c, "chat");
      // P143 N2: the linked client's one card is read again (throttled, not awaited): a name written in Notion directly names the
      // chat on this read's live update instead of after the 6-hour full read. Only this project's directory.
      const page = chat.client?.notionPageId;
      if (page && directory && directory.project === slug) void directory.directory.readCard(page);
      const verdicts = await repos.messengers.verdictsOf(slug, messages.map((m) => m.id));
      const ordered = messages
        .slice()
        .reverse()
        .map((m) => ({ id: m.id, direction: m.direction, kind: m.kind, text: m.text, format: "plain" as const, at: m.sentAt, hidden: isHiddenLabel(verdicts.get(m.id)) ? verdicts.get(m.id) : null, source: m.source ?? null }));
      return c.json(messengerConversationDto.parse({ chat, messages: ordered.slice(-100), earlier: Math.max(0, messages.length - 100), copy }));
    })
    .put("/api/projects/:slug/messengers/drafts/:id/text", (c) =>
      gated(c, messengerDraftTextBody, async (b, slug) => {
        const id = idOf(c, "id");
        if (id === null) return c.json({ error: "Not a draft id.", code: "invalid" as const }, 400);
        // Verdict 29: his edit of autopilot's draft makes it his; no later turn touches it.
        const cur = await repos.messengers.getDraft(slug, id);
        return c.json(draftOf(await repos.messengers.reviseDraft(slug, id, b.text, cur?.createdBy === AUTOPILOT_DRAFT_AUTHOR ? { createdBy: "owner" } : {})));
      }),
    )
    .post("/api/projects/:slug/messengers/drafts/:id/skip", (c) =>
      gated(c, noBody, async (_b, slug) => {
        const id = idOf(c, "id");
        if (id === null) return c.json({ error: "Not a draft id.", code: "invalid" as const }, 400);
        await repos.messengers.discardDraft(slug, id);
        return c.json(messengerSkippedDto.parse({ ok: true, id }));
      }),
    )
    .post("/api/projects/:slug/messengers/drafts/:id/restore", (c) =>
      gated(c, noBody, async (_b, slug) => {
        const id = idOf(c, "id");
        if (id === null) return c.json({ error: "Not a draft id.", code: "invalid" as const }, 400);
        return c.json(draftOf(await repos.messengers.restoreDraft(slug, id)));
      }),
    )
    .post("/api/projects/:slug/messengers/chats/:id/prepare", (c) =>
      gated(c, messengerPrepareBody, async (b, slug) => {
        const id = idOf(c, "id");
        if (id === null) return c.json({ error: "Not a chat id.", code: "invalid" as const }, 400);
        if (!reply) return c.json({ error: "Reply preparation is unavailable in this server mode.", code: "unavailable" as const }, 503);
        // A MessengerReplyError (404, 503 or 409) is the server's onError's (P126 E1).
        await prepareMessengerReply({ repos, llm: reply.llm, projectsDir: reply.projectsDir, ...(reply.policyDir ? { policyDir: reply.policyDir } : {}), project: slug, chatId: id, body: b });
        const row = await repos.messengers.chatById(slug, id);
        if (!row) return notFound(c, "chat");
        const chat = await projectedChatOf(repos, slug, row, identity, suggest);
        return chat ? c.json(chat) : notFound(c, "chat");
      }),
    )
    .post("/api/projects/:slug/messengers/chats/:id/draft", (c) =>
      gated(c, messengerDraftTextBody, async (b, slug) => {
        const id = idOf(c, "id");
        if (id === null) return c.json({ error: "Not a chat id.", code: "invalid" as const }, 400);
        const row = await repos.messengers.chatById(slug, id);
        if (!row) return notFound(c, "chat");
        const open = await repos.messengers.openDraft(slug, row.channel, row.chatId);
        if (open) return c.json({ error: `Draft ${open.id} already waits for review.`, code: "wrong_state" as const }, 409);
        const clientId = await repos.messengers.clientByIdentifier(slug, row.channel === "whatsapp" ? "whatsapp" : "telegram", row.chatId);
        await repos.messengers.createDraft({ project: slug, channel: row.channel, chatId: row.chatId, text: b.text, createdBy: "owner", clientId });
        const next = await projectedChatOf(repos, slug, row, identity, suggest);
        return next ? c.json(next) : notFound(c, "chat");
      }),
    )
    // P143 D2: "No reply needed" on a chat (Done) and its Undo: the chat leaves Needs you until their next message reopens it.
    // Mail's No reply needed (`inbound/:id/dismiss`) is the same rule for a person's mail; neither sends anything.
    .post("/api/projects/:slug/messengers/chats/:id/done", (c) =>
      gated(c, noBody, async (_b, slug) => {
        const id = idOf(c, "id");
        if (id === null) return c.json({ error: "Not a chat id.", code: "invalid" as const }, 400);
        if (!(await repos.messengers.chatById(slug, id))) return notFound(c, "chat");
        const row = await repos.messengers.markDone(slug, id, { by: "owner" });
        if (!row) return c.json({ error: "They have not written in this chat: there is nothing to close.", code: "wrong_state" as const }, 409);
        return c.json(messengerChatDoneDto.parse({ ok: true, id, done: true }));
      }),
    )
    .post("/api/projects/:slug/messengers/chats/:id/done/undo", (c) =>
      gated(c, noBody, async (_b, slug) => {
        const id = idOf(c, "id");
        if (id === null) return c.json({ error: "Not a chat id.", code: "invalid" as const }, 400);
        if (!(await repos.messengers.reopen(slug, id))) return notFound(c, "chat");
        return c.json(messengerChatDoneDto.parse({ ok: true, id, done: false }));
      }),
    )
    .put("/api/projects/:slug/messengers/chats/:id/rules", (c) =>
      gated(c, chatRulesBody, async (b, slug) => {
        const id = idOf(c, "id");
        if (id === null) return c.json({ error: "Not a chat id.", code: "invalid" as const }, 400);
        const problem = chatRulesProblem(b);
        if (problem) return c.json({ error: `Refused: ${problem}.`, code: "invalid" as const }, 400);
        const row = await repos.messengers.chatById(slug, id);
        if (!row) return notFound(c, "chat");
        // Decision 0049 point 10: the pre-analysis never runs on a chat that is not linked.
        if (b.prefilter === true && !(await repos.messengers.isLinked(slug, row.channel, row.chatId))) return c.json({ error: "Link the chat to a client first: the pre-analysis runs only in linked chats.", code: "wrong_state" as const }, 409);
        const next = await repos.messengers.setChatRules(slug, row.channel, row.chatId, b);
        // P71 M-P: the owner turned the pre-analysis on: one pass now over the chat's recent messages (none without a key).
        if (b.prefilter === true && !row.prefilter) preanalysis?.after(slug);
        const chat = await projectedChatOf(repos, slug, next, identity, suggest);
        return chat ? c.json(chat) : notFound(c, "chat");
      }),
    );
}
