import { Hono, type Context } from "hono";
import type { Repos } from "@hub/db";
import { assess, BATCH_LIMITS, batchTicketKey, planBatch, sendDraft, type BatchLimits, type Mailer, type SendDeps } from "@hub/send";
import { batchSendBody, batchSendParam, batchTicketBody, idParam, projectQuery, sendBody, sendParam, sendTicketBody, slugParam } from "@hub/contract/requests";
import { batchRunStateDto, batchSendPlanDto, sendCancelledDto, sendPreviewDto, sendsDto, sendTicketDto, sentDto, stopDto } from "@hub/contract/responses";
import { messengerSendBody, messengerSendPreviewDto } from "@hub/contract/messenger-panel";
import type { DraftWriter } from "@hub/agent/mail-drafts";
import { gateRefusal, ticketStore, type TicketStore } from "../admin-gate";
import { notFound, v } from "../http";
import { batchRuns, type BatchRuns } from "../send/batch-door";
import { applyMessenger, assessMessenger, type MessengerSenders } from "../send/messenger-door";
import { ops } from "@hub/log/ops";

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
  /** Which Mailer this is; with the fake (the e2e run only) `HUB_BATCH_SPACING_SECONDS` may shorten the batch spacing. */
  kind?: "mail-app" | "fake";
  /** P85b: the runs of Send all Checked (tests pass their own, with their own limits). */
  batchRuns?: BatchRuns;
  batchLimits?: BatchLimits;
  /** P89: told after each confirmed send (the Notion stamp of who sent); see `SendDeps.onSent`. */
  onSent?: SendDeps["onSent"];
}

/** The batch guards: the defaults, or (fake Mailer only, so never on a real Mail) a shorter spacing for the e2e run. */
function limitsOf(sender: SenderOptions): BatchLimits {
  if (sender.batchLimits) return sender.batchLimits;
  const env = Number(process.env.HUB_BATCH_SPACING_SECONDS);
  return sender.kind === "fake" && Number.isInteger(env) && env >= 0 ? { ...BATCH_LIMITS, spacingSeconds: env } : BATCH_LIMITS;
}

/** A ticket lives 60 s: the person has read the mail and pressed Send; the apply follows at once. */
const TICKET_TTL_MS = 60_000;

const refusal = (refused: string[]) => ({ error: refused.length === 1 ? `Not sent: ${refused[0]}` : `Not sent: ${refused.length} reasons`, code: "wrong_state" as const, refused });
const log = ops("send");
/** P86: a refusal of a confirmed send (not of a dry run, which only shows the checks) is a `warn` line with every reason. */
const refused = (what: Record<string, unknown>, reasons: string[]) => {
  log.warn("a confirmed send was refused", { ...what, reasons });
  return refusal(reasons);
};

/**
 * Sending, the one place the admin can do it (decision 0011, stage 1). A person decides each send: the first call is a
 * dry run that reads Mail and returns the exact mail; the second carries what the person saw (recipients and subject)
 * and sends only if Mail's draft still matches. Every send goes through `@hub/send`, the same checks as `hub send`,
 * and writes its audit row first. Cancel and Stop all only ever remove work: nothing here queues a send.
 * A messenger draft goes through the same door (P71 M4, `../send/messenger-door.ts`): the same dry run, ticket and audit row, its
 * own guards, and `messengers` holds the only send of each connected account.
 */
