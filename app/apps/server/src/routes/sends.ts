import { Hono, type Context } from "hono";
import type { Repos } from "@hub/db";
import { assess, sendDraft, type Mailer } from "@hub/send";
import { idParam, projectQuery, sendBody, sendParam, sendTicketBody, slugParam } from "@hub/contract/requests";
import { sendCancelledDto, sendPreviewDto, sendsDto, sendTicketDto, sentDto, stopDto } from "@hub/contract/responses";
import { messengerSendBody, messengerSendPreviewDto } from "@hub/contract/messenger-panel";
import type { DraftWriter } from "@hub/agent/mail-drafts";
import { gateRefusal, ticketStore, type TicketStore } from "../admin-gate";
import { notFound, v } from "../http";
import { applyMessenger, assessMessenger, type MessengerSenders } from "../send/messenger-door";

/** What the send routes need from the process: the Mailer, where project.md lives, and `allow_list` for `draft.recipients: test`. */
export interface SenderOptions {
  mailer: Mailer;
  projectsDir: string;
  /** `hubPaths().stateProjects`: the send policy files (P49 S11). */
  policyDir: string;
  allowList: string[];
  /** The admin's port: a send ticket is minted only for its exact origin (P49 S12). */
  adminPort: number;
  /** Tests: the ticket store (its clock). */
  tickets?: TicketStore;
  now?: () => Date;
  /** The hub's Mail draft writer (P56: a person's Save and Restore go through the agent's one writer); absent, both refuse. */
  writer?: DraftWriter;
  /** Bumps the live topic `mail` of a project after the server wrote one of its Mail drafts, so every open tab reads it again. */
  mailWritten?: (project: string) => void;
}

/** A ticket lives 60 s: the person has read the mail and pressed Send; the apply follows at once. */
const TICKET_TTL_MS = 60_000;

const refusal = (refused: string[]) => ({ error: refused.length === 1 ? `Not sent: ${refused[0]}` : `Not sent: ${refused.length} reasons`, code: "wrong_state" as const, refused });

/**
 * Sending, the one place the admin can do it (decision 0011, stage 1). A person decides each send: the first call is a
 * dry run that reads Mail and returns the exact mail; the second carries what the person saw (recipients and subject)
 * and sends only if Mail's draft still matches. Every send goes through `@hub/send`, the same checks as `hub send`,
 * and writes its audit row first. Cancel and Stop all only ever remove work: nothing here queues a send.
 * A messenger draft goes through the same door (P71 M4, `../send/messenger-door.ts`): the same dry run, ticket and audit row, its
 * own guards, and `messengers` holds the only send of each connected account.
 */
