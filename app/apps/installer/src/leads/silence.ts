// The receiving side of a lead form (P46 L3): when did a lead last arrive where the form lands? Read only, WARN only.
//   notion-leads: the newest `Received at` in the project's Leads database, by `Brand` (and `Form` when two forms share a brand).
//   mailbox:      the newest notification mail in a Mail account, by sender and subject, through mail-mcp (the Apple Mail read path).
// Only dates are read and printed: never a name, an address or a message.
import { fileState, readValue } from "@hub/connections";
import { loadProject } from "@hub/projects";
import type { Ctx } from "../context";
import { readJson } from "../context";
import { mcpCall } from "../mcp-probe";
import type { CheckResult } from "../types";
import type { Silence } from "./config";
import { errText } from "./net";

export const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
/** The history a threshold is measured from, and the floor of a measured threshold (plan P46 design b). */
export const HISTORY_DAYS = 90;
export const FLOOR_DAYS = 14;
const DAY = 864e5;
/** Notion pages of 100 read at most for the history: 1,000 leads in 90 days is far above any form we have. */
const MAX_PAGES = 10;
const NOTION_TIMEOUT_MS = 15_000;

export interface SilenceOut { level: CheckResult["level"]; detail: string }
type Read = { ok: true; dates: number[] } | { ok: false; why: string };

/** max(14, 3 x the median gap between consecutive leads), in whole days; undefined below 3 leads (under one a month in 90 days). */
export function measuredDays(dates: number[]): number | undefined {
  const t = [...dates].sort((a, b) => a - b);
  if (t.length < 3) return undefined;
  const gaps = t.slice(1).map((x, i) => x - t[i]!).sort((a, b) => a - b);
  const mid = gaps.length / 2;
  const median = gaps.length % 2 ? gaps[Math.floor(mid)]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  return Math.max(FLOOR_DAYS, Math.ceil((3 * median) / DAY));
}

async function readNotion(ctx: Ctx, s: Extract<Silence, { source: "notion-leads" }>, since: number): Promise<Read> {
  let notion;
  try { notion = loadProject(ctx.paths.projects, s.project).parsed.config.notion; } catch (e) { return { ok: false, why: errText(e) }; }
  const db = notion.databases.find((d) => d.slug === "leads");
  if (!db) return { ok: false, why: `project ${s.project} lists no leads database under ## Notion databases` };
  const st = fileState(ctx.configDir, notion.tokenFile);
  if (st.state !== "stored") return { ok: false, why: `state/secrets/${notion.tokenFile} is ${st.state === "unsafe-mode" ? `mode ${st.mode}, must be 600` : st.state}` };
  const token = readValue(ctx.configDir, notion.tokenFile)!;
  const filter = { and: [
    { property: "Brand", multi_select: { contains: s.brand } },
    { property: "Received at", date: { on_or_after: new Date(since).toISOString() } },
    ...(s.form ? [{ property: "Form", rich_text: { equals: s.form } }] : []),
  ] };
  const dates: number[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    let r: Response;
    try {
      r = await ctx.fetch(`${NOTION_API}/data_sources/${encodeURIComponent(db.dataSourceId)}/query`, {
        method: "POST", signal: AbortSignal.timeout(NOTION_TIMEOUT_MS),
        headers: { authorization: `Bearer ${token}`, "notion-version": NOTION_VERSION, "content-type": "application/json" },
        body: JSON.stringify({ filter, sorts: [{ property: "Received at", direction: "descending" }], page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      });
    } catch (e) { return { ok: false, why: `Notion: ${errText(e)}` }; }
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { message?: string };
      return { ok: false, why: `Notion answered ${r.status}${body.message ? `: ${body.message.slice(0, 120)}` : ""}` };
    }
    const j = (await r.json()) as { results?: { properties?: Record<string, { date?: { start?: string } | null }> }[]; has_more?: boolean; next_cursor?: string | null };
    for (const row of j.results ?? []) {
      const start = row.properties?.["Received at"]?.date?.start;
      const t = start ? Date.parse(start) : NaN;
      if (Number.isFinite(t)) dates.push(t);
    }
    if (!j.has_more || !j.next_cursor) break;
    cursor = j.next_cursor;
  }
  return { ok: true, dates };
}

async function readMailbox(ctx: Ctx, s: Extract<Silence, { source: "mailbox" }>, since: number): Promise<Read> {
  const account = s.account ?? readJson<{ account?: string }>(ctx.paths.configFile)?.account;
  if (!account) return { ok: false, why: "no account: set silence.account or `account` in config/config.json" };
  const r = await mcpCall(ctx, ctx.mailUrl, "find_messages", {
    account, mailboxPath: s.mailbox, dateAfter: new Date(since).toISOString(), limit: 1000,
    ...(s.sender ? { sender: s.sender } : {}), ...(s.subject ? { subject: s.subject } : {}),
  });
  if (!r.ok) return { ok: false, why: `mail-mcp find_messages: ${r.text.slice(0, 120)}` };
  let j: { messages?: { date_received?: string }[] };
  try { j = JSON.parse(r.text) as typeof j; } catch { return { ok: false, why: "mail-mcp answered something that is not JSON" }; }
  return { ok: true, dates: (j.messages ?? []).map((m) => Date.parse(m.date_received ?? "")).filter(Number.isFinite) };
}

const ago = (ms: number) => { const d = ms / DAY; return d < 1 ? `${Math.max(0, Math.round(d * 24))} h ago` : `${d.toFixed(1)} d ago`; };
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The silence half of one form's row. `none` says nothing (the row stays as the GET half left it). */
export async function checkSilence(ctx: Ctx, s: Silence, now = Date.now()): Promise<SilenceOut | undefined> {
  if (s.source === "none") return undefined;
  const lookback = Math.max(HISTORY_DAYS, s.days ?? 0);
  const since = now - lookback * DAY;
  const where = s.source === "notion-leads" ? `Notion Leads, Brand ${s.brand}${s.form ? `, Form ${s.form}` : ""}` : `mail ${s.mailbox.join("/")} from ${s.sender ?? "anyone"}${s.subject ? ` "${s.subject}"` : ""}`;
  const read = s.source === "notion-leads" ? await readNotion(ctx, s, since) : await readMailbox(ctx, s, since);
  if (!read.ok) return { level: "warn", detail: `silence not checked (${where}): ${read.why}` };
  const measured = measuredDays(read.dates);
  const limit = s.days ?? measured;
  const n = read.dates.length;
  if (limit === undefined) return { level: "warn", detail: `silence: ${n} lead(s) in ${lookback} d at ${where}, under one a month: set silence.days, or source none (the canary guards it)` };
  const how = s.days ? `warns after ${limit} d` : `warns after ${limit} d (measured: max(${FLOOR_DAYS}, 3 x median gap))`;
  if (!n) return { level: "warn", detail: `silence: no lead in ${lookback} d at ${where}, ${how}` };
  const newest = Math.max(...read.dates);
  const age = now - newest;
  if (age > limit * DAY) return { level: "warn", detail: `silence: no lead for ${(age / DAY).toFixed(0)} d (newest ${day(newest)}) at ${where}, ${how}: check the form and where it lands` };
  return { level: "pass", detail: `silence ok: newest lead ${ago(age)}, ${n} in ${lookback} d, ${how}` };
}
