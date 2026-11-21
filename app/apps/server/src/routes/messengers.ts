import { Hono, type Context } from "hono";
import { chatRulesProblem, isHiddenLabel } from "@hub/config/chat-rules";
import { sentenceOf } from "@hub/contract/errors";
import {
  chatRulesBody,
  inChannel,
  MESSENGER_CHANNEL_FILTERS,
  MESSENGER_VIEWS,
  messengerChatDto,
  messengerChatsDto,
  messengerDraftDto,
  messengerDraftTextBody,
  messengerSkippedDto,
  type MessengerChannelFilter,
  type MessengerChatDto,
  type MessengerView,
} from "@hub/contract/messenger-panel";
import { rulesOf, type MessengerChatRow, type MessengerDraftRow, type Repos } from "@hub/db";
import { z, type ZodType } from "zod";
import { gateRefusal } from "../admin-gate";
import { notFound } from "../http";
import { preanalysisStanding, type Preanalysis } from "../preanalysis";

const KIND = { telegram_bot: "telegram", telegram_user: "telegram", whatsapp: "whatsapp" } as const;
const viewOf = (v: string | undefined): MessengerView => MESSENGER_VIEWS.find((x) => x === v) ?? "todo";
const channelOf = (v: string | undefined): MessengerChannelFilter => MESSENGER_CHANNEL_FILTERS.find((x) => x === v) ?? "all";
const draftOf = (d: MessengerDraftRow) => messengerDraftDto.parse({ id: d.id, text: d.text, nudge: d.nudge, ownerRequest: d.ownerRequest, createdAt: d.createdAt, updatedAt: d.updatedAt });
const waits = (c: MessengerChatDto): boolean => c.draft !== null || c.owed;

/** One linked chat as the panel shows it: its client, rules, the newest stored message and the agent's open draft. */
async function chatRow(repos: Repos, slug: string, row: MessengerChatRow): Promise<MessengerChatDto> {
  const m = repos.messengers;
  const [activity, stored, draft, clientId, newest, triage] = await Promise.all([
    m.activity(slug, row.channel, row.chatId),
    m.messageCount(slug, row.channel, row.chatId),
    m.openDraft(slug, row.channel, row.chatId),
    m.clientByIdentifier(slug, KIND[row.channel], row.chatId),
    m.messagesOf(slug, [{ channel: row.channel, chatId: row.chatId }], { limit: 1 }),
    m.triageCounts(slug, row.channel, row.chatId),
  ]);
  const client = clientId === null ? null : await repos.clients.get(slug, clientId);
  const last = newest[0] ?? null;
  // P71 M-P: a newest message the pre-analysis hid (a "thanks", a notice) owes no reply.
  const verdict = last ? (await m.verdictsOf(slug, [last.id])).get(last.id) : undefined;
  const hidden = isHiddenLabel(verdict) ? verdict : null;
  return messengerChatDto.parse({
    id: row.id,
    channel: row.channel,
    chatId: row.chatId,
    title: row.title,
    client,
    rules: rulesOf(row),
    inbound: activity.inbound,
    stored,
    last: last ? { direction: last.direction, kind: last.kind, text: last.text, at: last.sentAt, hidden } : null,
    owed: last?.direction === "in" && hidden === null,
    draft: draft ? draftOf(draft) : null,
    autolinked: row.autolinked ?? null,
    triage,
  });
}

/** Waiting first (a draft, then a reply owed), then by the newest message, newest first. */
const order = (a: MessengerChatDto, b: MessengerChatDto): number =>
  Number(b.draft !== null) - Number(a.draft !== null) || Number(b.owed) - Number(a.owed) || (b.last?.at ?? "").localeCompare(a.last?.at ?? "") || a.id - b.id;

/**
 * The Messengers section (P71 M3, decision 0036 point 6). Reads: the linked chats of a project with what is owed and the agent's
 * open draft (`GET .../messengers/chats?filter=todo|linked|unlinked|hidden&channel=all|telegram|whatsapp`; P84c, P102: `unlinked` and `hidden` list no linked
 * chat, since such a chat is not linked: the admin reads them from the autolink's memory). Writes, each behind the admin gate (the exact admin Origin,
 * a loopback Host, `Sec-Fetch-Site: same-origin`), since a chat's instruction steers the agent and a draft's text is what Send
 * will carry: the owner's Edit of a draft that still waits, Skip and its Undo, and one chat's rules (`setChatRules`). Nothing
 * here sends: Send is the door of P71 M4. P71 M-P: each chat carries its pre-analysis counts by reason, the reply says whether a
 * pass can run (`preanalysis`), and turning a chat's switch on starts one pass.
 */
export function messengerRoutes(repos: Repos, adminPort: number, preanalysis?: Preanalysis) {
  const standing = () => preanalysis?.standing() ?? preanalysisStanding();
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
    .get("/api/projects/:slug/messengers/chats", async (c) => {
      const slug = c.req.param("slug");
      if ((await repos.projects.get(slug)) === null) return notFound(c, "project");
      const channel = channelOf(c.req.query("channel"));
      const rows = await Promise.all((await repos.messengers.allowedChats(slug)).filter((r) => inChannel(r.channel, channel)).map((r) => chatRow(repos, slug, r)));
      const all = rows.sort(order);
      const view = viewOf(c.req.query("filter"));
      const shown = view === "linked" ? all : view === "todo" ? all.filter(waits) : [];
      return c.json(messengerChatsDto.parse({ chats: shown, counts: { todo: all.filter(waits).length, linked: all.length }, preanalysis: standing() }));
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
        return c.json(await chatRow(repos, slug, next));
      }),
    );
}
