import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeDatabaseEntry } from "@hub/projects/write";
import type { Ctx } from "./context";
import { NOTION_API, notionHeaders, notionTokenOf, optionsOf, patchDataSource, readDataSource, type LiveProperty } from "./notion-api";
import type { NotionProject } from "./notion-check";

// P145 B2 (verdict 16, decision 0054): the first database the installer creates. `hub install --only notion.bug-reports` makes
// "Bug reports" beside each project's Clients (under Clients' parent page: the API cannot use a teamspace root), with the pack's
// properties and options (`schema/bug-reports.json`) and a one-way relation to the project's Clients, then writes
// `bug-reports: <id>` into project.md's `## Notion databases`, which is what lets the Notion guard and the `bug_report` tool reach
// it. On a database already listed it only adds missing properties and options, never renames or removes one. Required by no kind.

export const BUG_REPORTS = "bug-reports";
const TITLE = "Bug reports";
const SELF = "bug-reports";

type PackProp = { type: string; options?: string[]; target?: string; description?: string };
export type BugProject = NotionProject & { folder: string; parsed: { config: { brands: ReadonlyArray<{ name: string }> } } };

export interface BugReportsRow {
  slug: string;
  folder: string;
  token: string;
  clients: string;
  /** The `## Brands` names: the new database's `Projects` options. */
  brands: string[];
  dataSourceId: string | null;
  /** absent: not listed (would be created); missing: properties or options to add. */
  state: "ok" | "absent" | "missing" | "wrong" | "no_token" | "error";
  /** Property name -> what a PATCH adds (a new property, or a select's options with the live ones kept). */
  add: Record<string, unknown>;
  detail: string;
}

/** The pack's properties (`schema/bug-reports.json`). */
export function bugReportsPack(packDir: string): Record<string, PackProp> {
  const f = path.join(packDir, "schema", "bug-reports.json");
  if (!existsSync(f)) throw new Error(`the Notion pack has no schema/bug-reports.json (${f})`);
  return (JSON.parse(readFileSync(f, "utf8")) as { properties: Record<string, PackProp> }).properties;
}

/** One property as the API creates it. A relation to `clients` points at the project's Clients, one way. Pure. */
export function createSpec(p: PackProp & { description?: string }, o: { clients: string; self: string | null; brands: readonly string[] }): Record<string, unknown> | null {
  const options = (names: readonly string[]) => ({ options: names.map((name) => ({ name })) });
  const described = (spec: Record<string, unknown>) => (p.description ? { ...spec, description: p.description } : spec);
  switch (p.type) {
    case "title": return described({ title: {} });
    case "text": return described({ rich_text: {} });
    case "url": return described({ url: {} });
    case "date": return described({ date: {} });
    case "select": return described({ select: options(p.options ?? []) });
    case "multi_select": return described({ multi_select: options(p.options?.length ? p.options : o.brands) });
    case "relation": {
      const to = p.target === SELF ? o.self : o.clients;
      return to ? described({ relation: { data_source_id: to, type: "single_property", single_property: {} } }) : null;
    }
    default: return null;
  }
}

const LIVE_TYPE: Record<string, string> = { title: "title", text: "rich_text", url: "url", date: "date", select: "select", multi_select: "multi_select", relation: "relation" };

/** What a listed database lacks against the pack: missing properties, and missing options of a select (live ones kept). Pure. */
export function bugReportsGaps(pack: Record<string, PackProp>, live: Record<string, LiveProperty>, o: { clients: string; self: string }): { add: Record<string, unknown>; wrong: string[] } {
  const add: Record<string, unknown> = {};
  const wrong: string[] = [];
  const norm = (id: string | undefined) => (id ?? "").replace(/-/g, "").toLowerCase();
  for (const [name, p] of Object.entries(pack)) {
    const l = live[name];
    if (!l) {
      // The title is the database's own: a live one under another name is kept (Notion has exactly one title).
      if (p.type === "title") continue;
      const spec = createSpec(p, { clients: o.clients, self: o.self, brands: [] });
      if (spec) add[name] = spec;
      continue;
    }
    if (l.type !== LIVE_TYPE[p.type]) wrong.push(`"${name}" is a ${l.type}, not a ${LIVE_TYPE[p.type]}`);
    else if (p.type === "relation" && norm(l.relation?.data_source_id) !== norm(p.target === SELF ? o.self : o.clients)) wrong.push(`"${name}" points at another database`);
    else if (p.type === "select" && p.options?.length) {
      const have = optionsOf(l);
      const missing = p.options.filter((n) => !have.some((h) => h.name === n));
      if (missing.length) add[name] = { select: { options: [...have.map((h) => ({ ...(h.id ? { id: h.id } : {}), name: h.name, ...(h.color ? { color: h.color } : {}) })), ...missing.map((n) => ({ name: n }))] } };
    }
  }
  return { add, wrong };
}

