import { Hono, type Context } from "hono";
import { chatRulesProblem } from "@hub/config/chat-rules";
import { sentenceOf } from "@hub/contract/errors";
import {
  chatRulesBody,
  clientMatchesDto,
  MESSENGER_VIEWS,
  messengerChatDto,
  messengerChatsDto,
  messengerDraftDto,
  messengerDraftTextBody,
  messengerSkippedDto,
  type MessengerChatDto,
  type MessengerView,
} from "@hub/contract/messenger-panel";
import { rulesOf, type MessengerChatRow, type MessengerDraftRow, type Repos } from "@hub/db";
import { z, type ZodType } from "zod";
import { gateRefusal } from "../admin-gate";
import { notFound } from "../http";

const KIND = { telegram_bot: "telegram", telegram_user: "telegram", whatsapp: "whatsapp" } as const;
const viewOf = (v: string | undefined): MessengerView => MESSENGER_VIEWS.find((x) => x === v) ?? "waiting";
const draftOf = (d: MessengerDraftRow) => messengerDraftDto.parse({ id: d.id, text: d.text, nudge: d.nudge, ownerRequest: d.ownerRequest, createdAt: d.createdAt, updatedAt: d.updatedAt });
const waits = (c: MessengerChatDto): boolean => c.draft !== null || c.owed;

/** One linked chat as the panel shows it: its client, rules, the newest stored message and the agent's open draft. */
async function chatRow(repos: Repos, slug: string, row: MessengerChatRow): Promise<MessengerChatDto> {
  const m = repos.messengers;
  const [activity, draft, clientId, newest] = await Promise.all([
    m.activity(slug, row.channel, row.chatId),
    m.openDraft(slug, row.channel, row.chatId),
    m.clientByIdentifier(slug, KIND[row.channel], row.chatId),
    m.messagesOf(slug, [{ channel: row.channel, chatId: row.chatId }], { limit: 1 }),
  ]);
  const client = clientId === null ? null : await repos.clients.get(slug, clientId);
  const last = newest[0] ?? null;
  return messengerChatDto.parse({
    id: row.id,
    channel: row.channel,
    chatId: row.chatId,
    title: row.title,
    client,
    rules: rulesOf(row),
    inbound: activity.inbound,
    last: last ? { direction: last.direction, kind: last.kind, text: last.text, at: last.sentAt } : null,
    owed: last?.direction === "in",
    draft: draft ? draftOf(draft) : null,
  });
}

/** Waiting first (a draft, then a reply owed), then by the newest message, newest first. */
const order = (a: MessengerChatDto, b: MessengerChatDto): number =>
  Number(b.draft !== null) - Number(a.draft !== null) || Number(b.owed) - Number(a.owed) || (b.last?.at ?? "").localeCompare(a.last?.at ?? "") || a.id - b.id;

/**
 * The Messengers section (P71 M3, decision 0036 point 6). Reads: the linked chats of a project with what is owed and the agent's
 * open draft (`GET .../messengers/chats?filter=waiting|all`), and a client lookup for the link picker (two or more characters,
 * at most 8, never every client: `app/@rules/README.md` rule 16). Writes, each behind the admin gate (the exact admin Origin,
 * a loopback Host, `Sec-Fetch-Site: same-origin`), since a chat's instruction steers the agent and a draft's text is what Send
 * will carry: the owner's Edit of a draft that still waits, Skip and its Undo, and one chat's rules (`setChatRules`). Nothing
 * here sends: Send is the door of P71 M4.
 */
export function messengerRoutes(repos: Repos, adminPort: number) {
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
      const rows = await Promise.all((await repos.messengers.allowedChats(slug)).map((r) => chatRow(repos, slug, r)));
      const all = rows.sort(order);
      const shown = viewOf(c.req.query("filter")) === "all" ? all : all.filter(waits);
      return c.json(messengerChatsDto.parse({ chats: shown, counts: { waiting: all.filter(waits).length, all: all.length } }));
    })
    .get("/api/projects/:slug/messengers/clients", async (c) => {
      const slug = c.req.param("slug");
      if ((await repos.projects.get(slug)) === null) return notFound(c, "project");
      return c.json(clientMatchesDto.parse({ clients: await repos.clients.search(slug, c.req.query("q") ?? "") }));
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
        return c.json(await chatRow(repos, slug, next));
      }),
    );
}
