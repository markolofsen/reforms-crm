import { join } from "node:path";
import { LEAD_PREVIEW_CHARS, type NewLead, type Repos } from "@hub/db";
import { createNotionReader, leadFactsOf, loadToken, NoTokenError, parseLeadDetail, secretsDir, type LeadDetail, type NotionReader } from "@hub/notion";
import { convertLead, createLeadWriter, notionFailure, writeLeadStatus, type LeadWriter, type LeadWriteStatus } from "@hub/notion/leads-write";
import { brandForKey } from "@hub/projects/brands";
import { projectStore } from "@hub/projects/store";
import type { ProjectConfig } from "@hub/projects/model";
import { errFields, ops } from "@hub/log/ops";

/**
 * The Leads reader (P97 S2, decision 0044, verdicts 2 and 9 as the owner answered them on 2026-11-21). For each active project
 * whose project.md lists a `leads` database, the server reads that Notion data source with the project's token, every 15 minutes
 * and at once when the Mail reader sees a new lead notice (the notice is the trigger, never the source). It keeps the pages
 * received in the last `leads.window_days` (default 14) in `lead_rows` and counts the older ones still New (one muted line; the
 * Hub never writes them). The whole data source is listed and filtered here, so a Status that is a select on one instance and a
 * status on another needs no filter of its type. No token: the line says so and nothing fails.
 */
export const LEADS_REFRESH_MS = 15 * 60_000;
export const NO_LEADS_TOKEN = "Leads are not read: no Notion token (./run.sh token notion)";

export interface LeadsProjectStatus {
  slug: string;
  readAt: string | null;
  /** Why the project's Leads are not read now; null when the last read went through. */
  reason: string | null;
  /** New (or empty Status) leads received before the window: one muted count. */
  older: number;
  windowDays: number;
}

export interface LeadsStatus {
  state: "off" | "running" | "error";
  reason: string | null;
  reading: boolean;
  projects: LeadsProjectStatus[];
}

export interface LeadsHandle {
  status(): LeadsStatus;
  /** One read now (all projects, or one): a read already running is the one awaited. */
  read(project?: string): Promise<void>;
  /** The card's live read of one lead page, or why not. */
  page(project: string, pageId: string): Promise<{ lead: LeadDetail } | { note: string }>;
  /** S5: Spam, or New on its Undo (the owner's click), written in Notion. */
  setStatus(project: string, pageId: string, status: LeadWriteStatus): Promise<{ state: "written" | "skipped" | "refused" | "off"; note: string | null }>;
  stop(): void;
}

export interface LeadsOptions {
  repos: Repos;
  projectsDir: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** Set when Notion must not be read at all (the fake Mailer: a demo or e2e run): the reason the line shows. */
  offReason?: string;
  /** Tests: the reader and writer for a token (default: the real ones). */
  clients?: (token: string) => { reader: NotionReader; writer: LeadWriter };
  refreshMs?: number;
  /** false: no first read and no timer (tests call `read`). */
  auto?: boolean;
}

const DAY = 86_400_000;
const pageKey = (id: string) => id.replace(/-/g, "").toLowerCase();

interface Target {
  slug: string;
  config: ProjectConfig;
  leads: string;
}

/** Lead.Brand as the project's `## Brands` row name (the same project key, decision 0053), else the Notion option as written. */
export function brandOf(lead: Pick<LeadDetail, "brands">, config: Pick<ProjectConfig, "brands">): string | null {
  for (const b of lead.brands) {
    const row = brandForKey(config.brands, b);
    if (row) return row.name;
  }
  return lead.brands[0] ?? null;
}

/** When a lead arrived: `Received at`, else the page's creation time. */
const receivedOf = (lead: LeadDetail, page: { created_time?: unknown }): string => lead.receivedAt ?? (typeof page.created_time === "string" ? page.created_time : "");

