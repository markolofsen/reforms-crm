import { Hono, type Context } from "hono";
import { sentenceOf } from "@hub/contract/errors";
import { autolinkHiddenDto, autolinkHideBody, autolinkLinkBody, autolinkPreviewDto, autolinkRecordsBody, autolinkRecordsDto, autolinkStateDto, chatUnlinkedDto, userLinkedDto } from "@hub/contract/messengers";
import { RepoError, type Repos } from "@hub/db";
import { AdapterError, MessengersError } from "@hub/messengers";
import { humanActor, linkUserChatToRecord, unlinkIdentifier } from "@hub/messengers/human";
import { z, type ZodType } from "zod";
import { gateRefusal } from "../admin-gate";
import type { ProjectAutolink } from "../autolink-setup";
import { notFound } from "../http";

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
        if (st.project !== slug) return c.json(autolinkStateDto.parse({ enabled: false, directory: al.directory.status(), unlinkedActive: 0, recent: [], freshDays: st.freshDays, hidden: [], hiddenUnnamed: 0 }));
        const hidden = st.hidden.map((h) => ({ channel: h.channel, chatId: h.chatId, title: h.title, hiddenAt: h.hiddenAt }));
        return c.json(autolinkStateDto.parse({ enabled: st.enabled, directory: al.directory.status(), unlinkedActive: st.unlinkedActive, recent: st.recent, freshDays: st.freshDays, hidden, hiddenUnnamed: st.hiddenUnnamed }));
      }),
    )
    .post("/api/projects/:slug/messengers/autolink/preview", (c) =>
      guarded(c, empty, async (_b, slug, al) => {
        const st = await al.autolink.state();
        const accounts = st.project === slug ? (await al.autolink.preview()).map(({ account: _a, ...rest }) => rest) : [];
        return c.json(autolinkPreviewDto.parse({ enabled: st.enabled, directory: al.directory.status(), accounts }));
      }),
    )
    .post("/api/projects/:slug/messengers/autolink/records", (c) => guarded(c, autolinkRecordsBody, async (b, _slug, al) => c.json(autolinkRecordsDto.parse({ records: al.autolink.findRecords(b.q) })))
    )
    .post("/api/projects/:slug/messengers/autolink/link", (c) =>
      guarded(c, autolinkLinkBody, async (b, slug, al) => {
        const rec = al.autolink.record(b.key);
        if (!rec?.email) return c.json({ error: "That client record is not in the directory now, or it has no email.", code: "wrong_state" as const }, 409);
        const adapter = al.autolink.adapterOf(b.channel, b.account);
        if (!adapter) return c.json({ error: "That account is not connected (parked, stopped or unknown): see its state.", code: "wrong_state" as const }, 409);
        const r = await linkUserChatToRecord({ repos, adapter }, humanActor("admin"), { project: slug, client: { email: rec.email, name: rec.name }, chatId: b.chatId, ...(b.title ? { title: b.title } : {}) });
        return c.json(userLinkedDto.parse({ ok: true, chatId: b.chatId, imported: r.imported, importError: r.importError }));
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
    .post("/api/projects/:slug/messengers/chats/:id/unlink", (c) => guarded(c, empty, (_b, slug, al) => unlink(c, slug, al, false)))
    .post("/api/projects/:slug/messengers/chats/:id/never", (c) => guarded(c, empty, (_b, slug, al) => unlink(c, slug, al, true)));
}
