import { Hono, type Context } from "hono";
import { sentenceOf } from "@hub/contract/errors";
import { userDisconnectedDto, waConnectFlowBody, waConnectStartedDto, waConnectStepDto } from "@hub/contract/messengers";
import { RepoError } from "@hub/db";
import { AdapterError, MessengersError } from "@hub/messengers";
import { z, type ZodType } from "zod";
import { gateRefusal } from "../admin-gate";
import type { WhatsAppHandle } from "../whatsapp";

/**
 * The WhatsApp linked device's doors (P71 M5, decision 0036 points 3, 4 and 7). Every route but the state read is a POST behind
 * the admin gate (the exact admin Origin, a loopback Host, `Sec-Fetch-Site: same-origin`), as the Telegram account's: Connect
 * starts a pairing only on the owner's click and its state carries the QR code (as module rows, never the string). Linking a
 * chat is the autolink's (`routes/autolink.ts`, P102). No body or reply is logged. Nothing here sends a message: the
 * send is the send door's (`routes/sends.ts`).
 */
export function whatsappRoutes(wa: WhatsAppHandle | undefined, adminPort: number) {
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
    );
}

const emptyBody = z.strictObject({}).optional();