/** Pure: one listing of a Leads data source to the rows of the window and the count of older New ones. */
export function windowOf(pages: ReadonlyArray<{ created_time?: unknown } & Parameters<typeof parseLeadDetail>[0]>, o: { project: string; config: Pick<ProjectConfig, "brands" | "leads">; now: Date }): { rows: NewLead[]; older: number } {
  const since = new Date(o.now.getTime() - o.config.leads.windowDays * DAY).toISOString();
  const rows: NewLead[] = [];
  let older = 0;
  for (const page of pages) {
    const l = parseLeadDetail(page);
    const at = receivedOf(l, page);
    const isNew = l.status === null || l.status === "New";
    if (!at || at < since.slice(0, at.length)) {
      if (isNew) older++;
      continue;
    }
    // P98 item 4: the preview is what the person wrote (Message); the form's metadata (Details: locale, host, consent) never is.
    const text = l.message.replace(/\s+/g, " ").trim();
    rows.push({ project: o.project, pageId: pageKey(l.id), name: l.name, email: l.replyTo, accountEmail: l.email ? l.email.trim().toLowerCase() : null, brand: brandOf(l, o.config), receivedAt: at, preview: text.slice(0, LEAD_PREVIEW_CHARS), notionStatus: l.status, hasClient: l.hasClient, facts: leadFactsOf(l.sheet), phone: l.phone ?? l.otherContact });
  }
  return { rows, older };
}

