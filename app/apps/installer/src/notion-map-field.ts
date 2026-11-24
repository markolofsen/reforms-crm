import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { MAP_DATE_FIELD } from "@hub/notion/client-map";
import type { Ctx } from "./context";
import type { NotionProject } from "./notion-check";

// P135 K5 (verdict 2): the Clients database of each project carries the date property "Map updated", so a Notion view sorts
// clients by their newest map. `hub install` adds it through the API (a date is creatable; a Status or a cross-database formula
// is not, and this needs neither). One GET per project to check; one PATCH of the data source's properties to add it, nothing else.

const API = "https://api.notion.com/v1/data_sources";
type Row = { slug: string; state: "ok" | "missing" | "wrong_type" | "no_token" | "error"; dataSourceId: string; token: string; detail: string };

function tokenOf(ctx: Ctx, file: string): string {
  const f = path.join(ctx.configDir, file);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file) || !existsSync(f)) return "";
  try { return readFileSync(f, "utf8").trim(); } catch { return ""; }
}

const headers = (token: string) => ({ authorization: `Bearer ${token}`, "notion-version": "2025-09-03", "content-type": "application/json" });

/** Where each project's Clients database stands on "Map updated". Read only. */
export async function mapFieldRows(ctx: Ctx, projects: readonly NotionProject[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const p of projects) {
    const ds = p.parsed.config.notion.databases.find((d) => d.slug === "clients")?.dataSourceId;
    if (!ds) continue;
    const token = tokenOf(ctx, p.parsed.config.notion.tokenFile);
    if (!token) { rows.push({ slug: p.slug, state: "no_token", dataSourceId: ds, token, detail: `${p.slug}: no ${p.parsed.config.notion.tokenFile} to read Clients with` }); continue; }
    try {
      const r = await ctx.fetch(`${API}/${encodeURIComponent(ds)}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) });
      if (!r.ok) { rows.push({ slug: p.slug, state: "error", dataSourceId: ds, token, detail: `${p.slug}: Notion answered ${r.status} for Clients (see notion.access)` }); continue; }
      const body = (await r.json().catch(() => ({}))) as { properties?: Record<string, { type?: string }> };
      const type = body.properties?.[MAP_DATE_FIELD]?.type;
      rows.push({ slug: p.slug, state: type === "date" ? "ok" : type ? "wrong_type" : "missing", dataSourceId: ds, token, detail: type === "date" ? `${p.slug}: ok` : type ? `${p.slug}: "${MAP_DATE_FIELD}" is a ${type}, not a date: rename it in Notion` : `${p.slug}: no "${MAP_DATE_FIELD}"` });
    } catch (e) {
      rows.push({ slug: p.slug, state: "error", dataSourceId: ds, token, detail: `${p.slug}: cannot reach Notion (${(e as Error).name})` });
    }
  }
  return rows;
}

/** Adds "Map updated" (date) to each Clients database that lacks it; returns what it did. Never touches another property. */
export async function addMapField(ctx: Ctx, rows: readonly Row[]): Promise<string> {
  const added: string[] = [];
  for (const r of rows.filter((x) => x.state === "missing")) {
    const res = await ctx.fetch(`${API}/${encodeURIComponent(r.dataSourceId)}`, { method: "PATCH", headers: headers(r.token), body: JSON.stringify({ properties: { [MAP_DATE_FIELD]: { date: {} } } }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`${r.slug}: Notion answered ${res.status} adding "${MAP_DATE_FIELD}" (the integration needs Update content)`);
    added.push(r.slug);
  }
  return added.length ? `added "${MAP_DATE_FIELD}" to Clients of ${added.join(", ")}` : "nothing to add";
}