/** Where each project with a Clients database stands. Read only: one GET per listed Bug reports. */
export async function bugReportsRows(ctx: Ctx, projects: readonly BugProject[]): Promise<BugReportsRow[]> {
  const pack = bugReportsPack(ctx.paths.notionPack);
  const rows: BugReportsRow[] = [];
  for (const p of projects) {
    const dbs = p.parsed.config.notion.databases;
    const clients = dbs.find((d) => d.slug === "clients")?.dataSourceId;
    if (!clients) continue;
    const listed = dbs.find((d) => d.slug === BUG_REPORTS)?.dataSourceId ?? null;
    const token = notionTokenOf(ctx, p.parsed.config.notion.tokenFile);
    const base = { slug: p.slug, folder: p.folder, token, clients, brands: p.parsed.config.brands.map((b) => b.name), dataSourceId: listed, add: {} };
    if (!token) {
      rows.push({ ...base, state: "no_token", detail: `${p.slug}: no ${p.parsed.config.notion.tokenFile} to read Notion with` });
      continue;
    }
    if (!listed) {
      rows.push({ ...base, state: "absent", detail: `${p.slug}: no ${BUG_REPORTS} database in project.md (would be created beside Clients, ${Object.keys(pack).length} properties)` });
      continue;
    }
    try {
      const r = await readDataSource(ctx, token, listed);
      if (!r.ok) {
        rows.push({ ...base, state: "error", detail: `${p.slug}: Notion answered ${r.status} for ${BUG_REPORTS} (see notion.access)` });
        continue;
      }
      const { add, wrong } = bugReportsGaps(pack, r.body.properties ?? {}, { clients, self: listed });
      const names = Object.keys(add);
      const state = names.length ? "missing" : wrong.length ? "wrong" : "ok";
      rows.push({ ...base, add, state, detail: `${p.slug} ${BUG_REPORTS}: ${names.length ? `to add: ${names.join(", ")}` : "every property and option present, Clients relation live"}${wrong.length ? `; ${wrong.join("; ")}: fix it in Notion` : ""}` });
    } catch (e) {
      rows.push({ ...base, state: "error", detail: `${p.slug}: cannot reach Notion (${(e as Error).name})` });
    }
  }
  return rows;
}

/** The page Clients lives under: the parent of its database (a block's page when the database is inline). */
async function clientsParentPage(ctx: Ctx, token: string, clients: string): Promise<string> {
  const ds = await readDataSource(ctx, token, clients);
  if (!ds.ok) throw new Error(`Notion answered ${ds.status} reading Clients`);
  const dbId = ds.body.parent?.database_id;
  if (!dbId) throw new Error("Clients has no parent database in Notion's answer");
  const get = async (url: string) => {
    const r = await ctx.fetch(url, { headers: notionHeaders(token), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Notion answered ${r.status} reading Clients' parent`);
    return (await r.json().catch(() => ({}))) as { parent?: { type?: string; page_id?: string; block_id?: string } };
  };
  let parent = (await get(`${NOTION_API}/databases/${encodeURIComponent(dbId)}`)).parent;
  if (parent?.type === "block_id" && parent.block_id) parent = (await get(`${NOTION_API}/blocks/${encodeURIComponent(parent.block_id)}`)).parent;
  if (parent?.type !== "page_id" || !parent.page_id) throw new Error("Clients is not under a page (a teamspace root cannot hold a database the API creates): move Clients under a page, or create Bug reports by hand from schema/bug-reports.json");
  return parent.page_id;
}

/** Creates the database (absent) or adds what is missing (missing); writes project.md for a new one. Returns what it did. */
export async function applyBugReports(ctx: Ctx, rows: readonly BugReportsRow[]): Promise<string> {
  const pack = bugReportsPack(ctx.paths.notionPack);
  const done: string[] = [];
  for (const r of rows) {
    if (r.state === "missing" && r.dataSourceId) {
      await patchDataSource(ctx, r.token, r.dataSourceId, r.add, `${r.slug} ${BUG_REPORTS}`);
      done.push(`${r.slug}: added ${Object.keys(r.add).join(", ")}`);
      continue;
    }
    if (r.state !== "absent") continue;
    const page = await clientsParentPage(ctx, r.token, r.clients);
    const brands = r.brands;
    const properties = Object.fromEntries(Object.entries(pack).filter(([, p]) => p.target !== SELF).map(([n, p]) => [n, createSpec(p, { clients: r.clients, self: null, brands })]).filter(([, s]) => s !== null));
    const res = await ctx.fetch(`${NOTION_API}/databases`, { method: "POST", headers: notionHeaders(r.token), body: JSON.stringify({ parent: { type: "page_id", page_id: page }, title: [{ type: "text", text: { content: TITLE } }], initial_data_source: { properties } }), signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${r.slug}: Notion answered ${res.status} creating ${TITLE} (the integration needs Insert content on Clients' page)`);
    const body = (await res.json().catch(() => ({}))) as { data_sources?: Array<{ id?: string }> };
    const id = body.data_sources?.[0]?.id;
    if (!id) throw new Error(`${r.slug}: Notion created ${TITLE} but named no data source`);
    // The self relation needs the new data source's id, so it is a second call.
    const self = Object.entries(pack).filter(([, p]) => p.target === SELF).map(([n, p]) => [n, createSpec(p, { clients: r.clients, self: id, brands })] as const);
    if (self.length) await patchDataSource(ctx, r.token, id, Object.fromEntries(self), `${r.slug} ${BUG_REPORTS}`);
    writeDatabaseEntry(r.folder, BUG_REPORTS, id);
    done.push(`${r.slug}: created ${TITLE} (${id}) beside Clients and listed it in project.md`);
  }
  return done.length ? done.join("; ") : "nothing to do";
}
