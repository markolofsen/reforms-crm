import { Hono } from "hono";
import type { Repos } from "@hub/db";
import { assess, findMail, mailHash, sendDraft, type Mailer } from "@hub/send";
import { idParam, projectQuery, sendBody, sendParam, slugParam } from "@hub/contract/requests";
import { draftMailDto, draftThreadDto, sendCancelledDto, sendPreviewDto, sendsDto, sentDto, stopDto } from "@hub/contract/responses";
import { notFound, v } from "../http";

/** What the send routes need from the process: the Mailer, where project.md lives, and `allow_list` for `draft.recipients: test`. */
export interface SenderOptions {
  mailer: Mailer;
  projectsDir: string;
  allowList: string[];
  now?: () => Date;
}

const refusal = (refused: string[]) => ({ error: refused.length === 1 ? `Not sent: ${refused[0]}` : `Not sent: ${refused.length} reasons`, code: "wrong_state" as const, refused });

/**
 * Sending, the one place the admin can do it (decision 0011, stage 1). A person decides each send: the first call is a
 * dry run that reads Mail and returns the exact mail; the second carries what the person saw (recipients and subject)
 * and sends only if Mail's draft still matches. Every send goes through `@hub/send`, the same checks as `hub send`,
 * and writes its audit row first. Cancel and Stop all only ever remove work: nothing here queues a send.
 */
export function sendRoutes(repos: Repos, sender?: SenderOptions) {
  const deps = sender && { repos, mailer: sender.mailer, projectsDir: sender.projectsDir, allowList: sender.allowList, ...(sender.now ? { now: sender.now } : {}) };
  /** `*` is every project. */
  const scope = (slug: string) => (slug === "*" ? undefined : slug);

  return new Hono()
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
        return c.json(sendPreviewDto.parse({ ok: true, dryRun: true, from: m.sender, to: m.to, cc: m.cc, subject: m.subject, body: m.body }));
      }
      const r = await sendDraft(deps, { draftId: id, apply: true, actor: "admin", confirm: body.confirm });
      const out = JSON.parse(r.line) as { sendId?: number; refused?: string[]; error?: string };
      if (r.code === 0 && out.sendId !== undefined) return c.json(sentDto.parse({ ok: true, sendId: out.sendId }));
      if (r.code === 2) return c.json(refusal(out.refused ?? [out.error ?? "refused"]), 409);
      return c.json({ error: out.error ?? "The send failed.", code: "server" as const }, 500);
    })
    // The draft as Mail holds it now. Read-only: no audit row, nothing stored. The safety checks run on this live text.
    .get("/api/projects/:slug/drafts/:id/mail", v("param", sendParam), async (c) => {
      const { slug, id } = c.req.valid("param");
      const draft = await repos.drafts.get(id);
      if (!draft || draft.project !== slug) return notFound(c, "draft");
      const readAt = (sender?.now?.() ?? new Date()).toISOString();
      const empty = { from: null, to: [], cc: [], subject: "", body: "", hash: null, safetyResults: [], readAt };
      if (!deps) return c.json(draftMailDto.parse({ configured: false, found: false, reason: "Reading Mail is not set up on this server.", ...empty }));
      const f = await findMail(deps, draft);
      if (!f.mail) return c.json(draftMailDto.parse({ configured: true, found: false, reason: f.reason, ...empty }));
      const m = f.mail;
      const safetyResults = await repos.sends.safetyOf(id, { subject: m.subject, toAddr: m.to.join(","), ccAddr: m.cc.join(",") || null, body: m.body }, sender?.now?.());
      return c.json(draftMailDto.parse({ configured: true, found: true, reason: null, from: m.sender, to: m.to, cc: m.cc, subject: m.subject, body: m.body, hash: mailHash(m), safetyResults, readAt }));
    })
    // The last five messages of the conversation, read from Mail on demand (`Mailer.thread`). Read-only, nothing stored.
    .get("/api/projects/:slug/drafts/:id/thread", v("param", sendParam), async (c) => {
      const { slug, id } = c.req.valid("param");
      const draft = await repos.drafts.get(id);
      if (!draft || draft.project !== slug) return notFound(c, "draft");
      const readAt = (sender?.now?.() ?? new Date()).toISOString();
      if (!deps) return c.json(draftThreadDto.parse({ configured: false, read: false, reason: "Reading Mail is not set up on this server.", messages: [], readAt }));
      const address = draft.toAddr.match(/[^\s,;<>"']+@[^\s,;<>"']+/)?.[0] ?? "";
      try {
        const rows = address === "" ? [] : await deps.mailer.thread({ mailRef: draft.mailRef, subject: draft.subject, address }, 5);
        return c.json(draftThreadDto.parse({ configured: true, read: true, reason: null, messages: rows.map((m, i) => ({ ...m, last: i === 0 })), readAt }));
      } catch (e) {
        return c.json(draftThreadDto.parse({ configured: true, read: false, reason: `Mail could not be read: ${e instanceof Error ? e.message : "unknown error"}`, messages: [], readAt }));
      }
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
