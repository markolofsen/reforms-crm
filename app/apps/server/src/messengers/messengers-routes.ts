import { Hono, type Context } from "hono";
import { chatRulesProblem, isHiddenLabel } from "@hub/config/chat-rules";
import { sentenceOf } from "@hub/contract/errors";
import { chatRulesBody, inChannel, messengerChatsQuery, messengerConversationDto, messengerChatsDto, messengerDraftTextBody, messengerPrepareBody, messengerSkippedDto, type MessengerChatDto } from "@hub/contract/messenger-panel";
import { z, type ZodType } from "zod";
import { gateRefusal } from "../http/admin-gate";
import { notFound, v } from "../http/http";
import { preanalysisStanding } from "./preanalysis";
import { prepareMessengerReply } from "./reply";
import { createMessengerIdentityResolver } from "./identity";
import type { MessengersContext } from "./context";
import { draftOf, projectedChatOf, projectedChatRow, waits, waitsForThem } from "./chat-view";

/** Waiting first (a draft, then a reply owed), then by the newest message, newest first. */
const order = (a: MessengerChatDto, b: MessengerChatDto): number =>
  Number(b.draft !== null) - Number(a.draft !== null) || Number(b.owed) - Number(a.owed) || (b.last?.at ?? "").localeCompare(a.last?.at ?? "") || a.id - b.id;

/**
 * The Messengers section (P71 M3, decision 0036 point 6). Reads: the linked chats of a project with what is owed and the agent's
 * open draft (`GET .../messengers/chats?filter=needs_you|waiting|all&link=any|linked|unlinked|hidden&channel=all|telegram|whatsapp`; P84c, P102, P123 U3b: `unlinked` and `hidden` list no linked
 * chat, since such a chat is not linked: the admin reads them from the autolink's memory). Writes, each behind the admin gate (the exact admin Origin,
 * a loopback Host, `Sec-Fetch-Site: same-origin`), since a chat's instruction steers the agent and a draft's text is what Send
 * will carry: the owner's Edit of a draft that still waits, Skip and its Undo, and one chat's rules (`setChatRules`). Nothing
 * here sends: Send is the door of P71 M4. The owner may also create an unsent manual draft without an inbound message. P71 M-P: each chat carries its pre-analysis counts by reason, the reply says whether a
 * pass can run (`preanalysis`), and turning a chat's switch on starts one pass.
 */
export function messengerRoutes({ repos, adminPort, preanalysis, reply, directory }: MessengersContext) {
  const standing = () => preanalysis?.standing() ?? preanalysisStanding();
  const identity = createMessengerIdentityResolver(directory);
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
      const rows = (await repos.messengers.list(slug)).filter((projection) => inChannel(projection.row.channel, channel)).map((projection) => projectedChatRow(projection, identity, slug));
      const all = rows.sort(order);
      const search = q.toLocaleLowerCase();
      const matching = search
        ? all.filter((r) => [r.title, r.chatId, r.client?.name, r.client?.email, r.last?.text].some((value) => value?.toLocaleLowerCase().includes(search)))
        : all;
      // Only linked chats are stored here: the unlinked and hidden ones are the autolink's memory, read by the admin.
      const linkedShown = link === "any" || link === "linked";
      const shown = !linkedShown ? [] : view === "all" ? matching : matching.filter(view === "waiting" ? waitsForThem : waits);
      return c.json(messengerChatsDto.parse({ chats: shown, counts: { needs_you: all.filter(waits).length, waiting: all.filter(waitsForThem).length, all: all.length }, preanalysis: standing() }));
    })
    .get("/api/projects/:slug/messengers/chats/:id/conversation", async (c) => {
      const slug = c.req.param("slug");
      if ((await repos.projects.get(slug)) === null) return notFound(c, "project");
      const id = idOf(c, "id");
      const row = id === null ? null : await repos.messengers.chatById(slug, id);
      if (!row) return notFound(c, "chat");
      const [chat, messages] = await Promise.all([
        projectedChatOf(repos, slug, row, identity),
        repos.messengers.messagesOf(slug, [{ channel: row.channel, chatId: row.chatId }], { limit: 101 }),
      ]);
      if (!chat) return notFound(c, "chat");
      const verdicts = await repos.messengers.verdictsOf(slug, messages.map((m) => m.id));
      const ordered = messages
        .slice()
        .reverse()
        .map((m) => ({ id: m.id, direction: m.direction, kind: m.kind, text: m.text, format: "plain" as const, at: m.sentAt, hidden: isHiddenLabel(verdicts.get(m.id)) ? verdicts.get(m.id) : null }));
      return c.json(messengerConversationDto.parse({ chat, messages: ordered.slice(-100), earlier: Math.max(0, messages.length - 100) }));
    })
    .put("/api/projects/:slug/messengers/drafts/:id/text", (c) =>
      gated(c, messengerDraftTextBody, async (b, slug) => {
        const id = idOf(c, "id");
        if (id === null) return c.json({ error: "Not a draft id.", code: "invalid" as const }, 400);
        return c.json(draftOf(await repos.messengers.reviseDraft(slug, id, b.text)));
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
        const chat = await projectedChatOf(repos, slug, row, identity);
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
        const next = await projectedChatOf(repos, slug, row, identity);
        return next ? c.json(next) : notFound(c, "chat");
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
        const next = await repos.messengers.setChatRules(slug, row.channel, row.chatId, b);
        // P71 M-P: the owner turned the pre-analysis on: one pass now over the chat's recent messages (none without a key).
        if (b.prefilter === true && !row.prefilter) preanalysis?.after(slug);
        const chat = await projectedChatOf(repos, slug, next, identity);
        return chat ? c.json(chat) : notFound(c, "chat");
      }),
    );
}
