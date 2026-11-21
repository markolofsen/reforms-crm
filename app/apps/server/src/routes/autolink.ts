import { Hono, type Context } from "hono";
import { sentenceOf } from "@hub/contract/errors";
import { autolinkCreateBody, autolinkDialogsBody, autolinkHiddenDto, autolinkHideBody, autolinkLinkBody, autolinkLinkedDto, autolinkMoveBody, autolinkPreviewDto, autolinkRecordsBody, autolinkRecordsDto, autolinkStateDto, chatMovedDto, chatMoveUndoBody, chatMoveUndoneDto, chatUnlinkedDto, userDialogsDto } from "@hub/contract/messengers";
import { RepoError, type Repos } from "@hub/db";
import { IMPORT_DAYS } from "@hub/config/chat-rules";
import { AdapterError, MessengersError } from "@hub/messengers";
import { humanActor, linkUserChatToRecord, moveChatToRecord, undoMoveChat, unlinkIdentifier } from "@hub/messengers/human";
import { findClientPages } from "@hub/notion";
import { createChatClient, fillChatIdentity, type ChatIdentity, type FillOutcome } from "@hub/notion/chat-client";
import { ops } from "@hub/log/ops";
import { entryOf } from "../client-directory";
import { z, type ZodType } from "zod";
import { gateRefusal } from "../admin-gate";
import { markDialogs } from "../autolink-dialogs";
import type { ProjectAutolink } from "../autolink-setup";
import { notFound } from "../http";

/** At most this many dialogs in the Link a chat box: the owner's newest chats, read on demand and never stored. */
const DIALOGS_LIMIT = 200;

/**
 * The autolink's doors (P84, decision 0036 point 3 as amended 2026-11-20). Every route is a POST behind the admin gate (the exact
 * admin Origin, a loopback Host, `Sec-Fetch-Site: same-origin`): the state names the owner's own contacts (in memory, never stored),
 * the records come from his Notion, and Link, Unlink and Never link change what the Hub reads. The preview is the dry run: counts
 * only, no name, number or text, and nothing written. Nothing here sends.
 */
