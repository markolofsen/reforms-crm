import type { ProjectConfig } from "@hub/projects/model";

// P82 S2/S3: one Notion connector, one Notion user, several teamspaces with databases of the same names (Clients, Leads, ...).
// A search by name cannot tell them apart; only the ids can. This is the one place that turns a project's `## Notion databases`
// into what its session is told (the capabilities line, `project_show`) and what the guard enforces (`notionViolations`), so
// the two never disagree (decision 0009). Ids compare as 32 lowercase hex characters: Notion writes them with and without dashes.

export interface NotionScope {
  slug: string;
  /** `## Notion databases` of project.md: the role (`clients`, `leads`, ...) and the data source id, as written there. */
  databases: ReadonlyArray<{ role: string; dataSourceId: string }>;
  teamspace: string | null;
  teamspaceId: string | null;
  parentPage: string | null;
}

/** What the guard knows of this session's earlier Notion reads (the ledger's notion entries, P28): where a page came from. */
export interface NotionRead { op?: string | undefined; sources?: readonly string[] | undefined; pageIds?: readonly string[] | undefined }

export const notionScopeOf = (slug: string, cfg: Pick<ProjectConfig, "notion">): NotionScope => ({
  slug,
  databases: cfg.notion.databases.map((d) => ({ role: d.slug, dataSourceId: d.dataSourceId })),
  teamspace: cfg.notion.teamspace ?? null,
  teamspaceId: cfg.notion.teamspaceId ?? null,
  parentPage: cfg.notion.parentPage ?? null,
});

/** `41806f30-6f14-81ac-…` or `41806f306f1481ac…` or a notion URL holding one: the 32 hex characters, lowercase; "" when none. */
export const hexId = (v: unknown): string => (typeof v === "string" ? (v.replace(/-/g, "").match(/[0-9a-f]{32}/i)?.[0] ?? "").toLowerCase() : "");

