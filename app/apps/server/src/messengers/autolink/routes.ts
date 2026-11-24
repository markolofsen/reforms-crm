import { Hono, type Context } from "hono";
import { sentenceOf } from "@hub/contract/errors";
import { agentChatLinkBody, agentChatLinkedDto, agentClientCreateBody, agentUnlinkedDto, autolinkProposalsDropBody, autolinkProposalsDroppedDto, autolinkProposeBody, autolinkProposedDto, autolinkCreateBody, autolinkDialogsBody, autolinkHiddenDto, autolinkHideBody, autolinkLinkBody, autolinkLinkedDto, autolinkMoveBody, autolinkPreviewDto, autolinkRecordsBody, autolinkRecordsDto, autolinkStateDto, chatEmailBody, chatEmailDto, chatMovedDto, chatMoveUndoBody, chatMoveUndoneDto, chatUnlinkedDto, userDialogsDto } from "@hub/contract/messengers";
import { IMPORT_DAYS } from "@hub/config/chat-rules";
import { autopilotChatKey } from "@hub/config/autopilot";
import { chatClientTitle, isRealName, plainName } from "@hub/config/profile";
import { errFields, ops } from "@hub/log/ops";
import { AGENT_SEND_HEADER, tokenMatches } from "@hub/agent/send-token";
import { addClientEmail, forgetChat, humanActor, linkUserChatToRecord, moveChatToRecord, undoMoveChat, unlinkIdentifier, type HumanActor } from "@hub/messengers/human";
import { findClientPages } from "@hub/notion";
import { createChatClient, fillChatIdentity, findChatClientPages } from "@hub/notion/chat-client";
import { entryOf } from "../../clients/directory";
import { z, type ZodType } from "zod";
import { gateRefusal } from "../../http/admin-gate";
import { chatIdentityKit } from "./chat-identity";
import { markDialogs } from "./dialogs";
import type { ProjectAutolink } from "./setup";
import { notFound } from "../../http/http";
import type { MessengersContext } from "../context";

/** At most this many dialogs in the Link a chat box: the owner's newest chats, read on demand and never stored. */
const DIALOGS_LIMIT = 200;

/**
 * Verdict 30 (decision 0048): Unlink, Never link and Change client take the chat off the project's autopilot in the same owner
 * action, through the send policy's one writer; he switches it on again for the new client deliberately.
 */
function autopilotDrop(autopilot: MessengersContext["autopilot"], now: MessengersContext["now"]) {
  return (slug: string, row: { channel: "telegram_user" | "telegram_bot" | "whatsapp"; chatId: string }, why: string) => {
    if (!autopilot) return;
    autopilot.scheduler.cancel((x) => x.project === slug && x.channel === row.channel && x.chatId === row.chatId);
    try {
      const key = autopilotChatKey(row.channel, row.chatId);
      if (!autopilot.switches.project(slug).policy.chats.includes(key)) return;
      autopilot.switches.setProject(slug, { kind: "chat", chat: key, on: false }, "owner", (now ?? (() => new Date()))());
      ops("autopilot").info(`autopilot off for a chat: ${why}`, { project: slug, channel: row.channel });
    } catch (e) {
      ops("autopilot").warn("the chat could not be taken off the autopilot", { project: slug, channel: row.channel, ...errFields(e) });
    }
  };
}

/**
 * The autolink's doors (P84, decision 0036 point 3 as amended 2026-11-20). Every route is a POST behind the admin gate (the exact
 * admin Origin, a loopback Host, `Sec-Fetch-Site: same-origin`): the state names the owner's own contacts (in memory, never stored),
 * the records come from his Notion, and Link, Unlink and Never link change what the Hub reads. The preview is the dry run: counts
 * only, no name, number or text, and nothing written. Nothing here sends.
 */
