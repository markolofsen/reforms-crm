import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { FOLLOW_UP_NOTION, FOLLOW_UP_NOTION_STATUS, FOLLOW_UP_NOTION_WAITING_ON } from "@hub/config/follow-ups";
import type { Ctx } from "./context";
import type { NotionProject } from "./notion-check";

// P142 F7 (verdict 12): the Clients database of each project carries the four Hub-owned follow-up properties: `Next follow-up`
// (date), `Follow-up status` (select), `Follow-ups sent` (number) and `Waiting on` (select). New names on purpose: the CRM sync's
// `Follow-up on`, `Waiting since`, `Last inbound` and `Last outbound` have another writer (one owner per field). A select, not a
// Status: the API cannot create a Status. One GET per project to check; one PATCH of the data source adding only the missing ones.

const API = "https://api.notion.com/v1/data_sources";
type Name = (typeof FOLLOW_UP_NOTION)[keyof typeof FOLLOW_UP_NOTION];
const select = (names: readonly string[]) => ({ select: { options: names.map((name) => ({ name })) } });

/** Each property with the type it must have and the definition a PATCH creates it with. */
export const FOLLOW_UP_FIELDS: ReadonlyArray<{ name: Name; type: "date" | "select" | "number"; create: Record<string, unknown> }> = [
  { name: FOLLOW_UP_NOTION.next, type: "date", create: { date: {} } },
  { name: FOLLOW_UP_NOTION.status, type: "select", create: select(FOLLOW_UP_NOTION_STATUS) },
  { name: FOLLOW_UP_NOTION.sent, type: "number", create: { number: { format: "number" } } },
  { name: FOLLOW_UP_NOTION.waitingOn, type: "select", create: select(FOLLOW_UP_NOTION_WAITING_ON) },
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

/** Where each project's Clients database stands on the four properties. Read only. */
export async function followUpFieldRows(ctx: Ctx, projects: readonly NotionProject[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const p of projects) {
    const ds = p.parsed.config.notion.databases.find((d) => d.slug === "clients")?.dataSourceId;
    if (!ds) continue;
    const token = tokenOf(ctx, p.parsed.config.notion.tokenFile);
    const base = { slug: p.slug, dataSourceId: ds, token, missing: [] as Name[] };
    if (!token) {
      rows.push({ ...base, state: "no_token", detail: `${p.slug}: no ${p.parsed.config.notion.tokenFile} to read Clients with` });
      continue;
    }
    try {
      const r = await ctx.fetch(`${API}/${encodeURIComponent(ds)}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) });
      if (!r.ok) {
        rows.push({ ...base, state: "error", detail: `${p.slug}: Notion answered ${r.status} for Clients (see notion.access)` });
        continue;
      }
      const body = (await r.json().catch(() => ({}))) as { properties?: Record<string, { type?: string }> };
      const missing = FOLLOW_UP_FIELDS.filter((f) => !body.properties?.[f.name]).map((f) => f.name);
      const wrong = FOLLOW_UP_FIELDS.filter((f) => body.properties?.[f.name] && body.properties[f.name]?.type !== f.type);
      if (wrong.length) rows.push({ ...base, missing, state: "wrong_type", detail: `${p.slug}: ${wrong.map((f) => `"${f.name}" is a ${body.properties?.[f.name]?.type}, not a ${f.type}`).join(", ")}: rename it in Notion` });
      else rows.push({ ...base, missing, state: missing.length ? "missing" : "ok", detail: missing.length ? `${p.slug}: no ${missing.map((m) => `"${m}"`).join(", ")}` : `${p.slug}: ok` });
    } catch (e) {
      rows.push({ ...base, state: "error", detail: `${p.slug}: cannot reach Notion (${(e as Error).name})` });
    }
  }
  return rows;
}

/** Adds the missing follow-up properties to each Clients database; returns what it did. Never touches another property. */
export async function addFollowUpFields(ctx: Ctx, rows: readonly Row[]): Promise<string> {
  const added: string[] = [];
  for (const r of rows.filter((x) => x.missing.length && (x.state === "missing" || x.state === "wrong_type"))) {
    const properties = Object.fromEntries(FOLLOW_UP_FIELDS.filter((f) => r.missing.includes(f.name)).map((f) => [f.name, f.create]));
    const res = await ctx.fetch(`${API}/${encodeURIComponent(r.dataSourceId)}`, { method: "PATCH", headers: headers(r.token), body: JSON.stringify({ properties }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`${r.slug}: Notion answered ${res.status} adding the follow-up properties (the integration needs Update content)`);
    added.push(`${r.slug} (${r.missing.length})`);
  }
  return added.length ? `added the follow-up properties to Clients of ${added.join(", ")}` : "nothing to add";
}