const COLLECTION = /collection:\/\/([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/gi;
/** Every `collection://<id>` in a value, as hex ids. */
export const collectionIds = (v: unknown): string[] => [...new Set([...(typeof v === "string" ? v : JSON.stringify(v ?? "")).matchAll(COLLECTION)].map((m) => hexId(m[1])))];

const listOf = (s: NotionScope): string => s.databases.map((d) => `${d.role} collection://${d.dataSourceId}`).join(", ");

/** The notion part of the capabilities line: the databases by id, the teamspace once its id is recorded, and why search is not enough. */
export function notionCapability(s: NotionScope): string {
  if (!s.databases.length) return `notion: no databases listed in project.md (say: настрой проект ${s.slug})`;
  const ts = s.teamspaceId && s.teamspace ? `; teamspace ${s.teamspace}` : "";
  return `notion: this project's own databases, read and write (query, create and update rows; delete and move are denied), by id, never by search: ${listOf(s)}${ts}. The owner's Notion has other teamspaces with databases of the same names: they belong to other projects`;
}

/** The session rule beside the identity (P82 4B point 2). */
export const NOTION_RULE =
  "Never pick a Notion database by search. For clients, leads, documents, contacts or tasks, query the id on the capabilities line first (or call `project_show`). A database or page that search finds outside these ids belongs to another project: do not read from it or write to it; say so in one line.";

/** The Notion part of `project_show` (`hub mcp`): the same parse as the line, for a session after a compaction and for the skills' step 0. */
export const projectNotion = (s: NotionScope) => ({
  project: s.slug,
  teamspace: s.teamspaceId ? s.teamspace : null,
  teamspaceId: s.teamspaceId,
  parentPage: s.parentPage,
  databases: s.databases.map((d) => ({ role: d.role, dataSourceId: d.dataSourceId, url: `collection://${d.dataSourceId}` })),
});

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Why a Notion call of a bound session is refused (P82 4B points 5 to 8); empty when it may run. Always blocks, whatever HUB_GUARD
 * says: a write into another project's CRM is a wrong record under the owner's name, a read from it a wrong answer in this project's
 * name. No list, no check: an unbound session or a project whose `## Notion databases` is empty (setup) is told only. Search and
 * fetch are never refused (setup and import search on purpose); the post hook adds a note instead (`notionNote`).
 */
export function notionViolations(name: string, input: unknown, s: NotionScope | undefined, read: readonly NotionRead[] = []): string[] {
  const tool = /^mcp__notion__(.+)$/.exec(name)?.[1];
  if (!tool || !s || !s.databases.length) return [];
  const ours = new Set(s.databases.map((d) => hexId(d.dataSourceId)));
  const first = s.databases[0];
  const notOurs = (id: string) => `${id} is not one of ${s.slug}'s Notion databases (${listOf(s)}): a database outside this list is another project's, or not yet listed (then add it under ## Notion databases of project.md)`;
  const foreign = (ids: string[]) => ids.filter((x) => x && !ours.has(x)).map(notOurs);
  const i = obj(input);
  const fromProject = (page: string): boolean => !!page && (page === hexId(s.parentPage) || read.some((e) => (e.sources ?? []).some((x) => ours.has(hexId(x))) && (e.pageIds ?? []).some((p) => hexId(p) === page)));
  switch (tool) {
    case "notion-query-data-sources":
    case "notion-query-multiple-data-sources":
    case "notion-update-data-source":
    case "notion-create-view":
    case "notion-update-view": {
      const ids = [...collectionIds(input), ...["data_source_id", "dataSourceId"].map((k) => hexId(i[k]))];
      return [...new Set(foreign(ids))];
    }
    case "notion-create-pages": {
      const p = obj(i.parent);
      if (typeof p.data_source_id === "string") return foreign([hexId(p.data_source_id)]);
      if (typeof p.database_id === "string") return [`notion-create-pages with parent database_id ${p.database_id}: use data_source_id ${first?.dataSourceId ?? ""} (${first?.role ?? ""}) or another of ${s.slug}'s databases (${listOf(s)}); a database id is not checked against the project`];
      if (typeof p.page_id === "string") return fromProject(hexId(p.page_id)) ? [] : [`notion-create-pages under page ${p.page_id}: the page is neither ${s.slug}'s root (notion.parent_page) nor a page this session read from one of its databases; read it from the project's database first, or create in a database (${listOf(s)})`];
      if (typeof p.teamspace_id === "string") return s.teamspaceId && hexId(p.teamspace_id) === hexId(s.teamspaceId) ? [] : [`notion-create-pages in teamspace ${p.teamspace_id}: not ${s.slug}'s teamspace (notion.teamspace_id ${s.teamspaceId ?? "not recorded"})`];
      return [];
    }
    case "notion-update-page": {
      const page = hexId(i.page_id);
      if (!page || fromProject(page)) return [];
      return [`notion-update-page on ${String(i.page_id)}: this session has not read that page from one of ${s.slug}'s databases; read it from the project's ${first?.role ?? "own"} database first (${listOf(s)})`];
    }
    default:
      return [];
  }
}

/**
 * The post hook's note for a search or a fetch (P82 4B points 9 and 10, S0 point 3: a PostToolUse `additionalContext`, safe in
 * both modes): a search not narrowed to the project's databases, or a fetched object whose parent database is not the project's.
 * Null when there is nothing to say.
 */
export function notionNote(name: string, input: unknown, response: unknown, s: NotionScope | undefined): string | null {
  const tool = /^mcp__notion__(.+)$/.exec(name)?.[1];
  if (!s || !s.databases.length || (tool !== "notion-search" && tool !== "notion-fetch")) return null;
  const ours = new Set(s.databases.map((d) => hexId(d.dataSourceId)));
  const tell = `${s.slug}'s own databases are ${listOf(s)}; query them by id`;
  if (tool === "notion-search") {
    if (collectionIds(input).some((x) => ours.has(x)) || (!!s.teamspaceId && hexId(obj(input).teamspace_id) === hexId(s.teamspaceId))) return null;
    return `This Notion search was not narrowed to ${s.slug}: the owner's other teamspaces have databases of the same names, and their results belong to other projects. ${tell}.`;
  }
  const parents = collectionIds(response);
  if (!parents.length || parents.some((x) => ours.has(x))) return null;
  return `What this fetch returned sits in collection://${parents[0]}, which is not one of ${s.slug}'s listed databases: if it is another project's, do not use it for ${s.slug}. ${tell}.`;
}
