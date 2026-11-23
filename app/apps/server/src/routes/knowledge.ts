import { Hono } from "hono";
import { entryKey } from "@hub/contract/local";
import { entryStatus, inView, KNOWLEDGE_MAX_ROWS, KNOWLEDGE_VIEWS, knowledgeListDto, type KnowledgeEntryDto, type KnowledgeView } from "@hub/contract/knowledge";
import { notFound } from "../http";
import { configOf, hostTimeZone, localDate } from "../overview-facts";
import type { KnowledgeServices } from "../composition/capabilities";

const list = (json: string): string[] => {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const viewOf = (v: string | undefined): KnowledgeView => KNOWLEDGE_VIEWS.find((x) => x === v) ?? "all";

/**
 * `GET /api/projects/:slug/knowledge?filter=&q=` (P70): every entry of the project's knowledge index as the Knowledge table shows
 * it, read from `knowledge_docs` of that project only (no file read: whether the index matches the files is the project overview's
 * `consistent`). `status` is computed on the project's local day; `q` matches the title, case-insensitive; the counts are every
 * view's size for that search. Read only, behind the general guard; an unknown project is 404.
 */
export function knowledgeRoutes({ repos, now, timeZone }: KnowledgeServices) {
  return new Hono().get("/api/projects/:slug/knowledge", async (c) => {
    const slug = c.req.param("slug");
    const row = await repos.projects.get(slug);
    if (row === null) return notFound(c, "project");
    const config = configOf(row);
    const today = localDate(now(), config.timezone ?? timeZone ?? hostTimeZone());
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    const view = viewOf(c.req.query("filter"));
    const all: KnowledgeEntryDto[] = (await repos.knowledge.list(slug))
      .map((d) => ({ key: entryKey(d.path), title: d.title, use: d.use, approved: d.approved, audiences: list(d.audiences), brands: list(d.brands), category: d.category, kind: d.kind, validUntil: d.validUntil, status: entryStatus(d, today) }))
      .filter((e) => q === "" || e.title.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title));
    const counts = { all: all.length, attention: all.filter((e) => inView(e, "attention")).length, expired: all.filter((e) => inView(e, "expired")).length, unapproved: all.filter((e) => inView(e, "unapproved")).length };
    const shown = all.filter((e) => inView(e, view));
    return c.json(knowledgeListDto.parse({ scope: config.knowledge.scope, entries: shown.slice(0, KNOWLEDGE_MAX_ROWS), counts, truncated: shown.length > KNOWLEDGE_MAX_ROWS }));
  });
}