export function sendRoutes(repos: Repos, sender?: SenderOptions, messengers?: MessengerSenders) {
  const deps = sender && { repos, mailer: sender.mailer, projectsDir: sender.projectsDir, policyDir: sender.policyDir, allowList: sender.allowList, ...(sender.now ? { now: sender.now } : {}), ...(sender.onSent ? { onSent: sender.onSent } : {}) };
  const tickets = sender?.tickets ?? ticketStore({ ttlMs: TICKET_TTL_MS });
  const limits = sender ? limitsOf(sender) : BATCH_LIMITS;
  const runs = sender?.batchRuns ?? batchRuns({ limits });
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
    // P85b: the ticket of one batch run, bound to the batch and to exactly the drafts and text hashes the person confirmed.
    .post("/api/sends/batch-tickets", v("json", batchTicketBody), async (c) => {
      if (!sender) return c.json({ error: "Sending is not set up on this server.", code: "wrong_state" as const }, 409);
      const why = gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, sender.adminPort, { sameSite: true });
      if (why) return forbidden(c, why);
      const { project, batchId, items } = c.req.valid("json");
      if (!(await repos.batches.get(project, batchId))) return notFound(c, "batch");
      return c.json(sendTicketDto.parse(tickets.mint(batchTicketKey(batchId, items))));
    })
    // P85b: Send all Checked of one batch. The dry run lists who would get what, and who is held and why; the apply starts one
    // run of exactly the confirmed drafts (each through the door, one at a time, spaced), which the admin follows and may Stop.
    .post("/api/projects/:slug/batches/:id/send", v("param", batchSendParam), v("json", batchSendBody), async (c) => {
      const { slug, id } = c.req.valid("param");
      const body = c.req.valid("json");
      if (!deps || !sender) return c.json({ error: "Sending is not set up on this server.", code: "wrong_state" as const }, 409);
      if (!(await repos.batches.get(slug, id))) return notFound(c, "batch");
      if (!body.apply) {
        const plan = await planBatch(deps, slug, id, limits);
        if (!plan) return notFound(c, "batch");
        return c.json(batchSendPlanDto.parse({ ok: true, dryRun: true, ...plan }));
      }
      if (!tickets.take(body.ticket, batchTicketKey(id, body.items))) return forbidden(c, "a batch send needs the admin's ticket for exactly the drafts you confirmed; press Send all Checked in the admin");
      // What the person confirmed must still be what goes out: the plan is read again, and each confirmed draft must be in it with the same hash.
      const plan = await planBatch(deps, slug, id, limits);
      if (!plan) return notFound(c, "batch");
      const now = new Map(plan.items.map((i) => [i.draftId, i]));
      const changed = body.items.filter((i) => now.get(i.draftId)?.hash !== i.hash);
      if (changed.length) return c.json(refused({ project: slug, batch: id }, changed.map((i) => `draft ${i.draftId} ${now.has(i.draftId) ? "changed in Mail after you confirmed it" : "can no longer be sent (read the batch again)"}`)), 409);
      const r = runs.start(deps, { project: slug, batchId: id, items: body.items.flatMap((i) => now.get(i.draftId) ?? []) });
      if ("refused" in r) return c.json(refused({ project: slug, batch: id }, [r.refused]), 409);
      return c.json(batchRunStateDto.parse({ run: r.run }), 202);
    })
    .get("/api/projects/:slug/batches/:id/send", v("param", batchSendParam), async (c) => {
      const { slug, id } = c.req.valid("param");
      return c.json(batchRunStateDto.parse({ run: runs.get(slug, id) }));
    })
    // Stop only ever removes work: the mail being sent finishes, the drafts not yet tried stay Checked.
    .post("/api/projects/:slug/batches/:id/send/stop", v("param", batchSendParam), async (c) => {
      const { slug, id } = c.req.valid("param");
      runs.stop(slug, id);
      return c.json(batchRunStateDto.parse({ run: runs.get(slug, id) }));
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
      if ("refused" in r) return c.json(refused({ project: slug, messengerDraft: id }, r.refused), 409);
      // The failure itself is logged by the door, with its channel and account.
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
      if (r.code === 2) return c.json(refused({ project: slug, draft: id }, out.refused ?? [out.error ?? "refused"]), 409);
      log.error("a mail send failed; nothing was retried", { project: slug, draft: id, reason: out.error ?? "no reason given" });
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
