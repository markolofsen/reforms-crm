import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "./context";

// P145: the three calls the Notion schema steps share (`notion.projects`, `notion.project-keys`, `notion.bug-reports`): the
// project's token from its `notion.token_file`, the headers, and a data source read. The value of a token is never printed.

export const NOTION_API = "https://api.notion.com/v1";
export const notionHeaders = (token: string) => ({ authorization: `Bearer ${token}`, "notion-version": "2025-09-03", "content-type": "application/json" });

export function notionTokenOf(ctx: Ctx, file: string): string {
  const f = path.join(ctx.configDir, file);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file) || !existsSync(f)) return "";
  try {
    return readFileSync(f, "utf8").trim();
  } catch {
    return "";
  }
}

export type LiveOption = { id?: string; name?: string; color?: string };
export type LiveProperty = { id?: string; type?: string; multi_select?: { options?: LiveOption[] }; select?: { options?: LiveOption[] }; relation?: { data_source_id?: string } };
export interface LiveDataSource { id?: string; parent?: { type?: string; database_id?: string; page_id?: string }; properties?: Record<string, LiveProperty>; archived?: boolean; in_trash?: boolean }

/** One data source, or the HTTP status Notion answered. */
export async function readDataSource(ctx: Ctx, token: string, id: string): Promise<{ ok: true; body: LiveDataSource } | { ok: false; status: number }> {
  const r = await ctx.fetch(`${NOTION_API}/data_sources/${encodeURIComponent(id)}`, { headers: notionHeaders(token), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, body: (await r.json().catch(() => ({}))) as LiveDataSource };
}

/** A PATCH of one data source's properties. Throws with the slug and Notion's status on a refusal. */
export async function patchDataSource(ctx: Ctx, token: string, id: string, properties: Record<string, unknown>, what: string): Promise<void> {
  const res = await ctx.fetch(`${NOTION_API}/data_sources/${encodeURIComponent(id)}`, { method: "PATCH", headers: notionHeaders(token), body: JSON.stringify({ properties }), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${what}: Notion answered ${res.status} (the integration needs Update content)`);
}

/** The option names of a select or multi_select, as Notion holds them. */
export const optionsOf = (p: LiveProperty | undefined): LiveOption[] => (p?.type === "multi_select" ? (p.multi_select?.options ?? []) : p?.type === "select" ? (p.select?.options ?? []) : []);
