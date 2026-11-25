import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "./context";

/** The part of a loaded project this check reads. */
export interface NotionProject {
  slug: string;
  parsed: { config: { notion: { tokenFile: string; teamspace?: string | null; databases: { slug: string; dataSourceId: string }[] } } };
}

interface DataSource { archived?: boolean; in_trash?: boolean; properties?: Record<string, { type?: string; relation?: { data_source_id?: string } }> }
const norm = (id: string): string => id.replace(/-/g, "").toLowerCase();

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHARED = "notion-token";

/**
 * `doctor --project <slug>`, Notion: can the project's own integration read every database its project.md lists, is each one live
 * (not archived, not in the trash), and can it read the databases they relate to (Leads, People, ...)?
 * Read only: one GET per data source, the same call `notion-dump check` makes. The token comes from the project's
 * `notion.token_file` under the config folder. A project with its own file never falls back to the shared token (the
 * gate's rule too): a missing own file fails instead of quietly reading another workspace. The value is never printed.
 */
export async function notionCheck(ctx: Ctx, p: NotionProject): Promise<{ ok: boolean; detail: string; warnings?: string[] }> {
  const { tokenFile, databases } = p.parsed.config.notion;
  if (databases.length === 0) return { ok: false, detail: "no ## Notion databases to read" };
  if (!SAFE.test(tokenFile) || tokenFile.includes("..")) return { ok: false, detail: `notion.token_file "${tokenFile}" is not a plain file name` };

  const own = tokenFile !== SHARED;
  const file = path.join(ctx.configDir, tokenFile);
  if (!existsSync(file)) {
    return { ok: false, detail: `${file} is missing${own ? ` (${p.slug} has its own token file and never uses the shared one)` : " (run `pnpm hub token notion`)"}` };
  }
  const mode = statSync(file).mode & 0o777;
  if (mode & 0o077) return { ok: false, detail: `${file} is mode ${mode.toString(8)}, must be 600` };
  const token = readFileSync(file, "utf8").trim();
  if (!token) return { ok: false, detail: `${file} is empty` };

  const headers = { authorization: `Bearer ${token}`, "notion-version": "2025-09-03" };
  const bad: string[] = [];
  /** P145 K3 (verdict 9): an archived relation target the project does not list is a legacy or optional module the Hub never writes: a warning. */
  const warnings: string[] = [];
  const get = (id: string) => ctx.fetch(`https://api.notion.com/v1/data_sources/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(15_000) });
  const listed = new Set(databases.map((d) => norm(d.dataSourceId)));
  /** Relation targets that project.md does not list (Leads, People, ...): id -> "<database>.<property>" that points at it. */
  const targets = new Map<string, { raw: string; from: string }>();
  for (const db of databases) {
    try {
      const r = await get(db.dataSourceId);
      if (r.status === 401) return { ok: false, detail: "Notion rejected the token (401): wrong or revoked integration" };
      if (r.status === 404) bad.push(`${db.slug}: not shared with the integration (404): share it with the integration under Connections`);
      else if (r.status === 403) bad.push(`${db.slug}: the integration cannot read it (403): share it with the integration under Connections, capability Read content`);
      else if (!r.ok) bad.push(`${db.slug}: Notion answered ${r.status}`);
      else {
        const body = (await r.json().catch(() => ({}))) as DataSource;
        if (body.archived || body.in_trash) bad.push(`${db.slug}: archived in Notion (merged or removed): point project.md at the live database, or restore it`);
        for (const [name, prop] of Object.entries(body.properties ?? {})) {
          const to = prop.type === "relation" ? prop.relation?.data_source_id : undefined;
          if (to && !listed.has(norm(to)) && !targets.has(norm(to))) targets.set(norm(to), { raw: to, from: `${db.slug}.${name}` });
        }
      }
    } catch (e) {
      bad.push(`${db.slug}: cannot reach Notion (${(e as Error).name})`);
    }
  }
  for (const [id, { raw, from }] of targets) {
    const label = `${from} -> ${id.slice(0, 8)}`;
    try {
      const r = await get(raw);
      if (r.status === 404 || r.status === 403) bad.push(`relation target ${label}: not shared with the integration (${r.status}): share that database with the integration under Connections`);
      else if (!r.ok) bad.push(`relation target ${label}: Notion answered ${r.status}`);
      else {
        const body = (await r.json().catch(() => ({}))) as DataSource;
        if (body.archived || body.in_trash) warnings.push(`relation target ${label}: archived in Notion (the Hub does not use it): relink the property to the live database, or remove it`);
      }
    } catch (e) {
      bad.push(`relation target ${label}: cannot reach Notion (${(e as Error).name})`);
    }
  }
  const checked = databases.length + targets.size;
  if (bad.length) {
    const { teamspace } = p.parsed.config.notion;
    const grant = (b: string) => b.includes("(404)") || b.includes("(403)");
    const notShared = bad.filter(grant).length;
    // Every database 404: the integration sees none of the teamspace, so say that once (naming them) instead of listing seven lines.
    const none = bad.length === databases.length && bad.every((b) => !b.startsWith("relation target") && b.includes("(404)"));
    const what = none ? `the integration sees none of ${teamspace ? `teamspace "${teamspace}"` : "this project's databases"} (${databases.map((d) => d.slug).join(", ")})` : bad.join("; ");
    const fix = notShared ? ` Fix (you, in Notion): open ${teamspace ? `teamspace "${teamspace}"` : "the teamspace root page"} > ... > Connections > add the integration; or run sessions through the Notion connector, which needs no token.` : "";
    return { ok: false, detail: `${checked - bad.length}/${checked} readable; ${what}.${fix}` };
  }
  const warned = warnings.length ? `; ${warnings.join("; ")}` : "";
  return { ok: true, detail: `${databases.length}/${databases.length} readable: ${databases.map((d) => d.slug).join(", ")}${targets.size ? `; ${targets.size} relation target(s) reachable` : ""}${warned}`, ...(warnings.length ? { warnings } : {}) };
}

export interface ProjectsVerdict { ok: boolean; checked: number; detail: string; warnings?: string[] }

/**
 * W3: can the integration read every database of every project? One line: which databases fail, and which teamspace
 * page to share (Notion has no API for it). Read only. A project with no databases listed is not an error here.
 */
export async function verifyProjectDatabases(ctx: Ctx, projects: (NotionProject & { parsed: { config: { notion: { teamspace?: string | null } } } })[]): Promise<ProjectsVerdict> {
  const withDbs = projects.filter((p) => p.parsed.config.notion.databases.length > 0);
  if (!withDbs.length) return { ok: true, checked: 0, detail: "no project lists Notion databases yet" };
  const failed: { slug: string; teamspace: string | null; detail: string }[] = [];
  const warnings: string[] = [];
  for (const p of withDbs) {
    const r = await notionCheck(ctx, p);
    if (!r.ok) failed.push({ slug: p.slug, teamspace: p.parsed.config.notion.teamspace ?? null, detail: r.detail });
    for (const w of r.warnings ?? []) warnings.push(`${p.slug}: ${w}`);
  }
  if (!failed.length) return { ok: true, checked: withDbs.length, detail: `every database of ${withDbs.length} project(s) is readable${warnings.length ? `; ${warnings.join("; ")}` : ""}`, ...(warnings.length ? { warnings } : {}) };
  const names = failed.map((f) => f.slug).join(", ");
  const pages = [...new Set(failed.map((f) => (f.teamspace ? `"${f.teamspace}"` : `the Notion root page of ${f.slug}`)))].join(" and ");
  return { ok: false, checked: withDbs.length, detail: `unreachable for ${names}: share the teamspace page ${pages} with the integration (Notion: ... > Connections). ${failed[0]!.detail}` };
}
