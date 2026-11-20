import { Hono, type Context } from "hono";
import { sentenceOf } from "@hub/contract/errors";
import { userDialogsBody, userDialogsDto, userDisconnectedDto, userLinkedDto, waConnectFlowBody, waConnectStartedDto, waConnectStepDto, waLinkBody, type UserDialogDto } from "@hub/contract/messengers";
import { RepoError, type Repos } from "@hub/db";
import { AdapterError, MessengersError, type UserDialog } from "@hub/messengers";
import { humanActor, linkUserChat } from "@hub/messengers/human";
import { z, type ZodType } from "zod";
import { gateRefusal } from "../admin-gate";
import type { WhatsAppHandle } from "../whatsapp";
import { DIALOGS_LIMIT } from "./telegram-user";

/**
 * The WhatsApp linked device's doors (P71 M5, decision 0036 points 3, 4 and 7). Every route but the state read is a POST behind
 * the admin gate (the exact admin Origin, a loopback Host, `Sec-Fetch-Site: same-origin`), as the Telegram account's: Connect
 * starts a pairing only on the owner's click, its state carries the QR code (as module rows, never the string), the picker
 * returns his chats, and the link writes a client's identifiers. No body or reply is logged. Nothing here sends a message: the
 * send is the send door's (`routes/sends.ts`).
 */
export function whatsappRoutes(repos: Repos, wa: WhatsAppHandle | undefined, adminPort: number) {
  const gate = (c: Context) =>
    gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, adminPort, { sameSite: true });

  async function guarded<T>(c: Context, schema: ZodType<T>, then: (body: T, wa: WhatsAppHandle) => Promise<Response>): Promise<Response> {
    const why = gate(c);
    if (why) return c.json({ error: `Refused: ${why}.`, code: "forbidden" as const }, 403);
    if (!wa) return c.json({ error: "WhatsApp is not set up on this server.", code: "not_found" as const }, 404);
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: sentenceOf(parsed.error), code: "invalid" as const }, 400);
    try {
      return await then(parsed.data, wa);
    } catch (e) {
      if (e instanceof MessengersError) return c.json({ error: e.message, code: "wrong_state" as const }, 409);
      if (e instanceof RepoError) return c.json({ error: e.message, code: e.code === "not_found" ? ("not_found" as const) : ("wrong_state" as const) }, e.code === "not_found" ? 404 : 409);
      if (e instanceof AdapterError) return c.json({ error: `WhatsApp: ${e.message}`, code: "server" as const }, 502);
      throw e;
    }
  }
  const noProject = (c: Context, wa: WhatsAppHandle) => {
    const p = wa.project();
    return p.project !== null ? null : c.json({ error: `Not connected: ${p.reason}.`, code: "wrong_state" as const }, 409);
  };
  const live = (c: Context, wa: WhatsAppHandle, slug: string, account: string) => {
    const p = wa.project();
    if (p.project !== slug) return { refused: c.json({ error: `WhatsApp stores into project "${p.project ?? "none"}", not "${slug}".`, code: "wrong_state" as const }, 409) };
    const adapter = wa.adapter(account);
    if (!adapter) return { refused: c.json({ error: "This WhatsApp number is not connected (parked, stopped or unknown): see its state.", code: "wrong_state" as const }, 409) };
    return { adapter };
  };

  return new Hono()
    .get("/api/messengers/whatsapp", (c) => c.json(wa ? wa.status() : { state: "off", reason: "not set up", accounts: [] }))
    .post("/api/messengers/whatsapp/connect", (c) => guarded(c, emptyBody, async (_b, wa) => noProject(c, wa) ?? c.json(waConnectStartedDto.parse(await wa.pairing.start()))))
    .post("/api/messengers/whatsapp/connect/state", (c) => guarded(c, waConnectFlowBody, async (b, wa) => c.json(waConnectStepDto.parse(await wa.pairing.state(b.flow)))))
    .post("/api/messengers/whatsapp/connect/cancel", (c) =>
      guarded(c, waConnectFlowBody, async (b, wa) => {
        await wa.pairing.cancel(b.flow);
        return c.json({ ok: true as const });
      }),
    )
    .post("/api/messengers/whatsapp/:account/disconnect", (c) =>
      guarded(c, emptyBody, async (_b, wa) => {
        const account = c.req.param("account");
        if (!/^\d{1,20}$/.test(account)) return c.json({ error: "Not an account number.", code: "invalid" as const }, 400);
        return c.json(userDisconnectedDto.parse({ ok: true, account, removed: await wa.disconnect(account) }));
      }),
    )
    .post("/api/projects/:slug/messengers/whatsapp/:account/dialogs", (c) =>
      guarded(c, userDialogsBody, async (b, wa) => {
        const slug = c.req.param("slug");
        const l = live(c, wa, slug, c.req.param("account"));
        if (l.refused) return l.refused;
        await repos.messengers.identifiersOf(slug, b.clientId); // 404 for a client of another project
        const dialogs = await l.adapter.dialogs(DIALOGS_LIMIT);
        return c.json(userDialogsDto.parse({ dialogs: await marked(repos, slug, b.clientId, dialogs) }));
      }),
    )
    .post("/api/projects/:slug/messengers/whatsapp/:account/link", (c) =>
      guarded(c, waLinkBody, async (b, wa) => {
        const slug = c.req.param("slug");
        const l = live(c, wa, slug, c.req.param("account"));
        if (l.refused) return l.refused;
        const r = await linkUserChat({ repos, adapter: l.adapter }, humanActor("admin"), { project: slug, clientId: b.clientId, chatId: b.chatId, ...(b.title ? { title: b.title } : {}) });
        return c.json(userLinkedDto.parse({ ok: true, chatId: b.chatId, imported: r.imported, importError: r.importError }));
      }),
    );
}

const emptyBody = z.strictObject({}).optional();

/** The picker's marks: `linked` when the chat is on this project's allow-list, `suggested` when its number is one of this client's identifiers. */
async function marked(repos: Repos, project: string, clientId: number, dialogs: UserDialog[]): Promise<UserDialogDto[]> {
  const mine = await repos.messengers.identifiersOf(project, clientId);
  const allowed = new Set((await repos.messengers.allowedChats(project)).filter((c) => c.channel === "whatsapp").map((c) => c.chatId));
  const values = new Set(mine.map((i) => `${i.kind}:${i.value}`));
  return dialogs.map((d) => ({
    chatId: d.chatId,
    title: d.title,
    username: null,
    phone: d.phone,
    suggested: values.has(`whatsapp:${d.chatId}`) || values.has(`phone:${d.chatId}`),
    linked: allowed.has(d.chatId),
  }));
}
