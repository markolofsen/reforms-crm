import { Hono, type Context } from "hono";
import { sentenceOf } from "@hub/contract/errors";
import {
  userDialogsBody,
  userDialogsDto,
  userDisconnectedDto,
  userLinkBody,
  userLinkedDto,
  userLoginCancelBody,
  userLoginCodeBody,
  userLoginPasswordBody,
  userLoginStartBody,
  userLoginStepDto,
  type UserDialogDto,
} from "@hub/contract/messengers";
import { RepoError, type Repos } from "@hub/db";
import { AdapterError, MessengersError, normalizeIdentifier, type UserDialog } from "@hub/messengers";
import { humanActor, linkUserChat } from "@hub/messengers/human";
import { z, type ZodType } from "zod";
import { gateRefusal } from "../admin-gate";
import type { TelegramUserHandle } from "../telegram-user";

/** At most this many dialogs in the picker: the owner's newest chats, read on demand and never stored. */
export const DIALOGS_LIMIT = 200;

/**
 * The Telegram user account's doors (P71 M1, decision 0036 points 3, 4 and 7). Every route is a POST behind the admin gate (the
 * exact admin Origin, a loopback Host, `Sec-Fetch-Site: same-origin`, as the send ticket and the local Open): the login steps
 * carry the owner's api_hash, phone, code and password, the picker returns his contacts, and the link writes a client's
 * identifiers. No body or reply is logged; a reply never holds a session, a code or a password (the schemas have no field).
 * The link mints a `HumanActor` here, behind the gate (0036 point 7). Nothing here sends a message: M1 receives only.
 */
export function telegramUserRoutes(repos: Repos, tg: TelegramUserHandle | undefined, adminPort: number) {
  const gate = (c: Context) =>
    gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, adminPort, { sameSite: true });

  /** The gate, the service, then the strict body: one refusal shape for each. */
  async function guarded<T>(c: Context, schema: ZodType<T>, then: (body: T, tg: TelegramUserHandle) => Promise<Response>): Promise<Response> {
    const why = gate(c);
    if (why) return c.json({ error: `Refused: ${why}.`, code: "forbidden" as const }, 403);
    if (!tg) return c.json({ error: "Telegram user accounts are not set up on this server.", code: "not_found" as const }, 404);
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: sentenceOf(parsed.error), code: "invalid" as const }, 400);
    try {
      return await then(parsed.data, tg);
    } catch (e) {
      if (e instanceof MessengersError) return c.json({ error: e.message, code: "wrong_state" as const }, 409);
      if (e instanceof RepoError) return c.json({ error: e.message, code: e.code === "not_found" ? ("not_found" as const) : ("wrong_state" as const) }, e.code === "not_found" ? 404 : 409);
      if (e instanceof AdapterError) return c.json({ error: `Telegram: ${e.message}`, code: "server" as const }, 502);
      throw e;
    }
  }
  const noProject = (c: Context, tg: TelegramUserHandle) => {
    const p = tg.project();
    return p.project !== null ? null : c.json({ error: `Not connected: ${p.reason}.`, code: "wrong_state" as const }, 409);
  };
  /** The account's live adapter in the slug's project, or the refusal. */
  const live = (c: Context, tg: TelegramUserHandle, slug: string, account: string) => {
    const p = tg.project();
    if (p.project !== slug) return { refused: c.json({ error: `Telegram user accounts store into project "${p.project ?? "none"}", not "${slug}".`, code: "wrong_state" as const }, 409) };
    const adapter = tg.adapter(account);
    if (!adapter) return { refused: c.json({ error: "This Telegram account is not connected (parked, stopped or unknown): see its state.", code: "wrong_state" as const }, 409) };
    return { adapter };
  };

  return new Hono()
    .get("/api/messengers/telegram-user", (c) => c.json(tg ? tg.status() : { state: "off", reason: "not set up", accounts: [] }))
    .post("/api/messengers/telegram-user/login/start", (c) =>
      guarded(c, userLoginStartBody, async (b, tg) => noProject(c, tg) ?? c.json(userLoginStepDto.parse(await tg.login.start(b)))),
    )
    .post("/api/messengers/telegram-user/login/code", (c) => guarded(c, userLoginCodeBody, async (b, tg) => c.json(userLoginStepDto.parse(await tg.login.code(b.flow, b.code)))))
    .post("/api/messengers/telegram-user/login/password", (c) =>
      guarded(c, userLoginPasswordBody, async (b, tg) => c.json(userLoginStepDto.parse(await tg.login.password(b.flow, b.password)))),
    )
    .post("/api/messengers/telegram-user/login/cancel", (c) =>
      guarded(c, userLoginCancelBody, async (b, tg) => {
        await tg.login.cancel(b.flow);
        return c.json({ ok: true as const });
      }),
    )
    .post("/api/messengers/telegram-user/:account/disconnect", (c) =>
      guarded(c, emptyBody, async (_b, tg) => {
        const account = c.req.param("account");
        if (!/^\d{1,20}$/.test(account)) return c.json({ error: "Not an account id.", code: "invalid" as const }, 400);
        return c.json(userDisconnectedDto.parse({ ok: true, account, removed: await tg.disconnect(account) }));
      }),
    )
    .post("/api/projects/:slug/messengers/telegram-user/:account/dialogs", (c) =>
      guarded(c, userDialogsBody, async (b, tg) => {
        const slug = c.req.param("slug");
        const l = live(c, tg, slug, c.req.param("account"));
        if (l.refused) return l.refused;
        await repos.messengers.identifiersOf(slug, b.clientId); // 404 for a client of another project
        const dialogs = await l.adapter.dialogs(DIALOGS_LIMIT);
        return c.json(userDialogsDto.parse({ dialogs: await marked(repos, slug, b.clientId, dialogs) }));
      }),
    )
    .post("/api/projects/:slug/messengers/telegram-user/:account/link", (c) =>
      guarded(c, userLinkBody, async (b, tg) => {
        const slug = c.req.param("slug");
        const l = live(c, tg, slug, c.req.param("account"));
        if (l.refused) return l.refused;
        const r = await linkUserChat({ repos, adapter: l.adapter }, humanActor("admin"), { project: slug, clientId: b.clientId, chatId: b.chatId, ...(b.title ? { title: b.title } : {}) });
        return c.json(userLinkedDto.parse({ ok: true, chatId: b.chatId, imported: r.imported, importError: r.importError }));
      }),
    );
}

/** Disconnect takes no fields: an empty object or no body at all. */
const emptyBody = z.strictObject({}).optional();

/** The picker's marks: `linked` when the chat is on this project's allow-list, `suggested` when its id or phone is one of this client's identifiers. */
async function marked(repos: Repos, project: string, clientId: number, dialogs: UserDialog[]): Promise<UserDialogDto[]> {
  const mine = await repos.messengers.identifiersOf(project, clientId);
  const allowed = new Set((await repos.messengers.allowedChats(project)).filter((c) => c.channel === "telegram_user").map((c) => c.chatId));
  const values = new Set(mine.map((i) => `${i.kind}:${i.value}`));
  const phoneOf = (p: string | null) => {
    if (!p) return null;
    try {
      return normalizeIdentifier("phone", p);
    } catch {
      return null;
    }
  };
  return dialogs.map((d) => {
    const phone = phoneOf(d.phone);
    const suggested = values.has(`telegram:${d.chatId}`) || (phone !== null && (values.has(`phone:${phone}`) || values.has(`whatsapp:${phone}`)));
    return { chatId: d.chatId, title: d.title, username: d.username, phone: d.phone, suggested, linked: allowed.has(d.chatId) };
  });
}