export function autolinkRoutes({ repos, autolink: al, adminPort, agentToken, agentUnattended, autopilot, now }: MessengersContext) {
  async function guarded<T>(c: Context, schema: ZodType<T>, then: (body: T, slug: string, al: ProjectAutolink) => Promise<Response>): Promise<Response> {
    const why = gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, adminPort, { sameSite: true });
    if (why) return c.json({ error: `Refused: ${why}.`, code: "forbidden" as const }, 403);
    const slug = c.req.param("slug") ?? "";
    if ((await repos.projects.get(slug)) === null) return notFound(c, "project");
    const parsed = schema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: sentenceOf(parsed.error), code: "invalid" as const }, 400);
    if (!al) return c.json({ error: "The autolink is not set up on this server.", code: "not_found" as const }, 404);
    // A refusal (MessengersError, RepoError, AdapterError) is the server's onError's: its kind gives the status (P126 E1).
    return then(parsed.data, slug, al);
  }
  /**
   * P128 X5: the two doors of `hub mcp`'s chat sorting (a loopback call with the token of decision 0046's agent send, never the
   * admin's Origin). They read the unlinked chats' identities and keep proposals in memory; neither hides, links or sends.
   */
  async function agentGuarded<T>(c: Context, schema: ZodType<T>, then: (body: T, slug: string, al: ProjectAutolink) => Promise<Response>): Promise<Response> {
    if (!agentToken || !tokenMatches(c.req.header(AGENT_SEND_HEADER), agentToken)) return c.json({ error: "Refused: only the hub's own MCP server may ask this.", code: "forbidden" as const }, 403);
    const slug = c.req.param("slug") ?? "";
    if ((await repos.projects.get(slug)) === null) return notFound(c, "project");
    const parsed = schema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: sentenceOf(parsed.error), code: "invalid" as const }, 400);
    if (!al) return c.json({ error: "The autolink is not set up on this server.", code: "not_found" as const }, 404);
    if ((await al.autolink.state()).project !== slug) return c.json({ error: "The autolink serves another project.", code: "wrong_state" as const }, 409);
    return then(parsed.data, slug, al);
  }
  const idOf = (c: Context): number | null => {
    const v = c.req.param("id") ?? "";
    return /^[1-9]\d{0,9}$/.test(v) ? Number(v) : null;
  };
  const empty = z.unknown();

  const { identityFor, ownIdentity, fillLine, fillCard } = chatIdentityKit(repos);

  type UserChannel = "telegram_user" | "whatsapp";
  type Linked = { pageId: string; name: string; imported: number; importError: string | null; notion: string | null; how: "created" | "linked_existing" | "linked" };
  type Refused = { refused: string; code: "wrong_state" | "not_found" };

  /**
   * P100, P143 L2: the one Link of a chat to a client record, the owner's (the admin) and the agent's (attended): the link, the
   * hidden chat's refusal forgotten, the chat's number or username filled into the card's empty field, and the card read back.
   */
  async function linkToRecord(slug: string, a: ProjectAutolink, actor: HumanActor, b: { channel: UserChannel; account: string; chatId: string; key: string; title?: string | undefined }): Promise<Linked | Refused> {
    const rec = a.autolink.record(b.key);
    if (!rec) return { refused: "That client record is not in the directory now.", code: "wrong_state" };
    const adapter = a.autolink.adapterOf(b.channel, b.account);
    if (!adapter) return { refused: "That account is not connected (parked, stopped or unknown): see its state.", code: "wrong_state" };
    // P141 C1: a record links whether or not it has an Email; the Hub's client row is keyed by its card.
    const r = await linkUserChatToRecord({ repos, adapter }, actor, { project: slug, client: { pageId: rec.key, email: rec.email, name: rec.name }, chatId: b.chatId, ...(b.title ? { title: b.title } : {}), ...(await ownIdentity(a, slug, b.channel, b.chatId)) });
    // P102: a hidden chat linked by hand forgets its refusal in the same call.
    await a.autolink.forget(b.channel, b.chatId);
    // P100: the chat's username or number into the card's empty Telegram or WhatsApp, so the next chat links by itself. Never an overwrite.
    const notion = await fillCard(a, slug, rec.key, b.channel, b.chatId);
    // P143 N2: the card as it is now names the Hub's client (after a Hub write to it).
    void a.directory.readCard(rec.key, { force: true });
    return { pageId: rec.key, name: rec.name || rec.email || "the client", imported: r.imported, importError: r.importError, notion, how: "linked" };
  }

  /**
   * P100, P141 C3, P143 L2: Create from this chat, the owner's and the agent's: a card that already holds the email, or exactly this
   * chat's username or number, is linked instead; else one Clients card (Name, the Email when known, Relationship Lead, the chat's
   * username or number) is made, put into memory and the chat linked to it. A name that is only a number takes the channel's
   * placeholder ("WhatsApp +55…", P141 verdict 18), never the bare number. Insert content refused: nothing made, the fix said.
   */
  async function createFromChat(slug: string, a: ProjectAutolink, actor: HumanActor, b: { channel: UserChannel; account: string; chatId: string; title?: string | undefined; name: string; email?: string | null | undefined }): Promise<Linked | Refused> {
    if ((await a.autolink.state()).project !== slug) return { refused: "The autolink serves another project.", code: "wrong_state" };
    if (!a.directory.dataSourceId) return { refused: "This project has no Clients database in project.md.", code: "wrong_state" };
    const adapter = a.autolink.adapterOf(b.channel, b.account);
    if (!adapter) return { refused: "That account is not connected (parked, stopped or unknown): see its state.", code: "wrong_state" };
    if (await repos.messengers.isLinked(slug, b.channel, b.chatId)) return { refused: "That chat is already linked.", code: "wrong_state" };
    const identity = await identityFor(a, slug, b.channel, b.chatId);
    const own = await ownIdentity(a, slug, b.channel, b.chatId);
    const email = b.email ?? null;
    const name = isRealName(b.name, email) ? plainName(b.name) : chatClientTitle({ channel: identity.channel, username: identity.username, phone: identity.phone, chatId: b.chatId });
    const deps = await a.directory.notion();
    // A card with this email, or with exactly this chat's username or number, already: link to it, never a second one.
    const existing = (email ? await findClientPages(deps.reader, a.directory.dataSourceId, email) : await findChatClientPages(deps.reader, a.directory.dataSourceId, identity))[0];
    if (existing) {
      const entry = entryOf(existing as never);
      if (entry) a.directory.put(entry);
      const r = await linkUserChatToRecord({ repos, adapter }, actor, { project: slug, client: { pageId: existing.id, email: entry?.email ?? email, name: entry?.name || name }, chatId: b.chatId, ...(b.title ? { title: b.title } : {}), ...own });
      await a.autolink.forget(b.channel, b.chatId);
      const filled = fillLine(await fillChatIdentity(deps, { clientsDataSource: a.directory.dataSourceId, pageId: existing.id, identity }));
      const who = entry?.name || email || "this chat";
      return { pageId: existing.id, name: who, imported: r.imported, importError: r.importError, notion: `Linked to the existing card of ${who}${filled ? `; ${filled}` : ""}`, how: "linked_existing" };
    }
    const made = await createChatClient(deps, { clientsDataSource: a.directory.dataSourceId, name, email, identity });
    if (made.state !== "created") return { refused: made.note, code: "wrong_state" };
    const entry = entryOf(made.page as never);
    if (entry) a.directory.put(entry);
    const r = await linkUserChatToRecord({ repos, adapter }, actor, { project: slug, client: { pageId: made.pageId, email, name }, chatId: b.chatId, ...(b.title ? { title: b.title } : {}), ...own });
    await a.autolink.forget(b.channel, b.chatId);
    const field = identity.channel === "telegram" ? (identity.username ?? identity.phone) : identity.phone;
    return { pageId: made.pageId, name, imported: r.imported, importError: r.importError, notion: `Created ${name} in Notion${field ? ` with ${identity.channel === "telegram" ? "Telegram" : "WhatsApp"} ${field}` : ""}`, how: "created" };
  }
  const refusedOf = (c: Context, r: Refused) => c.json({ error: r.refused, code: r.code }, r.code === "not_found" ? 404 : 409);

  /** P143 L2: the agent's doors act only in an attended instance (decision 0046's rule for the agent send), on a known user chat. */
  async function agentChat(c: Context, slug: string, chat: number): Promise<{ row: NonNullable<Awaited<ReturnType<MessengersContext["repos"]["messengers"]["chatById"]>>>; channel: UserChannel; account: string } | Response> {
    if (!agentUnattended || agentUnattended()) return c.json({ error: "This instance runs unattended sessions: only the owner links or creates clients here.", code: "forbidden" as const }, 403);
    const row = await repos.messengers.chatById(slug, chat);
    if (!row) return notFound(c, "chat");
    if (row.channel === "telegram_bot") return c.json({ error: "A bot chat is not linked by the autolink.", code: "wrong_state" as const }, 409);
    if (!row.account) return c.json({ error: "The Hub does not know which account reads this chat yet: the owner links it in the admin.", code: "wrong_state" as const }, 409);
    return { row, channel: row.channel, account: row.account };
  }
  const agentActor = () => humanActor("agent (owner present)");

  async function unlink(c: Context, slug: string, al: ProjectAutolink, never: boolean) {
    const id = idOf(c);
    if (id === null) return c.json({ error: "Not a chat id.", code: "invalid" as const }, 400);
    const row = await repos.messengers.chatById(slug, id);
    if (!row) return notFound(c, "chat");
    if (row.channel === "telegram_bot") return c.json({ error: "A bot chat is not linked by the autolink.", code: "wrong_state" as const }, 409);
    const kind = row.channel === "whatsapp" ? "whatsapp" : "telegram";
    // Decision 0049: Unlink removes the identifier only (the chat stays known, its copy keeps the cache's TTL); Never link
    // remembers the chat's HMAC first and forgets the chat (its row, messages and drafts).
    if (never) {
      const client = await repos.messengers.clientByIdentifier(slug, kind, row.chatId);
      const name = client === null ? null : ((await repos.clients.get(slug, client))?.name ?? null);
      await al.autolink.refuse(row.channel, row.chatId, name || row.title);
    }
    await unlinkIdentifier(repos, humanActor("admin"), { project: slug, kind, value: row.chatId });
    autopilotDrop(autopilot, now)(slug, row, never ? "never link" : "unlinked");
    if (never) await forgetChat(repos, humanActor("admin"), { project: slug, channel: row.channel, chatId: row.chatId });
    return c.json(chatUnlinkedDto.parse({ ok: true, id, never }));
  }

  return new Hono()
    .post("/api/projects/:slug/messengers/autolink/state", (c) =>
      guarded(c, empty, async (_b, slug, al) => {
        const st = await al.autolink.state();
        if (st.project !== slug) return c.json(autolinkStateDto.parse({ enabled: false, directory: al.directory.status(), unlinkedActive: 0, recent: [], unlinked: [], freshDays: st.freshDays, hidden: [], hiddenUnnamed: 0, proposals: [] }));
        const hidden = st.hidden.map((h) => ({ channel: h.channel, account: h.account, chatId: h.chatId, title: h.title, hiddenAt: h.hiddenAt }));
        return c.json(autolinkStateDto.parse({ enabled: st.enabled, directory: al.directory.status(), unlinkedActive: st.unlinkedActive, recent: st.recent, unlinked: st.unlinked, freshDays: st.freshDays, hidden, hiddenUnnamed: st.hiddenUnnamed, proposals: st.proposals }));
      }),
    )
    .post("/api/projects/:slug/messengers/autolink/preview", (c) =>
      guarded(c, empty, async (_b, slug, al) => {
        const st = await al.autolink.state();
        const accounts = st.project === slug ? (await al.autolink.preview()).map(({ account: _a, ...rest }) => rest) : [];
        return c.json(autolinkPreviewDto.parse({ enabled: st.enabled, directory: al.directory.status(), accounts }));
      }),
    )
    // P100: the link box asks the copy in memory AND Notion live (read only), so a page made a minute ago is found.
    .post("/api/projects/:slug/messengers/autolink/records", (c) => guarded(c, autolinkRecordsBody, async (b, _slug, al) => c.json(autolinkRecordsDto.parse(await al.autolink.findRecords(b.q)))))
    .post("/api/projects/:slug/messengers/autolink/link", (c) =>
      guarded(c, autolinkLinkBody, async (b, slug, a) => {
        const r = await linkToRecord(slug, a, humanActor("admin"), b);
        if ("refused" in r) return refusedOf(c, r);
        return c.json(autolinkLinkedDto.parse({ ok: true, chatId: b.chatId, imported: r.imported, importError: r.importError, days: IMPORT_DAYS, notion: r.notion }));
      }),
    )
    // P100: nobody in Notion matches: the owner's Create (`createFromChat`, the same path as the agent's).
    .post("/api/projects/:slug/messengers/autolink/create", (c) =>
      guarded(c, autolinkCreateBody, async (b, slug, a) => {
        const r = await createFromChat(slug, a, humanActor("admin"), b);
        if ("refused" in r) return refusedOf(c, r);
        return c.json(autolinkLinkedDto.parse({ ok: true, chatId: b.chatId, imported: r.imported, importError: r.importError, days: IMPORT_DAYS, notion: r.notion }));
      }),
    )
    // P143 L2: the agent's Create from this chat and Link, attended only (`client_create`, `chat_link` of `hub mcp`).
    .post("/api/projects/:slug/messengers/autolink/agent-create", (c) =>
      agentGuarded(c, agentClientCreateBody, async (b, slug, a) => {
        const at = await agentChat(c, slug, b.chat);
        if (at instanceof Response) return at;
        // P141 C2: one lookup by the person's identities first: a client the Hub knows by this email or this number is linked to.
        const phone = at.channel === "whatsapp" && /^\+\d{7,15}$/.test(at.row.chatId) ? at.row.chatId : at.row.phone ? `+${at.row.phone.replace(/\D/g, "")}` : null;
        const known = (b.email ? await repos.clients.findByIdentity(slug, "email", b.email) : undefined) ?? (phone ? await repos.clients.findByIdentity(slug, "phone", phone) : undefined);
        const page = known === undefined ? null : ((await repos.clients.notionPageOf(slug, known)) ?? null);
        if (page) {
          await a.directory.readCard(page, { force: true });
          const r = await linkToRecord(slug, a, agentActor(), { channel: at.channel, account: at.account, chatId: at.row.chatId, key: page, ...(at.row.title ? { title: at.row.title } : {}) });
          if ("refused" in r) return refusedOf(c, r);
          return c.json(agentChatLinkedDto.parse({ ok: true, chat: b.chat, clientId: known ?? null, name: r.name, how: "linked_existing", notion: r.notion, imported: r.imported, importError: r.importError }));
        }
        const name = b.company && !b.name.toLowerCase().includes(b.company.toLowerCase()) ? `${b.name}, ${b.company}` : b.name;
        const r = await createFromChat(slug, a, agentActor(), { channel: at.channel, account: at.account, chatId: at.row.chatId, name, ...(at.row.title ? { title: at.row.title } : {}), ...(b.email ? { email: b.email } : {}) });
        if ("refused" in r) return refusedOf(c, r);
        const clientId = (await repos.clients.findByNotionPage(slug, r.pageId)) ?? null;
        return c.json(agentChatLinkedDto.parse({ ok: true, chat: b.chat, clientId, name: r.name, how: r.how, notion: r.notion, imported: r.imported, importError: r.importError }));
      }),
    )
    .post("/api/projects/:slug/messengers/autolink/agent-link", (c) =>
      agentGuarded(c, agentChatLinkBody, async (b, slug, a) => {
        const at = await agentChat(c, slug, b.chat);
        if (at instanceof Response) return at;
        if (await repos.messengers.isLinked(slug, at.channel, at.row.chatId)) return c.json({ error: "That chat is already linked.", code: "wrong_state" as const }, 409);
        const page = b.record ?? (b.client !== undefined ? await repos.clients.notionPageOf(slug, b.client) : null);
        if (!page) return c.json({ error: b.client !== undefined ? `Client ${b.client} has no Notion card the Hub knows.` : "Give client (a Hub client id) or record (a Notion page id).", code: "not_in_notion" as const }, 409);
        // The card is read now, so a page made a minute ago (or one the directory has not read) is found.
        if (!a.autolink.record(page)) await a.directory.readCard(page, { force: true });
        const r = await linkToRecord(slug, a, agentActor(), { channel: at.channel, account: at.account, chatId: at.row.chatId, key: page, ...(at.row.title ? { title: at.row.title } : {}) });
        if ("refused" in r) return refusedOf(c, r);
        const clientId = (await repos.clients.findByNotionPage(slug, page)) ?? null;
        return c.json(agentChatLinkedDto.parse({ ok: true, chat: b.chat, clientId, name: r.name, how: "linked", notion: r.notion, imported: r.imported, importError: r.importError }));
      }),
    )
    // P84c: Hide ("not a client") of an unlinked chat the Hub saw, and Unhide: the refusal's HMAC is written or deleted; Hide also
    // forgets the known chat (decision 0049: its row, its cached messages and drafts), so it leaves the list.
    .post("/api/projects/:slug/messengers/autolink/hide", (c) =>
      guarded(c, autolinkHideBody, async (b, slug, al) => {
        if ((await al.autolink.state()).project !== slug) return c.json({ error: "The autolink serves another project.", code: "wrong_state" as const }, 409);
        if (await repos.messengers.isLinked(slug, b.channel, b.chatId)) return c.json({ error: "That chat is linked: unlink it on its rules row first.", code: "wrong_state" as const }, 409);
        const row = await repos.messengers.chat(slug, b.channel, b.chatId);
        await al.autolink.refuse(b.channel, b.chatId, row?.title ?? null);
        await forgetChat(repos, humanActor("admin"), { project: slug, channel: b.channel, chatId: b.chatId });
        return c.json(autolinkHiddenDto.parse({ ok: true, channel: b.channel, chatId: b.chatId, hidden: true }));
      }),
    )
    // P128 X5: the agent reads the unlinked chats to sort them, and proposes hides; the owner's Keep drops proposals.
    .post("/api/projects/:slug/messengers/autolink/agent-unlinked", (c) =>
      agentGuarded(c, empty, async (_b, _slug, al) => {
        const st = await al.autolink.state();
        const proposed = new Set(st.proposals.map((p) => `${p.channel}:${p.chatId}`));
        const chats = st.unlinked.map((r) => ({ channel: r.channel, chatId: r.chatId, title: r.title, why: r.why, lastAt: r.last?.at ?? null, inbound: r.last?.inbound ?? null, proposed: proposed.has(`${r.channel}:${r.chatId}`) }));
        return c.json(agentUnlinkedDto.parse({ chats }));
      }),
    )
    .post("/api/projects/:slug/messengers/autolink/agent-proposals", (c) =>
      agentGuarded(c, autolinkProposeBody, async (b, _slug, al) => {
        const kept = al.autolink.proposeHide(b.items);
        return c.json(autolinkProposedDto.parse({ ok: true, kept, skipped: b.items.length - kept }));
      }),
    )
    .post("/api/projects/:slug/messengers/autolink/proposals/drop", (c) =>
      guarded(c, autolinkProposalsDropBody, async (b, slug, al) => {
        if ((await al.autolink.state()).project !== slug) return c.json({ error: "The autolink serves another project.", code: "wrong_state" as const }, 409);
        al.autolink.dropProposals(b.items);
        return c.json(autolinkProposalsDroppedDto.parse({ ok: true }));
      }),
    )
    .post("/api/projects/:slug/messengers/autolink/unhide", (c) =>
      guarded(c, autolinkHideBody, async (b, slug, al) => {
        if ((await al.autolink.state()).project !== slug) return c.json({ error: "The autolink serves another project.", code: "wrong_state" as const }, 409);
        await al.autolink.unrefuse(b.channel, b.chatId);
        return c.json(autolinkHiddenDto.parse({ ok: true, channel: b.channel, chatId: b.chatId, hidden: false }));
      }),
    )
    // P102: the dialogs of one account, marked against the picked client record, for "Link a chat…" (read on demand, never stored).
    .post("/api/projects/:slug/messengers/autolink/dialogs", (c) =>
      guarded(c, autolinkDialogsBody, async (b, slug, al) => {
        const rec = al.autolink.record(b.key);
        if (!rec) return c.json({ error: "That client record is not in the directory now.", code: "wrong_state" as const }, 409);
        const adapter = al.autolink.adapterOf(b.channel, b.account);
        if (!adapter) return c.json({ error: "That account is not connected (parked, stopped or unknown): see its state.", code: "wrong_state" as const }, 409);
        const allowed = new Set((await repos.messengers.knownChats(slug)).filter((r) => r.linked && r.channel === b.channel).map((r) => r.chatId));
        return c.json(userDialogsDto.parse({ dialogs: markDialogs(b.channel, rec, await adapter.dialogs(DIALOGS_LIMIT), allowed) }));
      }),
    )
    // P102 Change client: the chat's identifier moves to another client record, its stored messages stay, the old client's open draft is set aside.
    .post("/api/projects/:slug/messengers/chats/:id/client", (c) =>
      guarded(c, autolinkMoveBody, async (b, slug, al) => {
        const id = idOf(c);
        if (id === null) return c.json({ error: "Not a chat id.", code: "invalid" as const }, 400);
        const row = await repos.messengers.chatById(slug, id);
        if (!row) return notFound(c, "chat");
        if (row.channel === "telegram_bot") return c.json({ error: "A bot chat is not linked by the autolink.", code: "wrong_state" as const }, 409);
        const rec = al.autolink.record(b.key);
        if (!rec) return c.json({ error: "That client record is not in the directory now.", code: "wrong_state" as const }, 409);
        const r = await moveChatToRecord(repos, humanActor("admin"), { project: slug, channel: row.channel, chatId: row.chatId, client: { pageId: rec.key, email: rec.email, name: rec.name } });
        autopilotDrop(autopilot, now)(slug, row, "moved to another client");
        const from = await repos.clients.get(slug, r.fromClientId);
        const notion = await fillCard(al, slug, rec.key, row.channel, row.chatId);
        return c.json(chatMovedDto.parse({ ok: true, id, fromClientId: r.fromClientId, fromName: from?.name || from?.email || "the old client", toName: rec.name || rec.email || "the new client", skippedDraftId: r.skippedDraftId, notion }));
      }),
    )
    .post("/api/projects/:slug/messengers/chats/:id/client/undo", (c) =>
      guarded(c, chatMoveUndoBody, async (b, slug) => {
        const id = idOf(c);
        if (id === null) return c.json({ error: "Not a chat id.", code: "invalid" as const }, 400);
        const row = await repos.messengers.chatById(slug, id);
        if (!row) return notFound(c, "chat");
        if (row.channel === "telegram_bot") return c.json({ error: "A bot chat is not linked by the autolink.", code: "wrong_state" as const }, 409);
        const r = await undoMoveChat(repos, humanActor("admin"), { project: slug, channel: row.channel, chatId: row.chatId, clientId: b.clientId, draftId: b.draftId });
        return c.json(chatMoveUndoneDto.parse({ ok: true, id, draftRestored: r.draftRestored }));
      }),
    )
    // P141 C4: the client of a chat-only link gets its email; an address another client has merges the two (one Activity line).
    .post("/api/projects/:slug/messengers/chats/:id/email", (c) =>
      guarded(c, chatEmailBody, async (b, slug) => {
        const id = idOf(c);
        if (id === null) return c.json({ error: "Not a chat id.", code: "invalid" as const }, 400);
        const row = await repos.messengers.chatById(slug, id);
        if (!row) return notFound(c, "chat");
        const client = await repos.messengers.clientByIdentifier(slug, row.channel === "whatsapp" ? "whatsapp" : "telegram", row.chatId);
        if (client === null) return c.json({ error: "This chat is not linked to a client: link or create one first.", code: "wrong_state" as const }, 409);
        const r = await addClientEmail(repos, humanActor("admin"), { project: slug, clientId: client, email: b.email });
        return c.json(chatEmailDto.parse({ ok: true, id, clientId: r.clientId, merged: r.merged }));
      }),
    )
    .post("/api/projects/:slug/messengers/chats/:id/unlink", (c) => guarded(c, empty, (_b, slug, al) => unlink(c, slug, al, false)))
    .post("/api/projects/:slug/messengers/chats/:id/never", (c) => guarded(c, empty, (_b, slug, al) => unlink(c, slug, al, true)));
}
