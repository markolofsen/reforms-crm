import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LEAD_PASS_NOTION, LEAD_PASS_NOTION_DECISION } from "@hub/config/lead-pass";
import type { Ctx } from "./context";
import type { NotionProject } from "./notion-check";
import { notionRefusal } from "./notion-api";

// P147 L7 (decision 0055 point 5): the Leads database of each project carries the two Hub-owned lead pass properties, `Hub
// decision` (select of the pass's decisions) and `Hub reason` (text). New names on purpose: Status, Owner and Notes have other
// writers (one owner per field). One GET per project to check; one PATCH of the data source adding only the missing ones.

const API = "https://api.notion.com/v1/data_sources";
type Name = (typeof LEAD_PASS_NOTION)[keyof typeof LEAD_PASS_NOTION];

/** Each property with the type it must have and the definition a PATCH creates it with. */
export const LEAD_PASS_FIELDS: ReadonlyArray<{ name: Name; type: "select" | "rich_text"; create: Record<string, unknown> }> = [
  { name: LEAD_PASS_NOTION.decision, type: "select", create: { select: { options: Object.values(LEAD_PASS_NOTION_DECISION).map((name) => ({ name })) } } },
  { name: LEAD_PASS_NOTION.reason, type: "rich_text", create: { rich_text: {} } },
];

type Row = { slug: string; state: "ok" | "missing" | "wrong_type" | "no_token" | "error"; dataSourceId: string; token: string; missing: Name[]; detail: string };

function tokenOf(ctx: Ctx, file: string): string {
  const f = path.join(ctx.configDir, file);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file) || !existsSync(f)) return "";
  try {
    return readFileSync(f, "utf8").trim();
  } catch {
    return "";
  }
}

const headers = (token: string) => ({ authorization: `Bearer ${token}`, "notion-version": "2025-09-03", "content-type": "application/json" });

/** Where each project's Leads database stands on the two properties. Read only. */
export async function leadPassFieldRows(ctx: Ctx, projects: readonly NotionProject[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const p of projects) {
    const ds = p.parsed.config.notion.databases.find((d) => d.slug === "leads")?.dataSourceId;
    if (!ds) continue;
    const token = tokenOf(ctx, p.parsed.config.notion.tokenFile);
    const base = { slug: p.slug, dataSourceId: ds, token, missing: [] as Name[] };
    if (!token) {
      rows.push({ ...base, state: "no_token", detail: `${p.slug}: no ${p.parsed.config.notion.tokenFile} to read Leads with` });
      continue;
    }
    try {
      const r = await ctx.fetch(`${API}/${encodeURIComponent(ds)}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) });
      if (!r.ok) {
        rows.push({ ...base, state: "error", detail: `${p.slug}: Notion answered ${r.status} for Leads (see notion.access)` });
        continue;
      }
      const body = (await r.json().catch(() => ({}))) as { properties?: Record<string, { type?: string }> };
      const missing = LEAD_PASS_FIELDS.filter((f) => !body.properties?.[f.name]).map((f) => f.name);
      const wrong = LEAD_PASS_FIELDS.filter((f) => body.properties?.[f.name] && body.properties[f.name]?.type !== f.type);
      if (wrong.length) rows.push({ ...base, missing, state: "wrong_type", detail: `${p.slug}: ${wrong.map((f) => `"${f.name}" is a ${body.properties?.[f.name]?.type}, not a ${f.type}`).join(", ")}: rename it in Notion` });
      else rows.push({ ...base, missing, state: missing.length ? "missing" : "ok", detail: missing.length ? `${p.slug}: no ${missing.map((m) => `"${m}"`).join(", ")}` : `${p.slug}: ok` });
    } catch (e) {
      rows.push({ ...base, state: "error", detail: `${p.slug}: cannot reach Notion (${(e as Error).name})` });
    }
  }
  return rows;
}

/** Adds the missing lead pass properties to each Leads database; returns what it did. Never touches another property. */
export async function addLeadPassFields(ctx: Ctx, rows: readonly Row[]): Promise<string> {
  const added: string[] = [];
  for (const r of rows.filter((x) => x.missing.length && (x.state === "missing" || x.state === "wrong_type"))) {
    const properties = Object.fromEntries(LEAD_PASS_FIELDS.filter((f) => r.missing.includes(f.name)).map((f) => [f.name, f.create]));
    const res = await ctx.fetch(`${API}/${encodeURIComponent(r.dataSourceId)}`, { method: "PATCH", headers: headers(r.token), body: JSON.stringify({ properties }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`${r.slug}: adding the lead pass properties: ${await notionRefusal(res)}`);
    added.push(`${r.slug} (${r.missing.length})`);
  }
  return added.length ? `added the lead pass properties to Leads of ${added.join(", ")}` : "nothing to add";
}
