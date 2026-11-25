import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "./context";
import type { NotionProject } from "./notion-check";
import { notionRefusal } from "./notion-api";

// P140 P1a: the pack's property descriptions are the rule a person and an agent read in Notion ("Kept current by the agent from what
// the client says (never invented); the owner may edit."). Nothing else writes a live description, so `notion.descriptions` compares
// each project's databases with the pack and, on `hub install --only notion.descriptions`, sets the ones that differ. One PATCH per
// data source; a select's options are sent back exactly as Notion holds them, so no option, colour or type is changed; nothing is
// deleted. The integration needs Update content.

const API = "https://api.notion.com/v1/data_sources";
const headers = (token: string) => ({ authorization: `Bearer ${token}`, "notion-version": "2025-09-03", "content-type": "application/json" });
const OPTION_TYPES = new Set(["select", "multi_select"]);

type LiveOption = { id?: string; name?: string; color?: string };
type LiveProp = { type?: string; description?: string | null; select?: { options?: LiveOption[] }; multi_select?: { options?: LiveOption[] } };

/** One property whose live description is not the pack's. */
export interface DescriptionChange {
  property: string;
  type: string;
  live: string;
  pack: string;
  /** A select's options as Notion holds them now: sent back unchanged with the description. */
  options?: LiveOption[];
}

export interface DescriptionRow {
  slug: string;
  database: string;
  dataSourceId: string;
  token: string;
  state: "ok" | "differs" | "no_token" | "error";
  changes: DescriptionChange[];
  detail: string;
}

/** The pack's descriptions per database (`schema/<db>.json`, `properties.<name>.description`). */
export function packDescriptions(packDir: string): Map<string, Map<string, string>> {
  const dir = path.join(packDir, "schema");
  const out = new Map<string, Map<string, string>>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const s = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { database?: string; properties?: Record<string, { description?: unknown }> };
    const m = new Map<string, string>();
    for (const [name, p] of Object.entries(s.properties ?? {})) if (typeof p.description === "string" && p.description.trim()) m.set(name, p.description.trim());
    if (s.database && m.size) out.set(s.database, m);
  }
  return out;
}

/** What differs between the pack and one live data source. Pure. A property the live database lacks is `notion.access`'s concern, not this one's. */
export function descriptionChanges(pack: ReadonlyMap<string, string>, live: Record<string, LiveProp>): DescriptionChange[] {
  const out: DescriptionChange[] = [];
  for (const [property, want] of pack) {
    const l = live[property];
    if (!l?.type) continue;
    const have = (l.description ?? "").trim();
    if (have === want) continue;
    const options = OPTION_TYPES.has(l.type) ? (l.type === "select" ? l.select?.options : l.multi_select?.options) ?? [] : undefined;
    out.push({ property, type: l.type, live: have, pack: want, ...(options ? { options } : {}) });
  }
  return out;
}

/** The PATCH body that sets the changed descriptions; a select carries its own options back, untouched. Pure. */
export function descriptionPatch(changes: readonly DescriptionChange[]): { properties: Record<string, Record<string, unknown>> } {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const c of changes) {
    const config = c.options ? { options: c.options.map((o) => ({ ...(o.id ? { id: o.id } : {}), ...(o.name ? { name: o.name } : {}), ...(o.color ? { color: o.color } : {}) })) } : {};
    properties[c.property] = { description: c.pack, [c.type]: config };
  }
  return { properties };
}

function tokenOf(ctx: Ctx, file: string): string {
  const f = path.join(ctx.configDir, file);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file) || !existsSync(f)) return "";
  try {
    return readFileSync(f, "utf8").trim();
  } catch {
    return "";
  }
}

/** Where each project's databases stand against the pack's descriptions. Read only: one GET per database that has pack descriptions. */
export async function descriptionRows(ctx: Ctx, projects: readonly NotionProject[], packDir: string): Promise<DescriptionRow[]> {
  const pack = packDescriptions(packDir);
  const rows: DescriptionRow[] = [];
  for (const p of projects) {
    for (const db of p.parsed.config.notion.databases) {
      const want = pack.get(db.slug);
      if (!want) continue;
      const base = { slug: p.slug, database: db.slug, dataSourceId: db.dataSourceId, changes: [] as DescriptionChange[] };
      const token = tokenOf(ctx, p.parsed.config.notion.tokenFile);
      if (!token) {
        rows.push({ ...base, token, state: "no_token", detail: `${p.slug}: no ${p.parsed.config.notion.tokenFile} to read ${db.slug} with` });
        continue;
      }
      try {
        const r = await ctx.fetch(`${API}/${encodeURIComponent(db.dataSourceId)}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) });
        if (!r.ok) {
          rows.push({ ...base, token, state: "error", detail: `${p.slug}: Notion answered ${r.status} for ${db.slug} (see notion.access)` });
          continue;
        }
        const body = (await r.json().catch(() => ({}))) as { properties?: Record<string, LiveProp> };
        const changes = descriptionChanges(want, body.properties ?? {});
        rows.push({ ...base, token, state: changes.length ? "differs" : "ok", changes, detail: changes.length ? `${p.slug} ${db.slug}: ${changes.map((c) => c.property).join(", ")} differ from the pack` : `${p.slug} ${db.slug}: ok` });
      } catch (e) {
        rows.push({ ...base, token, state: "error", detail: `${p.slug}: cannot reach Notion (${(e as Error).name})` });
      }
    }
  }
  return rows;
}

/** Sets the pack's descriptions where they differ: one PATCH per data source. Returns what it did. */
export async function syncDescriptions(ctx: Ctx, rows: readonly DescriptionRow[]): Promise<string> {
  const done: string[] = [];
  for (const r of rows.filter((x) => x.state === "differs")) {
    const res = await ctx.fetch(`${API}/${encodeURIComponent(r.dataSourceId)}`, { method: "PATCH", headers: headers(r.token), body: JSON.stringify(descriptionPatch(r.changes)), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`${r.slug}: setting the descriptions of ${r.database}: ${await notionRefusal(res)}`);
    done.push(`${r.slug} ${r.database} (${r.changes.length})`);
  }
  return done.length ? `set the pack's descriptions on ${done.join(", ")}` : "nothing to set";
}
