import { Hono } from "hono";
import type { Repos } from "@hub/db";
import { agentDraftBody, audienceQuery, batchCreateBody, batchQuery, closeBody, idParam, projectQuery, safetyKindParam, safetyRuleBody } from "@hub/contract/requests";
import { audienceDto, batchCreatedDto, batchDto, batchesDto, okDto, safetyRuleSavedDto, safetyRulesDto } from "@hub/contract/responses";
import { toDraft } from "../dto";
import { notFound, v } from "../http";

/**
 * Bulk send (P9). Every route here makes, reviews or logs drafts. None sends: the person presses Send in Mail, and
 * `drafts.status` has no `sent` in anything the API accepts (see `SETTABLE_STATUSES`).
 */
export function bulkRoutes(repos: Repos) {
  return new Hono()
    // Who could this batch go to: a count for every audience chip, and the clients of the chosen one.
    .get("/api/bulk/audience", v("query", audienceQuery), async (c) => {
      const q = c.req.valid("query");
      return c.json(audienceDto.parse(await repos.batches.audience(q.project, { audience: q.audience, silentDays: q.silentDays })));
    })
    .post("/api/batches", v("json", batchCreateBody), async (c) => c.json(batchCreatedDto.parse(await repos.batches.create(c.req.valid("json")))))
    .get("/api/batches", v("query", projectQuery), async (c) => c.json(batchesDto.parse({ batches: await repos.batches.list(c.req.valid("query").project) })))
    .get("/api/batches/:id", v("param", idParam), v("query", batchQuery), async (c) => {
      const { project, filter, limit, offset } = c.req.valid("query");
      const batchId = c.req.valid("param").id;
      const batch = await repos.batches.get(project, batchId);
      if (!batch) return notFound(c, "batch");
      const rows = await repos.batches.drafts(project, batchId, filter, { limit, offset });
      const total = batch.counts[filter];
      return c.json(batchDto.parse({ batch, drafts: rows.map((d) => toDraft(d)), total, nextOffset: offset + rows.length < total ? offset + rows.length : null }));
    })
    // One step back for the most recent action in the batch.
    .post("/api/batches/:id/undo", v("param", idParam), v("query", projectQuery), async (c) => {
      const draft = await repos.batches.undoLast(c.req.valid("query").project, c.req.valid("param").id);
      return draft ? c.json(okDto.parse({ ok: true })) : c.json({ error: "Nothing to undo in this batch", code: "not_found" as const }, 404);
    })
    // The agent's way in: it adds a draft to a batch that is waiting for drafts, then closes the batch.
    .post("/api/batches/:id/drafts", v("param", idParam), v("json", agentDraftBody), async (c) => {
      const { project, ...draft } = c.req.valid("json");
      return c.json({ draftId: await repos.batches.addAgentDraft(project, c.req.valid("param").id, draft) });
    })
    .post("/api/batches/:id/close", v("param", idParam), v("json", closeBody), async (c) => {
      const { project, ...rest } = c.req.valid("json");
      await repos.batches.close(project, c.req.valid("param").id, rest);
      return c.json(okDto.parse({ ok: true }));
    })
    .get("/api/safety-rules", v("query", projectQuery), async (c) => c.json(safetyRulesDto.parse({ rules: await repos.safetyRules.list(c.req.valid("query").project) })))
    .put("/api/safety-rules/:kind", v("param", safetyKindParam), v("json", safetyRuleBody), async (c) => {
      const { project, ...patch } = c.req.valid("json");
      return c.json(safetyRuleSavedDto.parse({ rule: await repos.safetyRules.set(project, c.req.valid("param").kind, patch) }));
    });
}