export function autolinkRoutes(repos: Repos, al: ProjectAutolink | undefined, adminPort: number) {
  async function guarded<T>(c: Context, schema: ZodType<T>, then: (body: T, slug: string, al: ProjectAutolink) => Promise<Response>): Promise<Response> {
    const why = gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, adminPort, { sameSite: true });
    if (why) return c.json({ error: `Refused: ${why}.`, code: "forbidden" as const }, 403);
    const slug = c.req.param("slug") ?? "";
    if ((await repos.projects.get(slug)) === null) return notFound(c, "project");
    const parsed = schema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: sentenceOf(parsed.error), code: "invalid" as const }, 400);
    if (!al) return c.json({ error: "The autolink is not set up on this server.", code: "not_found" as const }, 404);
    try {
      return await then(parsed.data, slug, al);
    } catch (e) {
      if (e instanceof MessengersError) return c.json({ error: e.message, code: "wrong_state" as const }, 409);
      if (e instanceof RepoError) return c.json({ error: e.message, code: e.code === "not_found" ? ("not_found" as const) : ("wrong_state" as const) }, e.code === "not_found" ? 404 : 409);
      if (e instanceof AdapterError) return c.json({ error: e.message, code: "server" as const }, 502);
      throw e;
    }
  }
  const idOf = (c: Context): number | null => {
    const v = c.req.param("id") ?? "";
    return /^[1-9]\d{0,9}$/.test(v) ? Number(v) : null;
  };
  const empty = z.unknown();

  /** P100: the chat's identity for Notion: its username, and its phone in +E.164 (Telegram hands digits without the `+`). */
  const identityFor = (al: ProjectAutolink, channel: "telegram_user" | "whatsapp", chatId: string): ChatIdentity => {
    const id = al.autolink.identityOf(channel, chatId);
    const digits = (id?.phone ?? "").replace(/\D/g, "");
    return { channel: channel === "whatsapp" ? "whatsapp" : "telegram", username: id?.username ?? null, phone: digits.length >= 7 ? `+${digits}` : null };
  };
  const fillLine = (f: FillOutcome): string | null => (f.state === "written" ? `${f.property} set to ${f.value} in Notion` : f.state === "refused" ? f.note : f.reason.startsWith("nothing") ? null : `${f.reason} in Notion, kept`);

  /** P100: writes the chat's username or number into the card's empty Telegram or WhatsApp field; a failure leaves the link standing and is said in one line. */
  async function fillCard(al: ProjectAutolink, pageId: string, channel: "telegram_user" | "whatsapp", chatId: string): Promise<string | null> {
    if (!al.directory.dataSourceId) return null;
    try {
      return fillLine(await fillChatIdentity(await al.directory.notion(), { clientsDataSource: al.directory.dataSourceId, pageId, identity: identityFor(al, channel, chatId) }));
    } catch (e) {
      ops("notion").warn("filling the chat's field on the client failed", { error: e instanceof Error ? e.name : "error" });
      return "The Hub could not fill the chat's field in Notion (see the ops log); the link stands";
    }
  }

  async function unlink(c: Context, slug: string, al: ProjectAutolink, never: boolean) {
    const id = idOf(c);
    if (id === null) return c.json({ error: "Not a chat id.", code: "invalid" as const }, 400);
    const row = await repos.messengers.chatById(slug, id);
    if (!row) return notFound(c, "chat");
    if (row.channel === "telegram_bot") return c.json({ error: "A bot chat is not linked by the autolink.", code: "wrong_state" as const }, 409);
    const kind = row.channel === "whatsapp" ? "whatsapp" : "telegram";
    // The identifier, the chat, its messages and its drafts go (P71 M2b); Never link remembers the chat's HMAC first.
    if (never) {
      const client = await repos.messengers.clientByIdentifier(slug, kind, row.chatId);
      const name = client === null ? null : ((await repos.clients.get(slug, client))?.name ?? null);
      await al.autolink.refuse(row.channel, row.chatId, name || row.title);
    }
    await unlinkIdentifier(repos, humanActor("admin"), { project: slug, kind, value: row.chatId });
    await repos.messengers.disallowChat(slug, row.channel, row.chatId);
    return c.json(chatUnlinkedDto.parse({ ok: true, id, never }));
  }

  return new Hono()
    .post("/api/projects/:slug/messengers/autolink/state", (c) =>
      guarded(c, empty, async (_b, slug, al) => {
        const st = await al.autolink.state();
        if (st.project !== slug) return c.json(autolinkStateDto.parse({ enabled: false, directory: al.directory.status(), unlinkedActive: 0, recent: [], unlinked: [], freshDays: st.freshDays, hidden: [], hiddenUnnamed: 0 }));
        const hidden = st.hidden.map((h) => ({ channel: h.channel, account: h.account, chatId: h.chatId, title: h.title, hiddenAt: h.hiddenAt }));
        return c.json(autolinkStateDto.parse({ enabled: st.enabled, directory: al.directory.status(), unlinkedActive: st.unlinkedActive, recent: st.recent, unlinked: st.unlinked, freshDays: st.freshDays, hidden, hiddenUnnamed: st.hiddenUnnamed }));
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
      guarded(c, autolinkLinkBody, async (b, slug, al) => {
        const rec = al.autolink.record(b.key);
        if (!rec?.email) return c.json({ error: "That client record is not in the directory now, or it has no email.", code: "wrong_state" as const }, 409);
        const adapter = al.autolink.adapterOf(b.channel, b.account);
        if (!adapter) return c.json({ error: "That account is not connected (parked, stopped or unknown): see its state.", code: "wrong_state" as const }, 409);
        const r = await linkUserChatToRecord({ repos, adapter }, humanActor("admin"), { project: slug, client: { email: rec.email, name: rec.name }, chatId: b.chatId, ...(b.title ? { title: b.title } : {}) });
        // P102: a hidden chat linked by hand forgets its refusal in the same call.
        await al.autolink.forget(b.channel, b.chatId);
        // P100: the chat's username or number into the card's empty Telegram or WhatsApp, so the next chat links by itself. Never an overwrite.
        const notion = await fillCard(al, rec.key, b.channel, b.chatId);
        return c.json(autolinkLinkedDto.parse({ ok: true, chatId: b.chatId, imported: r.imported, importError: r.importError, days: IMPORT_DAYS, notion }));
      }),
    )
    // P100: nobody in Notion matches: the owner's Create makes one Clients card (Name, Email, Relationship Lead, the chat's username
    // or number), puts it into memory and links the chat to it. Insert content refused: nothing made, the fix said.
    .post("/api/projects/:slug/messengers/autolink/create", (c) =>
      guarded(c, autolinkCreateBody, async (b, slug, al) => {
        if ((await al.autolink.state()).project !== slug) return c.json({ error: "The autolink serves another project.", code: "wrong_state" as const }, 409);
        if (!al.directory.dataSourceId) return c.json({ error: "This project has no Clients database in project.md.", code: "wrong_state" as const }, 409);
        const adapter = al.autolink.adapterOf(b.channel, b.account);
        if (!adapter) return c.json({ error: "That account is not connected (parked, stopped or unknown): see its state.", code: "wrong_state" as const }, 409);
        if (await repos.messengers.isAllowed(slug, b.channel, b.chatId)) return c.json({ error: "That chat is already linked.", code: "wrong_state" as const }, 409);
        const identity = identityFor(al, b.channel, b.chatId);
        const deps = await al.directory.notion();
        // A card with this email already (made since the last read, or not found by the name typed): link to it, never a second one.
        const existing = (await findClientPages(deps.reader, al.directory.dataSourceId, b.email))[0];
        if (existing) {
          const entry = entryOf(existing as never);
          if (entry) al.directory.put(entry);
          const r = await linkUserChatToRecord({ repos, adapter }, humanActor("admin"), { project: slug, client: { email: b.email, name: entry?.name || b.name }, chatId: b.chatId, ...(b.title ? { title: b.title } : {}) });
          await al.autolink.forget(b.channel, b.chatId);
          const filled = fillLine(await fillChatIdentity(deps, { clientsDataSource: al.directory.dataSourceId, pageId: existing.id, identity }));
          return c.json(autolinkLinkedDto.parse({ ok: true, chatId: b.chatId, imported: r.imported, importError: r.importError, days: IMPORT_DAYS, notion: `Linked to the existing card of ${b.email}${filled ? `; ${filled}` : ""}` }));
        }
        const made = await createChatClient(deps, { clientsDataSource: al.directory.dataSourceId, name: b.name, email: b.email, identity });
        if (made.state !== "created") return c.json({ error: made.note, code: "wrong_state" as const }, 409);
        const entry = entryOf(made.page as never);
        if (entry) al.directory.put(entry);
        const r = await linkUserChatToRecord({ repos, adapter }, humanActor("admin"), { project: slug, client: { email: b.email, name: b.name }, chatId: b.chatId, ...(b.title ? { title: b.title } : {}) });
        await al.autolink.forget(b.channel, b.chatId);
        const field = identity.channel === "telegram" ? (identity.username ?? identity.phone) : identity.phone;
        return c.json(autolinkLinkedDto.parse({ ok: true, chatId: b.chatId, imported: r.imported, importError: r.importError, days: IMPORT_DAYS, notion: `Created ${b.name} in Notion${field ? ` with ${identity.channel === "telegram" ? "Telegram" : "WhatsApp"} ${field}` : ""}` }));
      }),
    )
    // P84c: Hide ("not a client") of an unlinked chat the Hub saw, and Unhide: the refusal's HMAC is written or deleted; nothing else.
    .post("/api/projects/:slug/messengers/autolink/hide", (c) =>
      guarded(c, autolinkHideBody, async (b, slug, al) => {
        if ((await al.autolink.state()).project !== slug) return c.json({ error: "The autolink serves another project.", code: "wrong_state" as const }, 409);
        if (await repos.messengers.isAllowed(slug, b.channel, b.chatId)) return c.json({ error: "That chat is linked: unlink it on its rules row first.", code: "wrong_state" as const }, 409);
        await al.autolink.refuse(b.channel, b.chatId);
        return c.json(autolinkHiddenDto.parse({ ok: true, channel: b.channel, chatId: b.chatId, hidden: true }));
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
        const allowed = new Set((await repos.messengers.allowedChats(slug)).filter((r) => r.channel === b.channel).map((r) => r.chatId));
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
        if (!rec?.email) return c.json({ error: "That client record is not in the directory now, or it has no email.", code: "wrong_state" as const }, 409);
        const r = await moveChatToRecord(repos, humanActor("admin"), { project: slug, channel: row.channel, chatId: row.chatId, client: { email: rec.email, name: rec.name } });
        const from = await repos.clients.get(slug, r.fromClientId);
        const notion = await fillCard(al, rec.key, row.channel, row.chatId);
        return c.json(chatMovedDto.parse({ ok: true, id, fromClientId: r.fromClientId, fromName: from?.name || from?.email || "the old client", toName: rec.name || rec.email, skippedDraftId: r.skippedDraftId, notion }));
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
    .post("/api/projects/:slug/messengers/chats/:id/unlink", (c) => guarded(c, empty, (_b, slug, al) => unlink(c, slug, al, false)))
    .post("/api/projects/:slug/messengers/chats/:id/never", (c) => guarded(c, empty, (_b, slug, al) => unlink(c, slug, al, true)));
}
