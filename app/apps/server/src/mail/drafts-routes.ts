import { Hono } from "hono";
import { clientHistory } from "@hub/messengers";
import { ackBody, checkedBody, draftsQuery, historyQuery, idParam, marksBody, projectQuery, statusBody, toneBody } from "@hub/contract/requests";
import { draftChangedDto, draftsDto, historyDto, timelineDto } from "@hub/contract/review";
import { toDraft } from "../http/dto";
import { notFound, v } from "../http/http";
import { findMail, mailHash, trashThread } from "@hub/send";
import { projectStore } from "@hub/projects";
import { errFields, ops } from "@hub/log/ops";
import type { MailContext } from "./context";

/**
 * Drafts to review, and what a person does to one. Nothing here sends: the only statuses a request can write are
 * `SETTABLE_STATUSES`, and every mutation names its project, so a draft of another project is "not found".
 */
export function draftRoutes({ repos, sender }: MailContext) {
  const ownDraft = async (project: string, id: number) => {
    const d = await repos.drafts.get(id);
    return d && d.project === project ? d : null;
  };
  const changed = (draftId: number) => draftChangedDto.parse({ ok: true, draftId });

  return new Hono()
    .get("/api/drafts", v("query", draftsQuery), async (c) => {
      const { project, filter, search, batch, limit, offset } = c.req.valid("query");
      // Only clients that have a draft: the admin is a review queue, not a client directory (decision 0009).
      const scope = { batch: batch ?? null, search };
      const [rows, counts, total] = await Promise.all([repos.clients.review(project, filter, { ...scope, limit, offset }), repos.clients.counts(project, scope), repos.clients.reviewTotal(project, filter, scope)]);
      return c.json(draftsDto.parse({ drafts: await Promise.all(rows.map(async (d) => toDraft(d, await repos.sends.forDraft(d.id)))), counts, total, nextOffset: offset + rows.length < total ? offset + rows.length : null }));
    })
    .post("/api/drafts/:id/checked", v("param", idParam), v("json", checkedBody), async (c) => {
      const { project, checked, hash: supplied } = c.req.valid("json");
      const id = c.req.valid("param").id;
      if (!(await ownDraft(project, id))) return notFound(c, "draft");
      let hash: string | null = null;
      if (checked && sender) {
        // Checked is bound to the text that was read (decision 0013): a tick carrying the hash of a stale read is refused.
        const own = await repos.drafts.get(id);
        const accounts = own ? (() => {
          try {
            return projectStore({ projects: sender.projectsDir, stateProjects: sender.policyDir }).config(own.project).mail.accounts;
          } catch {
            return null;
          }
        })() : null;
        const f = own ? await findMail(sender, own, "strict", { accounts, versions: await repos.mailVersions.ofDraft(own.id) }) : null;
        if (f?.mail) {
          hash = mailHash(f.mail);
          if (supplied && supplied !== hash) return c.json({ error: "The draft changed in Mail since you read it: read it again.", code: "wrong_state" as const }, 409);
        } else if (own) {
          // Fail closed: a Mail draft whose text cannot be read has no hash, so it cannot be Checked. A batch draft too (P85:
          // a campaign's drafts are Mail drafts like any other; the P9 template drafts without one are gone).
          return c.json({ error: `Mail could not be read, so this draft cannot be checked: ${f?.reason ?? "no draft found"}.`, code: "wrong_state" as const }, 409);
        }
      }
      const draft = await repos.drafts.setChecked(id, checked, hash);
      return draft ? c.json(changed(id)) : notFound(c, "draft");
    })
    .post("/api/drafts/:id/status", v("param", idParam), v("json", statusBody), async (c) => {
      const { project, status, reason } = c.req.valid("json");
      const id = c.req.valid("param").id;
      if (!(await ownDraft(project, id))) return notFound(c, "draft");
      const draft = await repos.drafts.setStatus(id, status, reason);
      // Skip and Done close the draft: the Mail versions the Hub recorded for it go to Trash (P56, P65), so the owner never
      // cleans up after the Hub; a draft he wrote in Mail himself is never in that record. In the background and best
      // effort: the status is the owner's decision and never waits on Mail; Undo finds the copy in Trash (Restore), and
      // `hub drafts sweep` finds whatever is left.
      if (draft && sender && (status === "skipped" || status === "done")) {
        void trashThread({ mailer: sender.mailer, repos }, draft.id).catch((e: unknown) => ops("mail").error("a closed draft's Mail versions were not moved to Trash", { project, draft: id, ...errFields(e) }));
      }
      return draft ? c.json(changed(id)) : notFound(c, "draft");
    })
    .post("/api/drafts/:id/tone", v("param", idParam), v("json", toneBody), async (c) => {
      const { project, tone } = c.req.valid("json");
      const id = c.req.valid("param").id;
      if (!(await ownDraft(project, id))) return notFound(c, "draft");
      const draft = await repos.drafts.setTone(id, tone);
      return draft ? c.json(changed(id)) : notFound(c, "draft");
    })
    .post("/api/drafts/:id/ack", v("param", idParam), v("json", ackBody), async (c) => {
      const { project, kind, acked } = c.req.valid("json");
      const id = c.req.valid("param").id;
      if (!(await ownDraft(project, id))) return notFound(c, "draft");
      const draft = await repos.drafts.acknowledge(id, kind, acked);
      return draft ? c.json(changed(id)) : notFound(c, "draft");
    })
    .post("/api/drafts/:id/undo", v("param", idParam), v("query", projectQuery), async (c) => {
      const id = c.req.valid("param").id;
      if (!(await ownDraft(c.req.valid("query").project, id))) return notFound(c, "draft");
      const draft = await repos.drafts.undo(id);
      return draft ? c.json(changed(id)) : notFound(c, "draft");
    })
    .put("/api/clients/:id/marks", v("param", idParam), v("json", marksBody), async (c) => {
      const { project, marks } = c.req.valid("json");
      const id = c.req.valid("param").id;
      if (!(await repos.clients.get(project, id))) return notFound(c, "client");
      return (await repos.clients.setMarks(id, marks)) ? c.json({ ok: true as const }) : notFound(c, "client");
    })
    // What the agent and the owner did for one client.
    .get("/api/clients/:id/timeline", v("param", idParam), v("query", projectQuery), async (c) => {
      const { project } = c.req.valid("query");
      const id = c.req.valid("param").id;
      if (!(await repos.clients.get(project, id))) return notFound(c, "client");
      return c.json(timelineDto.parse({ events: await repos.runs.eventsForClient(project, id) }));
    })
    // The client's stored messenger rows, newest first. Mail is not read here (decision 0026): the panel opens Mail for the thread.
    .get("/api/clients/:id/history", v("param", idParam), v("query", historyQuery), async (c) => {
      const q = c.req.valid("query");
      const clientId = c.req.valid("param").id;
      if (!(await repos.clients.get(q.project, clientId))) return notFound(c, "client");
      try {
        const h = await clientHistory({ repos }, q.project, clientId, { ...(q.limit ? { limit: q.limit } : {}), ...(q.cursor ? { cursor: q.cursor } : {}) });
        return c.json(historyDto.parse(h));
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("bad_cursor")) return c.json({ error: "bad cursor", code: "invalid" as const }, 400);
        throw e;
      }
    });
}