export function startLeadsReader(o: LeadsOptions): LeadsHandle {
  const env = o.env ?? process.env;
  const now = o.now ?? (() => new Date());
  const st: LeadsStatus = { state: o.offReason ? "off" : "running", reason: o.offReason ?? null, reading: false, projects: [] };
  let running: Promise<void> | null = null;

  async function targets(): Promise<Target[]> {
    const out: Target[] = [];
    for (const row of (await o.repos.projects.registry()).projects) {
      if (row.status !== "active" || row.archived || row.slug.startsWith("_")) continue;
      try {
        const config = projectStore({ projects: o.projectsDir }).config(row.slug);
        const leads = config.notion.databases.find((d) => d.slug === "leads")?.dataSourceId;
        if (leads) out.push({ slug: row.slug, config, leads });
      } catch {
        // A project.md that does not parse is the doctor's to report.
      }
    }
    return out;
  }

  async function clientsOf(config: ProjectConfig): Promise<{ reader: NotionReader; writer: LeadWriter }> {
    const file = config.notion.tokenFile;
    const token = await loadToken(file === "notion-token" ? env : { ...env, NOTION_TOKEN: "" }, join(secretsDir(env), file));
    return o.clients?.(token) ?? { reader: createNotionReader(token), writer: createLeadWriter(token) };
  }

  const put = (s: LeadsProjectStatus) => {
    st.projects = [...st.projects.filter((p) => p.slug !== s.slug), s];
  };

  async function readOne(t: Target): Promise<void> {
    const prev = st.projects.find((p) => p.slug === t.slug);
    const base = { slug: t.slug, windowDays: t.config.leads.windowDays };
    try {
      const { reader } = await clientsOf(t.config);
      const pages = [];
      for await (const p of reader.listPages(t.leads)) pages.push(p);
      const { rows, older } = windowOf(pages, { project: t.slug, config: t.config, now: now() });
      const added = await o.repos.leadRows.sync(rows, now());
      if (added) ops("notion").info("new leads read from Notion Leads", { project: t.slug, rows: added });
      put({ ...base, readAt: now().toISOString(), reason: null, older });
    } catch (e) {
      const why = e instanceof NoTokenError ? NO_LEADS_TOKEN : `Leads could not be read from Notion (${notionFailure(e).status ?? (e instanceof Error ? e.name : "error")})`;
      if (!(e instanceof NoTokenError)) ops("notion").error("reading the Notion Leads failed", { project: t.slug, ...notionFailure(e), error: e instanceof Error ? e.name : "error" });
      put({ ...base, readAt: prev?.readAt ?? null, reason: why, older: prev?.older ?? 0 });
    }
  }

  async function pass(project?: string): Promise<void> {
    if (o.offReason) return;
    st.reading = true;
    try {
      const all = await targets();
      const todo = project ? all.filter((t) => t.slug === project) : all;
      for (const t of todo) await readOne(t);
      if (!project) st.projects = st.projects.filter((p) => all.some((t) => t.slug === p.slug));
      const failed = st.projects.filter((p) => p.reason && p.reason !== NO_LEADS_TOKEN);
      st.state = failed.length ? "error" : "running";
      st.reason = failed[0]?.reason ?? null;
    } finally {
      st.reading = false;
    }
  }

  const read = (project?: string) => (running ??= pass(project).catch((e: unknown) => ops("notion").error("a pass of the Leads reader failed", errFields(e))).finally(() => (running = null)));

  const timer = o.auto === false || o.offReason ? null : setInterval(() => void read(), o.refreshMs ?? LEADS_REFRESH_MS);
  timer?.unref?.();
  if (o.auto !== false && !o.offReason) void read();

  async function targetOf(project: string): Promise<Target | null> {
    return (await targets()).find((t) => t.slug === project) ?? null;
  }

  return {
    status: () => ({ ...st, projects: st.projects.map((p) => ({ ...p })) }),
    read,
    async page(project, pageId) {
      if (o.offReason) return { note: `${o.offReason}: only the stored preview shows.` };
      const t = await targetOf(project);
      if (!t) return { note: "project.md lists no leads database (## Notion databases)." };
      try {
        const { writer } = await clientsOf(t.config);
        if (!writer.retrievePage) return { note: "This Hub cannot read a lead page." };
        return { lead: parseLeadDetail(await writer.retrievePage(pageId)) };
      } catch (e) {
        if (e instanceof NoTokenError) return { note: NO_LEADS_TOKEN };
        ops("notion").warn("reading a lead page for its card failed", { project, ...notionFailure(e) });
        return { note: "Notion could not show this lead now." };
      }
    },
    async setStatus(project, pageId, status) {
      if (o.offReason) return { state: "off", note: `${o.offReason}: Notion is not written.` };
      const t = await targetOf(project);
      if (!t) return { state: "skipped", note: "project.md lists no leads database (## Notion databases)." };
      try {
        const r = await writeLeadStatus(await clientsOf(t.config), { leadsDataSource: t.leads, pageId, status });
        if (r.state === "written") {
          await o.repos.leadRows.setStatus(project, [pageId], status);
          ops("notion").info(`lead Status set to ${status} in Notion`, { project });
          return { state: "written", note: null };
        }
        const note = r.state === "refused" ? r.note : `Notion was not changed: ${r.reason}`;
        ops("notion").warn("lead Status not written in Notion", { project, status, detail: note });
        return { state: r.state, note };
      } catch (e) {
        if (e instanceof NoTokenError) return { state: "skipped", note: NO_LEADS_TOKEN };
        ops("notion").warn("writing a lead's Status failed", { project, wanted: status, ...notionFailure(e), error: e instanceof Error ? e.name : "error" });
        return { state: "refused", note: `Notion did not take the Status (${notionFailure(e).status ?? "error"}): set it in Notion` };
      }
    },
    stop: () => {
      if (timer) clearInterval(timer);
    },
  };
}

/** The Leads line of one project for the admin: when Leads were last read, or why not, and the older count. */
export function projectLeadsOf(s: LeadsStatus, slug: string, windowDays = 14): { at: string | null; reason: string | null; reading: boolean; older: number; windowDays: number } {
  const p = s.projects.find((x) => x.slug === slug);
  const reason = s.state === "off" ? s.reason : (p?.reason ?? null);
  return { at: p?.readAt ?? null, reason, reading: s.reading, older: p?.older ?? 0, windowDays: p?.windowDays ?? windowDays };
}

export const LEADS_OFF: LeadsStatus = { state: "off", reason: "Notion Leads are not read here", reading: false, projects: [] };

export interface ConvertEnv {
  repos: Repos;
  projectsDir: string;
  env?: NodeJS.ProcessEnv;
  clients?: (token: string) => { reader: NotionReader; writer: LeadWriter };
  now?: () => Date;
}