export function sendRoutes(repos: Repos, sender?: SenderOptions, messengers?: MessengerSenders) {
  const deps = sender && { repos, mailer: sender.mailer, projectsDir: sender.projectsDir, policyDir: sender.policyDir, allowList: sender.allowList, ...(sender.now ? { now: sender.now } : {}) };
  const tickets = sender?.tickets ?? ticketStore({ ttlMs: TICKET_TTL_MS });
  const forbidden = (c: Context, why: string) => c.json({ error: `Not sent: ${why}.`, code: "forbidden" as const }, 403);
  /** `*` is every project. */
  const scope = (slug: string) => (slug === "*" ? undefined : slug);

  return new Hono()
    // P49 S12: the admin page fetches one ticket per apply. Only the admin's exact origin, from a same-origin fetch, gets one.
    .post("/api/sends/tickets", v("json", sendTicketBody), async (c) => {
      if (!sender) return c.json({ error: "Sending is not set up on this server.", code: "wrong_state" as const }, 409);
      const why = gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, sender.adminPort, { sameSite: true });
      if (why) return forbidden(c, why);
      const { project, draftId, kind } = c.req.valid("json");
      if (kind === "messenger") {
        if (!(await repos.messengers.getDraft(project, draftId))) return notFound(c, "draft");
        return c.json(sendTicketDto.parse(tickets.mint(`msend:${draftId}`)));
      }
      const draft = await repos.drafts.get(draftId);
      if (!draft || draft.project !== project) return notFound(c, "draft");
      return c.json(sendTicketDto.parse(tickets.mint(`send:${draftId}`)));
    })
    // P71 M4: one messenger draft. The dry run answers what would go out, or every refusal in words; the apply needs the ticket.
    .post("/api/projects/:slug/messengers/drafts/:id/send", v("param", sendParam), v("json", messengerSendBody), async (c) => {
      const { slug, id } = c.req.valid("param");
      const body = c.req.valid("json");
      if (!sender) return c.json({ error: "Sending is not set up on this server.", code: "wrong_state" as const }, 409);
      const door = { repos, projectsDir: sender.projectsDir, policyDir: sender.policyDir, allowList: sender.allowList, senders: messengers, ...(sender.now ? { now: sender.now } : {}) };
      if (!body.apply) {
        const a = await assessMessenger(door, slug, id);
        if (!a) return notFound(c, "draft");
        if (a.reasons.length || !a.preview) return c.json(refusal(a.reasons.length ? a.reasons : ["nothing to send"]), 409);
        return c.json(messengerSendPreviewDto.parse({ ok: true, dryRun: true, ...a.preview }));
      }
      if (!(await repos.messengers.getDraft(slug, id))) return notFound(c, "draft");
      if (!tickets.take(body.ticket, `msend:${id}`)) return forbidden(c, "a send needs the admin's ticket; press Send in the admin");
      const r = await applyMessenger(door, slug, id, body.confirm);
      if (!r) return notFound(c, "draft");
      if ("refused" in r) return c.json(refusal(r.refused), 409);
      if ("failed" in r) return c.json({ error: `The send failed: ${r.failed}. Nothing was retried; the draft waits again.`, code: "server" as const }, 500);
      return c.json(sentDto.parse({ ok: true, sendId: r.sendId }));
    })
    .post("/api/projects/:slug/drafts/:id/send", v("param", sendParam), v("json", sendBody), async (c) => {
      const { slug, id } = c.req.valid("param");
      const body = c.req.valid("json");
      const draft = await repos.drafts.get(id);
      if (!draft || draft.project !== slug) return notFound(c, "draft");
      if (!deps) return c.json({ error: "Sending is not set up on this server.", code: "wrong_state" as const }, 409);

      if (!body.apply) {
        const a = await assess(deps, id, { mode: "manual" });
        if (!a.ok || !a.mail) return c.json(refusal(a.reasons), 409);
        const m = a.mail;
        // What would go out: exactly the Mail text (decision 0031: nothing of the Hub's is in it).
        return c.json(sendPreviewDto.parse({ ok: true, dryRun: true, from: m.sender, to: m.to, cc: m.cc, subject: m.subject, body: m.body }));
      }
      // A send needs a person's ticket, not just the recipients and subject, which the dry run gives anyone (P49 S12).
      if (!tickets.take(body.ticket, `send:${id}`)) return forbidden(c, "a send needs the admin's ticket; press Send in the admin");
      const r = await sendDraft(deps, { draftId: id, apply: true, actor: "admin", confirm: body.confirm });
      const out = JSON.parse(r.line) as { sendId?: number; refused?: string[]; error?: string };
      if (r.code === 0 && out.sendId !== undefined) return c.json(sentDto.parse({ ok: true, sendId: out.sendId }));
      if (r.code === 2) return c.json(refusal(out.refused ?? [out.error ?? "refused"]), 409);
      return c.json({ error: out.error ?? "The send failed.", code: "server" as const }, 500);
    })
    .get("/api/projects/:slug/sends", v("param", slugParam), async (c) =>
      c.json(sendsDto.parse({ sends: await repos.sends.list(c.req.valid("param").slug), stopped: await repos.sends.stoppedScopes() })),
    )
    // Cancels a queued send (the window). A sent mail cannot be recalled, so only `queued` can be cancelled.
    .post("/api/sends/:id/cancel", v("param", idParam), v("query", projectQuery), async (c) => {
      const row = await repos.sends.get(c.req.valid("param").id);
      if (!row || row.project !== c.req.valid("query").project) return notFound(c, "send");
      const cancelled = await repos.sends.cancel(row.id, "cancelled in the admin");
      if (!cancelled) return c.json({ error: `Send ${row.id} is ${row.status}: only a queued send can be cancelled.`, code: "wrong_state" as const }, 409);
      return c.json(sendCancelledDto.parse({ ok: true, sendId: row.id }));
    })
    .post("/api/projects/:slug/sends/stop", v("param", slugParam), async (c) => {
      const cancelled = await repos.sends.stop(scope(c.req.valid("param").slug));
      return c.json(stopDto.parse({ ok: true, cancelled, stopped: await repos.sends.stoppedScopes() }));
    })
    .post("/api/projects/:slug/sends/resume", v("param", slugParam), async (c) => {
      await repos.sends.resume(scope(c.req.valid("param").slug));
      return c.json(stopDto.parse({ ok: true, cancelled: 0, stopped: await repos.sends.stoppedScopes() }));
    });
}
