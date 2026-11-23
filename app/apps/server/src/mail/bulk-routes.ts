import { Hono } from "hono";
import { agentSettingsBody, batchQuery, idParam, projectQuery, safetyKindParam, safetyRuleBody } from "@hub/contract/requests";
import { batchDto, batchesDto, warningsAckedDto } from "@hub/contract/review";
import { agentSettingsDto, okDto, safetyRuleSavedDto, safetyRulesDto } from "@hub/contract/responses";
import type { BulkServices } from "../composition/capabilities";
import { toDraft } from "../http/dto";
import { notFound, v } from "../http/http";

/**
 * Batches (P9), read-only since P48 (decision 0025): the agent prepares drafts from the owner's phrase in a session, so no
 * route creates a batch or adds to one. A batch is a view of the drafts it wrote, with one Undo. The safety rules live here
 * too, and the agent's model and advisor (P55: the same store; the next session start reads them). None sends: `drafts.status` has no `sent` in anything the API accepts (see `SETTABLE_STATUSES`).
 */
export function bulkRoutes({ repos }: BulkServices) {
  return new Hono()
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
    // P87 (finding 6): "Understood all warnings" of one batch: every amber result of its open drafts, the owner's act; red stays per draft.
    .post("/api/batches/:id/acknowledge-warnings", v("param", idParam), v("query", projectQuery), async (c) => {
      const project = c.req.valid("query").project;
      const batchId = c.req.valid("param").id;
      if (!(await repos.batches.get(project, batchId))) return notFound(c, "batch");
      return c.json(warningsAckedDto.parse({ ok: true, ...(await repos.drafts.acknowledgeWarnings(project, batchId)) }));
    })
    .get("/api/safety-rules", v("query", projectQuery), async (c) => c.json(safetyRulesDto.parse({ rules: await repos.safetyRules.list(c.req.valid("query").project) })))
    .put("/api/safety-rules/:kind", v("param", safetyKindParam), v("json", safetyRuleBody), async (c) => {
      const { project, ...patch } = c.req.valid("json");
      return c.json(safetyRuleSavedDto.parse({ rule: await repos.safetyRules.set(project, c.req.valid("param").kind, patch) }));
    })
    .get("/api/agent-settings", v("query", projectQuery), async (c) => c.json(agentSettingsDto.parse({ agent: await repos.agentSettings.get(c.req.valid("query").project) })))
    .put("/api/agent-settings", v("json", agentSettingsBody), async (c) => {
      const { project, ...patch } = c.req.valid("json");
      return c.json(agentSettingsDto.parse({ agent: await repos.agentSettings.set(project, patch) }));
    });
}