/**
 * P97 S4 (verdict 5, decision 0044 point 3): one confirmed send (the door's `onSent` or Sent detection) to an address that is a
 * stored lead of the project and not converted yet: link or create the lead's Clients card and set the lead In progress, then
 * record it on the lead rows. Called before the P89 stamp, so the stamp finds the card. Never throws; a refusal is the row's
 * note (the card and the doctor show it) and one ops-log line. `notion.convert_leads off`: nothing.
 */
export async function convertSentLead(c: ConvertEnv, n: { project: string; to: readonly string[]; draftId: number }): Promise<{ state: "none" | "off" | "converted" | "noted" | "failed"; note?: string }> {
  const log = ops("notion");
  try {
    const email = n.to.map((a) => (/<([^>]+)>/.exec(a)?.[1] ?? a).trim().toLowerCase()).find((a) => a.includes("@"));
    if (!email) return { state: "none" };
    const rows = (await c.repos.leadRows.ofEmail(n.project, email)).filter((r) => !r.convertedAt && r.dismissedReason !== "spam");
    const lead = rows[0];
    if (!lead) return { state: "none" };
    const config = projectStore({ projects: c.projectsDir }).config(n.project);
    if (config.notion.convertLeads === "off") return { state: "off" };
    const leads = config.notion.databases.find((d) => d.slug === "leads")?.dataSourceId;
    const clients = config.notion.databases.find((d) => d.slug === "clients")?.dataSourceId;
    const now = (c.now ?? (() => new Date()))();
    const ids = rows.map((r) => r.pageId);
    if (!leads || !clients) {
      const note = `project.md lists no ${leads ? "clients" : "leads"} database: the lead's Clients card was not made`;
      await c.repos.leadRows.markConverted(n.project, ids, { clientPageId: null, note }, now);
      log.warn("lead not converted at the send", { project: n.project, draft: n.draftId, detail: note });
      return { state: "noted", note };
    }
    const env = c.env ?? process.env;
    const file = config.notion.tokenFile;
    let token: string;
    try {
      token = await loadToken(file === "notion-token" ? env : { ...env, NOTION_TOKEN: "" }, join(secretsDir(env), file));
    } catch (e) {
      if (!(e instanceof NoTokenError)) throw e;
      const note = `no Notion token on this Mac: ask the dock to create ${lead.name}'s Clients card`;
      await c.repos.leadRows.markConverted(n.project, ids, { clientPageId: null, note }, now);
      log.info("lead not converted at the send: no Notion token", { project: n.project, draft: n.draftId });
      return { state: "noted", note };
    }
    const deps = c.clients?.(token) ?? { reader: createNotionReader(token), writer: createLeadWriter(token) };
    // P147 D3: a lead the pass decided `client` (an exact address match) is linked to that client's own card, never a lookup.
    const card = lead.passClientId ? await c.repos.clients.notionPageOf(n.project, lead.passClientId) : null;
    // P147 verdict 8: the profile facts of the form go on the card (a new one: all; a linked one: the empty ones only).
    const profile = { company: null, site: lead.site, country: lead.country, segment: lead.segment, volume: lead.volume };
    const r = await convertLead(deps, { leadsDataSource: leads, clientsDataSource: clients, leadPageId: lead.pageId, email, name: lead.name, brand: lead.brand, stored: { hasClient: lead.hasClient, status: lead.notionStatus }, profile, card });
    await c.repos.leadRows.markConverted(n.project, ids, { clientPageId: r.clientPageId, note: r.note }, now);
    if (r.status === "in_progress") await c.repos.leadRows.setStatus(n.project, [lead.pageId], "In progress");
    (r.note ? log.warn : log.info)(r.note ? "lead converted at the send, with a note for the owner" : "lead converted at the send (Clients card, In progress)", { project: n.project, draft: n.draftId, card: r.card, status: r.status, ...(r.note ? { detail: r.note } : {}) });
    return r.note ? { state: "noted", note: r.note } : { state: "converted" };
  } catch (e) {
    log.warn("converting the lead at the send failed", { project: n.project, draft: n.draftId, ...notionFailure(e), error: e instanceof Error ? e.name : "error" });
    return { state: "failed" };
  }
}
